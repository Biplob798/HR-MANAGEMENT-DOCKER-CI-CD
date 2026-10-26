const express = require('express');
const oracledb = require('oracledb');

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const app = express();
app.use(express.json());          // lets us read JSON sent by the browser

let pool;

async function getPool() {
  if (!pool) {
    pool = await oracledb.createPool({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING,
      poolMin: 1,
      poolMax: 5
    });
  }
  return pool;
}

// Runs one SQL statement. autoCommit saves INSERT/UPDATE immediately.
async function query(sql, binds = {}) {
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    return await conn.execute(sql, binds, { autoCommit: true });
  } finally {
    await conn.close();
  }
}

// Turns Oracle errors into clear messages for the user
function sendError(res, e) {
  console.error(e);
  const map = {
    1:     [409, 'This email already exists. Use a different email.'],
    2291:  [400, 'Selected job or department does not exist.'],
    1400:  [400, 'A required field is empty.'],
    12899: [400, 'One of the values is too long.'],
    1438:  [400, 'Salary value is too large.'],
    20205: [400, 'Database blocks changes outside office hours (HR trigger).']
  };
  const [status, message] = map[e.errorNum] || [500, e.message];
  res.status(status).json({ error: message });
}

// Next employee id: uses the HR sequence, or MAX+1 if the sequence is missing
async function nextEmployeeId() {
  try {
    const r = await query('SELECT employees_seq.NEXTVAL AS ID FROM dual');
    return r.rows[0].ID;
  } catch (e) {
    if (e.errorNum === 2289) {
      const r = await query('SELECT NVL(MAX(employee_id),0)+1 AS ID FROM employees');
      return r.rows[0].ID;
    }
    throw e;
  }
}

// Reads and cleans the form data sent by the browser
function readEmployee(body) {
  const text = v => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  const num  = v => (text(v) === null ? null : Number(v));
  return {
    first_name: text(body.first_name),
    last_name: text(body.last_name),
    email: text(body.email) ? text(body.email).toUpperCase() : null,   // HR schema stores emails in capitals
    phone: text(body.phone_number),
    hire_date: text(body.hire_date),
    job_id: text(body.job_id),
    salary: num(body.salary),
    department_id: num(body.department_id)
  };
}

function validate(emp) {
  if (!emp.last_name) return 'Last name is required.';
  if (!emp.email) return 'Email is required.';
  if (!emp.hire_date) return 'Hire date is required.';
  if (!emp.job_id) return 'Job is required.';
  if (emp.salary !== null && (isNaN(emp.salary) || emp.salary < 0)) return 'Salary must be a positive number.';
  return null;
}

const EMPLOYEE_SELECT = `
  SELECT e.employee_id, e.first_name, e.last_name, e.email, e.phone_number,
         TO_CHAR(e.hire_date, 'YYYY-MM-DD') AS hire_date,
         e.job_id, j.job_title, e.salary,
         e.department_id, d.department_name
  FROM employees e
  LEFT JOIN jobs j        ON e.job_id = j.job_id
  LEFT JOIN departments d ON e.department_id = d.department_id`;

// ---------- Health ----------
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Dropdown data ----------
app.get('/api/jobs', async (req, res) => {
  try {
    const r = await query('SELECT job_id, job_title FROM jobs ORDER BY job_title');
    res.json(r.rows);
  } catch (e) { sendError(res, e); }
});

app.get('/api/departments', async (req, res) => {
  try {
    const r = await query('SELECT department_id, department_name FROM departments ORDER BY department_name');
    res.json(r.rows);
  } catch (e) { sendError(res, e); }
});

app.get('/api/regions', async (req, res) => {
  try {
    const r = await query('SELECT region_id, region_name FROM regions ORDER BY 1');
    res.json(r.rows);
  } catch (e) { sendError(res, e); }
});

// ---------- Report with pagination + search ----------
app.get('/api/employees', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 10, 1), 100);
    const search = '%' + (req.query.search || '').toLowerCase() + '%';
    const where = `WHERE LOWER(e.first_name || ' ' || e.last_name || ' ' || e.email) LIKE :search`;

    const count = await query(`SELECT COUNT(*) AS TOTAL FROM employees e ${where}`, { search });
    const total = count.rows[0].TOTAL;

    const data = await query(
      `${EMPLOYEE_SELECT} ${where}
       ORDER BY e.employee_id
       OFFSET :skip ROWS FETCH NEXT :take ROWS ONLY`,
      { search, skip: (page - 1) * pageSize, take: pageSize }
    );

    res.json({
      data: data.rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  } catch (e) { sendError(res, e); }
});

// ---------- One employee ----------
app.get('/api/employees/:id', async (req, res) => {
  try {
    const r = await query(`${EMPLOYEE_SELECT} WHERE e.employee_id = :id`, { id: Number(req.params.id) });
    if (r.rows.length === 0) return res.status(404).json({ error: 'Employee not found.' });
    res.json(r.rows[0]);
  } catch (e) { sendError(res, e); }
});

// ---------- Add employee ----------
app.post('/api/employees', async (req, res) => {
  try {
    const emp = readEmployee(req.body);
    const problem = validate(emp);
    if (problem) return res.status(400).json({ error: problem });

    const id = await nextEmployeeId();
    await query(
      `INSERT INTO employees
         (employee_id, first_name, last_name, email, phone_number, hire_date, job_id, salary, department_id)
       VALUES
         (:id, :first_name, :last_name, :email, :phone, TO_DATE(:hire_date, 'YYYY-MM-DD'), :job_id, :salary, :department_id)`,
      { id, ...emp }
    );
    res.status(201).json({ message: 'Employee added.', employee_id: id });
  } catch (e) { sendError(res, e); }
});

// ---------- Edit employee ----------
app.put('/api/employees/:id', async (req, res) => {
  try {
    const emp = readEmployee(req.body);
    const problem = validate(emp);
    if (problem) return res.status(400).json({ error: problem });

    const r = await query(
      `UPDATE employees SET
         first_name = :first_name,
         last_name = :last_name,
         email = :email,
         phone_number = :phone,
         hire_date = TO_DATE(:hire_date, 'YYYY-MM-DD'),
         job_id = :job_id,
         salary = :salary,
         department_id = :department_id
       WHERE employee_id = :id`,
      { id: Number(req.params.id), ...emp }
    );
    if (r.rowsAffected === 0) return res.status(404).json({ error: 'Employee not found.' });
    res.json({ message: 'Employee updated.' });
  } catch (e) { sendError(res, e); }
});

app.listen(3000, () => console.log('Backend running on port 3000'));