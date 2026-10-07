let currentPeriodId = null;
let currentPayrollData = null;
let studentsList = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  // Set default date for attendance picker
  const today = new Date().toISOString().split('T')[0];
  const datePicker = document.getElementById('attendance-date-picker');
  if (datePicker) {
    datePicker.value = "2026-10-15"; // matches our sample cohort dates or today
  }

  await loadPeriods();
});

// Switch Tabs
function switchTab(tabId) {
  const tabs = ['tab-payroll', 'tab-attendance', 'tab-students'];
  tabs.forEach(t => {
    const el = document.getElementById(t);
    const btn = document.getElementById('tab-btn-' + t.replace('tab-', ''));
    if (t === tabId) {
      el.classList.remove('hidden');
      btn.className = "py-3 border-b-2 border-emerald-600 text-emerald-700 font-semibold flex items-center gap-2";
    } else {
      el.classList.add('hidden');
      btn.className = "py-3 border-b-2 border-transparent text-slate-500 hover:text-slate-800 flex items-center gap-2";
    }
  });

  if (tabId === 'tab-attendance') {
    loadAttendanceForDate();
  } else if (tabId === 'tab-students') {
    loadStudentsRoster();
  }
}

// Load Periods
async function loadPeriods() {
  try {
    const res = await fetch('/api/periods');
    const periods = await res.json();
    const select = document.getElementById('period-select');
    select.innerHTML = '';

    if (!periods || periods.length === 0) {
      // Prompt user to seed or seed automatically
      await seedData();
      return;
    }

    periods.forEach((p, idx) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.total_sessions} sessions)`;
      select.appendChild(opt);
    });

    currentPeriodId = periods[0].id;
    await refreshDashboard();
  } catch (err) {
    console.error("Failed to load periods:", err);
  }
}

async function onPeriodChange() {
  const select = document.getElementById('period-select');
  currentPeriodId = parseInt(select.value);
  await refreshDashboard();
}

// Refresh Dashboard
async function refreshDashboard() {
  if (!currentPeriodId) return;

  try {
    const res = await fetch(`/api/payroll/${currentPeriodId}`);
    if (!res.ok) throw new Error('Failed to fetch payroll');
    currentPayrollData = await res.json();

    renderHeaderAndKpis(currentPayrollData);
    renderPayrollTable(currentPayrollData.payroll_records);
  } catch (err) {
    console.error("Failed to refresh dashboard:", err);
  }
}

// Render Header & KPIs
function renderHeaderAndKpis(data) {
  const p = data.period;
  const s = data.summary;

  document.getElementById('active-period-title').textContent = `${p.name} (${p.total_sessions} Required Sessions)`;

  document.getElementById('kpi-disbursed').textContent = `$${s.total_disbursed.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
  document.getElementById('kpi-eligible-ratio').textContent = `${s.eligible_students} / ${s.total_students} Eligible`;
  document.getElementById('kpi-eligible-text').textContent = `${s.eligibility_rate_percent}% qualified for stipend`;

  document.getElementById('kpi-forfeited').textContent = `$${s.total_forfeited.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
  document.getElementById('kpi-avg-attendance').textContent = `${s.average_attendance}%`;

  const bar = document.getElementById('kpi-avg-bar');
  bar.style.width = `${Math.min(100, s.average_attendance)}%`;
  if (s.average_attendance >= 70) {
    bar.className = "bg-emerald-500 h-1.5 rounded-full";
  } else {
    bar.className = "bg-rose-500 h-1.5 rounded-full";
  }
}

// Render Payroll Table
function renderPayrollTable(records) {
  const tbody = document.getElementById('payroll-table-body');
  if (!records || records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">No student records found for this period.</td></tr>`;
    return;
  }

  tbody.innerHTML = records.map((r, idx) => {
    const isEligible = r.is_eligible;
    const pct = r.attendance_percentage;
    const threshold = r.threshold_percent;

    // Progress bar and badge styling
    const barColor = isEligible ? 'bg-emerald-500' : 'bg-rose-500';
    const badgeHtml = isEligible
      ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
           <i class="fa-solid fa-circle-check text-emerald-600"></i> ELIGIBLE (PAID)
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
           <i class="fa-solid fa-circle-xmark text-rose-600"></i> INELIGIBLE (<70%)
         </span>`;

    const payDisplay = isEligible
      ? `<div class="font-bold text-slate-900 text-base">${r.currency}${r.gross_pay.toFixed(2)}</div>
         <div class="text-[11px] text-slate-400 font-mono">${r.days_present} days × ${r.currency}${r.daily_rate}</div>`
      : `<div class="font-bold text-rose-600 text-base">${r.currency}0.00</div>
         <div class="text-[11px] text-rose-400 line-through font-mono">Forfeited ${r.currency}${r.potential_earnings.toFixed(2)}</div>`;

    return `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3.5 px-4">
          <div class="font-semibold text-slate-900">${r.name}</div>
          <div class="text-xs font-mono text-slate-400">${r.student_code} • ${r.email}</div>
        </td>
        <td class="py-3.5 px-4 font-mono text-xs">
          <span class="font-semibold text-slate-800">${r.days_present}</span> / ${r.total_sessions} days
          <div class="text-[11px] text-slate-400">Absent: ${r.days_absent} | Excused: ${r.days_excused}</div>
        </td>
        <td class="py-3.5 px-4 min-w-[160px]">
          <div class="flex items-center justify-between text-xs font-mono mb-1">
            <span class="font-bold ${isEligible ? 'text-emerald-700' : 'text-rose-700'}">${pct}%</span>
            <span class="text-[11px] text-slate-400">Req: ${threshold}%</span>
          </div>
          <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div class="${barColor} h-2 rounded-full transition-all" style="width: ${Math.min(100, pct)}%"></div>
          </div>
        </td>
        <td class="py-3.5 px-4">
          ${badgeHtml}
        </td>
        <td class="py-3.5 px-4 font-mono text-xs text-slate-700">
          ${r.currency}${r.daily_rate.toFixed(2)} / day
        </td>
        <td class="py-3.5 px-4 text-right">
          ${payDisplay}
        </td>
        <td class="py-3.5 px-4 text-center">
          <button onclick="viewPayslip(${idx})" class="px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-all" title="View Detailed Payslip">
            <i class="fa-solid fa-receipt"></i> Payslip
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// View Payslip Modal
function viewPayslip(recordIdx) {
  if (!currentPayrollData || !currentPayrollData.payroll_records[recordIdx]) return;
  const r = currentPayrollData.payroll_records[recordIdx];

  document.getElementById('slip-name').textContent = r.name;
  document.getElementById('slip-student-code').textContent = `${r.student_code} • ${r.email}`;
  document.getElementById('slip-period').textContent = r.period_name;
  document.getElementById('slip-total-sessions').textContent = `${r.total_sessions} Days`;
  document.getElementById('slip-attended').textContent = `${r.days_present} Days Present`;
  
  const rateEl = document.getElementById('slip-attendance-rate');
  rateEl.textContent = `${r.attendance_percentage}%`;
  rateEl.className = r.is_eligible ? "font-bold text-emerald-600" : "font-bold text-rose-600";

  document.getElementById('slip-rate').textContent = `${r.currency}${r.daily_rate.toFixed(2)} / day`;
  document.getElementById('slip-potential').textContent = `${r.currency}${r.potential_earnings.toFixed(2)}`;
  
  const finalPayoutEl = document.getElementById('slip-final-payout');
  const bannerEl = document.getElementById('slip-status-banner');

  if (r.is_eligible) {
    finalPayoutEl.textContent = `${r.currency}${r.gross_pay.toFixed(2)}`;
    finalPayoutEl.className = "text-emerald-700 text-lg font-black";

    bannerEl.className = "rounded-xl p-4 border bg-emerald-50 border-emerald-200 flex items-start gap-3 text-emerald-900";
    bannerEl.innerHTML = `
      <div class="text-xl text-emerald-600 mt-0.5"><i class="fa-solid fa-circle-check"></i></div>
      <div class="text-xs">
        <div class="font-bold text-sm text-emerald-800">ELIGIBLE FOR DISBURSAL</div>
        <p class="mt-0.5">${r.eligibility_reason}</p>
        <p class="mt-1 text-emerald-700 font-mono">Disbursal Formula: ${r.days_present} Present Days × ${r.currency}${r.daily_rate} = <strong>${r.currency}${r.gross_pay.toFixed(2)}</strong></p>
      </div>
    `;
  } else {
    finalPayoutEl.textContent = `${r.currency}0.00`;
    finalPayoutEl.className = "text-rose-600 text-lg font-black";

    bannerEl.className = "rounded-xl p-4 border bg-rose-50 border-rose-200 flex items-start gap-3 text-rose-900";
    bannerEl.innerHTML = `
      <div class="text-xl text-rose-600 mt-0.5"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div class="text-xs">
        <div class="font-bold text-sm text-rose-800">INELIGIBLE — DISBURSAL FORFEITED</div>
        <p class="mt-0.5">${r.eligibility_reason}</p>
        <p class="mt-1 text-rose-700 font-mono">Under the 70% minimum threshold rule, no stipend is disbursed when attendance is below 70%.</p>
      </div>
    `;
  }

  openModal('modal-payslip');
}

// Attendance Logger
async function loadAttendanceForDate() {
  if (!currentPeriodId) return;
  const date = document.getElementById('attendance-date-picker').value;
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
    if (studentsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-slate-400">No students registered.</td></tr>`;
      return;
    }

    tbody.innerHTML = studentsList.map(s => {
      const record = attMap[s.id] || { status: 'present', notes: '' };
      return `
        <tr data-student-id="${s.id}">
          <td class="py-3 px-4">
            <div class="font-semibold text-slate-800">${s.name}</div>
            <div class="text-xs text-slate-400 font-mono">${s.student_id}</div>
          </td>
          <td class="py-3 px-4 text-center">
            <div class="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 gap-1">
              <label class="cursor-pointer px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all has-[:checked]:bg-emerald-600 has-[:checked]:text-white text-slate-600 hover:text-slate-900">
                <input type="radio" name="att_${s.id}" value="present" ${record.status === 'present' ? 'checked' : ''} class="hidden">
                Present
              </label>
              <label class="cursor-pointer px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all has-[:checked]:bg-rose-600 has-[:checked]:text-white text-slate-600 hover:text-slate-900">
                <input type="radio" name="att_${s.id}" value="absent" ${record.status === 'absent' ? 'checked' : ''} class="hidden">
                Absent
              </label>
              <label class="cursor-pointer px-3 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all has-[:checked]:bg-amber-500 has-[:checked]:text-white text-slate-600 hover:text-slate-900">
                <input type="radio" name="att_${s.id}" value="excused" ${record.status === 'excused' ? 'checked' : ''} class="hidden">
                Excused
              </label>
            </div>
          </td>
          <td class="py-3 px-4">
            <input type="text" value="${record.notes || ''}" placeholder="Optional notes..." class="att-note-input w-full border border-slate-200 rounded px-2.5 py-1 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none"/>
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
    alert('Attendance saved successfully! Recalculating payroll...');
    await refreshDashboard();
  } catch (err) {
    alert('Error saving attendance: ' + err.message);
  }
}

// Student Roster
async function loadStudentsRoster() {
  try {
    const res = await fetch('/api/students');
    studentsList = await res.json();
    const tbody = document.getElementById('student-roster-body');

    if (studentsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400">No students found.</td></tr>`;
      return;
    }

    tbody.innerHTML = studentsList.map(s => `
      <tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3 px-4 font-mono text-xs font-semibold text-slate-700">${s.student_id}</td>
        <td class="py-3 px-4 font-semibold text-slate-800">${s.name}</td>
        <td class="py-3 px-4 text-xs text-slate-500 font-mono">${s.email}</td>
        <td class="py-3 px-4 font-mono text-xs text-slate-800 font-semibold">${s.currency}${s.daily_rate.toFixed(2)} / session</td>
        <td class="py-3 px-4 text-center">
          <button onclick="deleteStudent(${s.id})" class="text-rose-500 hover:text-rose-700 text-xs px-2 py-1 rounded hover:bg-rose-50" title="Delete Student">
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
    alert('Demo data loaded successfully! Check the 70% attendance cutoff in the payroll table.');
  } catch (err) {
    alert('Error loading demo data: ' + err.message);
  } finally {
    if (btn) btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Load Demo Data`;
  }
}

// Export CSV
function exportCSV() {
  if (!currentPeriodId) return;
  window.location.href = `/api/payroll/${currentPeriodId}/export-csv`;
}

// Modal Helpers
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
