import sqlite3
from typing import Optional
from pathlib import Path

DB_PATH = Path(__file__).parent / "payroll.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Students table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        daily_rate REAL NOT NULL DEFAULT 50.0,
        currency TEXT NOT NULL DEFAULT '$',
        bank_name TEXT DEFAULT '',
        account_number TEXT DEFAULT '',
        account_name TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Column migrations for existing tables
    existing_cols = [c[1] for c in cursor.execute("PRAGMA table_info(students)").fetchall()]
    if "bank_name" not in existing_cols:
        cursor.execute("ALTER TABLE students ADD COLUMN bank_name TEXT DEFAULT ''")
    if "account_number" not in existing_cols:
        cursor.execute("ALTER TABLE students ADD COLUMN account_number TEXT DEFAULT ''")
    if "account_name" not in existing_cols:
        cursor.execute("ALTER TABLE students ADD COLUMN account_name TEXT DEFAULT ''")

    # Pay Periods table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        total_sessions INTEGER NOT NULL,
        threshold_percent REAL NOT NULL DEFAULT 70.0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Attendance table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        period_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'excused')),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE,
        UNIQUE(student_id, period_id, date)
    )
    """)

    # Payouts Tracking table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        period_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending', 'processing', 'disbursed')),
        transaction_ref TEXT,
        paid_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE,
        UNIQUE(student_id, period_id)
    )
    """)

    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at", DB_PATH)
