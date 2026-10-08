import csv
import io
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, HTTPException, Query, Response, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from pathlib import Path

from database import get_db, init_db
from payroll_engine import calculate_student_payroll
from pdf_generator import generate_pdf_payslip

app = FastAPI(title="Student Attendance Payroll System", version="2.0.0")

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"

# Ensure tables and migrations exist at startup
init_db()

# --- Pydantic Schemas ---
class StudentCreate(BaseModel):
    student_id: str = Field(..., example="STU-001")
    name: str = Field(..., example="John Doe")
    email: str = Field(..., example="john@example.com")
    daily_rate: float = Field(50.0, ge=0.0)
    currency: str = Field("$", max_length=5)
    bank_name: Optional[str] = ""
    account_number: Optional[str] = ""
    account_name: Optional[str] = ""

class PeriodCreate(BaseModel):
    name: str = Field(..., example="October 2026")
    start_date: str = Field(..., example="2026-10-01")
    end_date: str = Field(..., example="2026-10-31")
    total_sessions: int = Field(20, gt=0)
    threshold_percent: float = Field(70.0, ge=0.0, le=100.0)

class AttendanceEntry(BaseModel):
    student_id: int
    period_id: int
    date: str
    status: str = Field(..., pattern="^(present|absent|excused)$")
    notes: Optional[str] = None

class BatchAttendanceEntry(BaseModel):
    period_id: int
    date: str
    entries: List[dict]

class StudentAttendanceUpdate(BaseModel):
    student_id: int
    period_id: int
    days_present: Optional[int] = None
    sessions: Optional[List[dict]] = None

class QRCheckinRequest(BaseModel):
    period_id: int
    student_code: str
    date: Optional[str] = None

class PayoutStatusUpdate(BaseModel):
    student_id: int
    period_id: int
    amount: float
    payment_status: str = Field(..., pattern="^(pending|processing|disbursed)$")
    transaction_ref: Optional[str] = None
    notes: Optional[str] = None


# --- API Routes: Students ---
@app.get("/api/students")
def list_students():
    conn = get_db()
    rows = conn.execute("SELECT * FROM students ORDER BY id ASC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/students")
def create_student(student: StudentCreate):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO students (student_id, name, email, daily_rate, currency, bank_name, account_number, account_name) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                student.student_id.strip(),
                student.name.strip(),
                student.email.strip(),
                student.daily_rate,
                student.currency.strip(),
                (student.bank_name or "").strip(),
                (student.account_number or "").strip(),
                (student.account_name or "").strip()
            )
        )
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return {"id": new_id, "message": "Student created successfully"}
    except Exception as e:
        conn.close()
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/students/{id}")
def delete_student(id: int):
    conn = get_db()
    conn.execute("DELETE FROM students WHERE id = ?", (id,))
    conn.commit()
    conn.close()
    return {"message": "Student deleted"}


# --- API Routes: Pay Periods ---
@app.get("/api/periods")
def list_periods():
    conn = get_db()
    rows = conn.execute("SELECT * FROM periods ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/periods")
def create_period(period: PeriodCreate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO periods (name, start_date, end_date, total_sessions, threshold_percent) VALUES (?, ?, ?, ?, ?)",
        (period.name.strip(), period.start_date, period.end_date, period.total_sessions, period.threshold_percent)
    )
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return {"id": new_id, "message": "Pay period created successfully"}


# --- API Routes: Attendance ---
@app.get("/api/attendance")
def get_attendance(period_id: Optional[int] = None, date: Optional[str] = None):
    conn = get_db()
    query = """
    SELECT a.*, s.name as student_name, s.student_id as student_code 
    FROM attendance a 
    JOIN students s ON a.student_id = s.id
    WHERE 1=1
    """
    params = []
    if period_id:
        query += " AND a.period_id = ?"
        params.append(period_id)
    if date:
        query += " AND a.date = ?"
        params.append(date)
    query += " ORDER BY a.date DESC, s.name ASC"

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/attendance/batch")
def save_batch_attendance(batch: BatchAttendanceEntry):
    conn = get_db()
    cursor = conn.cursor()
    saved = 0
    for item in batch.entries:
        s_id = item.get("student_id")
        status = item.get("status", "absent")
        notes = item.get("notes", "")
        cursor.execute("""
            INSERT INTO attendance (student_id, period_id, date, status, notes)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(student_id, period_id, date) DO UPDATE SET
                status = excluded.status,
                notes = excluded.notes
        """, (s_id, batch.period_id, batch.date, status, notes))
        saved += 1
    conn.commit()
    conn.close()
    return {"message": f"Successfully logged attendance for {saved} students."}

