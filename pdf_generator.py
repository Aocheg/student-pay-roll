import io
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

def generate_pdf_payslip(student_record: dict, period: dict, payout_info: dict = None) -> io.BytesIO:
    """
    Generates an executive-grade PDF payslip for a student based on attendance and 70% cutoff rule.
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=colors.HexColor('#0f172a'),
        alignment=TA_LEFT
    )
    subtitle_style = ParagraphStyle(
        'DocSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=14,
        textColor=colors.HexColor('#059669'),
        alignment=TA_LEFT
    )
    meta_style = ParagraphStyle(
        'MetaStyle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#64748b'),
        alignment=TA_RIGHT
    )
    h2_style = ParagraphStyle(
        'H2Style',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=colors.HexColor('#1e293b')
    )
    body_style = ParagraphStyle(
        'BodyDark',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#334155')
    )
    bold_style = ParagraphStyle(
        'BodyBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=12,
        textColor=colors.HexColor('#0f172a')
    )

    elements = []

    # 1. Header (Brand + Document Metadata)
    date_str = datetime.now().strftime("%B %d, %Y")
    slip_no = f"PAY-{period.get('id', 1):03d}-{student_record.get('student_code', 'STU')}-{datetime.now().strftime('%Y%m')}"

    header_data = [
        [
            Paragraph("<b>Learn2Earn Academic System</b>", subtitle_style),
            Paragraph(f"<b>Date:</b> {date_str}", meta_style)
        ],
        [
            Paragraph("STUDENT ATTENDANCE PAYSLIP", title_style),
            Paragraph(f"<b>Ref No:</b> {slip_no}", meta_style)
        ]
    ]
    header_table = Table(header_data, colWidths=[4.2 * inch, 3.0 * inch])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 10))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#059669'), spaceAfter=12))

    # 2. Eligibility Status Banner
    is_eligible = student_record.get('is_eligible', False)
    pct = student_record.get('attendance_percentage', 0.0)
    cutoff = student_record.get('threshold_percent', 70.0)
    gross_pay = student_record.get('gross_pay', 0.0)
    currency = student_record.get('currency', '$')

    if is_eligible:
        banner_bg = colors.HexColor('#ecfdf5')
        banner_border = colors.HexColor('#059669')
        banner_text = (
            f"<b>ELIGIBILITY STATUS: APPROVED FOR PAYMENT (≥ {cutoff}% CUTOFF MET)</b><br/>"
            f"<font size=8.5 color='#047857'>Student verified with {pct}% verified classroom attendance. Full prorated stipend approved.</font>"
        )
    else:
        banner_bg = colors.HexColor('#fff1f2')
        banner_border = colors.HexColor('#e11d48')
        banner_text = (
            f"<b>ELIGIBILITY STATUS: FORFEITED — BELOW {cutoff}% ATTENDANCE CUTOFF</b><br/>"
            f"<font size=8.5 color='#be123c'>Student recorded {pct}% attendance (below {cutoff}% minimum). In accordance with policy, payout is {currency}0.00.</font>"
        )

    banner_data = [[Paragraph(banner_text, ParagraphStyle('BannerP', parent=styles['Normal'], fontName='Helvetica', fontSize=9.5, leading=13, textColor=banner_border))]]
    banner_table = Table(banner_data, colWidths=[7.2 * inch])
    banner_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), banner_bg),
        ('BOX', (0, 0), (-1, -1), 1, banner_border),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    elements.append(banner_table)
    elements.append(Spacer(1, 14))

    # 3. Student & Cohort Information (2-Column Table)
    bank_info = student_record.get('bank_name', '')
    acc_no = student_record.get('account_number', '')
    acc_name = student_record.get('account_name', '')
    bank_display = f"{bank_info} ({acc_no})" if bank_info and acc_no else "On File / Direct Transfer"

    info_data = [
        [
            Paragraph("<b>STUDENT DETAILS</b>", h2_style),
            Paragraph("<b>COHORT & DISBURSAL INFO</b>", h2_style)
        ],
        [
            Paragraph(f"<b>Full Name:</b> {student_record.get('name', 'N/A')}", body_style),
            Paragraph(f"<b>Academic Cohort:</b> {period.get('name', 'N/A')}", body_style)
        ],
        [
            Paragraph(f"<b>Matriculation ID:</b> {student_record.get('student_code', 'N/A')}", body_style),
            Paragraph(f"<b>Cohort Dates:</b> {period.get('start_date', '')} to {period.get('end_date', '')}", body_style)
        ],
        [
            Paragraph(f"<b>Email Address:</b> {student_record.get('email', 'N/A')}", body_style),
            Paragraph(f"<b>Scheduled Sessions:</b> {period.get('total_sessions', 0)} sessions", body_style)
        ],
        [
            Paragraph(f"<b>Banking Method:</b> {bank_display}", body_style),
            Paragraph(f"<b>Disbursal Currency:</b> {currency}", body_style)
        ],
    ]

    info_table = Table(info_data, colWidths=[3.6 * inch, 3.6 * inch])
    info_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), colors.HexColor('#f8fafc')),
        ('BACKGROUND', (1, 0), (1, 0), colors.HexColor('#f8fafc')),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('LINEBELOW', (0, 0), (-1, 0), 1, colors.HexColor('#e2e8f0')),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 14))

    # 4. Attendance Breakdown Table
    elements.append(Paragraph("<b>ATTENDANCE VERIFICATION AUDIT</b>", h2_style))
    elements.append(Spacer(1, 4))

    att_headers = ["Metric Description", "Scheduled", "Present", "Absent / Excused", "Rate Achieved", "Requirement Status"]
    att_row = [
        "Mandatory Classroom Sessions",
        str(student_record.get('total_sessions', 0)),
        str(student_record.get('days_present', 0)),
        str(student_record.get('days_absent', 0) + student_record.get('days_excused', 0)),
        f"{pct}%",
        "PASS (Eligible)" if is_eligible else "FAIL (Substandard)"
    ]

    att_table_data = [
        [Paragraph(f"<b>{h}</b>", bold_style) for h in att_headers],
        [Paragraph(c, body_style) for c in att_row]
    ]

    att_table = Table(att_table_data, colWidths=[2.2 * inch, 0.9 * inch, 0.9 * inch, 1.2 * inch, 1.0 * inch, 1.0 * inch])
    att_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
    ]))
    elements.append(att_table)
    elements.append(Spacer(1, 14))

    # 5. Financial Computation Breakdown Table
    elements.append(Paragraph("<b>STIPEND COMPUTATION BREAKDOWN</b>", h2_style))
    elements.append(Spacer(1, 4))

    daily_rate = student_record.get('daily_rate', 0.0)
    days_present = student_record.get('days_present', 0)
    potential_earnings = student_record.get('potential_earnings', 0.0)

    fin_data = [
        [
            Paragraph("<b>Line Item Description</b>", bold_style),
            Paragraph("<b>Calculation Formula</b>", bold_style),
            Paragraph("<b>Gross Amount</b>", ParagraphStyle('RBold', parent=bold_style, alignment=TA_RIGHT))
        ],
        [
            Paragraph("Base Daily Attendance Rate", body_style),
            Paragraph(f"{currency}{daily_rate:.2f} per session present", body_style),
            Paragraph(f"{currency}{daily_rate:.2f}", ParagraphStyle('R', parent=body_style, alignment=TA_RIGHT))
        ],
        [
            Paragraph("Sessions Verified Present", body_style),
            Paragraph(f"{days_present} days × {currency}{daily_rate:.2f}", body_style),
            Paragraph(f"{currency}{potential_earnings:.2f}", ParagraphStyle('R', parent=body_style, alignment=TA_RIGHT))
        ],
        [
            Paragraph("70% Minimum Threshold Deduction", body_style),
            Paragraph("Applied if attendance < 70.0% (-100%)" if not is_eligible else "Threshold requirement satisfied (No deduction)", body_style),
            Paragraph(f"-{currency}{potential_earnings:.2f}" if not is_eligible else f"{currency}0.00", ParagraphStyle('R', parent=body_style, alignment=TA_RIGHT, textColor=colors.HexColor('#e11d48') if not is_eligible else colors.HexColor('#059669')))
        ],
        [
            Paragraph("<b>TOTAL NET PAYOUT DISBURSAL</b>", ParagraphStyle('NetL', parent=bold_style, fontSize=11, leading=14)),
            Paragraph("<b>Authorized Disbursal</b>" if is_eligible else "<b>Forfeited ($0.00 Payout)</b>", ParagraphStyle('NetM', parent=bold_style, fontSize=10, leading=13)),
            Paragraph(f"<b>{currency}{gross_pay:.2f}</b>", ParagraphStyle('NetR', parent=bold_style, fontSize=13, leading=16, alignment=TA_RIGHT, textColor=colors.HexColor('#059669') if is_eligible else colors.HexColor('#e11d48')))
        ],
    ]

    fin_table = Table(fin_data, colWidths=[2.7 * inch, 3.0 * inch, 1.5 * inch])
    fin_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f1f5f9')),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f8fafc')),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LINEBELOW', (0, -1), (-1, -1), 1.5, colors.HexColor('#059669') if is_eligible else colors.HexColor('#e11d48')),
    ]))
    elements.append(fin_table)
    elements.append(Spacer(1, 14))

    # 6. Official Institutional Policy Notice
    policy_notice = (
        "<b>Institutional Policy Clause:</b><br/>"
        "<i>\"Students receive stipend strictly based on verified attendance (Daily Rate × Days Present), "
        "provided attendance is at or above 70%. Anyone below 70% receives $0.00.\"</i>"
    )
    policy_table = Table([[Paragraph(policy_notice, ParagraphStyle('PN', parent=styles['Normal'], fontName='Helvetica', fontSize=8, leading=11, textColor=colors.HexColor('#475569')))]], colWidths=[7.2 * inch])
    policy_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f8fafc')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(policy_table)
    elements.append(Spacer(1, 18))

    # 7. Signature & Authorization Block
    sig_data = [
        [
            Paragraph("<b>Prepared By:</b><br/>Learn2Earn Payroll Engine<br/>Automated Verification", body_style),
            Paragraph("<b>Approved By:</b><br/>Academic Director / Bursar<br/>Official Disbursal Unit", body_style),
            Paragraph("<b>Digital Seal:</b><br/>[VERIFIED & AUDITED]<br/>Attendance Cutoff: 70%", ParagraphStyle('Seal', parent=body_style, textColor=colors.HexColor('#059669'), alignment=TA_RIGHT))
        ]
    ]
    sig_table = Table(sig_data, colWidths=[2.5 * inch, 2.5 * inch, 2.2 * inch])
    sig_table.setStyle(TableStyle([
        ('LINEABOVE', (0, 0), (0, 0), 1, colors.HexColor('#94a3b8')),
        ('LINEABOVE', (1, 0), (1, 0), 1, colors.HexColor('#94a3b8')),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
    ]))
    elements.append(KeepTogether(sig_table))

    doc.build(elements)
    buffer.seek(0)
    return buffer
