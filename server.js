// ============================================================
//  server.js — Updated with:
//  1. Delete customer
//  2. Email + screen reminders for due bills
//  3. Real BESCOM slab-based bill calculation
//  4. Penalty charges for overdue bills
// ============================================================

const express    = require('express');
const mysql      = require('mysql2');
const cors       = require('cors');
const path       = require('path');

const app  = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ──────────────────────────────────────────────────
const db = mysql.createConnection({
  host: 'localhost', user: 'root', password: '', database: 'electricity_db'
});
db.connect(err => {
  if (err) console.error('❌ MySQL error:', err.message);
  else     console.log('✅ Connected to MySQL database!');
});

// ── Residential Tariff Structure ─────────────────────────────
// 0–50 units:     ₹4.85/unit
// 51–100 units:   ₹5.88/unit
// 101–200 units:  ₹7.85/unit
// Above 200 units:₹9.13/unit
function calculateBESCOMBill(units) {
  let energyCharge = 0;
  let fixedCharge  = 50;
  let taxPercent   = 8;
  let tariffId     = 1;

  if (units <= 50) {
    energyCharge = units * 4.85;
    fixedCharge  = 35; taxPercent = 5; tariffId = 1;
  } else if (units <= 100) {
    energyCharge = (50 * 4.85) + ((units - 50) * 5.88);
    fixedCharge  = 50; taxPercent = 5; tariffId = 2;
  } else if (units <= 200) {
    energyCharge = (50 * 4.85) + (50 * 5.88) + ((units - 100) * 7.85);
    fixedCharge  = 75; taxPercent = 8; tariffId = 3;
  } else {
    energyCharge = (50 * 4.85) + (50 * 5.88) + (100 * 7.85) + ((units - 200) * 9.13);
    fixedCharge  = 100; taxPercent = 10; tariffId = 4;
  }

  const taxAmount = (energyCharge + fixedCharge) * taxPercent / 100;
  const total     = energyCharge + fixedCharge + taxAmount;
  return {
    tariffId,
    energyCharge: parseFloat(energyCharge.toFixed(2)),
    fixedCharge:  parseFloat(fixedCharge.toFixed(2)),
    taxAmount:    parseFloat(taxAmount.toFixed(2)),
    totalAmount:  parseFloat(total.toFixed(2))
  };
}

// Penalty: 1.5% of total per month overdue
function calculatePenalty(totalAmount, dueDateStr) {
  const due = new Date(dueDateStr);
  const now = new Date();
  if (now <= due) return 0;
  const monthsLate = Math.ceil((now - due) / (1000 * 60 * 60 * 24 * 30));
  return parseFloat((totalAmount * 0.015 * monthsLate).toFixed(2));
}

// ============================================================
//  API ROUTES
// ============================================================

// Dashboard stats
app.get('/api/dashboard-stats', (req, res) => {
  const sql = `SELECT
    (SELECT COUNT(*) FROM Customer) AS totalCustomers,
    (SELECT COUNT(*) FROM Bill) AS totalBills,
    (SELECT COALESCE(SUM(amount_paid),0) FROM Payment) AS totalCollected,
    (SELECT COALESCE(SUM(total_amount),0) FROM Bill WHERE bill_status IN ('unpaid','overdue')) AS totalOutstanding,
    (SELECT COUNT(*) FROM Bill WHERE bill_status='overdue') AS totalOverdue`;
  db.query(sql, (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(r[0]);
  });
});

app.get('/api/recent-bills', (req, res) => {
  db.query(`SELECT b.bill_id,b.bill_date,b.total_amount,b.bill_status,c.name AS customer_name
    FROM Bill b JOIN Customer c ON b.customer_id=c.customer_id ORDER BY b.bill_date DESC LIMIT 10`,
    (err, r) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(r);
    });
});

// Screen reminders — bills due within 5 days or overdue
app.get('/api/reminders', (req, res) => {
  const sql = `
    SELECT b.bill_id, b.total_amount, b.due_date, b.bill_status, b.penalty_amount,
           c.name AS customer_name, c.email, c.customer_id,
           DATEDIFF(b.due_date, CURDATE()) AS days_until_due
    FROM Bill b JOIN Customer c ON b.customer_id=c.customer_id
    WHERE b.bill_status IN ('unpaid','overdue')
      AND b.due_date <= DATE_ADD(CURDATE(), INTERVAL 10 DAY)
    ORDER BY b.due_date ASC`;
  db.query(sql, (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(r);
  });
});

