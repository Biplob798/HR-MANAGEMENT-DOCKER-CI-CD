const state = { page: 1, pageSize: 10, search: '', rows: [] };

const $ = id => document.getElementById(id);

// Prevents HTML injection from database values
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Small helper for calling the API
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Server error ' + res.status);
  return body;
}

function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- Dropdowns (jobs and departments) ----------
async function loadLookups() {
  const [jobs, depts] = await Promise.all([api('/api/jobs'), api('/api/departments')]);
  $('job_id').innerHTML = '<option value="">-- select job --</option>' +
    jobs.map(j => `<option value="${esc(j.JOB_ID)}">${esc(j.JOB_TITLE)}</option>`).join('');
  $('department_id').innerHTML = '<option value="">-- none --</option>' +
    depts.map(d => `<option value="${d.DEPARTMENT_ID}">${esc(d.DEPARTMENT_NAME)}</option>`).join('');
}

// ---------- Report ----------
async function loadEmployees() {
  $('status').textContent = 'Loading...';
  try {
    const q = new URLSearchParams({
      page: state.page,
      pageSize: state.pageSize,
      search: state.search
    });
    const result = await api('/api/employees?' + q);
    state.rows = result.data;

    // If we are beyond the last page (e.g. after searching), jump back
    if (result.data.length === 0 && result.total > 0 && state.page > 1) {
      state.page = result.totalPages;
      return loadEmployees();
    }

    renderRows(result.data);
    renderPager(result);

    const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
    const to = Math.min(result.page * result.pageSize, result.total);
    $('status').textContent = `Showing ${from}-${to} of ${result.total} employees`;
  } catch (err) {
    $('status').textContent = 'Failed to load data: ' + err.message;
  }
}

function renderRows(rows) {
  $('rows').innerHTML = rows.length === 0
    ? '<tr><td colspan="9">No employees found.</td></tr>'
    : rows.map(e => `
      <tr>
        <td>${e.EMPLOYEE_ID}</td>
        <td>${esc(e.FIRST_NAME)} ${esc(e.LAST_NAME)}</td>
        <td>${esc(e.EMAIL)}</td>
        <td>${esc(e.PHONE_NUMBER)}</td>
        <td>${esc(e.HIRE_DATE)}</td>
        <td>${esc(e.JOB_TITLE)}</td>
        <td class="num">${e.SALARY == null ? '' : Number(e.SALARY).toLocaleString()}</td>
        <td>${esc(e.DEPARTMENT_NAME)}</td>
        <td><button class="btn small" data-edit="${e.EMPLOYEE_ID}">Edit</button></td>
      </tr>`).join('');
}

function renderPager({ page, totalPages }) {
  const btn = (label, target, disabled = false, active = false) =>
    `<button class="btn small ${active ? 'active' : ''}" data-page="${target}" ${disabled ? 'disabled' : ''}>${label}</button>`;

  let html = btn('&laquo; First', 1, page === 1) + btn('&lsaquo; Prev', page - 1, page === 1);

  // Show a window of up to 5 page numbers around the current page
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) html += btn(p, p, false, p === page);

  html += btn('Next &rsaquo;', page + 1, page === totalPages) + btn('Last &raquo;', totalPages, page === totalPages);
  $('pager').innerHTML = html;
}

$('pager').addEventListener('click', e => {
  const b = e.target.closest('button[data-page]');
  if (!b || b.disabled) return;
  state.page = Number(b.dataset.page);
  loadEmployees();
});

$('pageSize').addEventListener('change', e => {
  state.pageSize = Number(e.target.value);
  state.page = 1;
  loadEmployees();
});

let searchTimer;
$('search').addEventListener('input', e => {
  clearTimeout(searchTimer);                 // wait until the user stops typing
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    state.page = 1;
    loadEmployees();
  }, 300);
});

// ---------- Add / Edit form ----------
const FIELDS = ['first_name', 'last_name', 'email', 'phone_number', 'hire_date', 'job_id', 'salary', 'department_id'];

function openForm(emp) {
  $('formError').textContent = '';
  $('empForm').reset();

  if (emp) {                                  // EDIT mode
    $('dlgTitle').textContent = 'Edit Employee #' + emp.EMPLOYEE_ID;
    $('employee_id').value = emp.EMPLOYEE_ID;
    $('first_name').value = emp.FIRST_NAME ?? '';
    $('last_name').value = emp.LAST_NAME ?? '';
    $('email').value = emp.EMAIL ?? '';
    $('phone_number').value = emp.PHONE_NUMBER ?? '';
    $('hire_date').value = emp.HIRE_DATE ?? '';
    $('job_id').value = emp.JOB_ID ?? '';
    $('salary').value = emp.SALARY ?? '';
    $('department_id').value = emp.DEPARTMENT_ID ?? '';
  } else {                                    // ADD mode
    $('dlgTitle').textContent = 'Add Employee';
    $('employee_id').value = '';
    $('hire_date').value = new Date().toISOString().slice(0, 10);
  }
  $('dlg').showModal();
}

$('addBtn').addEventListener('click', () => openForm(null));
$('cancelBtn').addEventListener('click', () => $('dlg').close());

$('rows').addEventListener('click', e => {
  const b = e.target.closest('button[data-edit]');
  if (!b) return;
  const emp = state.rows.find(r => r.EMPLOYEE_ID === Number(b.dataset.edit));
  if (emp) openForm(emp);
});

$('empForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('formError').textContent = '';

  const payload = {};
  FIELDS.forEach(f => payload[f] = $(f).value);

  const id = $('employee_id').value;
  try {
    if (id) {
      await api('/api/employees/' + id, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Employee updated');
    } else {
      await api('/api/employees', { method: 'POST', body: JSON.stringify(payload) });
      toast('Employee added');
    }
    $('dlg').close();
    loadEmployees();
  } catch (err) {
    $('formError').textContent = err.message;
  }
});

// ---------- Start ----------
loadLookups().catch(err => { $('status').textContent = 'Failed to load lookups: ' + err.message; });
loadEmployees();