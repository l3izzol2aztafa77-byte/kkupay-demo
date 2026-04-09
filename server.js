'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'kkupay-secret-2024';
const MOCK_PAYMENT = process.env.MOCK_PAYMENT !== 'false';
const PORT = process.env.PORT || 3000;

// ─── IN-MEMORY DATABASE ───────────────────────────────────────────────────────
let db = {
  users: [], wallets: [], payments: [], walletTxns: [], feeItems: [],
  chatMessages: [], auditLogs: [], notifications: [], refunds: [], merchants: []
};

function dbFind(table, predicate) { return db[table].find(predicate) || null; }
function dbFilter(table, predicate) { return db[table].filter(predicate); }
function dbInsert(table, record) { db[table].push(record); return record; }
function dbUpdate(table, predicate, updates) {
  const idx = db[table].findIndex(predicate);
  if (idx === -1) return null;
  db[table][idx] = { ...db[table][idx], ...updates };
  return db[table][idx];
}
function dbDelete(table, predicate) {
  const before = db[table].length;
  db[table] = db[table].filter(r => !predicate(r));
  return db[table].length < before;
}

function addAudit(userId, action, detail, ip) {
  dbInsert('auditLogs', {
    id: uuidv4(), userId, action, detail,
    ip: ip || '127.0.0.1', createdAt: new Date().toISOString()
  });
}

// ─── THAI BANK DETAILS ────────────────────────────────────────────────────────
const THAI_BANKS = {
  kbank:  { name: 'ธนาคารกสิกรไทย',               short: 'KBank', account: '004-1-55555-0', acct_name: 'มหาวิทยาลัยขอนแก่น', color: '#138f2d', textColor:'#fff' },
  scb:    { name: 'ธนาคารไทยพาณิชย์',              short: 'SCB',   account: '403-0-66666-0', acct_name: 'มหาวิทยาลัยขอนแก่น', color: '#4e2b84', textColor:'#fff' },
  ktb:    { name: 'ธนาคารกรุงไทย',                 short: 'KTB',   account: '981-0-77777-0', acct_name: 'มหาวิทยาลัยขอนแก่น', color: '#1a9cd8', textColor:'#fff' },
  bbl:    { name: 'ธนาคารกรุงเทพ',                 short: 'BBL',   account: '901-3-88888-0', acct_name: 'มหาวิทยาลัยขอนแก่น', color: '#1e4e9a', textColor:'#fff' },
  ttb:    { name: 'ธนาคารทีทีบี',                  short: 'TTB',   account: '080-6-99999-0', acct_name: 'มหาวิทยาลัยขอนแก่น', color: '#f4762c', textColor:'#fff' },
  gsb:    { name: 'ธนาคารออมสิน',                  short: 'GSB',   account: '020-01-111111-0','acct_name': 'มหาวิทยาลัยขอนแก่น', color: '#eb008a', textColor:'#fff' },
  baac:   { name: 'ธนาคารเพื่อการเกษตรฯ (ธกส.)',   short: 'BAAC',  account: '020000222222', acct_name: 'มหาวิทยาลัยขอนแก่น', color: '#007a3d', textColor:'#fff' },
};

