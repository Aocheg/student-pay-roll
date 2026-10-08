import unittest
from database import init_db, get_db
from payroll_engine import calculate_student_payroll

class TestPayrollThreshold(unittest.TestCase):
    def setUp(self):
        self.period = {
            "id": 1,
            "name": "Cohort 1",
            "total_sessions": 20,
            "threshold_percent": 70.0
        }
        self.student = {
            "id": 101,
            "student_id": "STU-001",
            "name": "Test Student",
            "email": "test@school.edu",
            "daily_rate": 50.0,
            "currency": "$"
        }

    def test_exactly_70_percent(self):
        # 14 out of 20 = 70.0% -> Must be ELIGIBLE
        records = [{"status": "present"} for _ in range(14)] + [{"status": "absent"} for _ in range(6)]
        result = calculate_student_payroll(self.student, self.period, records)
        self.assertTrue(result["is_eligible"])
        self.assertEqual(result["attendance_percentage"], 70.0)
        self.assertEqual(result["gross_pay"], 700.0) # 14 * 50
        self.assertEqual(result["payout_status"], "APPROVED")

    def test_just_below_threshold_65_percent(self):
        # 13 out of 20 = 65.0% -> Must be INELIGIBLE ($0.00 payout)
        records = [{"status": "present"} for _ in range(13)] + [{"status": "absent"} for _ in range(7)]
        result = calculate_student_payroll(self.student, self.period, records)
        self.assertFalse(result["is_eligible"])
        self.assertEqual(result["attendance_percentage"], 65.0)
        self.assertEqual(result["gross_pay"], 0.0)
        self.assertEqual(result["payout_status"], "REJECTED_BELOW_THRESHOLD")
        self.assertEqual(result["forfeited_amount"], 650.0)

    def test_high_attendance_90_percent(self):
        # 18 out of 20 = 90.0% -> Must be ELIGIBLE
        records = [{"status": "present"} for _ in range(18)] + [{"status": "absent"} for _ in range(2)]
        result = calculate_student_payroll(self.student, self.period, records)
        self.assertTrue(result["is_eligible"])
        self.assertEqual(result["attendance_percentage"], 90.0)
        self.assertEqual(result["gross_pay"], 900.0)

    def test_pdf_generation(self):
        import io
        from pdf_generator import generate_pdf_payslip
        records = [{"status": "present"} for _ in range(16)] + [{"status": "absent"} for _ in range(4)]
        calc = calculate_student_payroll(self.student, self.period, records)
        pdf_buffer = generate_pdf_payslip(self.student, self.period, calc)
        self.assertIsInstance(pdf_buffer, io.BytesIO)
        content = pdf_buffer.getvalue()
        self.assertTrue(len(content) > 1000)
        self.assertTrue(content.startswith(b"%PDF"))


if __name__ == "__main__":
    unittest.main()