@app.get("/api/attendance/student/{student_id}")
def get_student_attendance(student_id: int, period_id: int):
    conn = get_db()
    student = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        conn.close()
        raise HTTPException(status_code=404, detail="Student not found")
    
    period = conn.execute("SELECT * FROM periods WHERE id = ?", (period_id,)).fetchone()
    if not period:
        conn.close()
        raise HTTPException(status_code=404, detail="Period not found")
        
    student_dict = dict(student)
    period_dict = dict(period)

    att_rows = conn.execute(
        "SELECT * FROM attendance WHERE student_id = ? AND period_id = ? ORDER BY date ASC",
        (student_id, period_id)
    ).fetchall()
    att_list = [dict(a) for a in att_rows]
    conn.close()

    calc = calculate_student_payroll(student_dict, period_dict, att_list)
    calc["bank_name"] = student_dict.get("bank_name", "")
    calc["account_number"] = student_dict.get("account_number", "")
    calc["account_name"] = student_dict.get("account_name", "")

    return {
        "student": student_dict,
        "period": period_dict,
        "calculation": calc,
        "sessions": att_list
    }

@app.post("/api/attendance/student-update")
def update_student_attendance(update_data: StudentAttendanceUpdate):
    conn = get_db()
    cursor = conn.cursor()

    student = conn.execute("SELECT * FROM students WHERE id = ?", (update_data.student_id,)).fetchone()
    if not student:
        conn.close()
        raise HTTPException(status_code=404, detail="Student not found")
    period = conn.execute("SELECT * FROM periods WHERE id = ?", (update_data.period_id,)).fetchone()
    if not period:
        conn.close()
        raise HTTPException(status_code=404, detail="Period not found")
    
    student_dict = dict(student)
    period_dict = dict(period)
    total_sessions = period_dict.get("total_sessions", 20)

    if update_data.days_present is not None:
        target_present = max(0, min(total_sessions, update_data.days_present))
        
        existing = conn.execute(
            "SELECT date FROM attendance WHERE student_id = ? AND period_id = ? ORDER BY date ASC",
            (update_data.student_id, update_data.period_id)
        ).fetchall()
        
        dates = [r["date"] for r in existing]
        if len(dates) < total_sessions:
            start_date = period_dict.get("start_date", "2026-10-01")
            prefix = start_date[:8]
            dates = [f"{prefix}{d:02d}" for d in range(1, total_sessions + 1)]
        
        for idx, d in enumerate(dates):
            st = "present" if idx < target_present else "absent"
            cursor.execute("""
                INSERT INTO attendance (student_id, period_id, date, status, notes)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(student_id, period_id, date) DO UPDATE SET
                    status = excluded.status
            """, (update_data.student_id, update_data.period_id, d, st, "Updated via Attendance Manager"))

    elif update_data.sessions is not None:
        for item in update_data.sessions:
            d = item.get("date")
            st = item.get("status", "absent")
            notes = item.get("notes", "Updated session")
            cursor.execute("""
                INSERT INTO attendance (student_id, period_id, date, status, notes)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(student_id, period_id, date) DO UPDATE SET
                    status = excluded.status,
                    notes = excluded.notes
            """, (update_data.student_id, update_data.period_id, d, st, notes))

    conn.commit()

    att_rows = conn.execute(
        "SELECT * FROM attendance WHERE student_id = ? AND period_id = ? ORDER BY date ASC",
        (update_data.student_id, update_data.period_id)
    ).fetchall()
    att_list = [dict(a) for a in att_rows]
    conn.close()

    calc = calculate_student_payroll(student_dict, period_dict, att_list)
    return {
        "message": "Attendance updated successfully!",
        "calculation": calc,
        "is_eligible": calc["is_eligible"],
        "attendance_percentage": calc["attendance_percentage"],
        "gross_pay": calc["gross_pay"],
        "payout_status": calc["payout_status"]
    }

