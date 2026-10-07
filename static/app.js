let currentPeriodId = null;
let currentPayrollData = null;
let studentsList = [];
let periodsList = [];
let currentFilter = 'all';
let searchQuery = '';

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

  // Update Top Bar Header
  const meta = VIEW_METADATA[viewId] || { title: 'Student Payroll System', breadcrumb: 'Portal' };
  const titleEl = document.getElementById('current-view-title');
  const breadcrumbEl = document.getElementById('breadcrumb-current');
  if (titleEl) titleEl.textContent = meta.title;
  if (breadcrumbEl) breadcrumbEl.textContent = meta.breadcrumb;

  // View-specific data fetching
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

  // Attendance Spectrum
  const eligiblePct = s.eligibility_rate_percent;
  const ineligiblePct = Math.max(0, 100 - eligiblePct);
  const specElig = document.getElementById('spectrum-eligible');
  const specInelig = document.getElementById('spectrum-ineligible');
  const labelElig = document.getElementById('spectrum-label-eligible');
  const labelInelig = document.getElementById('spectrum-label-ineligible');

  if (specElig) specElig.style.width = `${eligiblePct}%`;
  if (specInelig) specInelig.style.width = `${ineligiblePct}%`;
  if (labelElig) labelElig.textContent = `Eligible: ${s.eligible_students} (${eligiblePct}%)`;
  if (labelInelig) labelInelig.textContent = `Ineligible: ${s.ineligible_students} (${ineligiblePct.toFixed(1)}%)`;

  // Dashboard Snapshot Table (first 4 students)
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
        </tr>
      `;
    }).join('');
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

// Render Payroll Computation Sheet with Filtering & Search
function renderPayrollTable() {
  if (!currentPayrollData) return;
  const records = currentPayrollData.payroll_records || [];

  // Update counts
  const eligibleTotal = records.filter(r => r.is_eligible).length;
  const ineligibleTotal = records.filter(r => !r.is_eligible).length;
  const countAll = document.getElementById('count-all');
  const countElig = document.getElementById('count-eligible');
  const countInelig = document.getElementById('count-ineligible');
  if (countAll) countAll.textContent = records.length;
  if (countElig) countElig.textContent = eligibleTotal;
  if (countInelig) countInelig.textContent = ineligibleTotal;

  // Apply filters
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
      r.email.toLowerCase().includes(searchQuery)
    );
  }

  const tbody = document.getElementById('payroll-table-body');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400 font-mono text-xs">No matching student records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r, idx) => {
    const isEligible = r.is_eligible;
    const pct = r.attendance_percentage;
    const threshold = r.threshold_percent;

    const barColor = isEligible ? 'bg-emerald-500' : 'bg-rose-500';
    const badgeHtml = isEligible
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
           <i class="fa-solid fa-circle-check text-emerald-600"></i> ELIGIBLE (PAID)
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
           <i class="fa-solid fa-circle-xmark text-rose-600"></i> INELIGIBLE (<70%)
         </span>`;

    const payDisplay = isEligible
      ? `<div class="font-extrabold text-slate-900 text-sm font-mono">${r.currency}${r.gross_pay.toFixed(2)}</div>
         <div class="text-[10px] text-slate-400 font-mono font-medium">${r.days_present} days × ${r.currency}${r.daily_rate}</div>`
      : `<div class="font-extrabold text-rose-600 text-sm font-mono">${r.currency}0.00</div>
         <div class="text-[10px] text-rose-400 line-through font-mono">Forfeited ${r.currency}${r.potential_earnings.toFixed(2)}</div>`;

    return `
      <tr class="hover:bg-slate-50/70 transition-colors">
        <td class="py-3.5 px-5">
          <div class="font-bold text-slate-900">${r.name}</div>
          <div class="text-xs font-mono text-slate-400">${r.student_code} • ${r.email}</div>
        </td>
        <td class="py-3.5 px-4 font-mono text-xs">
          <span class="font-bold text-slate-800">${r.days_present}</span> / ${r.total_sessions} days
          <div class="text-[10px] text-slate-400 font-sans">Absent: ${r.days_absent} | Excused: ${r.days_excused}</div>
        </td>
        <td class="py-3.5 px-4 min-w-[150px]">
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
        <td class="py-3.5 px-4 font-mono text-xs text-slate-700 font-medium">
          ${r.currency}${r.daily_rate.toFixed(2)} / session
        </td>
        <td class="py-3.5 px-5 text-right">
          ${payDisplay}
        </td>
        <td class="py-3.5 px-4 text-center">
          <button onclick="viewPayslipByCode('${r.student_code}')" class="px-3 py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-all shadow-2xs" title="View Detailed Payslip">
            <i class="fa-solid fa-receipt text-slate-500 mr-1"></i> Slip
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// View Payslip Modal
function viewPayslipByCode(studentCode) {
  if (!currentPayrollData || !currentPayrollData.payroll_records) return;
  const r = currentPayrollData.payroll_records.find(item => item.student_code === studentCode);
  if (!r) return;

  document.getElementById('slip-name').textContent = r.name;
  document.getElementById('slip-student-code').textContent = `${r.student_code} • ${r.email}`;
  document.getElementById('slip-period').textContent = r.period_name;
  document.getElementById('slip-total-sessions').textContent = `${r.total_sessions} Required Days`;
  document.getElementById('slip-attended').textContent = `${r.days_present} Days Present`;
  
  const rateEl = document.getElementById('slip-attendance-rate');
  rateEl.textContent = `${r.attendance_percentage}%`;
  rateEl.className = r.is_eligible ? "font-bold text-emerald-600 text-sm" : "font-bold text-rose-600 text-sm";

  document.getElementById('slip-rate').textContent = `${r.currency}${r.daily_rate.toFixed(2)} / day`;
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
        <div class="font-bold text-sm text-emerald-800">ELIGIBLE FOR DISBURSAL</div>
        <p class="mt-0.5">${r.eligibility_reason}</p>
        <p class="mt-1 text-emerald-700 font-mono">Formula: ${r.days_present} Days × ${r.currency}${r.daily_rate} = <strong>${r.currency}${r.gross_pay.toFixed(2)}</strong></p>
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
        <p class="mt-1 text-rose-700 font-mono">Under the strict 70% threshold rule, no stipend is disbursed when attendance is below 70%.</p>
      </div>
    `;
  }

  openModal('modal-payslip');
}

