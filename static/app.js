let currentPeriodId = null;
let currentPayrollData = null;
let studentsList = [];
let periodsList = [];
let currentFilter = 'all';
let searchQuery = '';
let activePayslipStudentId = null;
let qrScannerInstance = null;
let attendanceBarChartInstance = null;
let eligibilityDoughnutChartInstance = null;

const VIEW_METADATA = {
  'view-dashboard': {
    title: 'Dashboard Overview',
    breadcrumb: 'Dashboard'
  },
  'view-payroll': {
    title: 'Payroll Calculation & Payouts',
    breadcrumb: 'Payroll & Disbursal'
  },
  'view-attendance': {
    title: 'Daily Attendance Register',
    breadcrumb: 'Attendance Register'
  },
  'view-students': {
    title: 'Student Directory & Stipend Rates',
    breadcrumb: 'Students'
  },
  'view-cohorts': {
    title: 'Academic Cohorts & Periods',
    breadcrumb: 'Cohorts'
  }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  const datePicker = document.getElementById('attendance-date-picker');
  if (datePicker) {
    datePicker.value = "2026-10-15";
  }

  await loadPeriods();
});

// View Switcher: Shows ONLY the selected view, hiding all others completely
function switchView(viewId) {
  const allViews = ['view-dashboard', 'view-payroll', 'view-attendance', 'view-students', 'view-cohorts'];
  
  allViews.forEach(v => {
    const section = document.getElementById(v);
    const navBtn = document.getElementById('nav-btn-' + v.replace('view-', ''));
    
    if (v === viewId) {
      if (section) section.classList.remove('hidden');
      if (navBtn) {
        navBtn.classList.add('nav-active');
        navBtn.classList.remove('text-slate-600');
      }
    } else {
      if (section) section.classList.add('hidden');
      if (navBtn) {
        navBtn.classList.remove('nav-active');
        navBtn.classList.add('text-slate-600');
      }
    }
  });

  const meta = VIEW_METADATA[viewId] || { title: 'Student Payroll System', breadcrumb: 'Portal' };
  const titleEl = document.getElementById('current-view-title');
  const breadcrumbEl = document.getElementById('breadcrumb-current');
  if (titleEl) titleEl.textContent = meta.title;
  if (breadcrumbEl) breadcrumbEl.textContent = meta.breadcrumb;

  if (viewId === 'view-attendance') {
    loadAttendanceForDate();
  } else if (viewId === 'view-students') {
    loadStudentsRoster();
  } else if (viewId === 'view-cohorts') {
    loadCohortsList();
  } else if (viewId === 'view-payroll' || viewId === 'view-dashboard') {
    refreshDashboard();
  }
}