// ── Send reminder (screen notification only - no email) ──────
// Send reminder — on-screen only, no email needed
app.post('/api/send-reminder', (req, res) => {
  const { bill_id } = req.body;
  const sql = `
    SELECT b.bill_id, b.total_amount, b.due_date, b.bill_status,
           c.name, c.phone
    FROM Bill b JOIN Customer c ON b.customer_id=c.customer_id
    WHERE b.bill_id=?`;
  db.query(sql, [bill_id], (err, rows) => {
    if (err || !rows.length) return res.status(404).json({ error: 'Bill not found' });
    const b = rows[0];
    const isOverdue = b.bill_status === 'overdue';
    // Log trigger event to console (like a real trigger firing)
    console.log(`\n🔔 TRIGGER FIRED: ${isOverdue ? 'trg_overdue_alert' : 'trg_payment_reminder'}`);
    console.log(`   Customer: ${b.name} | Bill #${b.bill_id} | Rs.${b.total_amount} | Status: ${b.bill_status}`);
    const msg = isOverdue
      ? `⚠️ OVERDUE ALERT sent to ${b.name} — Bill #${b.bill_id} of Rs.${b.total_amount} is OVERDUE. Penalty is being applied at 1.5% per month.`
      : `🔔 REMINDER sent to ${b.name} — Bill #${b.bill_id} of Rs.${b.total_amount} is due on ${new Date(b.due_date).toLocaleDateString('en-IN')}. Please pay to avoid penalty.`;
    res.json({ success: true, message: msg, customer: b.name, bill_id: b.bill_id });
  });
});

// Customers — GET all
app.get('/api/customers', (req, res) => {
  db.query('SELECT * FROM Customer ORDER BY customer_id DESC', (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(r);
  });
});

// Customers — POST add
app.post('/api/customers', (req, res) => {
  const { name, email, phone, aadhar_number, address } = req.body;
  if (!name || !phone || !address)
    return res.status(400).json({ error: 'Name, phone and address are required.' });
  db.query('INSERT INTO Customer (name,email,phone,aadhar_number,address) VALUES (?,?,?,?,?)',
    [name, email, phone, aadhar_number || null, address], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, customer_id: result.insertId });
    });
});

// Customers — DELETE
app.delete('/api/customers/:id', (req, res) => {
  db.query('DELETE FROM Customer WHERE customer_id=?', [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ success: true });
  });
});

// Bills — GET all with optional status filter
app.get('/api/bills', (req, res) => {
  const { status } = req.query;
  let sql = `SELECT b.bill_id,b.bill_date,b.due_date,b.total_amount,b.bill_status,
    COALESCE(b.penalty_amount,0) AS penalty_amount,
    c.name AS customer_name,c.phone AS customer_phone,
    m.meter_number,mr.units_consumed
    FROM Bill b
    JOIN Customer c ON b.customer_id=c.customer_id
    JOIN Meter m ON b.meter_id=m.meter_id
    JOIN Meter_Reading mr ON b.reading_id=mr.reading_id`;
  const params = [];
  if (status) { sql += ' WHERE b.bill_status=?'; params.push(status); }
  sql += ' ORDER BY b.bill_date DESC';
  db.query(sql, params, (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(r);
  });
});

// Bills — Generate with real BESCOM slabs
app.post('/api/generate-bill', (req, res) => {
  const { customer_id, meter_id, previous_reading, current_reading } = req.body;
  if (!customer_id || !meter_id || current_reading === undefined || previous_reading === undefined)
    return res.status(400).json({ error: 'All fields are required.' });
  if (parseFloat(current_reading) < parseFloat(previous_reading))
    return res.status(400).json({ error: 'Current reading cannot be less than previous reading.' });

  const units = parseFloat((current_reading - previous_reading).toFixed(2));
  const bill  = calculateBESCOMBill(units);

  db.query('INSERT INTO Meter_Reading (meter_id,previous_reading,current_reading,reading_date) VALUES (?,?,?,CURDATE())',
    [meter_id, previous_reading, current_reading], (err, rr) => {
      if (err) return res.status(500).json({ error: err.message });
      db.query(`INSERT INTO Bill (customer_id,meter_id,reading_id,tariff_id,energy_charge,fixed_charge,
        tax_amount,total_amount,bill_date,due_date,bill_status,penalty_amount)
        VALUES (?,?,?,?,?,?,?,?,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 15 DAY),'unpaid',0)`,
        [customer_id, meter_id, rr.insertId, bill.tariffId,
         bill.energyCharge, bill.fixedCharge, bill.taxAmount, bill.totalAmount],
        (err2, br) => {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ success: true, bill_id: br.insertId, units_consumed: units, breakdown: bill });
        });
    });
});