// Attendance Logger
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
    alert('Attendance saved successfully! Payroll calculations have updated.');
    await refreshDashboard();
  } catch (err) {
    alert('Error saving attendance: ' + err.message);
  }
}

// Student Directory
async function loadStudentsRoster() {
  try {
    const res = await fetch('/api/students');
    studentsList = await res.json();
    const tbody = document.getElementById('student-roster-body');
    if (!tbody) return;

    if (studentsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 font-mono text-xs">No students registered.</td></tr>`;
      return;
    }

    tbody.innerHTML = studentsList.map(s => `
      <tr class="hover:bg-slate-50/70 transition-colors">
        <td class="py-3.5 px-5 font-mono text-xs font-bold text-slate-700">${s.student_id}</td>
        <td class="py-3.5 px-4 font-bold text-slate-900">${s.name}</td>
        <td class="py-3.5 px-4 text-xs text-slate-500 font-mono">${s.email}</td>
        <td class="py-3.5 px-4 font-mono text-xs text-slate-900 font-bold">${s.currency}${s.daily_rate.toFixed(2)} / session</td>
        <td class="py-3.5 px-4 text-center">
          <button onclick="deleteStudent(${s.id})" class="text-rose-500 hover:text-rose-700 text-xs px-2.5 py-1.5 rounded-lg hover:bg-rose-50 transition-colors" title="Delete Student">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
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

// Add Student Form
async function submitAddStudent(e) {
  e.preventDefault();
  const payload = {
    student_id: document.getElementById('new-stu-id').value,
    name: document.getElementById('new-stu-name').value,
    email: document.getElementById('new-stu-email').value,
    daily_rate: parseFloat(document.getElementById('new-stu-rate').value),
    currency: document.getElementById('new-stu-currency').value
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

// Seed Demo Data
async function seedData() {
  const btn = document.getElementById('btn-seed');
  if (btn) btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Loading...`;
  try {
    await fetch('/api/seed', { method: 'POST' });
    await loadPeriods();
    alert('Demo data loaded successfully!');
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
