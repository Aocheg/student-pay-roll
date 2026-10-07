# Student Attendance-Based Payroll System

A full-stack payroll application where students are compensated strictly based on verified attendance, enforcing a mandatory minimum **70% attendance threshold**.

---

## 📌 Core Payroll Policy & Calculation Rules

1. **Eligibility Requirement (70% Threshold)**:
   $$\text{Attendance Rate} = \left(\frac{\text{Sessions Attended}}{\text{Total Required Sessions}}\right) \times 100\%$$
   - **If Attendance Rate $\ge$ 70.0%**: The student is **ELIGIBLE** for payment.
   - **If Attendance Rate < 70.0%**: The student is **INELIGIBLE**. Payout is **$0.00** (strictly forfeited).

2. **Pro-rated Payout Formula**:
   $$\text{Gross Pay} = \begin{cases} \text{Days Present} \times \text{Daily Rate}, & \text{if Attendance Rate} \ge 70\% \\ \$0.00, & \text{if Attendance Rate} < 70\% \end{cases}$$

---

## 🚀 Quick Start Guide

### 1. Start the Server
The application runs on FastAPI and SQLite.
```bash
cd /home/student/student_payroll_app
./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Access the Web Dashboard
Open your browser at:
- **Web Dashboard**: [http://localhost:8000](http://localhost:8000)
- **Interactive API Documentation (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 🌟 Key Features

1. **Live Dashboard & KPI Overview**:
   - Total students enrolled & eligible vs. ineligible ratio.
   - Total payroll disbursed vs. total amount forfeited due to failing the 70% threshold.
   - Cohort average attendance rate with visual health meter.

2. **Strict Attendance Payroll Table**:
   - Color-coded badges: Green for **ELIGIBLE (PAID)**, Red for **INELIGIBLE (<70%)**.
   - Attendance percentage progress bar with target marker.
   - Instant computation of Days Present $\times$ Daily Stipend Rate.

3. **Detailed Payslip & Audit Breakdown**:
   - Click **Payslip** on any student to view their audit slip.
   - For ineligible students, shows the exact shortfall (e.g. *"Short by 1 day to reach 70%"*).
   - Printable slip format.

4. **Daily Attendance Logger**:
   - Select any session date.
   - Quickly mark Present, Absent, or Excused for the entire roster.
   - 1-click **Save Attendance & Recalculate**.

5. **Student & Cohort Management**:
   - Add new students with custom daily stipend rates and currency symbols.
   - Create new pay periods/cohorts with custom dates and session counts.

6. **Export & Reporting**:
   - Download the complete payroll sheet as a standard CSV file ready for finance/disbursal.

---

## 🧪 Running Automated Tests

Run the test suite to verify threshold calculations and boundary conditions:
```bash
cd /home/student/student_payroll_app
./venv/bin/python test_payroll.py
```
