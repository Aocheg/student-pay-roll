"""
Payroll Engine: Calculates student payroll strictly governed by attendance.
Rule:
- Attendance percentage must be >= threshold_percent (default 70.0%).
- If attendance < 70%:
    Eligibility: INELIGIBLE
    Payment: 0.00
    Reason: Below minimum attendance requirement.
- If attendance >= 70%:
    Eligibility: ELIGIBLE
    Payment: days_present * daily_rate
"""

from typing import Dict, Any, List

def calculate_student_payroll(
    student: Dict[str, Any],
    period: Dict[str, Any],
    attendance_records: List[Dict[str, Any]]
) -> Dict[str, Any]:
    total_sessions = period.get("total_sessions", 0)
    threshold_percent = period.get("threshold_percent", 70.0)
    daily_rate = float(student.get("daily_rate", 0.0))
    currency = student.get("currency", "$")

    # Count attendance types
    days_present = sum(1 for rec in attendance_records if rec["status"] == "present")
    days_absent = sum(1 for rec in attendance_records if rec["status"] == "absent")
    days_excused = sum(1 for rec in attendance_records if rec["status"] == "excused")
    days_logged = len(attendance_records)

    # Attendance percentage based on total required sessions in period
    if total_sessions > 0:
        attendance_percentage = round((days_present / total_sessions) * 100, 2)
    else:
        attendance_percentage = 0.0

    is_eligible = attendance_percentage >= threshold_percent

    potential_earnings = round(days_present * daily_rate, 2)
    max_possible_earnings = round(total_sessions * daily_rate, 2)

    if is_eligible:
        gross_pay = potential_earnings
        payout_status = "APPROVED"
        eligibility_reason = f"Met attendance requirement ({attendance_percentage}% >= {threshold_percent}%)"
    else:
        gross_pay = 0.0
        payout_status = "REJECTED_BELOW_THRESHOLD"
        shortfall = round(threshold_percent - attendance_percentage, 2)
        needed_days = int(-(-((threshold_percent / 100.0) * total_sessions) // 1)) # ceil
        additional_needed = max(0, needed_days - days_present)
        eligibility_reason = (
            f"Attendance below threshold ({attendance_percentage}% < {threshold_percent}%). "
            f"Shortfall: {shortfall}% (Needed at least {needed_days} present days, short by {additional_needed} days)."
        )

    return {
        "student_id": student.get("id"),
        "student_code": student.get("student_id"),
        "name": student.get("name"),
        "email": student.get("email"),
        "currency": currency,
        "daily_rate": daily_rate,
        "period_id": period.get("id"),
        "period_name": period.get("name"),
        "total_sessions": total_sessions,
        "days_logged": days_logged,
        "days_present": days_present,
        "days_absent": days_absent,
        "days_excused": days_excused,
        "attendance_percentage": attendance_percentage,
        "threshold_percent": threshold_percent,
        "is_eligible": is_eligible,
        "payout_status": payout_status,
        "eligibility_reason": eligibility_reason,
        "gross_pay": gross_pay,
        "potential_earnings": potential_earnings,
        "max_possible_earnings": max_possible_earnings,
        "forfeited_amount": potential_earnings if not is_eligible else 0.0,
    }