# --- FEATURE 2: CSV Attendance Bulk Upload & Template ---
@app.post("/api/attendance/upload-csv")
async def upload_attendance_csv(period_id: int = Form(...), file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")
    
    content = await file.read()
    text = content.decode('utf-8-sig', errors='replace')
    reader = csv.DictReader(io.StringIO(text))
    
    conn = get_db()
    cursor = conn.cursor()
    
    all_students = conn.execute("SELECT id, student_id FROM students").fetchall()
    stu_map = {s["student_id"].upper(): s["id"] for s in all_students}
    stu_id_map = {str(s["id"]): s["id"] for s in all_students}

    imported = 0
    skipped = 0
    
    for row in reader:
        code = row.get("student_code") or row.get("student_id") or row.get("Student ID") or ""
        date = row.get("date") or row.get("Date") or ""
        status = (row.get("status") or row.get("Status") or "present").strip().lower()
        notes = row.get("notes") or row.get("Notes") or "CSV Bulk Upload"

        if status not in ("present", "absent", "excused"):
            status = "present"
        
        s_id = stu_map.get(code.strip().upper()) or stu_id_map.get(code.strip())
        if not s_id or not date:
            skipped += 1
            continue

        cursor.execute("""
            INSERT INTO attendance (student_id, period_id, date, status, notes)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(student_id, period_id, date) DO UPDATE SET
                status = excluded.status,
                notes = excluded.notes
        """, (s_id, period_id, date.strip(), status, notes.strip()))
        imported += 1

    conn.commit()
    conn.close()
    return {
        "message": f"Successfully imported {imported} attendance records ({skipped} skipped/invalid).",
        "imported": imported,
        "skipped": skipped
    }

@app.get("/api/attendance/sample-template")
def get_sample_attendance_csv():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["student_code", "date", "status", "notes"])
    writer.writerow(["STU-101", "2026-10-21", "present", "Classroom check-in"])
    writer.writerow(["STU-102", "2026-10-21", "present", "Classroom check-in"])
    writer.writerow(["STU-105", "2026-10-21", "absent", "Medical leave"])
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=attendance_template.csv"}
    )


