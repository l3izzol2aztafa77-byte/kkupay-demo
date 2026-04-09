require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'kkupay_demo_secret';
const MOCK_PAYMENT = process.env.MOCK_PAYMENT !== 'false';

// ─── Omise Setup ──────────────────────────────────────────────────────────────
let omise = null;
if (!MOCK_PAYMENT && process.env.OMISE_SECRET_KEY) {
  try {
    omise = require('omise')({ secretKey: process.env.OMISE_SECRET_KEY });
  } catch { console.log('Omise not loaded, using mock'); }
}

// ─── In-Memory Database ───────────────────────────────────────────────────────
const DB = {
  users: [],
  wallets: [],
  payments: [],
  walletTxns: [],
  feeItems: [],
};

function dbFind(table, pred) { return DB[table].find(pred) || null; }
function dbFilter(table, pred) { return DB[table].filter(pred); }
function dbInsert(table, doc) { DB[table].push(doc); return doc; }
function dbUpdate(table, pred, updates) {
  const i = DB[table].findIndex(pred);
  if (i !== -1) { Object.assign(DB[table][i], updates, { updated_at: new Date().toISOString() }); return DB[table][i]; }
  return null;
}

// ─── Seed Data ────────────────────────────────────────────────────────────────
(function seedData() {
  const now = () => new Date().toISOString();
  const students = [
    { id: uuidv4(), student_id: 'STD001', name: 'นายสมชาย ใจดี', email: 'somchai@kku.ac.th', password: bcrypt.hashSync('demo1234', 8), role: 'student', faculty: 'วิทยาศาสตร์', year: 2 },
    { id: uuidv4(), student_id: 'STD002', name: 'น.ส.วรรณิษา แก้วมณี', email: 'wannisa@kku.ac.th', password: bcrypt.hashSync('demo1234', 8), role: 'student', faculty: 'วิศวกรรมศาสตร์', year: 3 },
    { id: uuidv4(), student_id: 'STD003', name: 'นายพิชัย รุ่งเรือง', email: 'pichai@kku.ac.th', password: bcrypt.hashSync('demo1234', 8), role: 'student', faculty: 'แพทยศาสตร์', year: 1 },
  ];
  const admin = { id: uuidv4(), student_id: null, name: 'Admin KKU', email: 'admin@kkupay.co.th', password: bcrypt.hashSync('admin1234', 8), role: 'admin', faculty: null, year: null, created_at: now() };
  DB.users.push(...students, admin);

  // Wallets
  students.forEach(s => dbInsert('wallets', {
    id: uuidv4(), user_id: s.id, balance: Math.floor(Math.random() * 3000) + 500,
    daily_limit: 2000, weekly_limit: 10000, created_at: now()
  }));

  // Fee items
  const fees = [
    { type: 'tuition', description: 'ค่าเทอม 1/2568', amount: 14500, due_date: '2025-06-30', status: 'unpaid' },
    { type: 'dormitory', description: 'ค่าหอพัก เดือนมิถุนายน 2568', amount: 3200, due_date: '2025-06-05', status: 'unpaid' },
    { type: 'health', description: 'ค่าประกันสุขภาพ 2568', amount: 1800, due_date: '2025-07-31', status: 'unpaid' },
    { type: 'activity', description: 'ค่ากิจกรรมนักศึกษา', amount: 500, due_date: '2025-06-15', status: 'paid' },
    { type: 'fine', description: 'ค่าปรับหนังสือห้องสมุด', amount: 120, due_date: '2025-05-30', status: 'unpaid' },
  ];
  students.forEach(s => fees.forEach(f => dbInsert('feeItems', { id: uuidv4(), user_id: s.id, ...f, paid_at: f.status === 'paid' ? now() : null })));

  // Historical payments
  const methods = ['promptpay', 'card', 'wallet'];
  const ptypes = ['tuition', 'dormitory', 'canteen', 'activity'];
  const descs = ['ค่าเทอม 2/2567', 'ค่าหอพัก เม.ย.', 'ร้านอาหาร MBK Canteen', 'ค่าสมัครกีฬา'];
  const amts = [14500, 3200, 85, 500];
  for (let i = 0; i < 35; i++) {
    const s = students[i % students.length];
    const idx = i % 4;
    const dAgo = Math.floor(Math.random() * 60);
    const d = new Date(); d.setDate(d.getDate() - dAgo);
    const receiptId = `RCP${1000000 + i}`;
    dbInsert('payments', {
      id: uuidv4(), order_ref: `KKU${Date.now()}${i}`, user_id: s.id,
      amount: amts[idx], currency: 'THB', payment_type: ptypes[idx],
      payment_method: methods[i % 3], status: 'success',
      description: descs[idx], receipt_id: receiptId,
      omise_charge_id: null, qr_data: null, metadata: null,
      created_at: d.toISOString(), updated_at: d.toISOString()
    });
  }
})();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = dbFind('users', u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  const wallet = dbFind('wallets', w => w.user_id === user.id);
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, student_id: user.student_id, faculty: user.faculty, year: user.year }, wallet });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = dbFind('users', u => u.id === req.user.id);
  const wallet = dbFind('wallets', w => w.user_id === user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, student_id: user.student_id, faculty: user.faculty, year: user.year }, wallet });
});