// ─── SEED DATA ────────────────────────────────────────────────────────────────
async function seedDB() {
  const hash = (pw) => bcrypt.hashSync(pw, 10);

  const users = [
    { id:'u1', studentId:'651ME001', username:'somchai',     password:hash('password123'), name:'สมชาย มีสุข',          nameEn:'Somchai Meesuk',         role:'student', faculty:'วิศวกรรมศาสตร์',    program:'วิศวกรรมคอมพิวเตอร์',      year:3, email:'somchai@kkumail.com',     phone:'0812345678', createdAt:new Date().toISOString() },
    { id:'u2', studentId:'641SC002', username:'wannisa',     password:hash('password123'), name:'วรรณิษา พูลสวัสดิ์',   nameEn:'Wannisa Poolsawat',      role:'student', faculty:'วิทยาศาสตร์',        program:'เคมี',                      year:4, email:'wannisa@kkumail.com',     phone:'0823456789', createdAt:new Date().toISOString() },
    { id:'u3', studentId:'671MD003', username:'pichai',      password:hash('password123'), name:'พิชัย สุขสันต์',        nameEn:'Pichai Suksan',          role:'student', faculty:'แพทยศาสตร์',        program:'แพทยศาสตรบัณฑิต',           year:1, email:'pichai@kkumail.com',      phone:'0834567890', createdAt:new Date().toISOString() },
    { id:'u4', studentId:'661NU004', username:'maneeratana', password:hash('password123'), name:'มณีรัตน์ แก้วสว่าง',   nameEn:'Maneeratana Kaewsawang', role:'student', faculty:'พยาบาลศาสตร์',      program:'พยาบาลศาสตรบัณฑิต',         year:2, email:'maneeratana@kkumail.com', phone:'0845678901', createdAt:new Date().toISOString() },
    { id:'a1', studentId:'ADMIN001', username:'admin',       password:hash('admin1234'),   name:'ผู้ดูแลระบบ',           nameEn:'System Admin',           role:'admin',   faculty:'กองคลัง',            program:'-', year:0, email:'admin@kku.ac.th',         phone:'0431234567', createdAt:new Date().toISOString() },
    { id:'a2', studentId:'FIN001',   username:'finance',     password:hash('finance1234'), name:'การเงิน กองคลัง',       nameEn:'Finance Officer',        role:'finance', faculty:'กองคลัง',            program:'-', year:0, email:'finance@kku.ac.th',       phone:'0431234568', createdAt:new Date().toISOString() },
  ];
  users.forEach(u => dbInsert('users', u));

  [{ userId:'u1', balance:1250.00 },{ userId:'u2', balance:3780.50 },{ userId:'u3', balance:500.00 },{ userId:'u4', balance:920.75 }]
    .forEach(w => dbInsert('wallets', { id:uuidv4(), ...w, updatedAt:new Date().toISOString() }));

  const fees = [
    { id:'f1',  userId:'u1', code:'TU-2567-1',  type:'tuition',   label:'ค่าเล่าเรียน ภาคต้น 2567',            amount:22500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะวิศวกรรมศาสตร์' },
    { id:'f2',  userId:'u1', code:'DO-2567-1',  type:'dormitory', label:'ค่าหอพัก ภาคต้น 2567',                amount:2800,  due:'2567-08-15', status:'pending',  semester:'1/2567', note:'หอพัก 11 ชั้น 3 ห้อง 312' },
    { id:'f3',  userId:'u1', code:'HE-2567-1',  type:'health',    label:'ค่าประกันสุขภาพนักศึกษา 2567',        amount:1650,  due:'2567-09-30', status:'paid',     semester:'1/2567', paidAt:'2024-08-01T10:00:00.000Z' },
    { id:'f4',  userId:'u2', code:'TU-2567-2',  type:'tuition',   label:'ค่าเล่าเรียน ภาคต้น 2567',            amount:18500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะวิทยาศาสตร์' },
    { id:'f5',  userId:'u2', code:'AC-2567-1',  type:'activity',  label:'ค่ากิจกรรมนักศึกษา 2567',             amount:450,   due:'2567-09-30', status:'pending',  semester:'1/2567', note:'' },
    { id:'f6',  userId:'u2', code:'SP-2567-1',  type:'sport',     label:'ค่าสิ่งอำนวยความสะดวกกีฬา 2567',      amount:300,   due:'2567-09-30', status:'pending',  semester:'1/2567', note:'' },
    { id:'f7',  userId:'u3', code:'TU-2567-3',  type:'tuition',   label:'ค่าเล่าเรียน ภาคต้น 2567',            amount:38500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะแพทยศาสตร์' },
    { id:'f8',  userId:'u3', code:'FI-2567-1',  type:'fine',      label:'ค่าปรับคืนหนังสือเกินกำหนด',          amount:120,   due:'2567-08-31', status:'overdue',  semester:'1/2567', note:'ห้องสมุดกลาง KKU' },
    { id:'f9',  userId:'u4', code:'TU-2567-4',  type:'tuition',   label:'ค่าเล่าเรียน ภาคต้น 2567',            amount:19500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะพยาบาลศาสตร์' },
    { id:'f10', userId:'u4', code:'IN-2567-1',  type:'internet',  label:'ค่าอินเทอร์เน็ตหอพัก ภาคต้น 2567',   amount:220,   due:'2567-08-31', status:'pending',  semester:'1/2567', note:'' },
    { id:'f11', userId:'u4', code:'PK-2567-1',  type:'parking',   label:'ค่าสติกเกอร์จอดรถ 2567',              amount:800,   due:'2567-09-15', status:'overdue',  semester:'1/2567', note:'รถจักรยานยนต์' },
  ];
  fees.forEach(f => dbInsert('feeItems', { ...f, createdAt:new Date().toISOString() }));

  // Sample historical payments
  [
    { id:'p-old1', userId:'u1', feeId:'f3', method:'promptpay',   amount:1650, status:'success', ref:'KKU-20240801-HE01', createdAt:'2024-08-01T10:00:00.000Z', paidAt:'2024-08-01T10:01:30.000Z' },
    { id:'p-old2', userId:'u2', feeId:null, method:'wallet_topup', amount:3000, status:'success', ref:'KKU-20240802-WL01', createdAt:'2024-08-02T14:30:00.000Z', paidAt:'2024-08-02T14:30:05.000Z' },
    { id:'p-old3', userId:'u3', feeId:null, method:'card',         amount:500,  status:'success', ref:'KKU-20240803-CD01', createdAt:'2024-08-03T09:15:00.000Z', paidAt:'2024-08-03T09:15:10.000Z' },
    { id:'p-old4', userId:'u1', feeId:null, method:'wallet_topup', amount:1000, status:'success', ref:'KKU-20240805-WL02', createdAt:'2024-08-05T08:00:00.000Z', paidAt:'2024-08-05T08:00:05.000Z' },
  ].forEach(p => dbInsert('payments', p));

  [
    { id:uuidv4(), userId:'u2', type:'credit', amount:3000, ref:'KKU-20240802-WL01', desc:'เติมเงิน KKU Wallet', createdAt:'2024-08-02T14:30:00.000Z' },
    { id:uuidv4(), userId:'u1', type:'credit', amount:1000, ref:'KKU-20240805-WL02', desc:'เติมเงิน KKU Wallet', createdAt:'2024-08-05T08:00:00.000Z' },
  ].forEach(t => dbInsert('walletTxns', t));

  const merchants = [
    { id:'m1', name:'ร้านอาหารกลางมหาวิทยาลัย',          category:'food',    mdr:1.5, status:'active', createdAt:new Date().toISOString() },
    { id:'m2', name:'ร้านถ่ายเอกสาร คณะวิทยาศาสตร์',      category:'service', mdr:1.5, status:'active', createdAt:new Date().toISOString() },
    { id:'m3', name:'สหกรณ์มหาวิทยาลัยขอนแก่น',           category:'store',   mdr:1.0, status:'active', createdAt:new Date().toISOString() },
    { id:'m4', name:'คลินิกเวชกรรม มข.',                   category:'health',  mdr:0.0, status:'active', createdAt:new Date().toISOString() },
    { id:'m5', name:'ศูนย์กีฬามหาวิทยาลัยขอนแก่น',         category:'sport',   mdr:1.5, status:'active', createdAt:new Date().toISOString() },
  ];
  merchants.forEach(m => dbInsert('merchants', m));

  dbInsert('notifications', { id:uuidv4(), userId:null, type:'broadcast', title:'ระบบ KKU Pay เปิดให้บริการแล้ว!', message:'เปิดให้ชำระค่าเล่าเรียน ภาคต้น 2567 ได้ตั้งแต่วันนี้ ถึง 30 กันยายน 2567', read:false, createdAt:new Date().toISOString() });
  dbInsert('notifications', { id:uuidv4(), userId:'u1', type:'personal', title:'แจ้งเตือน: ครบกำหนดชำระค่าหอพัก', message:'ค่าหอพัก ภาคต้น 2567 จำนวน ฿2,800 ครบกำหนดชำระ 15 สิงหาคม 2567 กรุณาชำระก่อนวันครบกำหนด', read:false, createdAt:new Date().toISOString() });
  dbInsert('notifications', { id:uuidv4(), userId:'u3', type:'personal', title:'แจ้งเตือน: ค่าปรับเกินกำหนด', message:'ค่าปรับคืนหนังสือ ฿120 เกินกำหนดชำระแล้ว กรุณาชำระโดยด่วน', read:false, createdAt:new Date().toISOString() });
}
seedDB();

// ─── CHAT BOT ─────────────────────────────────────────────────────────────────
function getBotReply(msg) {
  const m = msg.toLowerCase();
  if (/(ค่าเล่าเรียน|ค่าธรรมเนียม|ค่าเทอม|tuition)/.test(m))
    return 'ค่าเล่าเรียนขึ้นอยู่กับคณะที่สังกัด เช่น วิศวกรรมศาสตร์ ฿22,500 | แพทยศาสตร์ ฿38,500 | พยาบาล ฿19,500 ดูรายการชำระได้ที่เมนู "รายการค่าธรรมเนียม" หรือโทร 043-009-700 ต่อ 42132';
  if (/(ลืมรหัส|เปลี่ยนรหัส|password|รหัสผ่าน)/.test(m))
    return 'หากลืมรหัสผ่าน กรุณาติดต่อกองทะเบียน มข. โทร 043-009-700 ต่อ 42111 หรือ Email: registrar@kku.ac.th (จ-ศ 08:30-16:30 น.)';
  if (/(promptpay|พร้อมเพย์|qr|คิวอาร์)/.test(m))
    return 'ชำระผ่าน PromptPay QR:\n1) เลือกรายการ → 2) เลือก "PromptPay" → 3) สแกน QR ด้วยแอปธนาคาร → 4) ยืนยันการชำระ\nรองรับทุกธนาคาร ชำระได้ 24 ชม. ไม่มีค่าธรรมเนียม';
  if (/(wallet|กระเป๋า|เติมเงิน|balance|ยอดเงิน)/.test(m))
    return 'KKU Wallet คือกระเป๋าเงินอิเล็กทรอนิกส์ภายใน เติมเงินได้ผ่านบัตร/PromptPay/โอนธนาคาร แล้วใช้ชำระค่าธรรมเนียมได้ทันที เติมขั้นต่ำ ฿20 สูงสุด ฿50,000 ต่อครั้ง';
  if (/(โอนเงิน|internet banking|ธนาคาร|bank transfer|บัญชี)/.test(m))
    return 'ชำระผ่าน Internet Banking:\n1) เลือกธนาคาร (KBank/SCB/KTB/BBL/TTB/GSB/BAAC)\n2) โอนเงินไปยังบัญชี มข. พร้อมระบุ Ref1+Ref2\n3) ระบบยืนยันอัตโนมัติภายใน 1-2 ชม.\nหมายเหตุ: ต้องระบุ Ref ให้ถูกต้อง มิฉะนั้นระบบไม่สามารถจับคู่ได้';
  if (/(ใบเสร็จ|receipt|e-receipt|ดาวน์โหลด)/.test(m))
    return 'ดาวน์โหลดใบเสร็จ PDF ได้ที่: เมนู "ประวัติธุรกรรม" → คลิกรายการ → "ดาวน์โหลดใบเสร็จ" หรือระบบจะส่ง Email อัตโนมัติหลังชำระสำเร็จ';
  if (/(ewallet|true money|truemoney|rabbit|shopee|ลาย|อีวอลเล็ต)/.test(m))
    return 'รองรับ e-Wallet: TrueMoney Wallet, Rabbit LINE Pay, ShopeePay\nสแกน QR Code ในแอปที่ต้องการ ชำระได้ภายใน 10 นาที';
  if (/(เคาน์เตอร์|counter service|7-eleven|เซเว่น|บิ๊กซี|lotus|โลตัส|boonterm)/.test(m))
    return 'ชำระผ่าน Counter Service:\nนำบาร์โค้ดไปชำระที่ 7-Eleven, Big C, Lotus\'s, Boonterm ทั่วประเทศ\nค่าธรรมเนียม 10 บาท/รายการ ชำระได้ภายใน 3 วัน';
  if (/(บัตรเครดิต|บัตรเดบิต|card|visa|master|jcb)/.test(m))
    return 'รับบัตร Visa, MasterCard, JCB ทั้งเครดิตและเดบิต\nผ่านระบบ Omise (PCI-DSS certified) ไม่มีค่าธรรมเนียมเพิ่ม\nชำระได้ทันที ไม่ต้องรอยืนยัน';
  if (/(ค้างชำระ|overdue|เกินกำหนด|ปรับ|fine|โทษ)/.test(m))
    return 'รายการที่เกินกำหนดชำระ (สีแดง) อาจมีค่าปรับตามระเบียบมหาวิทยาลัย\nกรุณาชำระโดยเร็วหรือติดต่อกองคลัง: 043-009-700 ต่อ 42132';
  if (/(หอพัก|dormitory|ห้องพัก)/.test(m))
    return 'ค่าหอพักนักศึกษา ฿2,800 ต่อภาคเรียน ครบกำหนด 15 สิงหาคม\nปัญหาเรื่องหอพัก: งานหอพักนักศึกษา 043-009-700 ต่อ 42200';
  if (/(ติดต่อ|โทร|เบอร์|contact|help|ช่วย|สอบถาม|support)/.test(m))
    return '📞 ติดต่อกองคลัง มข.:\nโทร: 043-009-700 ต่อ 42132\nEmail: finance@kku.ac.th\nLine: @kkupay\nเวลาทำการ: จ-ศ 08:30-16:30 น.\n📍 อาคารสำนักงานอธิการบดี ชั้น 2';
  if (/(ขอบคุณ|thank|โอเค|ok|ได้เลย|เข้าใจ)/.test(m))
    return 'ยินดีให้บริการเสมอครับ/ค่ะ 😊 หากมีข้อสงสัยเพิ่มเติมพิมพ์ถามได้เลย!';
  return 'ขออภัย ไม่เข้าใจคำถาม กรุณาพิมพ์ใหม่หรือลองถามเกี่ยวกับ:\n• การชำระเงิน (PromptPay/บัตร/โอนธนาคาร)\n• KKU Wallet\n• ใบเสร็จ / ค่าเล่าเรียน\n\nหรือโทรหาเจ้าหน้าที่: 043-009-700 ต่อ 42132';
}

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = dbFind('users', u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name, studentId: user.studentId }, JWT_SECRET, { expiresIn: '8h' });
  addAudit(user.id, 'LOGIN', `${user.name} เข้าสู่ระบบ`, req.ip);
  const { password: _, ...safeUser } = user;
  res.json({ token, user: safeUser });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = dbFind('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password: _, ...safeUser } = user;
  const wallet = dbFind('wallets', w => w.userId === user.id);
  const unread = dbFilter('notifications', n => !n.read && (n.userId === user.id || n.userId === null)).length;
  res.json({ user: safeUser, wallet, unreadNotifications: unread });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FEES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/fees', authenticate, (req, res) => {
  const fees = dbFilter('feeItems', f => f.userId === req.user.id);
  res.json({ fees });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
function makeOrderId() { return 'KKU-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase(); }

// PromptPay
app.post('/api/payments/promptpay', authenticate, async (req, res) => {
  try {
    const { feeId, amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'ระบุจำนวนเงินไม่ถูกต้อง' });
    const orderId = makeOrderId();
    const promptpayId = '0043600097001';
    const amtStr = parseFloat(amount).toFixed(2);
    const qrData = `00020101021229370016A000000677010112011300${promptpayId}5303764540${String(amtStr.length).padStart(2,'0')}${amtStr}5802TH5916KKU PAYMENT6006KHON KA6304ABCD`;
    const qrImg = await QRCode.toDataURL(qrData, { width:300, margin:2, color:{ dark:'#4a0072', light:'#ffffff' } });
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'promptpay', amount:parseFloat(amount), status:'pending', ref:orderId, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `PromptPay ฿${amount} Ref:${orderId}`, req.ip);
    setTimeout(() => {
      dbUpdate('payments', p => p.id === payment.id, { status:'success', paidAt:new Date().toISOString() });
      if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'paid', paidAt:new Date().toISOString() });
      addAudit(req.user.id, 'PAYMENT_SUCCESS', `PromptPay ฿${amount} สำเร็จ Ref:${orderId}`, req.ip);
    }, 8000);
    res.json({ success:true, orderId, qrImage:qrImg, amount:parseFloat(amount), promptpayId, expiresAt:new Date(Date.now()+15*60*1000).toISOString(), instruction:'สแกน QR Code ด้วยแอปธนาคารใดก็ได้ ชำระได้ภายใน 15 นาที ไม่มีค่าธรรมเนียม' });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// Credit/Debit Card
app.post('/api/payments/card', authenticate, async (req, res) => {
  try {
    const { feeId, amount, cardNumber, cardName, expiry, cvv } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'ระบุจำนวนเงินไม่ถูกต้อง' });
    const orderId = makeOrderId();
    const last4 = (cardNumber||'').replace(/\s/g,'').slice(-4) || '0000';
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'card', amount:parseFloat(amount), status:'success', ref:orderId, cardLast4:last4, createdAt:new Date().toISOString(), paidAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'paid', paidAt:new Date().toISOString() });
    addAudit(req.user.id, 'PAYMENT_SUCCESS', `บัตร *${last4} ฿${amount} สำเร็จ Ref:${orderId}`, req.ip);
    res.json({ success:true, orderId, amount:parseFloat(amount), cardLast4:last4, message:'ชำระเงินสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// KKU Wallet
app.post('/api/payments/wallet', authenticate, async (req, res) => {
  try {
    const { feeId, amount } = req.body;
    const wallet = dbFind('wallets', w => w.userId === req.user.id);
    if (!wallet) return res.status(404).json({ error: 'ไม่พบกระเป๋าเงิน' });
    if (wallet.balance < parseFloat(amount)) return res.status(400).json({ error: `ยอดเงินในกระเป๋าไม่เพียงพอ (คงเหลือ ฿${wallet.balance.toFixed(2)})` });
    const orderId = makeOrderId();
    dbUpdate('wallets', w => w.userId === req.user.id, { balance: wallet.balance - parseFloat(amount), updatedAt:new Date().toISOString() });
    dbInsert('walletTxns', { id:uuidv4(), userId:req.user.id, type:'debit', amount:parseFloat(amount), ref:orderId, desc:'ชำระค่าธรรมเนียม', createdAt:new Date().toISOString() });
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'wallet', amount:parseFloat(amount), status:'success', ref:orderId, createdAt:new Date().toISOString(), paidAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'paid', paidAt:new Date().toISOString() });
    const newWallet = dbFind('wallets', w => w.userId === req.user.id);
    addAudit(req.user.id, 'PAYMENT_SUCCESS', `KKU Wallet ฿${amount} สำเร็จ Ref:${orderId}`, req.ip);
    res.json({ success:true, orderId, amount:parseFloat(amount), newBalance:newWallet.balance, message:'หักจากกระเป๋าเงินสำเร็จ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Internet Banking
app.post('/api/payments/banking', authenticate, async (req, res) => {
  try {
    const { feeId, amount, bankCode } = req.body;
    const bank = THAI_BANKS[bankCode];
    if (!bank) return res.status(400).json({ error: 'ไม่พบข้อมูลธนาคาร กรุณาเลือกใหม่' });
    const orderId = makeOrderId();
    const ref2 = Math.floor(100000 + Math.random()*900000).toString();
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'banking', amount:parseFloat(amount), status:'pending', ref:orderId, bankCode, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `Internet Banking ${bank.short} ฿${amount} Ref:${orderId}`, req.ip);
    res.json({
      success:true, orderId, amount:parseFloat(amount),
      bankName:bank.name, bankShort:bank.short,
      accountNumber:bank.account, accountName:bank.acct_name,
      color:bank.color, textColor:bank.textColor,
      ref1:orderId, ref2,
      expiresAt:new Date(Date.now()+24*60*60*1000).toISOString(),
      steps:[
        `เปิดแอป ${bank.short} หรือ Internet Banking ของท่าน`,
        `เลือกเมนู "โอนเงิน" หรือ "จ่ายบิล"`,
        `กรอกเลขบัญชีปลายทาง: ${bank.account}`,
        `ชื่อบัญชี: ${bank.acct_name}`,
        `จำนวนเงิน: ฿${parseFloat(amount).toLocaleString('th-TH',{minimumFractionDigits:2})}`,
        `ระบุ Ref1: ${orderId} ในช่องหมายเหตุ/อ้างอิง`,
        `ระบุ Ref2: ${ref2} ในช่องหมายเหตุ/อ้างอิง 2`,
        'กดยืนยันโอนเงิน และบันทึก/ถ่ายรูปสลิปไว้เป็นหลักฐาน'
      ],
      instruction:`ระบบจะยืนยันการรับเงินอัตโนมัติภายใน 1-2 ชั่วโมง กรุณาระบุ Ref ให้ถูกต้องทั้ง 2 ช่อง`
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// e-Wallet
app.post('/api/payments/ewallet', authenticate, async (req, res) => {
  try {
    const { feeId, amount, provider } = req.body;
    const providers = {
      truemoney: { name:'TrueMoney Wallet', color:'#ff6600', bg:'#fff3eb', icon:'🟠' },
      rabbit:    { name:'Rabbit LINE Pay',  color:'#00c300', bg:'#ebffeb', icon:'🟢' },
      shopee:    { name:'ShopeePay',        color:'#ee4d2d', bg:'#ffedea', icon:'🔴' },
    };
    const prov = providers[provider];
    if (!prov) return res.status(400).json({ error: 'ไม่พบ e-Wallet ที่เลือก' });
    const orderId = makeOrderId();
    const qrData = `EWALLET:${provider.toUpperCase()}:${orderId}:${amount}:KKU:${Date.now()}`;
    const qrImg = await QRCode.toDataURL(qrData, { width:280, margin:2, color:{ dark:'#000000', light:'#ffffff' } });
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'ewallet', amount:parseFloat(amount), status:'pending', ref:orderId, provider, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `${prov.name} ฿${amount} Ref:${orderId}`, req.ip);
    setTimeout(() => {
      dbUpdate('payments', p => p.id === payment.id, { status:'success', paidAt:new Date().toISOString() });
      if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'paid', paidAt:new Date().toISOString() });
      addAudit(req.user.id, 'PAYMENT_SUCCESS', `${prov.name} ฿${amount} สำเร็จ Ref:${orderId}`, req.ip);
    }, 10000);
    res.json({ success:true, orderId, amount:parseFloat(amount), provider:prov.name, color:prov.color, bg:prov.bg, icon:prov.icon, qrImage:qrImg, expiresAt:new Date(Date.now()+10*60*1000).toISOString(), instruction:`เปิดแอป ${prov.name} แตะที่ "สแกน" แล้วสแกน QR Code เพื่อชำระเงิน ชำระได้ภายใน 10 นาที` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Counter Service
app.post('/api/payments/counter', authenticate, async (req, res) => {
  try {
    const { feeId, amount } = req.body;
    const serviceFee = 10;
    const total = parseFloat(amount) + serviceFee;
    const orderId = makeOrderId();
    const barcode = '9900' + Date.now().toString().slice(-10) + Math.floor(Math.random()*100).toString().padStart(2,'0');
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'counter', amount:total, status:'pending', ref:orderId, barcode, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f => f.id === feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `Counter Service ฿${total} Ref:${orderId}`, req.ip);
    res.json({
      success:true, orderId, amount:parseFloat(amount), serviceFee, total, barcode,
      expiresAt:new Date(Date.now()+3*24*60*60*1000).toISOString(),
      locations:['7-Eleven (ทุกสาขาทั่วประเทศ)','Big C Extra / Big C Market','Lotus\'s (เทสโก้ โลตัส)','Boonterm Kiosk','CRG Pay Station','ธนาคารกรุงไทย (เคาน์เตอร์สาขา)'],
      instruction:`บันทึกบาร์โค้ดหรือ Ref: ${orderId} แล้วนำไปชำระที่จุดบริการ ค่าธรรมเนียม ${serviceFee} บาท ชำระได้ภายใน 3 วัน`
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  WALLET
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/wallet', authenticate, (req, res) => {
  const wallet = dbFind('wallets', w => w.userId === req.user.id);
  const txns = dbFilter('walletTxns', t => t.userId === req.user.id).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ wallet, transactions: txns });
});

app.post('/api/wallet/topup', authenticate, async (req, res) => {
  try {
    const { amount, method } = req.body;
    if (!amount || parseFloat(amount) < 20) return res.status(400).json({ error: 'ยอดเติมขั้นต่ำ 20 บาท' });
    if (parseFloat(amount) > 50000) return res.status(400).json({ error: 'ยอดเติมสูงสุด 50,000 บาทต่อครั้ง' });
    const wallet = dbFind('wallets', w => w.userId === req.user.id);
    const orderId = makeOrderId();
    dbUpdate('wallets', w => w.userId === req.user.id, { balance: wallet.balance + parseFloat(amount), updatedAt:new Date().toISOString() });
    dbInsert('walletTxns', { id:uuidv4(), userId:req.user.id, type:'credit', amount:parseFloat(amount), method, ref:orderId, desc:'เติมเงิน KKU Wallet', createdAt:new Date().toISOString() });
    dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId:null, method:'wallet_topup', amount:parseFloat(amount), status:'success', ref:orderId, createdAt:new Date().toISOString(), paidAt:new Date().toISOString() });
    const newWallet = dbFind('wallets', w => w.userId === req.user.id);
    addAudit(req.user.id, 'WALLET_TOPUP', `เติมเงิน ฿${amount} (${method}) Ref:${orderId}`, req.ip);
    res.json({ success:true, orderId, amount:parseFloat(amount), newBalance:newWallet.balance });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TRANSACTIONS & NOTIFICATIONS & CHAT
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/transactions', authenticate, (req, res) => {
  const payments = dbFilter('payments', p => p.userId === req.user.id).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ transactions: payments });
});

app.get('/api/notifications', authenticate, (req, res) => {
  const notifs = dbFilter('notifications', n => n.userId === req.user.id || n.userId === null).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ notifications: notifs });
});

app.post('/api/notifications/read', authenticate, (req, res) => {
  dbUpdate('notifications', n => n.id === req.body.notifId, { read:true });
  res.json({ success:true });
});

app.get('/api/chat/history', authenticate, (req, res) => {
  const msgs = dbFilter('chatMessages', m => m.userId === req.user.id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).slice(-50);
  res.json({ messages: msgs });
});

app.post('/api/chat', authenticate, (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'กรุณาพิมพ์ข้อความ' });
  const userMsg = dbInsert('chatMessages', { id:uuidv4(), userId:req.user.id, from:'user', message:message.trim(), createdAt:new Date().toISOString() });
  const reply = getBotReply(message);
  const botMsg = dbInsert('chatMessages', { id:uuidv4(), userId:req.user.id, from:'bot', message:reply, createdAt:new Date().toISOString() });
  res.json({ userMessage:userMsg, botReply:botMsg });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  RECEIPT PDF
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/receipt/:paymentId', authenticate, (req, res) => {
  const payment = dbFind('payments', p => p.id === req.params.paymentId && p.userId === req.user.id);
  if (!payment) return res.status(404).json({ error: 'ไม่พบรายการ' });
  const user = dbFind('users', u => u.id === req.user.id);
  const fee = payment.feeId ? dbFind('feeItems', f => f.id === payment.feeId) : null;
  const methodNames = { promptpay:'PromptPay QR', card:'บัตรเครดิต/เดบิต', wallet:'KKU Wallet', banking:'Internet Banking', ewallet:'e-Wallet', counter:'Counter Service', wallet_topup:'เติมเงิน KKU Wallet' };
  const doc = new PDFDocument({ size:'A4', margin:50 });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename=receipt-${payment.ref}.pdf`);
  doc.pipe(res);
  doc.rect(0,0,595,125).fill('#4a0072');
  doc.fillColor('white').fontSize(26).font('Helvetica-Bold').text('KKU PAY', 55, 28);
  doc.fontSize(11).font('Helvetica').text('ระบบชำระเงินออนไลน์ มหาวิทยาลัยขอนแก่น', 55, 62);
  doc.text('Khon Kaen University Payment System', 55, 78);
  doc.text('123 หมู่ 16 ถ.มิตรภาพ ต.ในเมือง อ.เมือง จ.ขอนแก่น 40002  |  โทร: 043-009-700 ต่อ 42132', 55, 94);
  doc.fillColor('#4a0072').fontSize(17).font('Helvetica-Bold').text('ใบเสร็จรับเงิน / Official Receipt', 0, 142, { align:'center' });
  doc.rect(50,168,495,1).fill('#4a0072');
  const rows = [
    ['เลขที่ใบเสร็จ / Receipt No.',payment.ref],
    ['วันที่ชำระ / Payment Date', new Date(payment.paidAt||payment.createdAt).toLocaleString('th-TH')],
    ['ชื่อผู้ชำระ / Payer', user?.name||'-'],
    ['รหัสนักศึกษา / Student ID', user?.studentId||'-'],
    ['คณะ / Faculty', user?.faculty||'-'],
    ['สาขา / Program', user?.program||'-'],
    ['รายการ / Description', fee?.label||(payment.method==='wallet_topup'?'เติมเงิน KKU Wallet':'ชำระเงิน')],
    ['วิธีชำระ / Method', methodNames[payment.method]||payment.method],
    ['สถานะ / Status', payment.status==='success'?'✓ ชำระแล้ว / Paid':'รอดำเนินการ / Pending'],
  ];
  let yy=178;
  rows.forEach(([label,val])=>{ doc.fillColor('#555').font('Helvetica-Bold').fontSize(9.5).text(label+':',60,yy); doc.fillColor('#222').font('Helvetica').text(String(val),255,yy); yy+=22; });
  doc.rect(50,yy+8,495,1).fill('#ddd');
  doc.rect(345,yy+15,200,55).fill('#4a0072');
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('จำนวนเงิน / Amount',350,yy+20);
  doc.fontSize(20).text('฿ '+parseFloat(payment.amount).toLocaleString('th-TH',{minimumFractionDigits:2}),350,yy+36);
  doc.rect(0,752,595,90).fill('#f5f5f5');
  doc.fillColor('#888').fontSize(8.5).font('Helvetica').text('เอกสารนี้ออกโดยระบบคอมพิวเตอร์อัตโนมัติ ไม่ต้องมีลายมือชื่อผู้รับเงิน',55,760,{align:'center'});
  doc.text('This document is computer-generated. No signature required.',55,774,{align:'center'});
  doc.text('KKU Pay v2.0  |  kkupay.kku.ac.th  |  © 2567 มหาวิทยาลัยขอนแก่น  |  สงวนสิทธิ์ตามกฎหมาย',55,789,{align:'center'});
  doc.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
const isAdmin = [authenticate, requireRole('admin','finance','support')];
const isAdminOnly = [authenticate, requireRole('admin')];
const isAdminFinance = [authenticate, requireRole('admin','finance')];

app.get('/api/admin/stats', isAdmin, (req, res) => {
  const success = db.payments.filter(p=>p.status==='success');
  const totalRevenue = success.reduce((s,p)=>s+parseFloat(p.amount),0);
  const walletTotal = db.wallets.reduce((s,w)=>s+w.balance,0);
  const pendingFees = db.feeItems.filter(f=>f.status==='pending'||f.status==='overdue');
  const pendingTotal = pendingFees.reduce((s,f)=>s+f.amount,0);
  const today = new Date().toISOString().slice(0,10);
  const todayOk = success.filter(p=>p.createdAt.startsWith(today));
  const days=[];
  for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10); days.push({ date:k, amount:success.filter(p=>p.createdAt.startsWith(k)).reduce((s,p)=>s+parseFloat(p.amount),0) }); }
  const methods={};
  success.forEach(p=>{ methods[p.method]=(methods[p.method]||0)+parseFloat(p.amount); });
  res.json({ totalRevenue, walletTotal, pendingTotal, todayRevenue:todayOk.reduce((s,p)=>s+parseFloat(p.amount),0), todayCount:todayOk.length, totalStudents:db.users.filter(u=>u.role==='student').length, totalTransactions:success.length, successRate:db.payments.length?(success.length/db.payments.length*100).toFixed(1):100, chartData:days, methodBreakdown:methods, refundCount:db.refunds.length, mdrRevenue:totalRevenue*0.015 });
});

app.get('/api/admin/users', isAdmin, (req, res) => {
  const students = db.users.filter(u=>u.role==='student').map(u=>{
    const {password:_,...safe}=u;
    const w=dbFind('wallets',ww=>ww.userId===u.id);
    const fees=dbFilter('feeItems',f=>f.userId===u.id);
    const paid=dbFilter('payments',p=>p.userId===u.id&&p.status==='success');
    return {...safe, walletBalance:w?.balance||0, feeCount:fees.length, pendingFees:fees.filter(f=>f.status==='pending'||f.status==='overdue').length, paymentCount:paid.length, totalPaid:paid.reduce((s,p)=>s+parseFloat(p.amount),0)};
  });
  res.json({ users: students });
});

app.get('/api/admin/transactions', isAdmin, (req, res) => {
  const txns = db.payments.map(p=>{
    const u=dbFind('users',u=>u.id===p.userId);
    const f=p.feeId?dbFind('feeItems',f=>f.id===p.feeId):null;
    return {...p, studentName:u?.name, studentId:u?.studentId, faculty:u?.faculty, feeLabel:f?.label};
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ transactions: txns });
});

// Fee CRUD
app.get('/api/admin/fees', isAdmin, (req, res) => {
  const fees = db.feeItems.map(f=>{ const u=dbFind('users',u=>u.id===f.userId); return {...f, studentName:u?.name, studentId:u?.studentId, faculty:u?.faculty}; });
  res.json({ fees });
});

app.post('/api/admin/fees', isAdminOnly, (req, res) => {
  const { userId, code, type, label, amount, due, semester, note } = req.body;
  const user = dbFind('users', u=>u.id===userId);
  if (!user) return res.status(404).json({ error:'ไม่พบนักศึกษา' });
  const fee = dbInsert('feeItems', { id:uuidv4(), userId, code:code||('FEE-'+Date.now()), type, label, amount:parseFloat(amount), due, semester:semester||'', note:note||'', status:'pending', createdAt:new Date().toISOString() });
  addAudit(req.user.id, 'FEE_CREATE', `สร้างรายการ "${label}" ฿${amount} → ${user.name}`, req.ip);
  res.json({ success:true, fee });
});

app.put('/api/admin/fees/:id', isAdminOnly, (req, res) => {
  const fee = dbUpdate('feeItems', f=>f.id===req.params.id, req.body);
  if (!fee) return res.status(404).json({ error:'ไม่พบรายการ' });
  addAudit(req.user.id, 'FEE_UPDATE', `แก้ไขรายการ "${fee.label}"`, req.ip);
  res.json({ success:true, fee });
});

app.delete('/api/admin/fees/:id', isAdminOnly, (req, res) => {
  const fee = dbFind('feeItems', f=>f.id===req.params.id);
  if (!fee) return res.status(404).json({ error:'ไม่พบรายการ' });
  dbDelete('feeItems', f=>f.id===req.params.id);
  addAudit(req.user.id, 'FEE_DELETE', `ลบรายการ "${fee.label}"`, req.ip);
  res.json({ success:true });
});

// Refund
app.post('/api/admin/refund', isAdminFinance, (req, res) => {
  const { paymentId, reason, amount } = req.body;
  const payment = dbFind('payments', p=>p.id===paymentId);
  if (!payment) return res.status(404).json({ error:'ไม่พบรายการ' });
  if (payment.status!=='success') return res.status(400).json({ error:'รายการนี้ไม่สามารถคืนเงินได้' });
  const refundAmt = parseFloat(amount)||parseFloat(payment.amount);
  const refund = dbInsert('refunds', { id:uuidv4(), paymentId, userId:payment.userId, amount:refundAmt, reason, status:'approved', processedBy:req.user.id, createdAt:new Date().toISOString() });
  dbUpdate('payments', p=>p.id===paymentId, { status:'refunded', refundId:refund.id, refundedAt:new Date().toISOString() });
  if (payment.method==='wallet') {
    const w=dbFind('wallets',w=>w.userId===payment.userId);
    if(w) dbUpdate('wallets',w=>w.userId===payment.userId,{ balance:w.balance+refundAmt, updatedAt:new Date().toISOString() });
    dbInsert('walletTxns',{ id:uuidv4(), userId:payment.userId, type:'credit', amount:refundAmt, ref:refund.id, desc:'คืนเงิน: '+reason, createdAt:new Date().toISOString() });
  }
  if (payment.feeId) dbUpdate('feeItems', f=>f.id===payment.feeId, { status:'pending' });
  addAudit(req.user.id, 'REFUND', `คืนเงิน ฿${refundAmt} รายการ ${payment.ref} เหตุผล: ${reason}`, req.ip);
  dbInsert('notifications', { id:uuidv4(), userId:payment.userId, type:'personal', title:'การคืนเงินได้รับการอนุมัติ', message:`รายการ ${payment.ref} ได้รับการคืนเงิน ฿${refundAmt.toFixed(2)} เหตุผล: ${reason}`, read:false, createdAt:new Date().toISOString() });
  res.json({ success:true, refund });
});

app.get('/api/admin/refunds', isAdmin, (req, res) => {
  const refunds = db.refunds.map(r=>{
    const p=dbFind('payments',p=>p.id===r.paymentId);
    const u=dbFind('users',u=>u.id===r.userId);
    const proc=dbFind('users',u=>u.id===r.processedBy);
    return {...r, paymentRef:p?.ref, studentName:u?.name, studentId:u?.studentId, processedByName:proc?.name};
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ refunds });
});

// Audit Log
app.get('/api/admin/audit-log', isAdmin, (req, res) => {
  const logs = db.auditLogs.map(l=>{ const u=dbFind('users',u=>u.id===l.userId); return {...l, userName:u?.name, userRole:u?.role}; }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,300);
  res.json({ logs });
});

// Settlement / Reconciliation
app.get('/api/admin/settlement', isAdminFinance, (req, res) => {
  const date = req.query.date||new Date().toISOString().slice(0,10);
  const day = db.payments.filter(p=>p.status==='success'&&p.createdAt.startsWith(date));
  const gross = day.reduce((s,p)=>s+parseFloat(p.amount),0);
  const byMethod={};
  day.forEach(p=>{ if(!byMethod[p.method]) byMethod[p.method]={count:0,gross:0,mdr:0,net:0}; byMethod[p.method].count++; byMethod[p.method].gross+=parseFloat(p.amount); byMethod[p.method].mdr+=parseFloat(p.amount)*0.015; byMethod[p.method].net+=parseFloat(p.amount)*0.985; });
  res.json({ date, gross, mdr:gross*0.015, net:gross*0.985, transactionCount:day.length, byMethod });
});

app.get('/api/admin/reconciliation', isAdminFinance, (req, res) => {
  const days=[];
  for(let i=29;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10); const t=db.payments.filter(p=>p.status==='success'&&p.createdAt.startsWith(k)); const g=t.reduce((s,p)=>s+parseFloat(p.amount),0); days.push({ date:k, count:t.length, gross:g, mdr:g*0.015, net:g*0.985 }); }
  res.json({ reconciliation:days });
});

// Merchants
app.get('/api/admin/merchants', isAdmin, (req, res) => res.json({ merchants:db.merchants }));

app.post('/api/admin/merchants', isAdminOnly, (req, res) => {
  const m = dbInsert('merchants', { id:uuidv4(), ...req.body, createdAt:new Date().toISOString() });
  addAudit(req.user.id, 'MERCHANT_CREATE', `เพิ่ม Merchant: ${m.name}`, req.ip);
  res.json({ success:true, merchant:m });
});

app.put('/api/admin/merchants/:id', isAdminOnly, (req, res) => {
  const m = dbUpdate('merchants', m=>m.id===req.params.id, req.body);
  if (!m) return res.status(404).json({ error:'ไม่พบ Merchant' });
  addAudit(req.user.id, 'MERCHANT_UPDATE', `อัพเดท Merchant: ${m.name}`, req.ip);
  res.json({ success:true, merchant:m });
});

// Broadcast
app.post('/api/admin/notifications/broadcast', isAdminOnly, (req, res) => {
  const { title, message } = req.body;
  const n = dbInsert('notifications', { id:uuidv4(), userId:null, type:'broadcast', title, message, read:false, createdAt:new Date().toISOString() });
  addAudit(req.user.id, 'BROADCAST', `ส่งประกาศ: "${title}"`, req.ip);
  res.json({ success:true, notification:n });
});

// ─── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'public', 'index.html'));
  else res.status(404).json({ error: 'API endpoint not found' });
});

app.listen(PORT, () => console.log(`✅ KKU Pay v2.0 running on port ${PORT} | Mock:${MOCK_PAYMENT}`));