// Meters — GET all
app.get('/api/meters', (req, res) => {
  db.query(`SELECT m.meter_id,m.meter_number,m.meter_type,c.name AS customer_name,c.customer_id
    FROM Meter m JOIN Customer c ON m.customer_id=c.customer_id ORDER BY m.meter_id DESC`,
    (err, r) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(r);
    });
});

// Meters — POST add
app.post('/api/meters', (req, res) => {
  const { customer_id, meter_number, location, meter_type } = req.body;
  if (!customer_id || !meter_number)
    return res.status(400).json({ error: 'Customer and meter number required.' });
  db.query('INSERT INTO Meter (customer_id,meter_number,location,meter_type,installation_date) VALUES (?,?,?,?,CURDATE())',
    [customer_id, meter_number, location || '', meter_type || 'single_phase'], (err, r) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, meter_id: r.insertId });
    });
});

// Payments — GET all
app.get('/api/payments', (req, res) => {
  db.query(`SELECT p.payment_id,p.bill_id,p.amount_paid,p.payment_date,
    p.payment_method,p.transaction_ref,c.name AS customer_name
    FROM Payment p JOIN Bill b ON p.bill_id=b.bill_id
    JOIN Customer c ON b.customer_id=c.customer_id ORDER BY p.payment_date DESC`,
    (err, r) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(r);
    });
});

// Payments — POST record
app.post('/api/payments', (req, res) => {
  const { bill_id, amount_paid, payment_method, transaction_ref } = req.body;
  if (!bill_id || !amount_paid || !payment_method)
    return res.status(400).json({ error: 'bill_id, amount_paid, payment_method required.' });

  db.query('SELECT total_amount,due_date FROM Bill WHERE bill_id=?', [bill_id], (err, rows) => {
    if (err || !rows.length) return res.status(404).json({ error: 'Bill not found.' });
    const penalty = calculatePenalty(rows[0].total_amount, rows[0].due_date);
    db.query('UPDATE Bill SET penalty_amount=? WHERE bill_id=?', [penalty, bill_id]);

    db.query('INSERT INTO Payment (bill_id,amount_paid,payment_date,payment_method,transaction_ref) VALUES (?,?,CURDATE(),?,?)',
      [bill_id, amount_paid, payment_method, transaction_ref || null], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        db.query(`SELECT b.total_amount+COALESCE(b.penalty_amount,0) AS grand_total,
          COALESCE(SUM(p.amount_paid),0) AS paid_so_far
          FROM Bill b LEFT JOIN Payment p ON b.bill_id=p.bill_id WHERE b.bill_id=? GROUP BY b.bill_id`,
          [bill_id], (err3, result) => {
            if (!err3 && result.length) {
              const { grand_total, paid_so_far } = result[0];
              if (parseFloat(paid_so_far) >= parseFloat(grand_total))
                db.query("UPDATE Bill SET bill_status='paid' WHERE bill_id=?", [bill_id]);
            }
            res.json({ success: true, penalty_applied: penalty });
          });
      });
  });
});

// ── Solar Net Metering ────────────────────────────────────
const FEED_IN_RATE = 3.50; // Rs.3.50/unit BESCOM Karnataka 2024

function calcSolarBill(netUnits) {
  if (netUnits <= 0) return { energy:0, fixed:0, tax:0, total:0, tariffId:1 };
  let e=0, f=35, t=5, id=1;
  if      (netUnits<=50)  { e=netUnits*4.85; f=35; t=5; id=1; }
  else if (netUnits<=100) { e=(50*4.85)+((netUnits-50)*5.88); f=50; t=5; id=2; }
  else if (netUnits<=200) { e=(50*4.85)+(50*5.88)+((netUnits-100)*7.85); f=75; t=8; id=3; }
  else                    { e=(50*4.85)+(50*5.88)+(100*7.85)+((netUnits-200)*9.13); f=100; t=10; id=4; }
  const tax=(e+f)*t/100;
  return { energy:+e.toFixed(2), fixed:f, tax:+tax.toFixed(2), total:+(e+f+tax).toFixed(2), tariffId:id };
}