// Load Periods / Cohorts
async function loadPeriods() {
  try {
    const res = await fetch('/api/periods');
    periodsList = await res.json();
    const select = document.getElementById('period-select');
    if (!select) return;
    select.innerHTML = '';

    if (!periodsList || periodsList.length === 0) {
      await seedData();
      return;
    }

    periodsList.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.total_sessions} sess.)`;
      select.appendChild(opt);
    });

    currentPeriodId = periodsList[0].id;
    await refreshDashboard();
  } catch (err) {
    console.error("Failed to load periods:", err);
  }
}

async function onPeriodChange() {
  const select = document.getElementById('period-select');
  currentPeriodId = parseInt(select.value);
  await refreshDashboard();
  loadAttendanceForDate();
}

// Refresh Dashboard & Payroll Data
async function refreshDashboard() {
  if (!currentPeriodId) return;

  try {
    const res = await fetch(`/api/payroll/${currentPeriodId}`);
    if (!res.ok) throw new Error('Failed to fetch payroll');
    currentPayrollData = await res.json();

    renderDashboardOverview(currentPayrollData);
    renderPayrollTable();
    renderDashboardCharts(currentPayrollData.payroll_records, currentPayrollData.summary);
  } catch (err) {
    console.error("Failed to refresh dashboard:", err);
  }
}

// Render Dashboard View
function renderDashboardOverview(data) {
  const p = data.period;
  const s = data.summary;

  const heroName = document.getElementById('hero-cohort-name');
  if (heroName) heroName.textContent = `${p.name} • ${p.total_sessions} Sessions Quota`;

  const kpiDisbursed = document.getElementById('kpi-disbursed');
  if (kpiDisbursed) kpiDisbursed.textContent = `$${s.total_disbursed.toLocaleString('en-US', {minimumFractionDigits: 2})}`;

  const kpiRatio = document.getElementById('kpi-eligible-ratio');
  if (kpiRatio) kpiRatio.textContent = `${s.eligible_students} / ${s.total_students}`;

  const kpiPercent = document.getElementById('kpi-eligible-percent');
  if (kpiPercent) kpiPercent.textContent = `${s.eligibility_rate_percent}%`;

  const kpiForfeited = document.getElementById('kpi-forfeited');
  if (kpiForfeited) kpiForfeited.textContent = `$${s.total_forfeited.toLocaleString('en-US', {minimumFractionDigits: 2})}`;

  const ineligBadge = document.getElementById('kpi-ineligible-badge');
  if (ineligBadge) ineligBadge.textContent = `${s.ineligible_students} Below 70%`;

  const kpiAvg = document.getElementById('kpi-avg-attendance');
  if (kpiAvg) kpiAvg.textContent = `${s.average_attendance}%`;

  const bar = document.getElementById('kpi-avg-bar');
  if (bar) {
    bar.style.width = `${Math.min(100, s.average_attendance)}%`;
    bar.className = s.average_attendance >= 70 ? "bg-emerald-500 h-2 rounded-full" : "bg-rose-500 h-2 rounded-full";
  }

  // Dashboard Snapshot Table
  const previewTbody = document.getElementById('dash-preview-tbody');
  if (previewTbody && data.payroll_records) {
    const previewList = data.payroll_records.slice(0, 5);
    previewTbody.innerHTML = previewList.map(r => {
      const isElig = r.is_eligible;
      const statusBadge = isElig
        ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800"><i class="fa-solid fa-check"></i> Eligible</span>`
        : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800"><i class="fa-solid fa-xmark"></i> Substandard</span>`;

      return `
        <tr class="hover:bg-slate-50/60 transition-colors">
          <td class="py-2.5 px-4 font-sans font-semibold text-slate-800">
            <div>${r.name}</div>
            <div class="text-[10px] text-slate-400 font-mono">${r.student_code}</div>
          </td>
          <td class="py-2.5 px-4 text-xs">
            <span class="font-bold ${isElig ? 'text-emerald-700' : 'text-rose-700'}">${r.attendance_percentage}%</span>
            <span class="text-[10px] text-slate-400 font-sans">(${r.days_present}/${r.total_sessions} days)</span>
          </td>
          <td class="py-2.5 px-4">${statusBadge}</td>
          <td class="py-2.5 px-4 text-right font-bold text-xs ${isElig ? 'text-slate-900' : 'text-rose-500'}">
            ${isElig ? `${r.currency}${r.gross_pay.toFixed(2)}` : '$0.00'}
          </td>
          <td class="py-2.5 px-4 text-center">
            <button onclick="openAttendanceUpdater(${r.student_id})" class="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all shadow-2xs flex items-center gap-1 mx-auto cursor-pointer" title="Adjust Attendance & Test 70% Cutoff">
              <i class="fa-solid fa-pen-to-square text-emerald-600"></i> Update
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

// ==========================================
// FEATURE 5: CHART.JS INTERACTIVE CHARTS
// ==========================================
function renderDashboardCharts(records, summary) {
  if (!records || records.length === 0 || typeof Chart === 'undefined') return;

  // 1. Doughnut Chart: Eligibility Distribution
  const doughnutCtx = document.getElementById('eligibilityDoughnutChart');
  if (doughnutCtx) {
    if (eligibilityDoughnutChartInstance) {
      eligibilityDoughnutChartInstance.destroy();
    }
    eligibilityDoughnutChartInstance = new Chart(doughnutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Eligible (≥ 70%)', 'Ineligible (< 70%)'],
        datasets: [{
          data: [summary.eligible_students, summary.ineligible_students],
          backgroundColor: ['#10b981', '#f43f5e'],
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const total = summary.total_students || 1;
                const val = context.parsed || 0;
                const pct = ((val / total) * 100).toFixed(1);
                return ` ${context.label}: ${val} students (${pct}%)`;
              }
            }
          }
        },
        cutout: '72%'
      }
    });

    const lElig = document.getElementById('chart-legend-eligible');
    const lInelig = document.getElementById('chart-legend-ineligible');
    if (lElig) lElig.textContent = `Eligible: ${summary.eligible_students}`;
    if (lInelig) lInelig.textContent = `Ineligible: ${summary.ineligible_students}`;
  }

  // 2. Bar Chart: Student Attendance % vs 70% Cutoff Line
  const barCtx = document.getElementById('attendanceBarChart');
  if (barCtx) {
    if (attendanceBarChartInstance) {
      attendanceBarChartInstance.destroy();
    }

    const labels = records.map(r => r.name.split(' ')[0]);
    const attendanceValues = records.map(r => r.attendance_percentage);
    const backgroundColors = records.map(r => r.is_eligible ? '#10b981' : '#f43f5e');

    attendanceBarChartInstance = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Attendance Rate (%)',
          data: attendanceValues,
          backgroundColor: backgroundColors,
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 38
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 100,
            ticks: {
              stepSize: 20,
              callback: val => val + '%'
            },
            grid: {
              color: '#f1f5f9'
            }
          },
          x: {
            grid: { display: false }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const r = records[context.dataIndex];
                const statusStr = r.is_eligible ? 'ELIGIBLE (PAID)' : 'INELIGIBLE ($0.00)';
                return ` Attendance: ${r.attendance_percentage}% (${r.days_present}/${r.total_sessions} days) — ${statusStr}`;
              }
            }
          }
        }
      }
    });
  }
}

// Filter Payroll Table
function filterPayrollTable(type) {
  currentFilter = type;
  const btns = ['all', 'eligible', 'ineligible'];
  btns.forEach(b => {
    const el = document.getElementById(`filter-btn-${b}`);
    if (!el) return;
    if (b === type) {
      el.className = "px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white transition-all shadow-xs";
    } else {
      el.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all";
    }
  });
  renderPayrollTable();
}

function searchPayrollTable() {
  const input = document.getElementById('payroll-search');
  searchQuery = input ? input.value.trim().toLowerCase() : '';
  renderPayrollTable();
}

// Render Payroll Computation Sheet with Filtering, Search, Banking, and Payout Status
function renderPayrollTable() {
  if (!currentPayrollData) return;
  const records = currentPayrollData.payroll_records || [];

  const eligibleTotal = records.filter(r => r.is_eligible).length;
  const ineligibleTotal = records.filter(r => !r.is_eligible).length;
  const countAll = document.getElementById('count-all');
  const countElig = document.getElementById('count-eligible');
  const countInelig = document.getElementById('count-ineligible');
  if (countAll) countAll.textContent = records.length;
  if (countElig) countElig.textContent = eligibleTotal;
  if (countInelig) countInelig.textContent = ineligibleTotal;

  let filtered = records;
  if (currentFilter === 'eligible') {
    filtered = filtered.filter(r => r.is_eligible);
  } else if (currentFilter === 'ineligible') {
    filtered = filtered.filter(r => !r.is_eligible);
  }

  if (searchQuery) {
    filtered = filtered.filter(r => 
      r.name.toLowerCase().includes(searchQuery) || 
      r.student_code.toLowerCase().includes(searchQuery) ||
      r.email.toLowerCase().includes(searchQuery) ||
      (r.bank_name && r.bank_name.toLowerCase().includes(searchQuery))
    );
  }

  const tbody = document.getElementById('payroll-table-body');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400 font-mono text-xs">No matching student records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r, idx) => {
    const isEligible = r.is_eligible;
    const pct = r.attendance_percentage;
    const threshold = r.threshold_percent;

    const barColor = isEligible ? 'bg-emerald-500' : 'bg-rose-500';
    const badgeHtml = isEligible
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
           <i class="fa-solid fa-circle-check text-emerald-600"></i> ELIGIBLE
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
           <i class="fa-solid fa-circle-xmark text-rose-600"></i> < 70% CUTOFF
         </span>`;

    const payDisplay = isEligible
      ? `<div class="font-extrabold text-slate-900 text-sm font-mono">${r.currency}${r.gross_pay.toFixed(2)}</div>
         <div class="text-[10px] text-slate-400 font-mono font-medium">${r.days_present} days × ${r.currency}${r.daily_rate}</div>`
      : `<div class="font-extrabold text-rose-600 text-sm font-mono">${r.currency}0.00</div>
         <div class="text-[10px] text-rose-400 line-through font-mono">Forfeited ${r.currency}${r.potential_earnings.toFixed(2)}</div>`;

    const bankDisplay = r.bank_name 
      ? `<div><span class="font-bold text-slate-800">${r.bank_name}</span></div><div class="text-slate-400 font-mono text-[10px]">${r.account_number}</div>`
      : `<span class="text-slate-400 text-[11px] italic">Not Configured</span>`;

    // Payout Status Badge
    let payoutStatusBadge = "";
    if (!isEligible) {
      payoutStatusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-400">N/A ($0)</span>`;
    } else if (r.payment_status === 'disbursed') {
      payoutStatusBadge = `<button onclick="openPayoutManager(${r.student_id})" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200 cursor-pointer" title="Click to view transaction"><i class="fa-solid fa-check-double"></i> Paid</button>`;
    } else if (r.payment_status === 'processing') {
      payoutStatusBadge = `<button onclick="openPayoutManager(${r.student_id})" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-300 hover:bg-blue-200 cursor-pointer"><i class="fa-solid fa-spinner fa-spin"></i> Processing</button>`;
    } else {
      payoutStatusBadge = `<button onclick="openPayoutManager(${r.student_id})" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 cursor-pointer"><i class="fa-solid fa-clock"></i> Pending</button>`;
    }

    return `
      <tr class="hover:bg-slate-50/70 transition-colors">
        <td class="py-3.5 px-5">
          <div class="font-bold text-slate-900">${r.name}</div>
          <div class="text-xs font-mono text-slate-400">${r.student_code} • ${r.email}</div>
        </td>
        <td class="py-3.5 px-4 text-xs font-mono">
          ${bankDisplay}
        </td>
        <td class="py-3.5 px-4 font-mono text-xs">
          <span class="font-bold text-slate-800">${r.days_present}</span> / ${r.total_sessions} days
          <div class="text-[10px] text-slate-400 font-sans">Absent: ${r.days_absent} | Excused: ${r.days_excused}</div>
        </td>
        <td class="py-3.5 px-4 min-w-[140px]">
          <div class="flex items-center justify-between text-xs font-mono mb-1">
            <span class="font-bold ${isEligible ? 'text-emerald-700' : 'text-rose-700'}">${pct}%</span>
            <span class="text-[10px] text-slate-400">Req: ${threshold}%</span>
          </div>
          <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div class="${barColor} h-2 rounded-full transition-all" style="width: ${Math.min(100, pct)}%"></div>
          </div>
        </td>
        <td class="py-3.5 px-4">
          ${badgeHtml}
        </td>
        <td class="py-3.5 px-4 text-right">
          ${payDisplay}
        </td>
        <td class="py-3.5 px-4 text-center">
          ${payoutStatusBadge}
        </td>
        <td class="py-3.5 px-5 text-center">
          <div class="flex items-center justify-center gap-1.5 flex-wrap">
            <button onclick="openAttendanceUpdater(${r.student_id})" class="px-2 py-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all shadow-2xs flex items-center gap-1 cursor-pointer" title="Adjust Attendance & Check 70% Cutoff">
              <i class="fa-solid fa-pen-to-square"></i> Update
            </button>
            <button onclick="downloadStudentPDF(${r.student_id})" class="px-2 py-1 text-[11px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-all shadow-2xs flex items-center gap-1 cursor-pointer" title="Download Official PDF Payslip">
              <i class="fa-solid fa-file-pdf"></i> PDF
            </button>
            <button onclick="openStudentQRBadge(${r.student_id})" class="px-2 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-all shadow-2xs flex items-center gap-1 cursor-pointer" title="View Digital QR Badge">
              <i class="fa-solid fa-qrcode"></i>
            </button>
            <button onclick="viewPayslipByCode('${r.student_code}')" class="px-2 py-1 text-[11px] font-bold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg transition-all cursor-pointer" title="View Audit Slip">
              <i class="fa-solid fa-receipt"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================
// FEATURE 1: PDF PAYSLIP GENERATION
// ==========================================
function downloadStudentPDF(studentId) {
  if (!currentPeriodId) return;
  window.location.href = `/api/payroll/${currentPeriodId}/student/${studentId}/pdf`;
}

function downloadActiveStudentPDF() {
  if (activePayslipStudentId && currentPeriodId) {
    downloadStudentPDF(activePayslipStudentId);
  }
}

// View Payslip Modal
function viewPayslipByCode(studentCode) {
  if (!currentPayrollData || !currentPayrollData.payroll_records) return;
  const r = currentPayrollData.payroll_records.find(item => item.student_code === studentCode);
  if (!r) return;

  activePayslipStudentId = r.student_id;

  document.getElementById('slip-name').textContent = r.name;
  document.getElementById('slip-student-code').textContent = `${r.student_code} • ${r.email}`;
  document.getElementById('slip-period').textContent = r.period_name;
  document.getElementById('slip-total-sessions').textContent = `${r.total_sessions} Required Days`;
  document.getElementById('slip-attended').textContent = `${r.days_present} Days Present`;
  
  const rateEl = document.getElementById('slip-attendance-rate');
  rateEl.textContent = `${r.attendance_percentage}%`;
  rateEl.className = r.is_eligible ? "font-bold text-emerald-600 text-sm" : "font-bold text-rose-600 text-sm";

  document.getElementById('slip-rate').textContent = `${r.currency}${r.daily_rate.toFixed(2)} / session`;
  document.getElementById('slip-potential').textContent = `${r.currency}${r.potential_earnings.toFixed(2)}`;
  
  const finalPayoutEl = document.getElementById('slip-final-payout');
  const bannerEl = document.getElementById('slip-status-banner');

  if (r.is_eligible) {
    finalPayoutEl.textContent = `${r.currency}${r.gross_pay.toFixed(2)}`;
    finalPayoutEl.className = "text-emerald-700 text-xl font-black";

    bannerEl.className = "rounded-2xl p-4 border bg-emerald-50 border-emerald-200 flex items-start gap-3 text-emerald-900";
    bannerEl.innerHTML = `
      <div class="text-xl text-emerald-600 mt-0.5"><i class="fa-solid fa-circle-check"></i></div>
      <div class="text-xs">
        <div class="font-bold text-sm text-emerald-800">ELIGIBLE FOR DISBURSAL (≥ 70% Cutoff)</div>
        <p class="mt-0.5">${r.eligibility_reason}</p>
        <p class="mt-1 text-emerald-700 font-mono">Disbursal: ${r.days_present} Days × ${r.currency}${r.daily_rate} = <strong>${r.currency}${r.gross_pay.toFixed(2)}</strong></p>
      </div>
    `;
  } else {
    finalPayoutEl.textContent = `${r.currency}0.00`;
    finalPayoutEl.className = "text-rose-600 text-xl font-black";

    bannerEl.className = "rounded-2xl p-4 border bg-rose-50 border-rose-200 flex items-start gap-3 text-rose-900";
    bannerEl.innerHTML = `
      <div class="text-xl text-rose-600 mt-0.5"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div class="text-xs">
        <div class="font-bold text-sm text-rose-800">INELIGIBLE — DISBURSAL FORFEITED</div>
        <p class="mt-0.5">${r.eligibility_reason}</p>
        <p class="mt-1 text-rose-700 font-mono">In accordance with institutional policy, students with attendance under 70% receive $0.00.</p>
      </div>
    `;
  }

  openModal('modal-payslip');
}

// ==========================================
// FEATURE 2: CSV ATTENDANCE IMPORT
// ==========================================
function onCSVFileSelected(event) {
  const file = event.target.files[0];
  const label = document.getElementById('csv-selected-filename');
  if (file && label) {
    label.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  }
}

async function submitCSVUpload() {
  const fileInput = document.getElementById('csv-file-input');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    return alert('Please select a .csv file first.');
  }

  if (!currentPeriodId) return alert('No active cohort selected.');

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('period_id', currentPeriodId);
  formData.append('file', file);

  const btn = document.getElementById('btn-submit-csv');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Uploading...`;

  try {
    const res = await fetch('/api/attendance/upload-csv', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Upload failed');
    }

    const data = await res.json();
    alert(`🎉 ${data.message}`);
    closeModal('modal-csv-upload');
    fileInput.value = '';
    document.getElementById('csv-selected-filename').textContent = 'Select a CSV File';

    await refreshDashboard();
    await loadAttendanceForDate();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-upload"></i> Upload & Apply`;
  }
}