// ─── FEES ─────────────────────────────────────────────────────────────────────
app.get('/api/fees', authenticate, (req, res) => {
  const fees = dbFilter('feeItems', f => f.user_id === req.user.id)
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  res.json(fees);
});

// ─── PAYMENTS ─────────────────────────────────────────────────────────────────
app.post('/api/payments/promptpay', authenticate, async (req, res) => {
  const { amount, description, fee_item_id } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const orderId = `KKU${Date.now()}`;
  const paymentId = uuidv4();
  try {
    let qrData, chargeId;
    if (!MOCK_PAYMENT && omise) {
      const source = await omise.sources.create({ type: 'promptpay', amount: Math.round(amount * 100), currency: 'THB' });
      const charge = await omise.charges.create({ amount: Math.round(amount * 100), currency: 'THB', source: source.id });
      qrData = charge.source?.scannable_code?.image?.download_uri;
      chargeId = charge.id;
    } else {
      qrData = `KKUPAY|${orderId}|${amount}|THB|PromptPay`;
      chargeId = `mock_${paymentId}`;
    }
    const qrImage = await QRCode.toDataURL(qrData, { width: 300, margin: 2, color: { dark: '#4f2d7f', light: '#ffffff' } });
    dbInsert('payments', { id: paymentId, order_ref: orderId, user_id: req.user.id, amount, currency: 'THB', payment_type: 'general', payment_method: 'promptpay', status: 'pending', description: description || 'ชำระเงิน', omise_charge_id: chargeId, qr_data: qrData, receipt_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (fee_item_id) dbUpdate('feeItems', f => f.id === fee_item_id, { status: 'processing' });
    res.json({ payment_id: paymentId, order_ref: orderId, qr_image: qrImage, qr_data: qrData, amount, status: 'pending', expires_in: 900 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payments/:id/confirm', authenticate, (req, res) => {
  const payment = dbFind('payments', p => p.id === req.params.id && p.user_id === req.user.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.status === 'success') return res.json({ message: 'Already paid', payment });
  const receiptId = `RCP${Date.now()}`;
  dbUpdate('payments', p => p.id === payment.id, { status: 'success', receipt_id: receiptId });
  dbFilter('feeItems', f => f.user_id === req.user.id && f.status === 'processing').forEach(f => dbUpdate('feeItems', x => x.id === f.id, { status: 'paid', paid_at: new Date().toISOString() }));
  const updated = dbFind('payments', p => p.id === payment.id);
  res.json({ message: 'Payment confirmed', payment: updated, receipt_id: receiptId });
});

app.post('/api/payments/card', authenticate, async (req, res) => {
  const { token, amount, description, fee_item_id } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const orderId = `KKU${Date.now()}`;
  const paymentId = uuidv4();
  try {
    let chargeId, status = 'success';
    if (!MOCK_PAYMENT && omise && token) {
      const charge = await omise.charges.create({ amount: Math.round(amount * 100), currency: 'THB', card: token, description: description || 'KKU Pay' });
      chargeId = charge.id;
      status = charge.status === 'successful' ? 'success' : 'failed';
    } else { chargeId = `mock_card_${paymentId}`; }
    const receiptId = status === 'success' ? `RCP${Date.now()}` : null;
    dbInsert('payments', { id: paymentId, order_ref: orderId, user_id: req.user.id, amount, currency: 'THB', payment_type: 'general', payment_method: 'card', status, description: description || 'ชำระด้วยบัตร', omise_charge_id: chargeId, receipt_id: receiptId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    if (status === 'success' && fee_item_id) dbUpdate('feeItems', f => f.id === fee_item_id, { status: 'paid', paid_at: new Date().toISOString() });
    res.json({ payment_id: paymentId, order_ref: orderId, status, receipt_id: receiptId, amount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/payments/wallet', authenticate, (req, res) => {
  const { amount, description, fee_item_id } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const wallet = dbFind('wallets', w => w.user_id === req.user.id);
  if (!wallet || wallet.balance < amount) return res.status(400).json({ error: 'ยอดเงินใน Wallet ไม่เพียงพอ' });
  const newBalance = wallet.balance - amount;
  dbUpdate('wallets', w => w.user_id === req.user.id, { balance: newBalance });
  const paymentId = uuidv4();
  const receiptId = `RCP${Date.now()}`;
  const orderId = `KKU${Date.now()}`;
  dbInsert('payments', { id: paymentId, order_ref: orderId, user_id: req.user.id, amount, currency: 'THB', payment_type: 'general', payment_method: 'wallet', status: 'success', description: description || 'ชำระจาก Wallet', receipt_id: receiptId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  dbInsert('walletTxns', { id: uuidv4(), wallet_id: wallet.id, type: 'debit', amount, balance_after: newBalance, description: description || 'ชำระเงิน', ref_payment_id: paymentId, created_at: new Date().toISOString() });
  if (fee_item_id) dbUpdate('feeItems', f => f.id === fee_item_id, { status: 'paid', paid_at: new Date().toISOString() });
  res.json({ payment_id: paymentId, status: 'success', receipt_id: receiptId, new_balance: newBalance });
});

app.get('/api/payments/:id', authenticate, (req, res) => {
  const p = dbFind('payments', p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

app.get('/api/payments', authenticate, (req, res) => {
  const { limit = 20, offset = 0 } = req.query;
  let payments;
  if (req.user.role === 'admin') {
    payments = DB.payments.map(p => {
      const u = dbFind('users', u => u.id === p.user_id);
      return { ...p, user_name: u?.name, student_id: u?.student_id };
    });
  } else {
    payments = dbFilter('payments', p => p.user_id === req.user.id);
  }
  payments = payments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(parseInt(offset), parseInt(offset) + parseInt(limit));
  res.json(payments);
});

// ─── WALLET ───────────────────────────────────────────────────────────────────
app.get('/api/wallet', authenticate, (req, res) => {
  const wallet = dbFind('wallets', w => w.user_id === req.user.id);
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
  const txns = dbFilter('walletTxns', t => t.wallet_id === wallet.id).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 30);
  res.json({ wallet, transactions: txns });
});

app.post('/api/wallet/topup', authenticate, async (req, res) => {
  const { amount, method } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const wallet = dbFind('wallets', w => w.user_id === req.user.id);
  const orderId = `TOPUP${Date.now()}`;
  const paymentId = uuidv4();

  if (method === 'promptpay') {
    const qrData = `KKUPAY_TOPUP|${orderId}|${amount}`;
    const qrImage = await QRCode.toDataURL(qrData, { width: 280, color: { dark: '#4f2d7f', light: '#ffffff' } });
    dbInsert('payments', { id: paymentId, order_ref: orderId, user_id: req.user.id, amount, currency: 'THB', payment_type: 'topup', payment_method: 'promptpay', status: 'pending', description: `เติมเงิน Wallet ฿${amount}`, receipt_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return res.json({ payment_id: paymentId, qr_image: qrImage, amount, method: 'promptpay' });
  }

  const newBalance = wallet.balance + amount;
  dbUpdate('wallets', w => w.user_id === req.user.id, { balance: newBalance });
  dbInsert('payments', { id: paymentId, order_ref: orderId, user_id: req.user.id, amount, currency: 'THB', payment_type: 'topup', payment_method: method || 'card', status: 'success', description: `เติมเงิน Wallet ฿${amount}`, receipt_id: `RCP${Date.now()}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  dbInsert('walletTxns', { id: uuidv4(), wallet_id: wallet.id, type: 'credit', amount, balance_after: newBalance, description: `เติมเงิน (${method})`, created_at: new Date().toISOString() });
  res.json({ message: 'Top-up successful', new_balance: newBalance });
});

app.post('/api/wallet/topup/:payment_id/confirm', authenticate, (req, res) => {
  const payment = dbFind('payments', p => p.id === req.params.payment_id && p.payment_type === 'topup' && p.status === 'pending');
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  const wallet = dbFind('wallets', w => w.user_id === req.user.id);
  const newBalance = wallet.balance + payment.amount;
  dbUpdate('wallets', w => w.user_id === req.user.id, { balance: newBalance });
  dbUpdate('payments', p => p.id === payment.id, { status: 'success' });
  dbInsert('walletTxns', { id: uuidv4(), wallet_id: wallet.id, type: 'credit', amount: payment.amount, balance_after: newBalance, description: 'เติมเงิน (PromptPay)', created_at: new Date().toISOString() });
  res.json({ message: 'Top-up confirmed', new_balance: newBalance });
});

// ─── RECEIPTS ─────────────────────────────────────────────────────────────────
app.get('/api/receipts/:receipt_id', authenticate, (req, res) => {
  const payment = dbFind('payments', p => p.receipt_id === req.params.receipt_id);
  if (!payment) return res.status(404).json({ error: 'Receipt not found' });
  const user = dbFind('users', u => u.id === payment.user_id);
  res.json({ ...payment, name: user?.name, student_id: user?.student_id, email: user?.email, faculty: user?.faculty });
});

app.get('/api/receipts/:receipt_id/pdf', authenticate, (req, res) => {
  const payment = dbFind('payments', p => p.receipt_id === req.params.receipt_id);
  if (!payment) return res.status(404).json({ error: 'Receipt not found' });
  const user = dbFind('users', u => u.id === payment.user_id);

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="receipt_${payment.receipt_id}.pdf"`);
  doc.pipe(res);

  // Header bar
  doc.rect(0, 0, 595, 80).fill('#4f2d7f');
  doc.fontSize(24).font('Helvetica-Bold').fillColor('white').text('KKU PAY', 60, 22);
  doc.fontSize(11).font('Helvetica').fillColor('rgba(255,255,255,0.8)').text('ระบบชำระเงินดิจิทัล — มหาวิทยาลัยขอนแก่น', 60, 50);
  doc.fillColor('#1a1a2e');
  doc.moveDown(3);

  // Receipt title
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#4f2d7f').text('ใบเสร็จรับเงิน / e-Receipt', { align: 'center' });
  doc.moveDown(0.8);

  const row = (label, value, bold = false) => {
    const y = doc.y;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#6b7280').text(label, 70, y);
    doc.fontSize(10).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#1a1a2e').text(String(value || '—'), 250, y, { width: 280 });
    doc.moveDown(0.7);
  };

  // Info section
  doc.rect(60, doc.y, 475, 1).fillColor('#e5e7eb').fill(); doc.moveDown(0.5);
  doc.fillColor('#1a1a2e');
  row('เลขที่ใบเสร็จ:', payment.receipt_id, true);
  row('วันที่ออกใบเสร็จ:', new Date(payment.created_at).toLocaleString('th-TH'));
  row('เลขที่อ้างอิง:', payment.order_ref);
  doc.rect(60, doc.y, 475, 1).fillColor('#e5e7eb').fill(); doc.moveDown(0.5);
  doc.fillColor('#1a1a2e');
  row('ชื่อผู้ชำระเงิน:', user?.name);
  row('รหัสนักศึกษา:', user?.student_id);
  row('คณะ:', user?.faculty);
  row('อีเมล:', user?.email);
  doc.rect(60, doc.y, 475, 1).fillColor('#e5e7eb').fill(); doc.moveDown(0.5);
  doc.fillColor('#1a1a2e');
  row('รายการ:', payment.description);
  row('ช่องทางชำระเงิน:', { promptpay: 'PromptPay / QR Code', card: 'บัตรเครดิต/เดบิต', wallet: 'KKU Wallet', banking: 'Internet Banking' }[payment.payment_method] || payment.payment_method);
  row('สถานะ:', 'ชำระเรียบร้อยแล้ว ✓');

  // Amount box
  doc.moveDown(0.5);
  doc.rect(60, doc.y, 475, 54).fillColor('#f3f0ff').fill();
  const boxY = doc.y + 10;
  doc.fontSize(13).font('Helvetica').fillColor('#4f2d7f').text('จำนวนเงินที่ชำระ:', 75, boxY);
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#4f2d7f').text(`฿ ${Number(payment.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}  (THB)`, 240, boxY - 4);
  doc.moveDown(3.5);

  // Footer
  doc.rect(0, 720, 595, 120).fillColor('#f4f6fb').fill();
  doc.rect(0, 720, 595, 2).fillColor('#4f2d7f').fill();
  doc.fontSize(9).font('Helvetica').fillColor('#6b7280');
  doc.text('ใบเสร็จนี้ออกโดยระบบอิเล็กทรอนิกส์ — มีผลเทียบเท่าใบเสร็จรับเงินต้นฉบับ', 60, 730, { align: 'center', width: 475 });
  doc.text('KKU Pay | support@kkupay.co.th | มหาวิทยาลัยขอนแก่น จ.ขอนแก่น 40002', 60, 745, { align: 'center', width: 475 });
  doc.text(`Document ID: ${payment.receipt_id} | Generated: ${new Date().toISOString()}`, 60, 760, { align: 'center', width: 475 });

  doc.end();
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', authenticate, requireAdmin, (req, res) => {
  const successTxns = dbFilter('payments', p => p.status === 'success');
  const today = new Date().toISOString().slice(0, 10);
  const todayTxns = successTxns.filter(p => p.created_at.slice(0, 10) === today);
  const total = { count: successTxns.length, total: successTxns.reduce((s, p) => s + p.amount, 0) };
  const todayStats = { count: todayTxns.length, total: todayTxns.reduce((s, p) => s + p.amount, 0) };
  const pending = dbFilter('payments', p => p.status === 'pending');
  const failed = dbFilter('payments', p => p.status === 'failed');
  const students = dbFilter('users', u => u.role === 'student');

  // By method
  const methodMap = {};
  successTxns.forEach(p => { if (!methodMap[p.payment_method]) methodMap[p.payment_method] = { count: 0, total: 0 }; methodMap[p.payment_method].count++; methodMap[p.payment_method].total += p.amount; });
  const byMethod = Object.entries(methodMap).map(([k, v]) => ({ payment_method: k, ...v }));

  // By type
  const typeMap = {};
  successTxns.forEach(p => { if (!typeMap[p.payment_type]) typeMap[p.payment_type] = { count: 0, total: 0 }; typeMap[p.payment_type].count++; typeMap[p.payment_type].total += p.amount; });
  const byType = Object.entries(typeMap).map(([k, v]) => ({ payment_type: k, ...v }));

  // Daily last 7 days
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayTxns = successTxns.filter(p => p.created_at.slice(0, 10) === dateStr);
    daily.push({ date: dateStr, total: dayTxns.reduce((s, p) => s + p.amount, 0), count: dayTxns.length });
  }

  // Recent
  const recent = DB.payments.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10).map(p => {
    const u = dbFind('users', u => u.id === p.user_id);
    return { ...p, user_name: u?.name, student_id: u?.student_id };
  });

  res.json({ total, today: todayStats, byMethod, byType, userCount: { count: students.length }, pendingCount: { count: pending.length }, failedCount: { count: failed.length }, daily, recent });
});

app.get('/api/admin/users', authenticate, requireAdmin, (req, res) => {
  const users = dbFilter('users', u => u.role === 'student').map(u => {
    const w = dbFind('wallets', w => w.user_id === u.id);
    return { id: u.id, name: u.name, email: u.email, student_id: u.student_id, faculty: u.faculty, year: u.year, balance: w?.balance || 0 };
  }).sort((a, b) => a.name.localeCompare(b.name, 'th'));
  res.json(users);
});

app.get('/api/admin/transactions', authenticate, requireAdmin, (req, res) => {
  const { limit = 100, offset = 0, status, method } = req.query;
  let txns = DB.payments.slice();
  if (status) txns = txns.filter(p => p.status === status);
  if (method) txns = txns.filter(p => p.payment_method === method);
  txns = txns.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const total = txns.length;
  txns = txns.slice(parseInt(offset), parseInt(offset) + parseInt(limit)).map(p => {
    const u = dbFind('users', u => u.id === p.user_id);
    return { ...p, user_name: u?.name, student_id: u?.student_id };
  });
  res.json({ transactions: txns, total });
});

// ─── API DOCS ─────────────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'KKU Pay API', version: '1.0.0',
    description: 'Campus Payment System — Khon Kaen University',
    base_url: `http://localhost:${PORT}/api`,
    endpoints: {
      auth: { 'POST /api/auth/login': 'Login', 'GET /api/auth/me': 'Current user [auth]' },
      payments: {
        'GET /api/fees': 'Fee items [auth]',
        'POST /api/payments/promptpay': 'PromptPay QR [auth]',
        'POST /api/payments/card': 'Card payment (Omise) [auth]',
        'POST /api/payments/wallet': 'Pay from Wallet [auth]',
        'GET /api/payments': 'Payment history [auth]',
        'POST /api/payments/:id/confirm': 'Confirm pending payment (demo) [auth]',
      },
      wallet: { 'GET /api/wallet': 'Balance + transactions [auth]', 'POST /api/wallet/topup': 'Top-up [auth]' },
      receipts: { 'GET /api/receipts/:id': 'Receipt data [auth]', 'GET /api/receipts/:id/pdf': 'Download PDF [auth]' },
      admin: { 'GET /api/admin/stats': 'Dashboard stats [admin]', 'GET /api/admin/transactions': 'All transactions [admin]', 'GET /api/admin/users': 'All students [admin]' },
    },
    demo_accounts: {
      student: { email: 'somchai@kku.ac.th', password: 'demo1234' },
      admin: { email: 'admin@kkupay.co.th', password: 'admin1234' },
    },
    test_cards: { visa: '4242424242424242', mastercard: '5555555555554444', expiry: '12/27', cvv: '123' },
    mock_payment_mode: MOCK_PAYMENT,
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 KKU Pay Demo Server running on http://localhost:${PORT}`);
  console.log(`\n📋 API Docs:        http://localhost:${PORT}/api`);
  console.log(`🎓 Student Portal:  http://localhost:${PORT}/`);
  console.log(`🛡️  Admin Dashboard: http://localhost:${PORT}/admin.html`);
  console.log(`\n🔑 Demo accounts:`);
  console.log(`   Student: somchai@kku.ac.th / demo1234`);
  console.log(`   Admin:   admin@kkupay.co.th / admin1234`);
  console.log(`\n💳 Mock payment: ${MOCK_PAYMENT ? 'ON (ไม่ต้องใช้ Omise key)' : 'OFF (Omise sandbox)'}`);
});