# --- FEATURE 3: QR Code Check-in Endpoint ---
@app.post("/api/attendance/qr-checkin")
def qr_checkin(req: QRCheckinRequest):
    conn = get_db()
    clean_code = req.student_code.strip()
    if clean_code.startswith("L2E:"):
        clean_code = clean_code[4:]

    student = conn.execute(
        "SELECT * FROM students WHERE UPPER(student_id) = ? OR id = ?",
        (clean_code.upper(), clean_code if clean_code.isdigit() else -1)
    ).fetchone()
    
    if not student:
        conn.close()
        raise HTTPException(status_code=404, detail=f"No student found with ID/Code: '{clean_code}'")

    period = conn.execute("SELECT * FROM periods WHERE id = ?", (req.period_id,)).fetchone()
    if not period:
        conn.close()
        raise HTTPException(status_code=404, detail="Period not found")

    student_dict = dict(student)
    period_dict = dict(period)
    checkin_date = req.date or datetime.now().strftime("%Y-%m-%d")

    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO attendance (student_id, period_id, date, status, notes)
        VALUES (?, ?, ?, 'present', 'QR Digital Check-in')
        ON CONFLICT(student_id, period_id, date) DO UPDATE SET
            status = 'present',
            notes = 'QR Digital Check-in'
    """, (student_dict["id"], req.period_id, checkin_date))
    conn.commit()

    att_rows = conn.execute(
        "SELECT * FROM attendance WHERE student_id = ? AND period_id = ?",
        (student_dict["id"], req.period_id)
    ).fetchall()
    conn.close()

    calc = calculate_student_payroll(student_dict, period_dict, [dict(a) for a in att_rows])
    return {
        "message": f"Checked in {student_dict['name']} successfully!",
        "student": student_dict,
        "checkin_date": checkin_date,
        "days_present": calc["days_present"],
        "total_sessions": calc["total_sessions"],
        "attendance_percentage": calc["attendance_percentage"],
        "threshold_percent": calc["threshold_percent"],
        "is_eligible": calc["is_eligible"],
        "gross_pay": calc["gross_pay"]
    }


# --- API Routes: Payroll Calculation & FEATURE 1: PDF Payslip ---
@app.get("/api/payroll/{period_id}")
def get_period_payroll(period_id: int):
    conn = get_db()
    period = conn.execute("SELECT * FROM periods WHERE id = ?", (period_id,)).fetchone()
    if not period:
        conn.close()
        raise HTTPException(status_code=404, detail="Pay period not found")
    
    period_dict = dict(period)
    students = conn.execute("SELECT * FROM students ORDER BY name ASC").fetchall()
    payout_rows = conn.execute("SELECT * FROM payouts WHERE period_id = ?", (period_id,)).fetchall()
    payout_map = {p["student_id"]: dict(p) for p in payout_rows}
    
    results = []
    total_disbursed = 0.0
    total_potential = 0.0
    total_forfeited = 0.0
    eligible_count = 0
    ineligible_count = 0
    total_attendance_pct_sum = 0.0

    for s in students:
        s_dict = dict(s)
        att_rows = conn.execute(
            "SELECT * FROM attendance WHERE student_id = ? AND period_id = ?",
            (s_dict["id"], period_id)
        ).fetchall()
        att_list = [dict(a) for a in att_rows]

        calc = calculate_student_payroll(s_dict, period_dict, att_list)
        calc["bank_name"] = s_dict.get("bank_name", "")
        calc["account_number"] = s_dict.get("account_number", "")
        calc["account_name"] = s_dict.get("account_name", "")
        
        p_info = payout_map.get(s_dict["id"], {})
        calc["payment_status"] = p_info.get("payment_status", "pending" if calc["is_eligible"] else "unpaid")
        calc["transaction_ref"] = p_info.get("transaction_ref", "")
        calc["paid_at"] = p_info.get("paid_at", "")

        results.append(calc)

        total_disbursed += calc["gross_pay"]
        total_potential += calc["potential_earnings"]
        total_forfeited += calc["forfeited_amount"]
        total_attendance_pct_sum += calc["attendance_percentage"]

        if calc["is_eligible"]:
            eligible_count += 1
        else:
            ineligible_count += 1

    student_count = len(students)
    avg_attendance = round(total_attendance_pct_sum / student_count, 1) if student_count > 0 else 0.0

    conn.close()
    return {
        "period": period_dict,
        "summary": {
            "total_students": student_count,
            "eligible_students": eligible_count,
            "ineligible_students": ineligible_count,
            "eligibility_rate_percent": round((eligible_count / student_count * 100), 1) if student_count > 0 else 0.0,
            "total_disbursed": round(total_disbursed, 2),
            "total_forfeited": round(total_forfeited, 2),
            "average_attendance": avg_attendance,
            "threshold_required": period_dict.get("threshold_percent", 70.0)
        },
        "payroll_records": results
    }

@app.get("/api/payroll/{period_id}/student/{student_id}/pdf")
def get_student_payslip_pdf(period_id: int, student_id: int):
    conn = get_db()
    student = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if not student:
        conn.close()
        raise HTTPException(status_code=404, detail="Student not found")
    period = conn.execute("SELECT * FROM periods WHERE id = ?", (period_id,)).fetchone()
    if not period:
        conn.close()
        raise HTTPException(status_code=404, detail="Period not found")
    
    att_rows = conn.execute(
        "SELECT * FROM attendance WHERE student_id = ? AND period_id = ? ORDER BY date ASC",
        (student_id, period_id)
    ).fetchall()
    
    payout = conn.execute(
        "SELECT * FROM payouts WHERE student_id = ? AND period_id = ?",
        (student_id, period_id)
    ).fetchone()
    conn.close()

    student_dict = dict(student)
    period_dict = dict(period)
    att_list = [dict(a) for a in att_rows]
    payout_dict = dict(payout) if payout else {}

    calc = calculate_student_payroll(student_dict, period_dict, att_list)
    calc["bank_name"] = student_dict.get("bank_name", "")
    calc["account_number"] = student_dict.get("account_number", "")
    calc["account_name"] = student_dict.get("account_name", "")

    pdf_buffer = generate_pdf_payslip(calc, period_dict, payout_dict)
    filename = f"payslip_{calc['student_code']}_{period_dict['name'].replace(' ', '_')}.pdf"
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/payroll/{period_id}/export-csv")
def export_payroll_csv(period_id: int):
    payroll_data = get_period_payroll(period_id)
    records = payroll_data["payroll_records"]
    period = payroll_data["period"]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Student ID", "Student Name", "Email", "Bank Name", "Account Number", "Total Expected Days", 
        "Days Present", "Days Absent", "Days Excused", 
        "Attendance %", "Min Required %", "Eligibility Status", 
        "Daily Rate", "Gross Pay", "Disbursal Status", "Txn Ref", "Notes/Audit"
    ])

    for r in records:
        writer.writerow([
            r["student_code"],
            r["name"],
            r["email"],
            r.get("bank_name", ""),
            r.get("account_number", ""),
            r["total_sessions"],
            r["days_present"],
            r["days_absent"],
            r["days_excused"],
            f"{r['attendance_percentage']}%",
            f"{r['threshold_percent']}%",
            "ELIGIBLE (PAID)" if r["is_eligible"] else "INELIGIBLE (UNPAID)",
            f"{r['currency']}{r['daily_rate']:.2f}",
            f"{r['currency']}{r['gross_pay']:.2f}",
            r.get("payment_status", "pending"),
            r.get("transaction_ref", ""),
            r["eligibility_reason"]
        ])

    output.seek(0)
    filename = f"payroll_period_{period_id}_{period['name'].replace(' ', '_')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# --- FEATURE 4: Payout Tracking Endpoints ---
@app.get("/api/payouts/{period_id}")
def get_period_payouts(period_id: int):
    conn = get_db()
    rows = conn.execute("SELECT * FROM payouts WHERE period_id = ?", (period_id,)).fetchall()
    conn.close()
    return {r["student_id"]: dict(r) for r in rows}

@app.post("/api/payouts/update-status")
def update_payout_status(p: PayoutStatusUpdate):
    conn = get_db()
    cursor = conn.cursor()
    paid_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if p.payment_status == "disbursed" else None
    ref = p.transaction_ref or f"TXN-{datetime.now().strftime('%Y%m%d')}-{p.student_id:04d}"

    cursor.execute("""
        INSERT INTO payouts (student_id, period_id, amount, payment_status, transaction_ref, paid_at, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, period_id) DO UPDATE SET
            amount = excluded.amount,
            payment_status = excluded.payment_status,
            transaction_ref = excluded.transaction_ref,
            paid_at = excluded.paid_at,
            notes = excluded.notes
    """, (p.student_id, p.period_id, p.amount, p.payment_status, ref, paid_at, p.notes or ""))
    conn.commit()
    conn.close()
    return {"message": "Payout status updated successfully!", "status": p.payment_status, "ref": ref}


# --- API Route: Seed Realistic Demo Data ---
@app.post("/api/seed")
def seed_demo_data():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM payouts")
    cursor.execute("DELETE FROM attendance")
    cursor.execute("DELETE FROM students")
    cursor.execute("DELETE FROM periods")

    cursor.execute("""
        INSERT INTO periods (name, start_date, end_date, total_sessions, threshold_percent)
        VALUES ('October 2026 Academic Cohort', '2026-10-01', '2026-10-31', 20, 70.0)
    """)
    period_id = cursor.lastrowid

    students_data = [
        # (code, name, email, daily_rate, days_present, days_excused, bank, acc_num)
        ("STU-101", "Amara Okafor", "amara@school.edu", 50.0, 19, 0, "Chase Bank", "1029384756"),
        ("STU-102", "Liam Smith", "liam@school.edu", 50.0, 17, 1, "Bank of America", "4938201948"),
        ("STU-103", "Zainab Al-Mansoor", "zainab@school.edu", 55.0, 16, 0, "Wells Fargo", "7839201948"),
        ("STU-104", "Carlos Mendez", "carlos@school.edu", 50.0, 14, 0, "Citibank", "3920194857"),
        ("STU-105", "Fatima Hassan", "fatima@school.edu", 60.0, 13, 0, "First Bank", "8392019483"),
        ("STU-106", "David Chen", "david@school.edu", 50.0, 10, 2, "TD Bank", "2910394857"),
        ("STU-107", "Khadija Abubakar", "khadija@school.edu", 50.0, 18, 0, "PNC Bank", "5839201948"),
        ("STU-108", "Noah Williams", "noah@school.edu", 45.0, 6, 1, "Capital One", "9182736450"),
    ]

    for code, name, email, rate, pres, exc, bank, acc in students_data:
        cursor.execute("""
            INSERT INTO students (student_id, name, email, daily_rate, currency, bank_name, account_number, account_name)
            VALUES (?, ?, ?, ?, '$', ?, ?, ?)
        """, (code, name, email, rate, bank, acc, name))
        s_id = cursor.lastrowid

        for day in range(1, 21):
            date_str = f"2026-10-{day:02d}"
            if day <= pres:
                status = "present"
            elif day <= pres + exc:
                status = "excused"
            else:
                status = "absent"
            
            cursor.execute("""
                INSERT INTO attendance (student_id, period_id, date, status, notes)
                VALUES (?, ?, ?, ?, ?)
            """, (s_id, period_id, date_str, status, "Classroom verification"))

        # Seed initial payout record for eligible students
        pct = (pres / 20.0) * 100
        if pct >= 70.0:
            cursor.execute("""
                INSERT INTO payouts (student_id, period_id, amount, payment_status, transaction_ref)
                VALUES (?, ?, ?, 'pending', ?)
            """, (s_id, period_id, pres * rate, f"TXN-202610-{s_id:04d}"))

    conn.commit()
    conn.close()
    return {"message": "Demo data populated with 8 students, 20 attendance sessions, banking info, and payout status records."}


# Serve Static files & Frontend
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
def serve_index():
    return FileResponse(STATIC_DIR / "index.html")
