import csv
import io
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from pathlib import Path

from database import get_db, init_db
from payroll_engine import calculate_student_payroll

app = FastAPI(title="Student Attendance Payroll System", version="1.0.0")

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"

# Ensure tables exist at startup
init_db()

# --- Pydantic Schemas ---
class StudentCreate(BaseModel):
    student_id: str = Field(..., example="STU-001")
    name: str = Field(..., example="John Doe")
    email: str = Field(..., example="john@example.com")
    daily_rate: float = Field(50.0, ge=0.0)
    currency: str = Field("$", max_length=5)

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
    entries: List[dict] # [{"student_id": 1, "status": "present", "notes": ""}, ...]


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
            "INSERT INTO students (student_id, name, email, daily_rate, currency) VALUES (?, ?, ?, ?, ?)",
            (student.student_id.strip(), student.name.strip(), student.email.strip(), student.daily_rate, student.currency.strip())
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


# --- API Routes: Payroll Calculation ---
@app.get("/api/payroll/{period_id}")
def get_period_payroll(period_id: int):
    conn = get_db()
    period = conn.execute("SELECT * FROM periods WHERE id = ?", (period_id,)).fetchone()
    if not period:
        conn.close()
        raise HTTPException(status_code=404, detail="Pay period not found")
    
    period_dict = dict(period)
    students = conn.execute("SELECT * FROM students ORDER BY name ASC").fetchall()
    
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

@app.get("/api/payroll/{period_id}/export-csv")
def export_payroll_csv(period_id: int):
    payroll_data = get_period_payroll(period_id)
    records = payroll_data["payroll_records"]
    period = payroll_data["period"]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Student ID", "Student Name", "Email", "Total Expected Days", 
        "Days Present", "Days Absent", "Days Excused", 
        "Attendance %", "Min Required %", "Eligibility Status", 
        "Daily Rate", "Gross Pay", "Notes/Audit"
    ])

    for r in records:
        writer.writerow([
            r["student_code"],
            r["name"],
            r["email"],
            r["total_sessions"],
            r["days_present"],
            r["days_absent"],
            r["days_excused"],
            f"{r['attendance_percentage']}%",
            f"{r['threshold_percent']}%",
            "ELIGIBLE (PAID)" if r["is_eligible"] else "INELIGIBLE (UNPAID)",
            f"{r['currency']}{r['daily_rate']:.2f}",
            f"{r['currency']}{r['gross_pay']:.2f}",
            r["eligibility_reason"]
        ])

    output.seek(0)
    filename = f"payroll_period_{period_id}_{period['name'].replace(' ', '_')}.csv"
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# --- API Route: Seed Realistic Demo Data ---
@app.post("/api/seed")
def seed_demo_data():
    conn = get_db()
    cursor = conn.cursor()

    # Clear previous mock data
    cursor.execute("DELETE FROM attendance")
    cursor.execute("DELETE FROM students")
    cursor.execute("DELETE FROM periods")

    # 1. Create a pay period with 20 total sessions (70% threshold = 14 days required)
    cursor.execute("""
        INSERT INTO periods (name, start_date, end_date, total_sessions, threshold_percent)
        VALUES ('October 2026 Academic Cohort', '2026-10-01', '2026-10-31', 20, 70.0)
    """)
    period_id = cursor.lastrowid

    # 2. Add realistic students with diverse attendance profiles
    # (Notice how 70% of 20 is exactly 14 days!)
    students_data = [
        # (code, name, email, daily_rate, days_present, days_excused)
        ("STU-101", "Amara Okafor", "amara@school.edu", 50.0, 19, 0),    # 95% -> ELIGIBLE ($950)
        ("STU-102", "Liam Smith", "liam@school.edu", 50.0, 17, 1),       # 85% -> ELIGIBLE ($850)
        ("STU-103", "Zainab Al-Mansoor", "zainab@school.edu", 55.0, 16, 0),# 80% -> ELIGIBLE ($880)
        ("STU-104", "Carlos Mendez", "carlos@school.edu", 50.0, 14, 0),   # Exactly 14/20 = 70.0% -> ELIGIBLE ($700)
        ("STU-105", "Fatima Hassan", "fatima@school.edu", 60.0, 13, 0),   # 13/20 = 65.0% -> INELIGIBLE ($0.00) (Just 1 day short!)
        ("STU-106", "David Chen", "david@school.edu", 50.0, 10, 2),       # 10/20 = 50.0% -> INELIGIBLE ($0.00)
        ("STU-107", "Khadija Abubakar", "khadija@school.edu", 50.0, 18, 0),# 90% -> ELIGIBLE ($900)
        ("STU-108", "Noah Williams", "noah@school.edu", 45.0, 6, 1),      # 6/20 = 30.0% -> INELIGIBLE ($0.00)
    ]

    for code, name, email, rate, pres, exc in students_data:
        cursor.execute("""
            INSERT INTO students (student_id, name, email, daily_rate, currency)
            VALUES (?, ?, ?, ?, '$')
        """, (code, name, email, rate))
        s_id = cursor.lastrowid

        # Populate 20 days of records
        # day 1 to 20
        absent_count = 20 - (pres + exc)
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

    conn.commit()
    conn.close()
    return {"message": "Demo data populated successfully with 8 students, 20 attendance sessions, and 70% threshold test cases."}


# Serve Static files & Frontend
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
def serve_index():
    return FileResponse(STATIC_DIR / "index.html")