// POST /api/generate-solar-bill
app.post('/api/generate-solar-bill', (req, res) => {
  const { customer_id, meter_id, grid_previous, grid_current,
          solar_previous, solar_current, prev_month_credit } = req.body;

  const gridImported  = +(grid_current - grid_previous).toFixed(2);
  const solarExported = +(Math.max(0, (solar_current||0) - (solar_previous||0))).toFixed(2);
  const creditUnits   = parseFloat(prev_month_credit || 0);
  const netUnits      = +Math.max(0, gridImported - solarExported - creditUnits).toFixed(2);
  const exportCredit  = +(solarExported * FEED_IN_RATE).toFixed(2);
  const bill          = calcSolarBill(netUnits);
  const finalAmount   = +Math.max(0, bill.total - exportCredit).toFixed(2);
  const creditCarried = +(Math.max(0, exportCredit - bill.total)).toFixed(2);

  // Insert meter reading (grid)
  db.query('INSERT INTO Meter_Reading(meter_id,previous_reading,current_reading,reading_date) VALUES(?,?,?,CURDATE())',
    [meter_id, grid_previous, grid_current], (err, rr) => {
      if (err) return res.status(500).json({ error: err.message });

      // Insert into Bill table with solar extra fields
      const sql = `INSERT INTO Bill
        (customer_id,meter_id,reading_id,tariff_id,energy_charge,fixed_charge,
         tax_amount,total_amount,bill_date,due_date,bill_status,penalty_amount)
        VALUES(?,?,?,?,?,?,?,?,CURDATE(),DATE_ADD(CURDATE(),INTERVAL 15 DAY),'unpaid',0)`;
      db.query(sql,
        [customer_id, meter_id, rr.insertId, bill.tariffId,
         bill.energy, bill.fixed, bill.tax, finalAmount], (err2, br) => {
          if (err2) return res.status(500).json({ error: err2.message });

          // Store solar-specific data in Solar_Bill table
          db.query(`INSERT INTO Solar_Bill
            (bill_id,grid_imported,solar_exported,net_units,export_credit,credit_carried)
            VALUES(?,?,?,?,?,?)`,
            [br.insertId, gridImported, solarExported, netUnits, exportCredit, creditCarried],
            (err3) => {
              if (err3) console.error('Solar_Bill insert error:', err3.message);
            });

          res.json({
            success: true, bill_id: br.insertId,
            grid_imported: gridImported, solar_exported: solarExported,
            net_units: netUnits, export_credit: exportCredit,
            final_amount: finalAmount, credit_carried: creditCarried
          });
        });
    });
});

// GET /api/solar-bills
app.get('/api/solar-bills', (req, res) => {
  const sql = `
    SELECT b.bill_id, b.bill_date, b.due_date, b.total_amount, b.bill_status,
           c.name AS customer_name, m.meter_number,
           COALESCE(sb.grid_imported,0)   AS grid_imported,
           COALESCE(sb.solar_exported,0)  AS solar_exported,
           COALESCE(sb.net_units,0)       AS net_units,
           COALESCE(sb.export_credit,0)   AS export_credit,
           COALESCE(sb.credit_carried,0)  AS credit_carried
    FROM Bill b
    JOIN Customer c ON b.customer_id=c.customer_id
    JOIN Meter m ON b.meter_id=m.meter_id
    INNER JOIN Solar_Bill sb ON b.bill_id=sb.bill_id
    ORDER BY b.bill_date DESC`;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});
