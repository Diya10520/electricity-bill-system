/* ============================================================
   reminder.js — Smart Bill Reminder Popup System
   Save in: electricity-bill-system/public/reminder.js
   Include with <script src="reminder.js"></script> in dashboard.html
   ============================================================ */

(function() {

  // Inject popup styles
  const style = document.createElement('style');
  style.textContent = `
    #reminder-popup-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 9998;
      display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none;
      transition: opacity 0.3s;
    }
    #reminder-popup-overlay.show {
      opacity: 1; pointer-events: all;
    }
    #reminder-popup {
      background: #fff;
      border-radius: 20px;
      width: 90%; max-width: 480px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      overflow: hidden;
      transform: translateY(30px);
      transition: transform 0.3s;
      font-family: 'Calibri', sans-serif;
    }
    body.dark #reminder-popup { background: #1e293b; color: #e2e8f0; }
    #reminder-popup-overlay.show #reminder-popup { transform: translateY(0); }

    .rp-header {
      padding: 24px 28px 20px;
      border-bottom: 1px solid #e2e8f0;
      display: flex; align-items: center; gap: 14px;
    }
    body.dark .rp-header { border-color: #334155; }

    .rp-icon {
      width: 48px; height: 48px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; flex-shrink: 0;
    }
    .rp-icon.overdue  { background: #fed7d7; }
    .rp-icon.due-soon { background: #feebc8; }
    .rp-icon.upcoming { background: #bee3f8; }

    .rp-header-text h3 { font-size: 19px; font-weight: 700; margin: 0 0 2px; }
    .rp-header-text p  { font-size: 14px; color: #718096; margin: 0; }
    body.dark .rp-header-text p { color: #94a3b8; }

    .rp-body { padding: 20px 28px; }

    .rp-bill-card {
      background: #f7fafc;
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      border-left: 4px solid #e2e8f0;
    }
    body.dark .rp-bill-card { background: #0f172a; }
    .rp-bill-card.overdue  { border-left-color: #e53e3e; }
    .rp-bill-card.due-soon { border-left-color: #dd6b20; }
    .rp-bill-card.upcoming { border-left-color: #3182ce; }

    .rp-bill-card .rp-customer {
      font-size: 17px; font-weight: 700; margin-bottom: 6px;
    }
    .rp-bill-card .rp-details {
      display: grid; grid-template-columns: 1fr 1fr;
      gap: 4px; font-size: 14px; color: #4a5568;
    }
    body.dark .rp-bill-card .rp-details { color: #94a3b8; }
    .rp-bill-card .rp-amount {
      font-size: 22px; font-weight: 800;
      color: #1a365d; margin-top: 8px;
    }
    body.dark .rp-bill-card .rp-amount { color: #93c5fd; }

    .rp-warning {
      background: #fff5f5; border: 1px solid #fed7d7;
      border-radius: 10px; padding: 12px 16px;
      font-size: 14px; color: #742a2a; margin-bottom: 16px;
      line-height: 1.6;
    }
    body.dark .rp-warning { background: #2d0a0a; border-color: #742a2a; color: #fc8181; }

    .rp-countdown {
      text-align: center; margin-bottom: 16px;
    }
    .rp-countdown .rp-days {
      font-size: 42px; font-weight: 800;
      line-height: 1;
    }
    .rp-countdown .rp-days.red    { color: #e53e3e; }
    .rp-countdown .rp-days.orange { color: #dd6b20; }
    .rp-countdown .rp-days.blue   { color: #3182ce; }
    .rp-countdown .rp-days-label  { font-size: 14px; color: #718096; margin-top: 2px; }

    .rp-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .rp-nav span { font-size: 13px; color: #718096; }

    .rp-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .rp-btn {
      flex: 1; padding: 13px 16px; border-radius: 10px;
      font-size: 16px; font-weight: 700; border: none;
      cursor: pointer; font-family: 'Calibri', sans-serif;
      transition: opacity 0.2s, transform 0.1s;
    }
    .rp-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .rp-btn.pay   { background: #1a365d; color: white; }
    .rp-btn.later { background: #f7fafc; color: #4a5568; border: 1px solid #e2e8f0; }
    body.dark .rp-btn.later { background: #334155; color: #e2e8f0; border-color: #475569; }
    .rp-btn.snooze { background: #feebc8; color: #7b341e; font-size: 14px; flex: 0 0 auto; }

    .rp-footer {
      padding: 12px 28px 20px;
      font-size: 12px; color: #a0aec0; text-align: center;
    }

    .rp-dots {
      display: flex; gap: 6px; justify-content: center; margin-bottom: 14px;
    }
    .rp-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #e2e8f0; transition: background 0.2s;
    }
    .rp-dot.active { background: #1a365d; }
    body.dark .rp-dot { background: #334155; }
    body.dark .rp-dot.active { background: #93c5fd; }
  `;
  document.head.appendChild(style);

  // Create popup HTML
  const overlay = document.createElement('div');
  overlay.id = 'reminder-popup-overlay';
  overlay.innerHTML = `
    <div id="reminder-popup">
      <div class="rp-header">
        <div class="rp-icon" id="rp-icon">🔔</div>
        <div class="rp-header-text">
          <h3 id="rp-title">Payment Reminder</h3>
          <p id="rp-subtitle">You have pending bills</p>
        </div>
      </div>
      <div class="rp-body">
        <div class="rp-dots" id="rp-dots"></div>
        <div class="rp-countdown">
          <div class="rp-days" id="rp-days">0</div>
          <div class="rp-days-label" id="rp-days-label">days remaining</div>
        </div>
        <div class="rp-bill-card" id="rp-bill-card">
          <div class="rp-customer" id="rp-customer"></div>
          <div class="rp-details" id="rp-details"></div>
          <div class="rp-amount" id="rp-amount"></div>
        </div>
        <div class="rp-warning" id="rp-warning"></div>
        <div class="rp-nav">
          <button onclick="reminderPrev()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#718096;">&#8592;</button>
          <span id="rp-nav-label">1 of 1</span>
          <button onclick="reminderNext()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#718096;">&#8594;</button>
        </div>
        <div class="rp-actions">
          <button class="rp-btn pay"   id="rp-pay-btn"   onclick="reminderPayNow()">Pay Now</button>
          <button class="rp-btn later" onclick="reminderLater()">Remind Me Tomorrow</button>
          <button class="rp-btn snooze" onclick="reminderClose()">Not Now</button>
        </div>
      </div>
      <div class="rp-footer" id="rp-footer"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  let reminders = [];
  let currentIndex = 0;

  function renderReminder(r) {
    const days = r.days_until_due;
    const isOverdue  = days < 0;
    const isDueSoon  = days >= 0 && days <= 3;
    const isUpcoming = days > 3;

    // Icon + header
    const iconEl = document.getElementById('rp-icon');
    const titleEl = document.getElementById('rp-title');
    const subEl   = document.getElementById('rp-subtitle');
    const cardEl  = document.getElementById('rp-bill-card');
    const daysEl  = document.getElementById('rp-days');
    const daysLbl = document.getElementById('rp-days-label');
    const warnEl  = document.getElementById('rp-warning');
    const payBtn  = document.getElementById('rp-pay-btn');

    iconEl.className = 'rp-icon ' + (isOverdue ? 'overdue' : isDueSoon ? 'due-soon' : 'upcoming');
    cardEl.className = 'rp-bill-card ' + (isOverdue ? 'overdue' : isDueSoon ? 'due-soon' : 'upcoming');

    if (isOverdue) {
      iconEl.textContent = '⛔';
      titleEl.textContent = 'Bill Overdue!';
      subEl.textContent   = 'Immediate payment required';
      daysEl.textContent  = Math.abs(days);
      daysEl.className    = 'rp-days red';
      daysLbl.textContent = `days overdue — penalty charges applying`;
      warnEl.innerHTML = `⚠️ <strong>Your bill is overdue.</strong> A penalty of 1.5% per month is being added to your total. If unpaid, your next bill will include this bill's amount + penalty + new units consumed. Continued non-payment may lead to <strong>disconnection of your electricity supply.</strong>`;
      payBtn.textContent = '⚡ Pay Now to Stop Penalty';
    } else if (isDueSoon) {
      iconEl.textContent = '⚠️';
      titleEl.textContent = days === 0 ? 'Due TODAY!' : `Due in ${days} Day${days===1?'':'s'}!`;
      subEl.textContent   = 'Pay before the due date to avoid penalty';
      daysEl.textContent  = days === 0 ? 'TODAY' : days;
      daysEl.className    = 'rp-days orange';
      daysLbl.textContent = days === 0 ? 'Last day to pay without penalty' : `day${days===1?'':'s'} left before due date`;
      warnEl.innerHTML = `📋 <strong>Pay before the due date.</strong> If you miss it, a late fee of 1.5% will be added monthly. Your next bill will include unpaid amount + penalty + next month's units consumed together — making it much larger!`;
      payBtn.textContent = '💳 Pay Now';
    } else {
      iconEl.textContent = '🔔';
      titleEl.textContent = 'Upcoming Bill Due';
      subEl.textContent   = 'Plan your payment in advance';
      daysEl.textContent  = days;
      daysEl.className    = 'rp-days blue';
      daysLbl.textContent = 'days until due date';
      warnEl.innerHTML = `💡 <strong>Early payment tip:</strong> Pay before the due date to avoid any late charges. If unpaid, penalty will be added and next month's bill will carry the outstanding amount forward.`;
      payBtn.textContent = '💳 Pay Early';
    }

    // Bill card
    document.getElementById('rp-customer').textContent = r.customer_name;
    document.getElementById('rp-details').innerHTML = `
      <span>Bill #${r.bill_id}</span>
      <span>Due: ${new Date(r.due_date).toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'})}</span>
      <span>Status: ${r.bill_status}</span>
      <span>${r.penalty_amount > 0 ? 'Penalty: ₹' + r.penalty_amount : 'No penalty yet'}</span>
    `;
    document.getElementById('rp-amount').textContent = '₹' + Number(r.total_amount).toLocaleString('en-IN');

    // Nav dots
    const dotsEl = document.getElementById('rp-dots');
    dotsEl.innerHTML = reminders.map((_, i) =>
      `<div class="rp-dot ${i === currentIndex ? 'active' : ''}"></div>`
    ).join('');

    document.getElementById('rp-nav-label').textContent = `${currentIndex + 1} of ${reminders.length}`;
    document.getElementById('rp-footer').textContent =
      `Ecozep Billing System • Bill generated ${new Date(r.due_date - 15*24*60*60*1000).toLocaleDateString('en-IN')}`;

    // Store bill ID for pay now
    overlay.dataset.currentBillId     = r.bill_id;
    overlay.dataset.currentBillAmount = r.total_amount;
  }

  window.reminderNext = function() {
    if (currentIndex < reminders.length - 1) {
      currentIndex++;
      renderReminder(reminders[currentIndex]);
    }
  };

  window.reminderPrev = function() {
    if (currentIndex > 0) {
      currentIndex--;
      renderReminder(reminders[currentIndex]);
    }
  };

  window.reminderPayNow = function() {
    const id     = overlay.dataset.currentBillId;
    const amount = overlay.dataset.currentBillAmount;
    reminderClose();
    window.location.href = `payments.html?bill_id=${id}&amount=${amount}`;
  };

  window.reminderLater = function() {
    // Snooze for 24 hours
    const snoozeUntil = Date.now() + 24 * 60 * 60 * 1000;
    localStorage.setItem('reminderSnooze', snoozeUntil);
    reminderClose();
  };

  window.reminderClose = function() {
    overlay.classList.remove('show');
  };

  // Show popup
  function showReminder(bills) {
    reminders    = bills;
    currentIndex = 0;
    renderReminder(bills[0]);
    overlay.classList.add('show');
  }

  // Check snooze + load reminders on page load
  window.addEventListener('DOMContentLoaded', () => {
    const snooze = localStorage.getItem('reminderSnooze');
    if (snooze && Date.now() < parseInt(snooze)) return; // snoozed

    fetch('/api/reminders')
      .then(r => r.json())
      .then(bills => {
        if (bills && bills.length > 0) {
          // Show after 1.5s so page loads first
          setTimeout(() => showReminder(bills), 1500);
        }
      })
      .catch(() => {});
  });

})();