// ==========================================
// FEATURE 3: QR CODE BADGES & CHECK-IN CONSOLE
// ==========================================
function openStudentQRBadge(studentId) {
  const student = studentsList.find(s => s.id === studentId) || (currentPayrollData && currentPayrollData.payroll_records.find(r => r.student_id === studentId));
  if (!student) return;

  document.getElementById('badge-name').textContent = student.name;
  document.getElementById('badge-code').textContent = student.student_id || student.student_code;
  document.getElementById('badge-email').textContent = student.email;

  const canvasContainer = document.getElementById('qrcode-canvas');
  canvasContainer.innerHTML = '';

  const qrText = `L2E:${student.student_id || student.student_code}`;
  new QRCode(canvasContainer, {
    text: qrText,
    width: 140,
    height: 140,
    colorDark: "#0f172a",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });

  openModal('modal-qr-badge');
}

function openQRScannerModal() {
  openModal('modal-qr-scanner');
  document.getElementById('qr-input-manual').value = '';
  document.getElementById('qr-input-manual').focus();
  document.getElementById('qr-checkin-result').classList.add('hidden');

  // Start html5-qrcode scanner if camera supported
  if (typeof Html5Qrcode !== 'undefined') {
    try {
      qrScannerInstance = new Html5Qrcode("qr-reader");
      qrScannerInstance.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => {
          handleQRCheckinCode(decodedText);
        },
        (errorMessage) => {
          // scanning frames
        }
      ).catch(err => {
        console.log("Camera access not available or denied:", err);
      });
    } catch (e) {
      console.log("Scanner init error:", e);
    }
  }
}