// GET /api/trigger-bills — returns all bills with customer info for trigger notifications
app.get('/api/trigger-bills', (req, res) => {
  const { customer_id, status } = req.query;
  let sql = `
    SELECT b.bill_id, b.bill_date, b.due_date, b.total_amount,
           b.bill_status, COALESCE(b.penalty_amount,0) AS penalty_amount,
           c.name AS customer_name, c.email, c.phone,
           m.meter_number, mr.units_consumed,
           DATEDIFF(b.due_date, CURDATE()) AS days_until_due
    FROM Bill b
    JOIN Customer c ON b.customer_id = c.customer_id
    JOIN Meter m ON b.meter_id = m.meter_id
    JOIN Meter_Reading mr ON b.reading_id = mr.reading_id
    WHERE 1=1
  `;
  const params = [];
  if (customer_id) { sql += ' AND b.customer_id = ?'; params.push(customer_id); }
  if (status)      { sql += ' AND b.bill_status = ?'; params.push(status); }
  sql += ' ORDER BY b.bill_date DESC';

  // Also auto-mark overdue before returning
  db.query("UPDATE Bill SET bill_status='overdue' WHERE bill_status='unpaid' AND due_date < CURDATE()", () => {
    db.query(sql, params, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
  });
});

// Mark overdue every hour automatically
setInterval(() => {
  db.query("UPDATE Bill SET bill_status='overdue' WHERE bill_status='unpaid' AND due_date < CURDATE()", () => {});
}, 1000 * 60 * 60);

// ── Consumption chart data ────────────────────────────────────
app.get('/api/consumption-chart', (req, res) => {
  const sql = `
    SELECT DATE_FORMAT(mr.reading_date, '%b %Y') AS month,
           SUM(mr.units_consumed) AS total_units
    FROM Meter_Reading mr
    GROUP BY DATE_FORMAT(mr.reading_date, '%Y-%m')
    ORDER BY MIN(mr.reading_date) DESC
    LIMIT 6
  `;
  db.query(sql, (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(r.reverse());
  });
});

// ── Bill detail (for PDF) ─────────────────────────────────────
app.get('/api/bill-detail/:id', (req, res) => {
  const sql = `
    SELECT b.*, c.name AS customer_name, c.phone AS customer_phone,
           c.address, m.meter_number, mr.units_consumed,
           COALESCE(b.penalty_amount,0) AS penalty_amount
    FROM Bill b
    JOIN Customer c ON b.customer_id=c.customer_id
    JOIN Meter m ON b.meter_id=m.meter_id
    JOIN Meter_Reading mr ON b.reading_id=mr.reading_id
    WHERE b.bill_id=?
  `;
  db.query(sql, [req.params.id], (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!r.length) return res.status(404).json({ error: 'Bill not found' });
    res.json(r[0]);
  });
});

// ── Customer bill history ─────────────────────────────────────
app.get('/api/customer-bills/:id', (req, res) => {
  const sql = `
    SELECT b.bill_id, b.bill_date, b.total_amount, b.bill_status, mr.units_consumed
    FROM Bill b
    JOIN Meter_Reading mr ON b.reading_id=mr.reading_id
    WHERE b.customer_id=?
    ORDER BY b.bill_date DESC
  `;
  db.query(sql, [req.params.id], (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(r);
  });
});

// ── Complaints ────────────────────────────────────────────────
app.get('/api/complaints', (req, res) => {
  const sql = `
    SELECT comp.*, c.name AS customer_name
    FROM Complaint comp
    JOIN Customer c ON comp.customer_id=c.customer_id
    ORDER BY comp.raised_on DESC
  `;
  db.query(sql, (err, r) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(r);
  });
});

app.post('/api/complaints', (req, res) => {
  const { customer_id, bill_id, description } = req.body;
  if (!customer_id || !description)
    return res.status(400).json({ error: 'Customer and description required.' });

  // If bill_id provided, check it exists first
  const safeBillId = bill_id && bill_id !== '' ? parseInt(bill_id) : null;

  const doInsert = () => {
    db.query(
      'INSERT INTO Complaint (customer_id, bill_id, description, raised_on) VALUES (?,?,?,CURDATE())',
      [customer_id, safeBillId, description],
      (err, r) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, complaint_id: r.insertId });
      }
    );
  };

  if (safeBillId) {
    // Verify bill exists before linking
    db.query('SELECT bill_id FROM Bill WHERE bill_id=?', [safeBillId], (err, rows) => {
      if (err || !rows.length) {
        // Bill doesn't exist — insert complaint without bill link
        db.query(
          'INSERT INTO Complaint (customer_id, bill_id, description, raised_on) VALUES (?,?,?,CURDATE())',
          [customer_id, null, description],
          (err2, r) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ success: true, complaint_id: r.insertId, note: 'Bill ID not found, complaint saved without bill reference.' });
          }
        );
      } else {
        doInsert();
      }
    });
  } else {
    doInsert();
  }
});

app.put('/api/complaints/:id/resolve', (req, res) => {
  db.query(
    "UPDATE Complaint SET complaint_status='resolved', resolved_on=CURDATE() WHERE complaint_id=?",
    [req.params.id],
    (err, r) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`   Open this URL in your browser to see your project!`);
});