function closeQRScannerModal() {
  if (qrScannerInstance) {
    qrScannerInstance.stop().then(() => {
      qrScannerInstance.clear();
      qrScannerInstance = null;
    }).catch(err => {
      qrScannerInstance = null;
    });
  }
  closeModal('modal-qr-scanner');
}

async function submitManualCheckin() {
  const code = document.getElementById('qr-input-manual').value.trim();
  if (!code) return;
  await handleQRCheckinCode(code);
  document.getElementById('qr-input-manual').value = '';
}

async function handleQRCheckinCode(scannedCode) {
  if (!currentPeriodId) return;

  try {
    const res = await fetch('/api/attendance/qr-checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_id: currentPeriodId,
        student_code: scannedCode
      })
    });

    const resultBox = document.getElementById('qr-checkin-result');
    resultBox.classList.remove('hidden');

    if (!res.ok) {
      const err = await res.json();
      resultBox.className = "rounded-2xl p-4 border bg-rose-50 border-rose-200 text-rose-900";
      resultBox.innerHTML = `
        <div class="font-bold flex items-center gap-2 text-rose-800">
          <i class="fa-solid fa-triangle-exclamation"></i> Check-in Failed
        </div>
        <p class="text-xs text-rose-700 mt-1">${err.detail || 'Could not verify student'}</p>
      `;
      return;
    }

    const data = await res.json();
    const isElig = data.is_eligible;

    resultBox.className = isElig 
      ? "rounded-2xl p-4 border bg-emerald-50 border-emerald-200 text-emerald-900"
      : "rounded-2xl p-4 border bg-amber-50 border-amber-200 text-amber-900";

    resultBox.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-8 h-8 rounded-xl ${isElig ? 'bg-emerald-500' : 'bg-amber-500'} text-white flex items-center justify-center font-bold text-sm shrink-0">
          <i class="fa-solid fa-user-check"></i>
        </div>
        <div>
          <div class="font-black text-sm text-slate-900">${data.student.name} (${data.student.student_id})</div>
          <p class="text-xs text-slate-600 mt-0.5">Checked in for today's session (${data.checkin_date})!</p>
          <div class="mt-2 text-xs font-mono font-bold flex items-center gap-2">
            <span>Presence: ${data.days_present}/${data.total_sessions} (${data.attendance_percentage}%)</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] ${isElig ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'}">
              ${isElig ? 'ELIGIBLE' : 'BELOW 70%'}
            </span>
          </div>
        </div>
      </div>
    `;

    await refreshDashboard();
    await loadAttendanceForDate();
  } catch (err) {
    alert(err.message);
  }
}

// ==========================================
// FEATURE 4: STUDENT BANKING & PAYOUT MANAGEMENT
// ==========================================
let activePayoutStudentId = null;

function openPayoutManager(studentId) {
  if (!currentPayrollData || !currentPayrollData.payroll_records) return;
  const r = currentPayrollData.payroll_records.find(item => item.student_id === studentId);
  if (!r) return;

  activePayoutStudentId = studentId;

  document.getElementById('payout-stu-name').textContent = r.name;
  document.getElementById('payout-stu-code').textContent = `${r.student_code} • ${r.email}`;
  document.getElementById('payout-amount-display').textContent = `${r.currency}${r.gross_pay.toFixed(2)}`;

  document.getElementById('payout-bank-name').textContent = r.bank_name || 'No Bank Specified';
  document.getElementById('payout-acc-number').textContent = r.account_number || 'N/A';
  document.getElementById('payout-acc-name').textContent = r.account_name || r.name;

  const statusSelect = document.getElementById('payout-status-select');
  statusSelect.value = (r.payment_status === 'disbursed' || r.payment_status === 'processing') ? r.payment_status : 'pending';

  document.getElementById('payout-txn-ref').value = r.transaction_ref || `TXN-${new Date().getFullYear()}${(new Date().getMonth()+1).toString().padStart(2,'0')}-${r.student_id.toString().padStart(4,'0')}`;
  document.getElementById('payout-notes').value = '';

  openModal('modal-payout-manage');
}

async function submitPayoutStatusUpdate(e) {
  e.preventDefault();
  if (!activePayoutStudentId || !currentPeriodId) return;

  const r = currentPayrollData.payroll_records.find(item => item.student_id === activePayoutStudentId);
  const amount = r ? r.gross_pay : 0.0;
  const status = document.getElementById('payout-status-select').value;
  const txnRef = document.getElementById('payout-txn-ref').value.trim();
  const notes = document.getElementById('payout-notes').value.trim();

  try {
    const res = await fetch('/api/payouts/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: activePayoutStudentId,
        period_id: currentPeriodId,
        amount: amount,
        payment_status: status,
        transaction_ref: txnRef,
        notes: notes
      })
    });

    if (!res.ok) throw new Error("Failed to update status");
    const data = await res.json();
    alert(`Disbursal status set to '${status.toUpperCase()}'! Reference: ${data.ref}`);

    closeModal('modal-payout-manage');
    await refreshDashboard();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// Attendance Logger View
async function loadAttendanceForDate() {
  if (!currentPeriodId) return;
  const dateInput = document.getElementById('attendance-date-picker');
  if (!dateInput) return;
  const date = dateInput.value;
  if (!date) return;

  try {
    const [stuRes, attRes] = await Promise.all([
      fetch('/api/students'),
      fetch(`/api/attendance?period_id=${currentPeriodId}&date=${date}`)
    ]);

    studentsList = await stuRes.json();
    const existingAtt = await attRes.json();
    const attMap = {};
    existingAtt.forEach(a => attMap[a.student_id] = a);

    const tbody = document.getElementById('attendance-register-body');
    if (!tbody) return;

    if (studentsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-slate-400 font-mono text-xs">No students enrolled yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = studentsList.map(s => {
      const record = attMap[s.id] || { status: 'present', notes: '' };
      return `
        <tr data-student-id="${s.id}">
          <td class="py-3 px-5">
            <div class="font-bold text-slate-800">${s.name}</div>
            <div class="text-[11px] text-slate-400 font-mono">${s.student_id}</div>
          </td>
          <td class="py-3 px-4 text-center">
            <div class="inline-flex rounded-xl border border-slate-200 p-1 bg-slate-50 gap-1 shadow-2xs">
              <label class="cursor-pointer px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all has-[:checked]:bg-emerald-600 has-[:checked]:text-white text-slate-600 hover:text-slate-900">
                <input type="radio" name="att_${s.id}" value="present" ${record.status === 'present' ? 'checked' : ''} class="hidden">
                Present
              </label>
              <label class="cursor-pointer px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all has-[:checked]:bg-rose-600 has-[:checked]:text-white text-slate-600 hover:text-slate-900">
                <input type="radio" name="att_${s.id}" value="absent" ${record.status === 'absent' ? 'checked' : ''} class="hidden">
                Absent
              </label>
              <label class="cursor-pointer px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all has-[:checked]:bg-amber-500 has-[:checked]:text-white text-slate-600 hover:text-slate-900">
                <input type="radio" name="att_${s.id}" value="excused" ${record.status === 'excused' ? 'checked' : ''} class="hidden">
                Excused
              </label>
            </div>
          </td>
          <td class="py-3 px-4">
            <input type="text" value="${record.notes || ''}" placeholder="Optional notes or remarks..." class="att-note-input w-full border border-slate-200 rounded-xl px-3 py-1.5 text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 focus:outline-none"/>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error("Failed to load attendance for date:", err);
  }
}

function markAllPresent() {
  document.querySelectorAll('#attendance-register-body tr').forEach(tr => {
    const presentRadio = tr.querySelector('input[value="present"]');
    if (presentRadio) presentRadio.checked = true;
  });
}

async function saveAttendanceRegister() {
  if (!currentPeriodId) return;
  const date = document.getElementById('attendance-date-picker').value;
  if (!date) return alert('Please pick a date');

  const rows = document.querySelectorAll('#attendance-register-body tr');
  const entries = [];

  rows.forEach(tr => {
    const sId = parseInt(tr.dataset.studentId);
    const checkedRadio = tr.querySelector('input[type="radio"]:checked');
    const noteInput = tr.querySelector('.att-note-input');
    if (sId && checkedRadio) {
      entries.push({
        student_id: sId,
        status: checkedRadio.value,
        notes: noteInput ? noteInput.value.trim() : ""
      });
    }
  });

  try {
    const res = await fetch('/api/attendance/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_id: currentPeriodId,
        date: date,
        entries: entries
      })
    });
    const result = await res.json();
    alert('Attendance saved successfully! Payroll calculations updated.');
    await refreshDashboard();
  } catch (err) {
    alert('Error saving attendance: ' + err.message);
  }
}

// Student Directory View
async function loadStudentsRoster() {
  try {
    const res = await fetch('/api/students');
    studentsList = await res.json();
    const tbody = document.getElementById('student-roster-body');
    if (!tbody) return;

    if (studentsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400 font-mono text-xs">No students registered.</td></tr>`;
      return;
    }

    tbody.innerHTML = studentsList.map(s => {
      const bankDisplay = s.bank_name 
        ? `<div class="font-bold text-slate-800">${s.bank_name}</div><div class="text-[10px] text-slate-400 font-mono">${s.account_number}</div>`
        : `<span class="text-slate-400 italic">No bank recorded</span>`;

      return `
        <tr class="hover:bg-slate-50/70 transition-colors">
          <td class="py-3.5 px-5 font-mono text-xs font-bold text-slate-700">${s.student_id}</td>
          <td class="py-3.5 px-4 font-bold text-slate-900">${s.name}</td>
          <td class="py-3.5 px-4 text-xs text-slate-500 font-mono">${s.email}</td>
          <td class="py-3.5 px-4 text-xs font-mono">${bankDisplay}</td>
          <td class="py-3.5 px-4 font-mono text-xs text-slate-900 font-bold">${s.currency}${s.daily_rate.toFixed(2)} / session</td>
          <td class="py-3.5 px-4 text-center">
            <button onclick="openStudentQRBadge(${s.id})" class="px-2.5 py-1 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-all shadow-2xs flex items-center gap-1 mx-auto" title="View Digital QR ID Badge">
              <i class="fa-solid fa-qrcode text-emerald-600"></i> Badge
            </button>
          </td>
          <td class="py-3.5 px-4 text-center">
            <button onclick="deleteStudent(${s.id})" class="text-rose-500 hover:text-rose-700 text-xs px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors" title="Delete Student">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error("Failed to load students roster:", err);
  }
}

async function deleteStudent(id) {
  if (!confirm('Are you sure you want to remove this student?')) return;
  await fetch(`/api/students/${id}`, { method: 'DELETE' });
  await loadStudentsRoster();
  await refreshDashboard();
}

// Cohorts View
async function loadCohortsList() {
  try {
    const res = await fetch('/api/periods');
    periodsList = await res.json();
    const tbody = document.getElementById('cohorts-table-body');
    if (!tbody) return;

    if (periodsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 font-mono text-xs">No cohorts defined.</td></tr>`;
      return;
    }

    tbody.innerHTML = periodsList.map(p => `
      <tr class="hover:bg-slate-50/70 transition-colors">
        <td class="py-3.5 px-5 font-bold text-slate-900">${p.name}</td>
        <td class="py-3.5 px-4 text-xs font-mono text-slate-600">${p.start_date} to ${p.end_date}</td>
        <td class="py-3.5 px-4 font-mono text-xs font-bold text-slate-800">${p.total_sessions} Sessions</td>
        <td class="py-3.5 px-4 font-mono text-xs font-bold text-emerald-700">${p.threshold_percent}% Cutoff</td>
        <td class="py-3.5 px-4">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
          </span>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error("Failed to load cohorts:", err);
  }
}

// Add Student Form (With Banking Fields)
async function submitAddStudent(e) {
  e.preventDefault();
  const payload = {
    student_id: document.getElementById('new-stu-id').value,
    name: document.getElementById('new-stu-name').value,
    email: document.getElementById('new-stu-email').value,
    daily_rate: parseFloat(document.getElementById('new-stu-rate').value),
    currency: document.getElementById('new-stu-currency').value,
    bank_name: document.getElementById('new-stu-bank').value.trim(),
    account_number: document.getElementById('new-stu-acc').value.trim(),
    account_name: document.getElementById('new-stu-name').value.trim()
  };

  try {
    const res = await fetch('/api/students', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to add student');
    }
    closeModal('modal-add-student');
    document.getElementById('form-add-student').reset();
    await refreshDashboard();
    await loadStudentsRoster();
  } catch (err) {
    alert(err.message);
  }
}

// Add Period Form
async function submitAddPeriod(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('new-per-name').value,
    start_date: document.getElementById('new-per-start').value,
    end_date: document.getElementById('new-per-end').value,
    total_sessions: parseInt(document.getElementById('new-per-sessions').value),
    threshold_percent: parseFloat(document.getElementById('new-per-threshold').value)
  };

  try {
    const res = await fetch('/api/periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to create period');
    closeModal('modal-add-period');
    document.getElementById('form-add-period').reset();
    await loadPeriods();
    await loadCohortsList();
  } catch (err) {
    alert(err.message);
  }
}

// Live Attendance Adjuster Logic
let activeStudentUpdate = null;

async function openAttendanceUpdater(studentId) {
  if (!currentPeriodId) return;
  try {
    const res = await fetch(`/api/attendance/student/${studentId}?period_id=${currentPeriodId}`);
    if (!res.ok) throw new Error("Could not load student attendance");
    const data = await res.json();
    activeStudentUpdate = data;

    document.getElementById('upd-stu-name').textContent = data.student.name;
    document.getElementById('upd-stu-details').textContent = `${data.student.student_id} • ${data.student.currency}${data.student.daily_rate.toFixed(2)}/session • ${data.student.email}`;
    document.getElementById('upd-sessions-quota').textContent = `Out of ${data.period.total_sessions} Required Sessions`;
    
    const input = document.getElementById('upd-present-input');
    input.max = data.period.total_sessions;
    input.value = data.calculation.days_present;

    const thresholdNeeded = Math.ceil((data.period.threshold_percent / 100) * data.period.total_sessions);
    document.getElementById('upd-threshold-days').textContent = thresholdNeeded;

    refreshLiveAttendancePreview();
    openModal('modal-update-attendance');
  } catch (err) {
    alert(err.message);
  }
}

function adjustPresentStepper(delta) {
  const input = document.getElementById('upd-present-input');
  if (!input || !activeStudentUpdate) return;
  let val = parseInt(input.value) || 0;
  const maxSessions = activeStudentUpdate.period.total_sessions;
  val = Math.max(0, Math.min(maxSessions, val + delta));
  input.value = val;
  refreshLiveAttendancePreview();
}

function onPresentInputChange() {
  const input = document.getElementById('upd-present-input');
  if (!input || !activeStudentUpdate) return;
  const maxSessions = activeStudentUpdate.period.total_sessions;
  let val = parseInt(input.value) || 0;
  if (val > maxSessions) val = maxSessions;
  if (val < 0) val = 0;
  input.value = val;
  refreshLiveAttendancePreview();
}

function quickJumpToThreshold() {
  if (!activeStudentUpdate) return;
  const total = activeStudentUpdate.period.total_sessions;
  const thresholdNeeded = Math.ceil((activeStudentUpdate.period.threshold_percent / 100) * total);
  const input = document.getElementById('upd-present-input');
  if (input) {
    input.value = thresholdNeeded;
    refreshLiveAttendancePreview();
  }
}

function refreshLiveAttendancePreview() {
  if (!activeStudentUpdate) return;
  const input = document.getElementById('upd-present-input');
  const presentDays = parseInt(input.value) || 0;
  const totalSessions = activeStudentUpdate.period.total_sessions;
  const thresholdPct = activeStudentUpdate.period.threshold_percent;
  const dailyRate = activeStudentUpdate.student.daily_rate;
  const currency = activeStudentUpdate.student.currency;

  const pct = totalSessions > 0 ? Number(((presentDays / totalSessions) * 100).toFixed(1)) : 0;
  const isEligible = pct >= thresholdPct;
  const potentialPay = Number((presentDays * dailyRate).toFixed(2));
  const finalPayout = isEligible ? potentialPay : 0.0;

  document.getElementById('upd-live-pct').textContent = `${pct}% (${presentDays}/${totalSessions} Days)`;
  document.getElementById('upd-live-rate').textContent = `${currency}${dailyRate.toFixed(2)} / session`;

  const payoutEl = document.getElementById('upd-live-payout');
  const cardEl = document.getElementById('upd-status-card');

  if (isEligible) {
    payoutEl.textContent = `${currency}${finalPayout.toFixed(2)}`;
    payoutEl.className = "text-emerald-700 font-mono text-base font-black";

    cardEl.className = "rounded-2xl p-4 border bg-emerald-50 border-emerald-200 text-emerald-900";
    cardEl.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-sm font-bold shrink-0 mt-0.5 shadow-2xs">
          <i class="fa-solid fa-circle-check"></i>
        </div>
        <div>
          <div class="font-extrabold text-sm text-emerald-800 flex items-center gap-2">
            <span>🎉 ELIGIBLE FOR DISBURSAL</span>
            <span class="text-xs font-mono font-bold bg-emerald-200/70 text-emerald-900 px-2 py-0.5 rounded-full">${pct}% ≥ ${thresholdPct}%</span>
          </div>
          <p class="text-xs text-emerald-700 mt-1">
            Minimum 70% attendance reached! Payout is unlocked for <strong>${presentDays} present sessions</strong>.
          </p>
          <div class="mt-2 text-xs font-mono font-bold text-emerald-800">
            Approved Payout: ${presentDays} days × ${currency}${dailyRate.toFixed(2)} = <span class="underline">${currency}${finalPayout.toFixed(2)}</span>
          </div>
        </div>
      </div>
    `;
  } else {
    payoutEl.textContent = `${currency}0.00`;
    payoutEl.className = "text-rose-600 font-mono text-base font-black";

    const thresholdDays = Math.ceil((thresholdPct / 100) * totalSessions);
    const shortBy = thresholdDays - presentDays;

    cardEl.className = "rounded-2xl p-4 border bg-rose-50 border-rose-200 text-rose-900";
    cardEl.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-8 h-8 rounded-xl bg-rose-500 text-white flex items-center justify-center text-sm font-bold shrink-0 mt-0.5 shadow-2xs">
          <i class="fa-solid fa-ban"></i>
        </div>
        <div>
          <div class="font-extrabold text-sm text-rose-800 flex items-center gap-2">
            <span>⚠️ INELIGIBLE (Below 70% Cutoff)</span>
            <span class="text-xs font-mono font-bold bg-rose-200/70 text-rose-900 px-2 py-0.5 rounded-full">${pct}% &lt; ${thresholdPct}%</span>
          </div>
          <p class="text-xs text-rose-700 mt-1">
            Attendance is below the mandatory 70% cutoff. Payout remains <strong>$0.00</strong>.
          </p>
          <div class="mt-2 text-xs font-bold text-rose-800">
            👉 Needs <strong>${shortBy} more present session(s)</strong> (at least ${thresholdDays} days) to become eligible!
          </div>
        </div>
      </div>
    `;
  }
}

async function saveStudentAttendanceUpdate() {
  if (!activeStudentUpdate) return;
  const input = document.getElementById('upd-present-input');
  const presentDays = parseInt(input.value) || 0;
  const btn = document.getElementById('btn-save-upd');

  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

  try {
    const res = await fetch('/api/attendance/student-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: activeStudentUpdate.student.id,
        period_id: activeStudentUpdate.period.id,
        days_present: presentDays
      })
    });

    if (!res.ok) throw new Error("Failed to save attendance update");
    const result = await res.json();

    closeModal('modal-update-attendance');

    const msg = result.is_eligible 
      ? `🎉 SUCCESS! ${activeStudentUpdate.student.name} reached ${result.attendance_percentage}% attendance and is now ELIGIBLE for payment ($${result.gross_pay.toFixed(2)})!`
      : `Updated attendance to ${result.attendance_percentage}%. Still below 70% cutoff ($0.00).`;

    alert(msg);

    await refreshDashboard();
    await loadAttendanceForDate();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> <span>Save Attendance & Update Payout</span>`;
  }
}

// Seed Demo Data
async function seedData() {
  const btn = document.getElementById('btn-seed');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading...`;
  try {
    await fetch('/api/seed', { method: 'POST' });
    await loadPeriods();
    alert('Demo data loaded successfully with banking records and attendance history!');
  } catch (err) {
    alert('Error loading demo data: ' + err.message);
  } finally {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles text-amber-500"></i> Demo Data`;
  }
}

// Export CSV
function exportCSV() {
  if (!currentPeriodId) return;
  window.location.href = `/api/payroll/${currentPeriodId}/export-csv`;
}

// Modal Helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}
