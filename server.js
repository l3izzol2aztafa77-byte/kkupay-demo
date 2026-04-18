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
  chatMessages: [], auditLogs: [], notifications: [], refunds: [],
  merchants: [], merchantTxns: [], merchantWithdrawals: [], posOrders: []
};

function dbFind(t, fn) { return db[t].find(fn) || null; }
function dbFilter(t, fn) { return db[t].filter(fn); }
function dbInsert(t, r) { db[t].push(r); return r; }
function dbUpdate(t, fn, u) {
  const i = db[t].findIndex(fn);
  if (i === -1) return null;
  db[t][i] = { ...db[t][i], ...u };
  return db[t][i];
}
function dbDelete(t, fn) { const b = db[t].length; db[t] = db[t].filter(r => !fn(r)); return db[t].length < b; }

function addAudit(userId, action, detail, ip) {
  dbInsert('auditLogs', { id:uuidv4(), userId, action, detail, ip:ip||'127.0.0.1', createdAt:new Date().toISOString() });
}

// ─── THAI BANK DETAILS ────────────────────────────────────────────────────────
const THAI_BANKS = {
  kbank: { name:'ธนาคารกสิกรไทย',              short:'KBank', account:'004-1-55555-0', acct_name:'มหาวิทยาลัยขอนแก่น', color:'#138f2d', textColor:'#fff' },
  scb:   { name:'ธนาคารไทยพาณิชย์',             short:'SCB',   account:'403-0-66666-0', acct_name:'มหาวิทยาลัยขอนแก่น', color:'#4e2b84', textColor:'#fff' },
  ktb:   { name:'ธนาคารกรุงไทย',                short:'KTB',   account:'981-0-77777-0', acct_name:'มหาวิทยาลัยขอนแก่น', color:'#1a9cd8', textColor:'#fff' },
  bbl:   { name:'ธนาคารกรุงเทพ',                short:'BBL',   account:'901-3-88888-0', acct_name:'มหาวิทยาลัยขอนแก่น', color:'#1e4e9a', textColor:'#fff' },
  ttb:   { name:'ธนาคารทีทีบี',                 short:'TTB',   account:'080-6-99999-0', acct_name:'มหาวิทยาลัยขอนแก่น', color:'#f4762c', textColor:'#fff' },
  gsb:   { name:'ธนาคารออมสิน',                 short:'GSB',   account:'020-01-111111-0',acct_name:'มหาวิทยาลัยขอนแก่น', color:'#eb008a', textColor:'#fff' },
  baac:  { name:'ธนาคารเพื่อการเกษตรฯ (ธกส.)', short:'BAAC',  account:'020000222222',   acct_name:'มหาวิทยาลัยขอนแก่น', color:'#007a3d', textColor:'#fff' },
};

// ─── SEED DATA ────────────────────────────────────────────────────────────────
async function seedDB() {
  const h = pw => bcrypt.hashSync(pw, 10);

  // ── Students & Staff ──
  const users = [
    { id:'u1', studentId:'651ME001', username:'somchai',     password:h('password123'), name:'สมชาย มีสุข',           nameEn:'Somchai Meesuk',         role:'student', faculty:'วิศวกรรมศาสตร์',   program:'วิศวกรรมคอมพิวเตอร์', year:3, email:'somchai@kkumail.com',     phone:'0812345678', createdAt:new Date().toISOString() },
    { id:'u2', studentId:'641SC002', username:'wannisa',     password:h('password123'), name:'วรรณิษา พูลสวัสดิ์',    nameEn:'Wannisa Poolsawat',      role:'student', faculty:'วิทยาศาสตร์',       program:'เคมี',                 year:4, email:'wannisa@kkumail.com',     phone:'0823456789', createdAt:new Date().toISOString() },
    { id:'u3', studentId:'671MD003', username:'pichai',      password:h('password123'), name:'พิชัย สุขสันต์',         nameEn:'Pichai Suksan',          role:'student', faculty:'แพทยศาสตร์',       program:'แพทยศาสตรบัณฑิต',     year:1, email:'pichai@kkumail.com',      phone:'0834567890', createdAt:new Date().toISOString() },
    { id:'u4', studentId:'661NU004', username:'maneeratana', password:h('password123'), name:'มณีรัตน์ แก้วสว่าง',    nameEn:'Maneeratana Kaewsawang', role:'student', faculty:'พยาบาลศาสตร์',     program:'พยาบาลศาสตรบัณฑิต',   year:2, email:'maneeratana@kkumail.com', phone:'0845678901', createdAt:new Date().toISOString() },
    { id:'a1', studentId:'ADMIN001', username:'admin',       password:h('admin1234'),   name:'ผู้ดูแลระบบ',            nameEn:'System Admin',           role:'admin',   faculty:'กองคลัง', program:'-', year:0, email:'admin@kku.ac.th',         phone:'0431234567', createdAt:new Date().toISOString() },
    { id:'a2', studentId:'FIN001',   username:'finance',     password:h('finance1234'), name:'การเงิน กองคลัง',        nameEn:'Finance Officer',        role:'finance', faculty:'กองคลัง', program:'-', year:0, email:'finance@kku.ac.th',       phone:'0431234568', createdAt:new Date().toISOString() },
    // Merchant logins
    { id:'m-u1', studentId:'MER001', username:'merchant1', password:h('merchant123'), name:'ร้านอาหารกลางมหาวิทยาลัย', nameEn:'KKU Canteen', role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'canteen@kku.ac.th', phone:'0431100001', merchantId:'m1', createdAt:new Date().toISOString() },
    { id:'m-u2', studentId:'MER002', username:'merchant2', password:h('merchant123'), name:'ร้านถ่ายเอกสาร คณะวิทย์',  nameEn:'Copy Center',  role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'copy@kku.ac.th',    phone:'0431100002', merchantId:'m2', createdAt:new Date().toISOString() },
    { id:'m-u3', studentId:'MER003', username:'merchant3', password:h('merchant123'), name:'สหกรณ์มหาวิทยาลัยขอนแก่น',nameEn:'KKU Co-op',    role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'coop@kku.ac.th',    phone:'0431100003', merchantId:'m3', createdAt:new Date().toISOString() },
    { id:'m-u4', studentId:'MER004', username:'merchant4', password:h('merchant123'), name:'คลินิกเวชกรรม มข.',        nameEn:'KKU Clinic',   role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'clinic@kku.ac.th',  phone:'0431100004', merchantId:'m4', createdAt:new Date().toISOString() },
    { id:'m-u5', studentId:'MER005', username:'merchant5', password:h('merchant123'), name:'ศูนย์กีฬามหาวิทยาลัย',     nameEn:'KKU Sports',   role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'sports@kku.ac.th',  phone:'0431100005', merchantId:'m5', createdAt:new Date().toISOString() },
    { id:'m-u6', studentId:'MER006', username:'merchant6', password:h('merchant123'), name:'ร้านหนังสือ มข.',          nameEn:'KKU Bookstore',role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'book@kku.ac.th',    phone:'0431100006', merchantId:'m6', createdAt:new Date().toISOString() },
    { id:'m-u7', studentId:'MER007', username:'merchant7', password:h('merchant123'), name:'ร้านเสื้อผ้า KKU Shop',   nameEn:'KKU Shop',     role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'shop@kku.ac.th',    phone:'0431100007', merchantId:'m7', createdAt:new Date().toISOString() },
    { id:'m-u8', studentId:'MER008', username:'merchant8', password:h('merchant123'), name:'ร้านกาแฟ Kaffee Corner',  nameEn:'Kaffee Corner',role:'merchant', faculty:'ร้านค้า', program:'-', year:0, email:'kaffee@kku.ac.th',  phone:'0431100008', merchantId:'m8', createdAt:new Date().toISOString() },
  ];
  users.forEach(u => dbInsert('users', u));

  // ── Wallets ──
  [{ userId:'u1', balance:1250.00 },{ userId:'u2', balance:3780.50 },{ userId:'u3', balance:500.00 },{ userId:'u4', balance:920.75 }]
    .forEach(w => dbInsert('wallets', { id:uuidv4(), ...w, updatedAt:new Date().toISOString() }));

  // ── Merchants (detailed) ──
  const merchants = [
    {
      id:'m1', code:'KKU-M001', name:'ร้านอาหารกลางมหาวิทยาลัยขอนแก่น', nameEn:'KKU Central Canteen',
      category:'food', subCategory:'canteen', mdr:1.5, status:'active',
      contactName:'นางสาว จันทร์ เพ็ชรดี', contactPhone:'0431100001', contactEmail:'canteen@kku.ac.th',
      address:'อาคารพุทธศิลป์ (ชั้น G) มข. ถ.มิตรภาพ ขอนแก่น 40002',
      location:'ใจกลางมหาวิทยาลัย หน้าอาคารพุทธศิลป์',
      bankCode:'kbank', bankAccount:'004-2-11111-1', bankName:'ธนาคารกสิกรไทย', accountName:'น.ส.จันทร์ เพ็ชรดี',
      promptpayId:'0664312001', taxId:'3401234567891',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'จ-ศ 06:30–20:00 น. | ส 07:00–14:00 น.',
      description:'ร้านอาหารครบครัน มีทั้งอาหารตามสั่ง ข้าวราดแกง ก๋วยเตี๋ยว และเครื่องดื่มนานาชนิด',
      products:[
        { id:'p1-1', name:'ข้าวราดแกง', price:45, category:'main', available:true, img:'🍛' },
        { id:'p1-2', name:'ก๋วยเตี๋ยวหมู', price:40, category:'noodle', available:true, img:'🍜' },
        { id:'p1-3', name:'ข้าวมันไก่', price:50, category:'main', available:true, img:'🍗' },
        { id:'p1-4', name:'ผัดกะเพราไข่ดาว', price:55, category:'main', available:true, img:'🍳' },
        { id:'p1-5', name:'น้ำส้มคั้น', price:20, category:'drink', available:true, img:'🍊' },
        { id:'p1-6', name:'ชาเย็น', price:25, category:'drink', available:true, img:'🧋' },
        { id:'p1-7', name:'กาแฟเย็น', price:30, category:'drink', available:true, img:'☕' },
        { id:'p1-8', name:'ข้าวผัดกุ้ง', price:65, category:'main', available:false, img:'🍤' },
      ],
      registeredAt:'2024-01-15T08:00:00.000Z', createdAt:new Date().toISOString()
    },
    {
      id:'m2', code:'KKU-M002', name:'ร้านถ่ายเอกสารและเครื่องเขียน คณะวิทยาศาสตร์', nameEn:'Science Copy Center',
      category:'service', subCategory:'print', mdr:1.5, status:'active',
      contactName:'นายสมศักดิ์ ใจดี', contactPhone:'0431100002', contactEmail:'copy@kku.ac.th',
      address:'อาคาร SC.07 ชั้น 1 คณะวิทยาศาสตร์ มข.',
      location:'คณะวิทยาศาสตร์ ชั้น 1 ใกล้บันได',
      bankCode:'scb', bankAccount:'403-2-22222-2', bankName:'ธนาคารไทยพาณิชย์', accountName:'นายสมศักดิ์ ใจดี',
      promptpayId:'0664312002', taxId:'3401234567892',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'จ-ศ 07:30–18:00 น.',
      description:'บริการถ่ายเอกสาร พิมพ์งาน เข้าเล่ม ลามิเนต จำหน่ายอุปกรณ์การเรียน',
      products:[
        { id:'p2-1', name:'ถ่ายเอกสาร A4 (ขาว-ดำ)', price:1, category:'print', available:true, img:'📄' },
        { id:'p2-2', name:'ถ่ายเอกสาร A4 (สี)', price:5, category:'print', available:true, img:'🖨️' },
        { id:'p2-3', name:'พิมพ์งาน A4', price:3, category:'print', available:true, img:'🖨️' },
        { id:'p2-4', name:'เข้าเล่มสันกาว', price:30, category:'bind', available:true, img:'📚' },
        { id:'p2-5', name:'ลามิเนต A4', price:10, category:'laminate', available:true, img:'✨' },
        { id:'p2-6', name:'ปากกาลูกลื่น', price:8, category:'stationery', available:true, img:'🖊️' },
        { id:'p2-7', name:'สมุดบันทึก A5', price:35, category:'stationery', available:true, img:'📓' },
        { id:'p2-8', name:'แฟ้มใส A4', price:12, category:'stationery', available:true, img:'🗂️' },
      ],
      registeredAt:'2024-02-01T08:00:00.000Z', createdAt:new Date().toISOString()
    },
    {
      id:'m3', code:'KKU-M003', name:'สหกรณ์มหาวิทยาลัยขอนแก่น', nameEn:'KKU Cooperative Store',
      category:'store', subCategory:'convenience', mdr:1.0, status:'active',
      contactName:'นายประเสริฐ สมบัติ', contactPhone:'0431100003', contactEmail:'coop@kku.ac.th',
      address:'อาคารพุทธศิลป์ (ชั้น 1) มข.',
      location:'อาคารพุทธศิลป์ ชั้น 1',
      bankCode:'ktb', bankAccount:'981-2-33333-3', bankName:'ธนาคารกรุงไทย', accountName:'สหกรณ์ มข.',
      promptpayId:'0664312003', taxId:'0405555000001',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'จ-ศ 07:00–20:00 น. | ส-อ 08:00–17:00 น.',
      description:'ร้านสหกรณ์จำหน่ายสินค้าอุปโภคบริโภค อาหารสำเร็จรูป เครื่องดื่ม ราคาประหยัด',
      products:[
        { id:'p3-1', name:'น้ำดื่ม 600ml', price:7, category:'drink', available:true, img:'💧' },
        { id:'p3-2', name:'ขนมปังแผ่น', price:25, category:'food', available:true, img:'🍞' },
        { id:'p3-3', name:'มาม่าต้มยำ', price:8, category:'food', available:true, img:'🍜' },
        { id:'p3-4', name:'ไข่ไก่ (แผง 10 ฟอง)', price:40, category:'food', available:true, img:'🥚' },
        { id:'p3-5', name:'สบู่ก้อน', price:18, category:'personal', available:true, img:'🧼' },
        { id:'p3-6', name:'แชมพู 170ml', price:55, category:'personal', available:true, img:'🧴' },
        { id:'p3-7', name:'เนยถั่ว', price:120, category:'food', available:true, img:'🥜' },
        { id:'p3-8', name:'กาแฟ 3in1 (1ซอง)', price:6, category:'drink', available:true, img:'☕' },
      ],
      registeredAt:'2024-01-10T08:00:00.000Z', createdAt:new Date().toISOString()
    },
    {
      id:'m4', code:'KKU-M004', name:'คลินิกเวชกรรม มข. (ห้องยาและเวชภัณฑ์)', nameEn:'KKU Medical Clinic',
      category:'health', subCategory:'medical', mdr:0.0, status:'active',
      contactName:'ภญ.สุดา รักษ์สุข', contactPhone:'0431100004', contactEmail:'clinic@kku.ac.th',
      address:'อาคารบริการวิชาการ 1 ชั้น 1 มข.',
      location:'ด้านหน้าโรงพยาบาลศรีนครินทร์ มข.',
      bankCode:'bbl', bankAccount:'901-3-44444-4', bankName:'ธนาคารกรุงเทพ', accountName:'คลินิก มข.',
      promptpayId:'0664312004', taxId:'0405555000002',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'จ-ศ 08:00–17:00 น. (ปิดพักกลางวัน 12:00–13:00)',
      description:'ให้บริการตรวจรักษาโรคทั่วไป จำหน่ายยาและเวชภัณฑ์ บริการฉีดวัคซีน',
      products:[
        { id:'p4-1', name:'ค่าตรวจโรคทั่วไป', price:150, category:'service', available:true, img:'🏥' },
        { id:'p4-2', name:'ยาพาราเซตามอล (10เม็ด)', price:15, category:'medicine', available:true, img:'💊' },
        { id:'p4-3', name:'ยาแก้ไอ (ขวด)', price:45, category:'medicine', available:true, img:'💊' },
        { id:'p4-4', name:'ยาแก้ปวดท้อง', price:35, category:'medicine', available:true, img:'💊' },
        { id:'p4-5', name:'ผ้าพันแผล', price:20, category:'supply', available:true, img:'🩹' },
        { id:'p4-6', name:'แอลกอฮอล์เจล', price:25, category:'supply', available:true, img:'🧴' },
        { id:'p4-7', name:'วัคซีนไข้หวัดใหญ่', price:350, category:'vaccine', available:true, img:'💉' },
        { id:'p4-8', name:'ตรวจเลือดทั่วไป (CBC)', price:200, category:'lab', available:true, img:'🔬' },
      ],
      registeredAt:'2024-01-20T08:00:00.000Z', createdAt:new Date().toISOString()
    },
    {
      id:'m5', code:'KKU-M005', name:'ศูนย์กีฬามหาวิทยาลัยขอนแก่น', nameEn:'KKU Sports Center',
      category:'sport', subCategory:'facility', mdr:1.5, status:'active',
      contactName:'นายวิรัตน์ แข็งแรง', contactPhone:'0431100005', contactEmail:'sports@kku.ac.th',
      address:'ศูนย์กีฬา มข. ถ.มิตรภาพ ขอนแก่น',
      location:'ฝั่งตะวันตกของมหาวิทยาลัย ใกล้สนามกีฬา',
      bankCode:'ttb', bankAccount:'080-6-55555-5', bankName:'ธนาคารทีทีบี', accountName:'ศูนย์กีฬา มข.',
      promptpayId:'0664312005', taxId:'0405555000003',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'ทุกวัน 05:30–21:00 น.',
      description:'บริการสนามกีฬาครบวงจร ว่ายน้ำ ฟิตเนส แบดมินตัน บาสเกตบอล ฟุตบอล',
      products:[
        { id:'p5-1', name:'ว่ายน้ำ (ครั้ง)', price:30, category:'swimming', available:true, img:'🏊' },
        { id:'p5-2', name:'ฟิตเนส (ครั้ง)', price:40, category:'fitness', available:true, img:'💪' },
        { id:'p5-3', name:'สนามแบดมินตัน (1ชม.)', price:60, category:'badminton', available:true, img:'🏸' },
        { id:'p5-4', name:'สนามบาสเกตบอล (1ชม.)', price:50, category:'basketball', available:true, img:'🏀' },
        { id:'p5-5', name:'สนามฟุตซอล (1ชม.)', price:200, category:'football', available:true, img:'⚽' },
        { id:'p5-6', name:'สมาชิกรายเดือน', price:300, category:'membership', available:true, img:'🎫' },
        { id:'p5-7', name:'เช่าไม้แบดมินตัน', price:20, category:'equipment', available:true, img:'🏸' },
        { id:'p5-8', name:'ลู่วิ่งตีนยาง (ชม.)', price:20, category:'fitness', available:true, img:'🏃' },
      ],
      registeredAt:'2024-02-10T08:00:00.000Z', createdAt:new Date().toISOString()
    },
    {
      id:'m6', code:'KKU-M006', name:'ร้านหนังสือและสิ่งพิมพ์ มข. (KKU Bookstore)', nameEn:'KKU Bookstore',
      category:'education', subCategory:'bookstore', mdr:1.5, status:'active',
      contactName:'นางสุภาพ วิชาดี', contactPhone:'0431100006', contactEmail:'book@kku.ac.th',
      address:'อาคารศูนย์วิทยบริการ ชั้น 1 มข.',
      location:'ใกล้สำนักวิทยบริการ (ห้องสมุดกลาง)',
      bankCode:'gsb', bankAccount:'020-01-66666-6', bankName:'ธนาคารออมสิน', accountName:'ร้านหนังสือ มข.',
      promptpayId:'0664312006', taxId:'3401234567896',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'จ-ศ 08:30–17:30 น.',
      description:'จำหน่ายหนังสือเรียน ตำรา งานวิจัย เครื่องแบบนักศึกษา สินค้าที่ระลึก KKU',
      products:[
        { id:'p6-1', name:'หนังสือเรียนทั่วไป', price:250, category:'book', available:true, img:'📖' },
        { id:'p6-2', name:'ตำราวิทยาศาสตร์', price:380, category:'book', available:true, img:'🔬' },
        { id:'p6-3', name:'เสื้อโปโล KKU (ชาย)', price:290, category:'uniform', available:true, img:'👔' },
        { id:'p6-4', name:'เสื้อโปโล KKU (หญิง)', price:290, category:'uniform', available:true, img:'👗' },
        { id:'p6-5', name:'แก้ว KKU Tumbler', price:180, category:'souvenir', available:true, img:'☕' },
        { id:'p6-6', name:'กระเป๋า KKU', price:450, category:'souvenir', available:true, img:'🎒' },
        { id:'p6-7', name:'สมุด KKU', price:85, category:'stationery', available:true, img:'📓' },
        { id:'p6-8', name:'พวงกุญแจ KKU', price:59, category:'souvenir', available:true, img:'🔑' },
      ],
      registeredAt:'2024-03-01T08:00:00.000Z', createdAt:new Date().toISOString()
    },
    {
      id:'m7', code:'KKU-M007', name:'KKU Fashion Shop (ร้านเสื้อผ้านักศึกษา)', nameEn:'KKU Fashion Shop',
      category:'fashion', subCategory:'clothing', mdr:1.5, status:'active',
      contactName:'นางสาวปิยะนุช แต่งกาย', contactPhone:'0431100007', contactEmail:'shop@kku.ac.th',
      address:'หน้าอาคารหอพัก 6 มข.',
      location:'แนวหอพัก ด้านตะวันออก',
      bankCode:'kbank', bankAccount:'004-2-77777-7', bankName:'ธนาคารกสิกรไทย', accountName:'น.ส.ปิยะนุช แต่งกาย',
      promptpayId:'0664312007', taxId:'3401234567897',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'จ-ศ 10:00–20:00 น. | ส-อ 10:00–18:00 น.',
      description:'จำหน่ายเสื้อผ้านักศึกษา ชุดนักศึกษาสำหรับวิศวะ/วิทย์/พยาบาล ชุดลำลอง',
      products:[
        { id:'p7-1', name:'ชุดนักศึกษาวิศวะ (เสื้อ)', price:350, category:'uniform', available:true, img:'👔' },
        { id:'p7-2', name:'ชุดนักศึกษาวิศวะ (กางเกง)', price:300, category:'uniform', available:true, img:'👖' },
        { id:'p7-3', name:'ชุดพยาบาล (เสื้อ)', price:320, category:'uniform', available:true, img:'🩺' },
        { id:'p7-4', name:'เสื้อยืดลาย KKU', price:199, category:'casual', available:true, img:'👕' },
        { id:'p7-5', name:'กางเกงวอร์ม KKU', price:249, category:'sport', available:true, img:'🩳' },
        { id:'p7-6', name:'หมวก KKU', price:150, category:'accessory', available:true, img:'🧢' },
        { id:'p7-7', name:'รองเท้านักศึกษาหญิง', price:850, category:'shoes', available:false, img:'👞' },
        { id:'p7-8', name:'เข็มขัดหนัง', price:180, category:'accessory', available:true, img:'👗' },
      ],
      registeredAt:'2024-03-15T08:00:00.000Z', createdAt:new Date().toISOString()
    },
    {
      id:'m8', code:'KKU-M008', name:'Kaffee Corner (ร้านกาแฟและเบเกอรี่)', nameEn:'Kaffee Corner',
      category:'cafe', subCategory:'beverage', mdr:1.5, status:'active',
      contactName:'นางสาวพิม กลิ่นหอม', contactPhone:'0431100008', contactEmail:'kaffee@kku.ac.th',
      address:'อาคารวิทยาลัยบัณฑิตศึกษาการจัดการ (MBA) ชั้น 1 มข.',
      location:'หน้าอาคาร MBA ด้านทิศใต้',
      bankCode:'scb', bankAccount:'403-2-88888-8', bankName:'ธนาคารไทยพาณิชย์', accountName:'น.ส.พิม กลิ่นหอม',
      promptpayId:'0664312008', taxId:'3401234567898',
      settleBalance:0, totalSales:0, pendingSettle:0,
      businessHours:'จ-ศ 06:30–19:00 น. | ส 07:30–15:00 น.',
      description:'กาแฟสด เครื่องดื่ม เบเกอรี่สด ของว่างนานาชนิด Wi-Fi ฟรีสำหรับนักศึกษา',
      products:[
        { id:'p8-1', name:'Espresso (Single)', price:40, category:'coffee', available:true, img:'☕' },
        { id:'p8-2', name:'Americano', price:45, category:'coffee', available:true, img:'☕' },
        { id:'p8-3', name:'Latte', price:65, category:'coffee', available:true, img:'🥛' },
        { id:'p8-4', name:'Cappuccino', price:65, category:'coffee', available:true, img:'☕' },
        { id:'p8-5', name:'ชาเขียว Matcha Latte', price:70, category:'tea', available:true, img:'🍵' },
        { id:'p8-6', name:'Croissant', price:55, category:'bakery', available:true, img:'🥐' },
        { id:'p8-7', name:'Chocolate Cake', price:75, category:'bakery', available:true, img:'🎂' },
        { id:'p8-8', name:'Smoothie ผลไม้รวม', price:80, category:'smoothie', available:true, img:'🥤' },
      ],
      registeredAt:'2024-04-01T08:00:00.000Z', createdAt:new Date().toISOString()
    },
  ];
  merchants.forEach(m => {
    const sales = Math.floor(Math.random()*50000)+5000;
    m.totalSales = sales;
    m.settleBalance = Math.floor(sales * (1 - m.mdr/100));
    m.pendingSettle = Math.floor(m.settleBalance * 0.15);
    dbInsert('merchants', m);
  });

  // ── Fee Items ──
  const fees = [
    { id:'f1',  userId:'u1', code:'TU-2567-1', type:'tuition',  label:'ค่าเล่าเรียน ภาคต้น 2567',          amount:22500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะวิศวกรรมศาสตร์' },
    { id:'f2',  userId:'u1', code:'DO-2567-1', type:'dormitory',label:'ค่าหอพัก ภาคต้น 2567',              amount:2800,  due:'2567-08-15', status:'pending',  semester:'1/2567', note:'หอพัก 11 ชั้น 3 ห้อง 312' },
    { id:'f3',  userId:'u1', code:'HE-2567-1', type:'health',   label:'ค่าประกันสุขภาพนักศึกษา 2567',      amount:1650,  due:'2567-09-30', status:'paid',     semester:'1/2567', paidAt:'2024-08-01T10:00:00.000Z' },
    { id:'f4',  userId:'u2', code:'TU-2567-2', type:'tuition',  label:'ค่าเล่าเรียน ภาคต้น 2567',          amount:18500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะวิทยาศาสตร์' },
    { id:'f5',  userId:'u2', code:'AC-2567-1', type:'activity', label:'ค่ากิจกรรมนักศึกษา 2567',           amount:450,   due:'2567-09-30', status:'pending',  semester:'1/2567', note:'' },
    { id:'f6',  userId:'u2', code:'SP-2567-1', type:'sport',    label:'ค่าสิ่งอำนวยความสะดวกกีฬา 2567',   amount:300,   due:'2567-09-30', status:'pending',  semester:'1/2567', note:'' },
    { id:'f7',  userId:'u3', code:'TU-2567-3', type:'tuition',  label:'ค่าเล่าเรียน ภาคต้น 2567',          amount:38500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะแพทยศาสตร์' },
    { id:'f8',  userId:'u3', code:'FI-2567-1', type:'fine',     label:'ค่าปรับคืนหนังสือเกินกำหนด',        amount:120,   due:'2567-08-31', status:'overdue',  semester:'1/2567', note:'ห้องสมุดกลาง KKU' },
    { id:'f9',  userId:'u4', code:'TU-2567-4', type:'tuition',  label:'ค่าเล่าเรียน ภาคต้น 2567',          amount:19500, due:'2567-09-30', status:'pending',  semester:'1/2567', note:'คณะพยาบาลศาสตร์' },
    { id:'f10', userId:'u4', code:'IN-2567-1', type:'internet', label:'ค่าอินเทอร์เน็ตหอพัก ภาคต้น 2567', amount:220,   due:'2567-08-31', status:'pending',  semester:'1/2567', note:'' },
    { id:'f11', userId:'u4', code:'PK-2567-1', type:'parking',  label:'ค่าสติกเกอร์จอดรถ 2567',           amount:800,   due:'2567-09-15', status:'overdue',  semester:'1/2567', note:'รถจักรยานยนต์' },
  ];
  fees.forEach(f => dbInsert('feeItems', { ...f, createdAt:new Date().toISOString() }));

  // ── Historical payments ──
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

  // ── Sample POS orders ──
  const sampleOrders = [
    { merchantId:'m1', userId:'u1', items:[{productId:'p1-1',name:'ข้าวราดแกง',price:45,qty:1},{productId:'p1-5',name:'น้ำส้มคั้น',price:20,qty:2}], total:85, method:'wallet', createdAt:'2024-08-10T11:30:00.000Z' },
    { merchantId:'m8', userId:'u2', items:[{productId:'p8-3',name:'Latte',price:65,qty:1},{productId:'p8-6',name:'Croissant',price:55,qty:1}], total:120, method:'wallet', createdAt:'2024-08-11T09:00:00.000Z' },
    { merchantId:'m3', userId:'u3', items:[{productId:'p3-1',name:'น้ำดื่ม 600ml',price:7,qty:3},{productId:'p3-3',name:'มาม่าต้มยำ',price:8,qty:2}], total:37, method:'wallet', createdAt:'2024-08-12T15:00:00.000Z' },
  ];
  sampleOrders.forEach(o => {
    const ref = 'POS-'+Date.now()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
    const order = dbInsert('posOrders', { id:uuidv4(), ...o, ref, status:'paid', paidAt:o.createdAt });
    dbInsert('merchantTxns', { id:uuidv4(), merchantId:o.merchantId, orderId:order.id, type:'sale', amount:o.total, mdr:(o.total * (dbFind('merchants',m=>m.id===o.merchantId)?.mdr||1.5)/100), net:o.total*(1-(dbFind('merchants',m=>m.id===o.merchantId)?.mdr||1.5)/100), ref, createdAt:o.createdAt });
  });

  // ── Notifications ──
  dbInsert('notifications', { id:uuidv4(), userId:null, type:'broadcast', title:'ระบบ KKU Pay เปิดให้บริการแล้ว!', message:'เปิดให้ชำระค่าเล่าเรียน ภาคต้น 2567 ได้ตั้งแต่วันนี้ ถึง 30 กันยายน 2567', read:false, createdAt:new Date().toISOString() });
  dbInsert('notifications', { id:uuidv4(), userId:'u1', type:'personal', title:'แจ้งเตือน: ครบกำหนดชำระค่าหอพัก', message:'ค่าหอพัก ภาคต้น 2567 ฿2,800 ครบกำหนด 15 ส.ค. 2567', read:false, createdAt:new Date().toISOString() });
}
seedDB();

// ─── CHAT BOT ─────────────────────────────────────────────────────────────────
function getBotReply(msg) {
  const m = msg.toLowerCase();
  if (/(ค่าเล่าเรียน|ค่าธรรมเนียม|ค่าเทอม|tuition)/.test(m)) return 'ค่าเล่าเรียนขึ้นอยู่กับคณะ เช่น วิศวกรรมฯ ฿22,500 | แพทยศาสตร์ ฿38,500 | พยาบาล ฿19,500 ดูรายการที่เมนู "รายการค่าธรรมเนียม" หรือโทร 043-009-700 ต่อ 42132';
  if (/(ลืมรหัส|เปลี่ยนรหัส|password)/.test(m)) return 'หากลืมรหัสผ่าน ติดต่อกองทะเบียน มข. โทร 043-009-700 ต่อ 42111';
  if (/(promptpay|พร้อมเพย์|qr)/.test(m)) return 'ชำระผ่าน PromptPay QR:\n1) เลือกรายการ → 2) เลือก PromptPay → 3) สแกน QR → 4) ยืนยัน\nรองรับทุกธนาคาร ฟรีค่าธรรมเนียม';
  if (/(wallet|กระเป๋า|เติมเงิน)/.test(m)) return 'KKU Wallet ใช้ชำระทั้งค่าธรรมเนียมมหาวิทยาลัยและร้านค้าพันธมิตรในมข. เติมขั้นต่ำ ฿20 สูงสุด ฿50,000';
  if (/(ร้านค้า|merchant|สั่งอาหาร|ซื้อ|shop)/.test(m)) return 'สามารถใช้ KKU Wallet ซื้อสินค้า/อาหารที่ร้านค้าพันธมิตรในมหาวิทยาลัยได้เลย เช่น ร้านอาหาร คาเฟ่ สหกรณ์ คลินิก ไม่มีค่าธรรมเนียมเพิ่ม!';
  if (/(โอนเงิน|internet banking|ธนาคาร)/.test(m)) return 'ชำระผ่าน Internet Banking:\n1) เลือกธนาคาร (KBank/SCB/KTB/BBL/TTB/GSB/BAAC)\n2) โอนพร้อม Ref1+Ref2\n3) ระบบยืนยัน 1-2 ชม.';
  if (/(ใบเสร็จ|receipt)/.test(m)) return 'ดาวน์โหลดใบเสร็จ PDF ที่เมนู "ประวัติธุรกรรม" → คลิกรายการ → "ดาวน์โหลดใบเสร็จ"';
  if (/(ewallet|truemoney|rabbit|shopee)/.test(m)) return 'รองรับ TrueMoney Wallet, Rabbit LINE Pay, ShopeePay — สแกน QR ได้เลย';
  if (/(เคาน์เตอร์|counter|7-eleven|โลตัส)/.test(m)) return 'ชำระที่ 7-Eleven, Big C, Lotus\'s ทั่วประเทศ ค่าธรรมเนียม 10 บาท/รายการ';
  if (/(ติดต่อ|โทร|เบอร์|contact)/.test(m)) return '📞 กองคลัง มข.: 043-009-700 ต่อ 42132\n📧 finance@kku.ac.th\n🕐 จ-ศ 08:30-16:30 น.';
  if (/(ขอบคุณ|thank|โอเค)/.test(m)) return 'ยินดีให้บริการ 😊 มีอะไรเพิ่มเติมถามได้เลย!';
  return 'ไม่เข้าใจคำถาม ลองถามเกี่ยวกับ:\n• ค่าเล่าเรียน / KKU Wallet\n• PromptPay / โอนธนาคาร / บัตร\n• ร้านค้าพันธมิตร / ใบเสร็จ\nหรือโทร 043-009-700 ต่อ 42132';
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error:'Unauthorized' });
  try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error:'Invalid token' }); }
}
function requireRole(...roles) {
  return (req,res,next) => { if (!roles.includes(req.user.role)) return res.status(403).json({ error:'Forbidden' }); next(); };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req,res) => {
  const { username, password } = req.body;
  const user = dbFind('users', u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  const token = jwt.sign({ id:user.id, role:user.role, name:user.name, studentId:user.studentId, merchantId:user.merchantId }, JWT_SECRET, { expiresIn:'8h' });
  addAudit(user.id, 'LOGIN', `${user.name} เข้าสู่ระบบ`, req.ip);
  const { password:_, ...safe } = user;
  res.json({ token, user:safe });
});

app.get('/api/auth/me', authenticate, (req,res) => {
  const user = dbFind('users', u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error:'User not found' });
  const { password:_, ...safe } = user;
  const wallet = dbFind('wallets', w => w.userId === user.id);
  const unread = dbFilter('notifications', n => !n.read && (n.userId===user.id||n.userId===null)).length;
  const merchant = user.merchantId ? dbFind('merchants', m => m.id === user.merchantId) : null;
  res.json({ user:safe, wallet, unreadNotifications:unread, merchant });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FEES
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/fees', authenticate, (req,res) => {
  const fees = dbFilter('feeItems', f => f.userId === req.user.id);
  res.json({ fees });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PAYMENTS (Student)
// ═══════════════════════════════════════════════════════════════════════════════
function makeOrderId() { return 'KKU-'+Date.now()+'-'+Math.random().toString(36).slice(2,6).toUpperCase(); }

app.post('/api/payments/promptpay', authenticate, async (req,res) => {
  try {
    const { feeId, amount } = req.body;
    if (!amount||amount<=0) return res.status(400).json({ error:'ระบุจำนวนเงินไม่ถูกต้อง' });
    const orderId = makeOrderId();
    const qrData = `PROMPTPAY:0043600097001:${parseFloat(amount).toFixed(2)}:${orderId}`;
    const qrImg = await QRCode.toDataURL(qrData, { width:300, margin:2, color:{ dark:'#4a0072', light:'#ffffff' } });
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'promptpay', amount:parseFloat(amount), status:'pending', ref:orderId, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f=>f.id===feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `PromptPay ฿${amount} Ref:${orderId}`, req.ip);
    setTimeout(() => { dbUpdate('payments',p=>p.id===payment.id,{status:'success',paidAt:new Date().toISOString()}); if(feeId) dbUpdate('feeItems',f=>f.id===feeId,{status:'paid',paidAt:new Date().toISOString()}); addAudit(req.user.id,'PAYMENT_SUCCESS',`PromptPay ฿${amount} สำเร็จ`,req.ip); }, 8000);
    res.json({ success:true, orderId, qrImage:qrImg, amount:parseFloat(amount), promptpayId:'0043600097001', expiresAt:new Date(Date.now()+15*60*1000).toISOString(), instruction:'สแกน QR Code ด้วยแอปธนาคารใดก็ได้ ชำระได้ภายใน 15 นาที ไม่มีค่าธรรมเนียม' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/payments/card', authenticate, async (req,res) => {
  try {
    const { feeId, amount, cardNumber, cardName } = req.body;
    if (!amount||amount<=0) return res.status(400).json({ error:'ระบุจำนวนเงินไม่ถูกต้อง' });
    const orderId = makeOrderId(); const last4 = (cardNumber||'').replace(/\s/g,'').slice(-4)||'0000';
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'card', amount:parseFloat(amount), status:'success', ref:orderId, cardLast4:last4, createdAt:new Date().toISOString(), paidAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f=>f.id===feeId, { status:'paid', paidAt:new Date().toISOString() });
    addAudit(req.user.id, 'PAYMENT_SUCCESS', `บัตร *${last4} ฿${amount} สำเร็จ`, req.ip);
    res.json({ success:true, orderId, amount:parseFloat(amount), cardLast4:last4, message:'ชำระเงินสำเร็จ' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/payments/wallet', authenticate, async (req,res) => {
  try {
    const { feeId, amount } = req.body;
    const wallet = dbFind('wallets', w=>w.userId===req.user.id);
    if (!wallet) return res.status(404).json({ error:'ไม่พบกระเป๋าเงิน' });
    if (wallet.balance < parseFloat(amount)) return res.status(400).json({ error:`ยอดเงินไม่เพียงพอ (คงเหลือ ฿${wallet.balance.toFixed(2)})` });
    const orderId = makeOrderId();
    dbUpdate('wallets', w=>w.userId===req.user.id, { balance:wallet.balance-parseFloat(amount), updatedAt:new Date().toISOString() });
    dbInsert('walletTxns', { id:uuidv4(), userId:req.user.id, type:'debit', amount:parseFloat(amount), ref:orderId, desc:'ชำระค่าธรรมเนียม', createdAt:new Date().toISOString() });
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'wallet', amount:parseFloat(amount), status:'success', ref:orderId, createdAt:new Date().toISOString(), paidAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f=>f.id===feeId, { status:'paid', paidAt:new Date().toISOString() });
    const newW = dbFind('wallets', w=>w.userId===req.user.id);
    addAudit(req.user.id, 'PAYMENT_SUCCESS', `KKU Wallet ฿${amount} สำเร็จ`, req.ip);
    res.json({ success:true, orderId, amount:parseFloat(amount), newBalance:newW.balance });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/payments/banking', authenticate, async (req,res) => {
  try {
    const { feeId, amount, bankCode } = req.body;
    const bank = THAI_BANKS[bankCode];
    if (!bank) return res.status(400).json({ error:'ไม่พบข้อมูลธนาคาร' });
    const orderId = makeOrderId(); const ref2 = Math.floor(100000+Math.random()*900000).toString();
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'banking', amount:parseFloat(amount), status:'pending', ref:orderId, bankCode, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f=>f.id===feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `Internet Banking ${bank.short} ฿${amount} Ref:${orderId}`, req.ip);
    res.json({ success:true, paymentId:payment.id, orderId, amount:parseFloat(amount), bankName:bank.name, bankShort:bank.short, accountNumber:bank.account, accountName:bank.acct_name, color:bank.color, textColor:bank.textColor, ref1:orderId, ref2, expiresAt:new Date(Date.now()+24*60*60*1000).toISOString(), steps:[`เปิดแอป ${bank.short} หรือ Internet Banking`,`เลือก "โอนเงิน" → กรอกเลขบัญชี ${bank.account}`,`ชื่อบัญชี: ${bank.acct_name}`,`จำนวน: ฿${parseFloat(amount).toFixed(2)}`,`ระบุ Ref1: ${orderId} ในช่องหมายเหตุ`,`ระบุ Ref2: ${ref2} ในช่องหมายเหตุ 2`,'กดยืนยัน แล้วแนบสลิปในหน้านี้ทันทีเพื่อยืนยันอัตโนมัติ'], instruction:'แนบสลิปด้านล่างเพื่อให้ระบบยืนยันทันที หรือรอ Admin ตรวจสอบภายใน 1-2 ชม.' });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/payments/ewallet', authenticate, async (req,res) => {
  try {
    const { feeId, amount, provider } = req.body;
    const provs = { truemoney:{ name:'TrueMoney Wallet',color:'#ff6600',bg:'#fff3eb',icon:'🟠' }, rabbit:{ name:'Rabbit LINE Pay',color:'#00c300',bg:'#ebffeb',icon:'🟢' }, shopee:{ name:'ShopeePay',color:'#ee4d2d',bg:'#ffedea',icon:'🔴' } };
    const prov = provs[provider]; if (!prov) return res.status(400).json({ error:'ไม่พบ e-Wallet' });
    const orderId = makeOrderId(); const qrImg = await QRCode.toDataURL(`EWALLET:${provider}:${orderId}:${amount}`,{ width:280,margin:2 });
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'ewallet', amount:parseFloat(amount), status:'pending', ref:orderId, provider, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f=>f.id===feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `${prov.name} ฿${amount} Ref:${orderId}`, req.ip);
    setTimeout(() => { dbUpdate('payments',p=>p.id===payment.id,{status:'success',paidAt:new Date().toISOString()}); if(feeId) dbUpdate('feeItems',f=>f.id===feeId,{status:'paid',paidAt:new Date().toISOString()}); }, 10000);
    res.json({ success:true, orderId, amount:parseFloat(amount), provider:prov.name, color:prov.color, bg:prov.bg, icon:prov.icon, qrImage:qrImg, expiresAt:new Date(Date.now()+10*60*1000).toISOString(), instruction:`เปิดแอป ${prov.name} แตะ "สแกน" แล้วสแกน QR Code` });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post('/api/payments/counter', authenticate, async (req,res) => {
  try {
    const { feeId, amount } = req.body;
    const serviceFee = 10; const total = parseFloat(amount)+serviceFee;
    const orderId = makeOrderId(); const barcode = '9900'+Date.now().toString().slice(-10)+Math.floor(Math.random()*100).toString().padStart(2,'0');
    const payment = dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId, method:'counter', amount:total, status:'pending', ref:orderId, barcode, createdAt:new Date().toISOString() });
    if (feeId) dbUpdate('feeItems', f=>f.id===feeId, { status:'processing' });
    addAudit(req.user.id, 'PAYMENT_INIT', `Counter Service ฿${total} Ref:${orderId}`, req.ip);
    res.json({ success:true, orderId, amount:parseFloat(amount), serviceFee, total, barcode, expiresAt:new Date(Date.now()+3*24*60*60*1000).toISOString(), locations:['7-Eleven (ทุกสาขา)','Big C Extra / Market','Lotus\'s (เทสโก้)','Boonterm Kiosk','CRG Pay Station','ธนาคารกรุงไทย (เคาน์เตอร์)'], instruction:`นำบาร์โค้ดไปชำระที่จุดบริการ ค่าธรรมเนียม ${serviceFee} บาท ชำระได้ใน 3 วัน` });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  WALLET
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/wallet', authenticate, (req,res) => {
  const wallet = dbFind('wallets', w=>w.userId===req.user.id);
  const txns = dbFilter('walletTxns', t=>t.userId===req.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ wallet, transactions:txns });
});

app.post('/api/wallet/topup', authenticate, async (req,res) => {
  try {
    const { amount, method } = req.body;
    if (!amount||parseFloat(amount)<20) return res.status(400).json({ error:'ยอดเติมขั้นต่ำ 20 บาท' });
    if (parseFloat(amount)>50000) return res.status(400).json({ error:'ยอดเติมสูงสุด 50,000 บาท' });
    const wallet = dbFind('wallets', w=>w.userId===req.user.id);
    const orderId = makeOrderId();
    dbUpdate('wallets', w=>w.userId===req.user.id, { balance:wallet.balance+parseFloat(amount), updatedAt:new Date().toISOString() });
    dbInsert('walletTxns', { id:uuidv4(), userId:req.user.id, type:'credit', amount:parseFloat(amount), method, ref:orderId, desc:'เติมเงิน KKU Wallet', createdAt:new Date().toISOString() });
    dbInsert('payments', { id:uuidv4(), userId:req.user.id, feeId:null, method:'wallet_topup', amount:parseFloat(amount), status:'success', ref:orderId, createdAt:new Date().toISOString(), paidAt:new Date().toISOString() });
    const newW = dbFind('wallets', w=>w.userId===req.user.id);
    addAudit(req.user.id, 'WALLET_TOPUP', `เติมเงิน ฿${amount} (${method})`, req.ip);
    res.json({ success:true, orderId, amount:parseFloat(amount), newBalance:newW.balance });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  POS — Merchant payment from customer wallet
// ═══════════════════════════════════════════════════════════════════════════════
// GET merchant list + products for student shopping
app.get('/api/merchants', authenticate, (req,res) => {
  const list = db.merchants.filter(m=>m.status==='active').map(m=>({
    id:m.id, code:m.code, name:m.name, nameEn:m.nameEn, category:m.category,
    subCategory:m.subCategory, description:m.description, address:m.address,
    location:m.location, businessHours:m.businessHours, contactPhone:m.contactPhone,
    promptpayId:m.promptpayId, products:m.products, mdr:m.mdr
  }));
  res.json({ merchants:list });
});

app.get('/api/merchants/:id', authenticate, (req,res) => {
  const m = dbFind('merchants', m=>m.id===req.params.id);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });
  const { settleBalance:_, totalSales:__, bankAccount:___, ...pub } = m;
  res.json({ merchant:pub });
});

// POS checkout — customer pays from KKU Wallet to merchant
app.post('/api/pos/checkout', authenticate, async (req,res) => {
  try {
    const { merchantId, items, method } = req.body;
    if (!items||!items.length) return res.status(400).json({ error:'ไม่มีรายการสินค้า' });
    const merchant = dbFind('merchants', m=>m.id===merchantId);
    if (!merchant||merchant.status!=='active') return res.status(404).json({ error:'ไม่พบร้านค้า' });
    // Validate items & compute total
    let total = 0; const validated = [];
    for (const item of items) {
      const prod = (merchant.products||[]).find(p=>p.id===item.productId);
      if (!prod) return res.status(400).json({ error:`ไม่พบสินค้า ${item.productId}` });
      if (!prod.available) return res.status(400).json({ error:`สินค้า "${prod.name}" หมดแล้ว` });
      const qty = parseInt(item.qty)||1;
      validated.push({ productId:prod.id, name:prod.name, price:prod.price, qty, subtotal:prod.price*qty });
      total += prod.price * qty;
    }
    if (method === 'wallet') {
      const wallet = dbFind('wallets', w=>w.userId===req.user.id);
      if (!wallet||wallet.balance<total) return res.status(400).json({ error:`ยอดเงินไม่เพียงพอ (คงเหลือ ฿${(wallet?.balance||0).toFixed(2)}, ต้องการ ฿${total.toFixed(2)})` });
      dbUpdate('wallets', w=>w.userId===req.user.id, { balance:wallet.balance-total, updatedAt:new Date().toISOString() });
    }
    const ref = 'POS-'+Date.now()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
    const mdrAmt = total*(merchant.mdr/100); const netAmt = total - mdrAmt;
    const order = dbInsert('posOrders', { id:uuidv4(), merchantId, userId:req.user.id, ref, items:validated, total, method, status:'paid', paidAt:new Date().toISOString(), createdAt:new Date().toISOString() });
    // Merchant transaction log
    dbInsert('merchantTxns', { id:uuidv4(), merchantId, orderId:order.id, type:'sale', amount:total, mdr:mdrAmt, net:netAmt, ref, createdAt:new Date().toISOString() });
    // Update merchant settle balance
    dbUpdate('merchants', m=>m.id===merchantId, { totalSales:(merchant.totalSales||0)+total, settleBalance:(merchant.settleBalance||0)+netAmt, pendingSettle:(merchant.pendingSettle||0)+netAmt });
    // Wallet txn record
    if (method==='wallet') dbInsert('walletTxns', { id:uuidv4(), userId:req.user.id, type:'debit', amount:total, ref, desc:`ซื้อสินค้า ${merchant.name}`, merchantId, createdAt:new Date().toISOString() });
    addAudit(req.user.id, 'POS_PAYMENT', `ซื้อสินค้า ${merchant.name} ฿${total} Ref:${ref}`, req.ip);
    const newW = dbFind('wallets', w=>w.userId===req.user.id);
    res.json({ success:true, orderId:order.id, ref, total, merchantName:merchant.name, items:validated, method, newBalance:newW?.balance, paidAt:order.paidAt });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// Student order history
app.get('/api/pos/orders', authenticate, (req,res) => {
  const orders = dbFilter('posOrders', o=>o.userId===req.user.id).map(o=>{
    const m = dbFind('merchants', m=>m.id===o.merchantId);
    return { ...o, merchantName:m?.name };
  }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ orders });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MERCHANT PORTAL ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
const isMerchant = [authenticate, requireRole('merchant')];

// Merchant dashboard stats
app.get('/api/merchant/stats', isMerchant, (req,res) => {
  const merchantId = req.user.merchantId;
  const merchant = dbFind('merchants', m=>m.id===merchantId);
  if (!merchant) return res.status(404).json({ error:'ไม่พบข้อมูลร้านค้า' });
  const txns = dbFilter('merchantTxns', t=>t.merchantId===merchantId);
  const today = new Date().toISOString().slice(0,10);
  const todayTxns = txns.filter(t=>t.createdAt.startsWith(today));
  const days = [];
  for (let i=6;i>=0;i--) { const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10); const dt=txns.filter(t=>t.createdAt.startsWith(k)); days.push({ date:k, sales:dt.reduce((s,t)=>s+t.amount,0), count:dt.length }); }
  // Product sales count
  const orders = dbFilter('posOrders', o=>o.merchantId===merchantId&&o.status==='paid');
  const productSales = {};
  orders.forEach(o=>o.items.forEach(item=>{ productSales[item.name]=(productSales[item.name]||0)+item.qty; }));
  res.json({
    merchantId, merchantName:merchant.name, code:merchant.code,
    totalSales:merchant.totalSales||0, settleBalance:merchant.settleBalance||0,
    pendingSettle:merchant.pendingSettle||0, mdr:merchant.mdr,
    todaySales:todayTxns.reduce((s,t)=>s+t.amount,0), todayCount:todayTxns.length,
    totalOrders:orders.length, chartData:days, productSales,
    bankCode:merchant.bankCode, bankAccount:merchant.bankAccount, bankName:merchant.bankName, accountName:merchant.accountName
  });
});

// Merchant transaction history
app.get('/api/merchant/transactions', isMerchant, (req,res) => {
  const txns = dbFilter('merchantTxns', t=>t.merchantId===req.user.merchantId)
    .map(t=>{ const o=dbFind('posOrders',o=>o.id===t.orderId); const u=o?dbFind('users',u=>u.id===o.userId):null; return {...t, customerName:u?.name, studentId:u?.studentId, items:o?.items, orderRef:o?.ref}; })
    .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ transactions:txns });
});

// Merchant orders
app.get('/api/merchant/orders', isMerchant, (req,res) => {
  const orders = dbFilter('posOrders', o=>o.merchantId===req.user.merchantId)
    .map(o=>{ const u=dbFind('users',u=>u.id===o.userId); return { ...o, customerName:u?.name, studentId:u?.studentId }; })
    .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ orders });
});

// Product management
app.get('/api/merchant/products', isMerchant, (req,res) => {
  const m = dbFind('merchants', m=>m.id===req.user.merchantId);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });
  res.json({ products:m.products||[] });
});

app.post('/api/merchant/products', isMerchant, (req,res) => {
  const m = dbFind('merchants', mm=>mm.id===req.user.merchantId);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });
  const prod = { id:'p'+Date.now(), ...req.body, available:true };
  const products = [...(m.products||[]), prod];
  dbUpdate('merchants', mm=>mm.id===m.id, { products });
  addAudit(req.user.id, 'PRODUCT_CREATE', `เพิ่มสินค้า "${prod.name}" ฿${prod.price}`, req.ip);
  res.json({ success:true, product:prod });
});

app.put('/api/merchant/products/:productId', isMerchant, (req,res) => {
  const m = dbFind('merchants', mm=>mm.id===req.user.merchantId);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });
  const products = (m.products||[]).map(p => p.id===req.params.productId ? {...p,...req.body} : p);
  dbUpdate('merchants', mm=>mm.id===m.id, { products });
  addAudit(req.user.id, 'PRODUCT_UPDATE', `อัพเดทสินค้า ${req.params.productId}`, req.ip);
  res.json({ success:true });
});

app.delete('/api/merchant/products/:productId', isMerchant, (req,res) => {
  const m = dbFind('merchants', mm=>mm.id===req.user.merchantId);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });
  const products = (m.products||[]).filter(p=>p.id!==req.params.productId);
  dbUpdate('merchants', mm=>mm.id===m.id, { products });
  addAudit(req.user.id, 'PRODUCT_DELETE', `ลบสินค้า ${req.params.productId}`, req.ip);
  res.json({ success:true });
});

// Merchant withdrawal request
app.post('/api/merchant/withdraw', isMerchant, (req,res) => {
  const { amount } = req.body;
  const m = dbFind('merchants', mm=>mm.id===req.user.merchantId);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });
  if (parseFloat(amount) > (m.settleBalance||0)) return res.status(400).json({ error:`ยอดเงินไม่เพียงพอ (คงเหลือ ฿${(m.settleBalance||0).toFixed(2)})` });
  const ref = 'WD-'+Date.now()+'-'+Math.random().toString(36).slice(2,6).toUpperCase();
  const wd = dbInsert('merchantWithdrawals', { id:uuidv4(), merchantId:m.id, amount:parseFloat(amount), bankCode:m.bankCode, bankAccount:m.bankAccount, bankName:m.bankName, accountName:m.accountName, ref, status:'pending', requestedAt:new Date().toISOString(), createdAt:new Date().toISOString() });
  dbUpdate('merchants', mm=>mm.id===m.id, { settleBalance:(m.settleBalance||0)-parseFloat(amount), pendingSettle:Math.max(0,(m.pendingSettle||0)-parseFloat(amount)) });
  addAudit(req.user.id, 'WITHDRAWAL_REQUEST', `ขอถอนเงิน ฿${amount} → ${m.bankName}`, req.ip);
  res.json({ success:true, withdrawal:wd });
});

app.get('/api/merchant/withdrawals', isMerchant, (req,res) => {
  const wds = dbFilter('merchantWithdrawals', w=>w.merchantId===req.user.merchantId).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ withdrawals:wds });
});

// Merchant QR for static display (customers scan to pay)
app.get('/api/merchant/qr', isMerchant, async (req,res) => {
  const m = dbFind('merchants', mm=>mm.id===req.user.merchantId);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });
  const qrData = `KKUPAY:MERCHANT:${m.id}:${m.code}:${m.promptpayId}`;
  const qrImg = await QRCode.toDataURL(qrData, { width:300, margin:2, color:{ dark:'#4a0072', light:'#ffffff' } });
  res.json({ qrImage:qrImg, merchantId:m.id, code:m.code, promptpayId:m.promptpayId });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  QR PAYMENT SYSTEM (Merchant → Student Wallet)
// ═══════════════════════════════════════════════════════════════════════════════

// Merchant สร้าง QR session สำหรับรับเงิน
app.post('/api/qr/generate', isMerchant, async (req,res) => {
  const { amount, note } = req.body;
  if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
    return res.status(400).json({ error:'กรุณาระบุจำนวนเงินที่ถูกต้อง' });
  const m = dbFind('merchants', mm=>mm.id===req.user.merchantId);
  if (!m) return res.status(404).json({ error:'ไม่พบร้านค้า' });

  const ref = 'QR-' + Date.now() + '-' + Math.random().toString(36).slice(2,7).toUpperCase();
  const payload = JSON.stringify({
    type: 'KKUPAY_QR',
    merchantId: m.id,
    merchantName: m.name,
    amount: parseFloat(amount),
    ref,
    note: note || '',
    exp: Date.now() + 5 * 60 * 1000   // หมดอายุใน 5 นาที
  });

  // เก็บ QR session ใน db
  if (!db.qrSessions) db.qrSessions = [];
  db.qrSessions.push({
    ref,
    merchantId: m.id,
    merchantName: m.name,
    amount: parseFloat(amount),
    note: note || '',
    status: 'pending',   // pending | paid | expired
    payerId: null,
    payerName: null,
    createdAt: new Date().toISOString(),
    exp: Date.now() + 5 * 60 * 1000
  });

  const qrImg = await QRCode.toDataURL(payload, {
    width: 320, margin: 2,
    color: { dark: '#4a0072', light: '#ffffff' }
  });

  res.json({ success:true, ref, qrImage:qrImg, amount:parseFloat(amount), merchantName:m.name, expiresIn:300 });
});

// Student สแกน QR → ดูรายละเอียดก่อนจ่าย
app.post('/api/qr/info', authenticate, (req,res) => {
  const { ref } = req.body;
  if (!db.qrSessions) return res.status(404).json({ error:'ไม่พบ QR นี้' });
  const session = db.qrSessions.find(s=>s.ref===ref);
  if (!session) return res.status(404).json({ error:'ไม่พบ QR นี้' });
  if (session.status === 'paid') return res.status(400).json({ error:'QR นี้ถูกใช้ไปแล้ว' });
  if (Date.now() > session.exp) {
    session.status = 'expired';
    return res.status(400).json({ error:'QR หมดอายุแล้ว กรุณาขอใหม่จากร้านค้า' });
  }
  res.json({ ref:session.ref, merchantName:session.merchantName, amount:session.amount, note:session.note });
});

// Student ยืนยันจ่ายเงิน
app.post('/api/qr/pay', authenticate, (req,res) => {
  const { ref } = req.body;
  if (req.user.role !== 'student') return res.status(403).json({ error:'เฉพาะนักศึกษาเท่านั้น' });
  if (!db.qrSessions) return res.status(404).json({ error:'ไม่พบ QR นี้' });

  const session = db.qrSessions.find(s=>s.ref===ref);
  if (!session) return res.status(404).json({ error:'ไม่พบ QR นี้' });
  if (session.status === 'paid') return res.status(400).json({ error:'QR นี้ถูกใช้ไปแล้ว' });
  if (Date.now() > session.exp) { session.status='expired'; return res.status(400).json({ error:'QR หมดอายุแล้ว' }); }

  // ตรวจ wallet นักศึกษา
  const wallet = dbFind('wallets', w=>w.userId===req.user.id);
  if (!wallet) return res.status(404).json({ error:'ไม่พบ Wallet' });
  if (wallet.balance < session.amount) return res.status(400).json({ error:`ยอดคงเหลือไม่พอ (มี ฿${wallet.balance.toFixed(2)} ต้องการ ฿${session.amount.toFixed(2)})` });

  // หัก wallet นักศึกษา
  dbUpdate('wallets', w=>w.userId===req.user.id, { balance: wallet.balance - session.amount });

  // เพิ่ม settle balance ให้ร้านค้า
  dbUpdate('merchants', m=>m.id===session.merchantId, {
    totalSales: (dbFind('merchants',m=>m.id===session.merchantId)?.totalSales||0) + session.amount,
    settleBalance: (dbFind('merchants',m=>m.id===session.merchantId)?.settleBalance||0) + session.amount,
  });

  // บันทึก payment
  const payment = dbInsert('payments', {
    id: uuidv4(),
    userId: req.user.id,
    ref: session.ref,
    method: 'qr_merchant',
    amount: session.amount,
    status: 'success',
    merchantId: session.merchantId,
    merchantName: session.merchantName,
    note: session.note,
    createdAt: new Date().toISOString()
  });

  // อัปเดต QR session
  session.status = 'paid';
  session.payerId = req.user.id;
  session.payerName = req.user.name;
  session.paidAt = new Date().toISOString();

  // แจ้งเตือนนักศึกษา
  dbInsert('notifications', {
    id: uuidv4(), userId: req.user.id, type:'payment',
    title:'ชำระเงินสำเร็จ',
    message:`จ่ายเงิน ฿${session.amount.toFixed(2)} ให้ ${session.merchantName} สำเร็จ`,
    read:false, createdAt: new Date().toISOString()
  });

  addAudit(req.user.id, 'QR_PAY', `จ่ายเงิน QR ฿${session.amount} → ${session.merchantName} (ref:${session.ref})`, req.ip);

  const newBalance = wallet.balance - session.amount;
  res.json({ success:true, ref:session.ref, amount:session.amount, merchantName:session.merchantName, newBalance, paymentId:payment.id });
});

// Merchant polling ดูสถานะ QR
app.get('/api/qr/status/:ref', isMerchant, (req,res) => {
  if (!db.qrSessions) return res.json({ status:'pending' });
  const session = db.qrSessions.find(s=>s.ref===req.params.ref);
  if (!session) return res.status(404).json({ error:'ไม่พบ QR' });
  if (Date.now() > session.exp && session.status==='pending') session.status='expired';
  res.json({
    status: session.status,
    ref: session.ref,
    amount: session.amount,
    payerName: session.payerName || null,
    paidAt: session.paidAt || null
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  GENERAL
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/transactions', authenticate, (req,res) => {
  const payments = dbFilter('payments', p=>p.userId===req.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ transactions:payments });
});

app.get('/api/notifications', authenticate, (req,res) => {
  const n = dbFilter('notifications', n=>n.userId===req.user.id||n.userId===null).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ notifications:n });
});

app.post('/api/notifications/read', authenticate, (req,res) => {
  dbUpdate('notifications', n=>n.id===req.body.notifId, { read:true });
  res.json({ success:true });
});

app.get('/api/chat/history', authenticate, (req,res) => {
  const msgs = dbFilter('chatMessages', m=>m.userId===req.user.id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).slice(-50);
  res.json({ messages:msgs });
});

app.post('/api/chat', authenticate, (req,res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error:'กรุณาพิมพ์ข้อความ' });
  const userMsg = dbInsert('chatMessages', { id:uuidv4(), userId:req.user.id, from:'user', message:message.trim(), createdAt:new Date().toISOString() });
  const reply = getBotReply(message);
  const botMsg = dbInsert('chatMessages', { id:uuidv4(), userId:req.user.id, from:'bot', message:reply, createdAt:new Date().toISOString() });
  res.json({ userMessage:userMsg, botReply:botMsg });
});

// ─── RECEIPT PDF ──────────────────────────────────────────────────────────────
app.get('/api/receipt/:paymentId', authenticate, (req,res) => {
  const payment = dbFind('payments', p=>p.id===req.params.paymentId&&p.userId===req.user.id);
  if (!payment) return res.status(404).json({ error:'ไม่พบรายการ' });
  const user = dbFind('users', u=>u.id===req.user.id);
  const fee = payment.feeId ? dbFind('feeItems', f=>f.id===payment.feeId) : null;
  const mNames = { promptpay:'PromptPay QR',card:'บัตรเครดิต/เดบิต',wallet:'KKU Wallet',banking:'Internet Banking',ewallet:'e-Wallet',counter:'Counter Service',wallet_topup:'เติมเงิน KKU Wallet' };
  const doc = new PDFDocument({ size:'A4', margin:50 });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename=receipt-${payment.ref}.pdf`);
  doc.pipe(res);
  doc.rect(0,0,595,125).fill('#4a0072');
  doc.fillColor('white').fontSize(26).font('Helvetica-Bold').text('KKU PAY',55,28);
  doc.fontSize(11).font('Helvetica').text('ระบบชำระเงินออนไลน์ มหาวิทยาลัยขอนแก่น',55,62);
  doc.text('123 หมู่ 16 ถ.มิตรภาพ ต.ในเมือง อ.เมือง จ.ขอนแก่น 40002  |  043-009-700 ต่อ 42132',55,94);
  doc.fillColor('#4a0072').fontSize(17).font('Helvetica-Bold').text('ใบเสร็จรับเงิน / Official Receipt',0,142,{align:'center'});
  doc.rect(50,168,495,1).fill('#4a0072');
  const rows=[['เลขที่ใบเสร็จ',payment.ref],['วันที่ชำระ',new Date(payment.paidAt||payment.createdAt).toLocaleString('th-TH')],['ชื่อผู้ชำระ',user?.name||'-'],['รหัสนักศึกษา',user?.studentId||'-'],['คณะ',user?.faculty||'-'],['รายการ',fee?.label||(payment.method==='wallet_topup'?'เติมเงิน KKU Wallet':'ชำระเงิน')],['วิธีชำระ',mNames[payment.method]||payment.method],['สถานะ',payment.status==='success'?'✓ ชำระแล้ว':'รอดำเนินการ']];
  let yy=178;
  rows.forEach(([l,v])=>{ doc.fillColor('#555').font('Helvetica-Bold').fontSize(9.5).text(l+':',60,yy); doc.fillColor('#222').font('Helvetica').text(String(v),255,yy); yy+=22; });
  doc.rect(50,yy+8,495,1).fill('#ddd');
  doc.rect(345,yy+15,200,55).fill('#4a0072');
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('จำนวนเงิน / Amount',350,yy+20);
  doc.fontSize(20).text('฿ '+parseFloat(payment.amount).toLocaleString('th-TH',{minimumFractionDigits:2}),350,yy+36);
  doc.rect(0,752,595,90).fill('#f5f5f5');
  doc.fillColor('#888').fontSize(8.5).font('Helvetica').text('เอกสารออกโดยระบบอัตโนมัติ ไม่ต้องมีลายมือชื่อ | KKU Pay v2.0 | © 2567 มหาวิทยาลัยขอนแก่น',55,780,{align:'center'});
  doc.end();
});

// POS receipt
app.get('/api/pos/receipt/:orderId', authenticate, (req,res) => {
  const order = dbFind('posOrders', o=>o.id===req.params.orderId);
  if (!order) return res.status(404).json({ error:'ไม่พบรายการ' });
  const merchant = dbFind('merchants', m=>m.id===order.merchantId);
  const user = dbFind('users', u=>u.id===order.userId);
  const doc = new PDFDocument({ size:[226,400+order.items.length*24], margin:20 });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename=pos-${order.ref}.pdf`);
  doc.pipe(res);
  doc.fillColor('#4a0072').fontSize(14).font('Helvetica-Bold').text('KKU PAY',0,20,{align:'center'});
  doc.fillColor('#333').fontSize(9).font('Helvetica').text(merchant?.name||'—',0,38,{align:'center'});
  doc.text(merchant?.address||'',0,50,{align:'center'});
  doc.moveTo(20,68).lineTo(206,68).stroke('#ccc');
  doc.text('ใบเสร็จรับเงิน / Receipt',0,74,{align:'center'});
  doc.text('Ref: '+order.ref,0,86,{align:'center'});
  doc.text(new Date(order.paidAt).toLocaleString('th-TH'),0,98,{align:'center'});
  doc.moveTo(20,110).lineTo(206,110).stroke('#ccc');
  let y=118;
  order.items.forEach(item=>{ doc.fillColor('#111').text(item.name,20,y,{width:120}); doc.text(`x${item.qty}`,140,y,{width:30}); doc.text('฿'+item.subtotal,172,y,{width:54,align:'right'}); y+=18; });
  doc.moveTo(20,y).lineTo(206,y).stroke('#ccc'); y+=8;
  doc.font('Helvetica-Bold').fontSize(11).text('รวมทั้งสิ้น',20,y); doc.text('฿'+order.total.toFixed(2),100,y,{width:106,align:'right'}); y+=22;
  doc.font('Helvetica').fontSize(8).fillColor('#666').text('วิธีชำระ: '+({wallet:'KKU Wallet',card:'บัตรเครดิต',promptpay:'PromptPay'}[order.method]||order.method),20,y);
  y+=14; doc.text('ลูกค้า: '+(user?.name||'—'),20,y);
  y+=24; doc.fillColor('#aaa').fontSize(7).text('ขอบคุณที่ใช้บริการ | KKU Pay',0,y,{align:'center'});
  doc.end();
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════
const isAdmin = [authenticate, requireRole('admin','finance','support')];
const isAdminOnly = [authenticate, requireRole('admin')];
const isAdminFinance = [authenticate, requireRole('admin','finance')];

app.get('/api/admin/stats', isAdmin, (req,res) => {
  const ok = db.payments.filter(p=>p.status==='success');
  const totalRevenue = ok.reduce((s,p)=>s+parseFloat(p.amount),0);
  const walletTotal = db.wallets.reduce((s,w)=>s+w.balance,0);
  const pendingTotal = db.feeItems.filter(f=>f.status==='pending'||f.status==='overdue').reduce((s,f)=>s+f.amount,0);
  const merchantSales = db.merchants.reduce((s,m)=>s+(m.totalSales||0),0);
  const today = new Date().toISOString().slice(0,10);
  const todayOk = ok.filter(p=>p.createdAt.startsWith(today));
  const days=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=d.toISOString().slice(0,10); days.push({ date:k, amount:ok.filter(p=>p.createdAt.startsWith(k)).reduce((s,p)=>s+parseFloat(p.amount),0) }); }
  const methods={}; ok.forEach(p=>{ methods[p.method]=(methods[p.method]||0)+parseFloat(p.amount); });
  res.json({ totalRevenue, walletTotal, pendingTotal, merchantSales, todayRevenue:todayOk.reduce((s,p)=>s+parseFloat(p.amount),0), todayCount:todayOk.length, totalStudents:db.users.filter(u=>u.role==='student').length, totalMerchants:db.merchants.filter(m=>m.status==='active').length, totalTransactions:ok.length, successRate:db.payments.length?(ok.length/db.payments.length*100).toFixed(1):100, chartData:days, methodBreakdown:methods, refundCount:db.refunds.length, mdrRevenue:merchantSales*0.015+totalRevenue*0.015 });
});

app.get('/api/admin/users', isAdmin, (req,res) => {
  const students = db.users.filter(u=>u.role==='student').map(u=>{ const {password:_,...safe}=u; const w=dbFind('wallets',ww=>ww.userId===u.id); const fees=dbFilter('feeItems',f=>f.userId===u.id); const paid=dbFilter('payments',p=>p.userId===u.id&&p.status==='success'); return {...safe,walletBalance:w?.balance||0,feeCount:fees.length,pendingFees:fees.filter(f=>f.status==='pending'||f.status==='overdue').length,paymentCount:paid.length,totalPaid:paid.reduce((s,p)=>s+parseFloat(p.amount),0)}; });
  res.json({ users:students });
});

app.get('/api/admin/transactions', isAdmin, (req,res) => {
  const txns = db.payments.map(p=>{ const u=dbFind('users',u=>u.id===p.userId); const f=p.feeId?dbFind('feeItems',f=>f.id===p.feeId):null; return {...p,studentName:u?.name,studentId:u?.studentId,faculty:u?.faculty,feeLabel:f?.label}; }).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({ transactions:txns });
});

app.get('/api/admin/fees', isAdmin, (req,res) => { const fees=db.feeItems.map(f=>{ const u=dbFind('users',u=>u.id===f.userId); return {...f,studentName:u?.name,studentId:u?.studentId,faculty:u?.faculty}; }); res.json({ fees }); });
app.post('/api/admin/fees', isAdminOnly, (req,res) => { const {userId,code,type,label,amount,due,semester,note}=req.body; const user=dbFind('users',u=>u.id===userId); if(!user) return res.status(404).json({error:'ไม่พบนักศึกษา'}); const fee=dbInsert('feeItems',{id:uuidv4(),userId,code:code||('FEE-'+Date.now()),type,label,amount:parseFloat(amount),due,semester:semester||'',note:note||'',status:'pending',createdAt:new Date().toISOString()}); addAudit(req.user.id,'FEE_CREATE',`สร้าง "${label}" ฿${amount} → ${user.name}`,req.ip); res.json({success:true,fee}); });
app.put('/api/admin/fees/:id', isAdminOnly, (req,res) => { const fee=dbUpdate('feeItems',f=>f.id===req.params.id,req.body); if(!fee) return res.status(404).json({error:'ไม่พบรายการ'}); addAudit(req.user.id,'FEE_UPDATE',`แก้ไข "${fee.label}"`,req.ip); res.json({success:true,fee}); });
app.delete('/api/admin/fees/:id', isAdminOnly, (req,res) => { const fee=dbFind('feeItems',f=>f.id===req.params.id); if(!fee) return res.status(404).json({error:'ไม่พบรายการ'}); dbDelete('feeItems',f=>f.id===req.params.id); addAudit(req.user.id,'FEE_DELETE',`ลบ "${fee.label}"`,req.ip); res.json({success:true}); });

app.post('/api/admin/refund', isAdminFinance, (req,res) => {
  const {paymentId,reason,amount}=req.body; const payment=dbFind('payments',p=>p.id===paymentId); if(!payment) return res.status(404).json({error:'ไม่พบรายการ'}); if(payment.status!=='success') return res.status(400).json({error:'ไม่สามารถคืนเงินได้'});
  const refundAmt=parseFloat(amount)||parseFloat(payment.amount); const refund=dbInsert('refunds',{id:uuidv4(),paymentId,userId:payment.userId,amount:refundAmt,reason,status:'approved',processedBy:req.user.id,createdAt:new Date().toISOString()});
  dbUpdate('payments',p=>p.id===paymentId,{status:'refunded',refundId:refund.id,refundedAt:new Date().toISOString()});
  if(payment.method==='wallet'){const w=dbFind('wallets',w=>w.userId===payment.userId);if(w){dbUpdate('wallets',w=>w.userId===payment.userId,{balance:w.balance+refundAmt,updatedAt:new Date().toISOString()});dbInsert('walletTxns',{id:uuidv4(),userId:payment.userId,type:'credit',amount:refundAmt,ref:refund.id,desc:'คืนเงิน: '+reason,createdAt:new Date().toISOString()});}}
  if(payment.feeId) dbUpdate('feeItems',f=>f.id===payment.feeId,{status:'pending'});
  addAudit(req.user.id,'REFUND',`คืนเงิน ฿${refundAmt} Ref:${payment.ref} เหตุผล:${reason}`,req.ip);
  dbInsert('notifications',{id:uuidv4(),userId:payment.userId,type:'personal',title:'การคืนเงินได้รับการอนุมัติ',message:`รายการ ${payment.ref} ได้รับการคืนเงิน ฿${refundAmt.toFixed(2)} เหตุผล: ${reason}`,read:false,createdAt:new Date().toISOString()});
  res.json({success:true,refund});
});

app.get('/api/admin/refunds', isAdmin, (req,res) => { const refunds=db.refunds.map(r=>{const p=dbFind('payments',p=>p.id===r.paymentId);const u=dbFind('users',u=>u.id===r.userId);const proc=dbFind('users',u=>u.id===r.processedBy);return {...r,paymentRef:p?.ref,studentName:u?.name,studentId:u?.studentId,processedByName:proc?.name};}).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)); res.json({refunds}); });
app.get('/api/admin/audit-log', isAdmin, (req,res) => { const logs=db.auditLogs.map(l=>{const u=dbFind('users',u=>u.id===l.userId);return{...l,userName:u?.name,userRole:u?.role};}).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,300); res.json({logs}); });

app.get('/api/admin/settlement', isAdminFinance, (req,res) => {
  const date=req.query.date||new Date().toISOString().slice(0,10); const day=db.payments.filter(p=>p.status==='success'&&p.createdAt.startsWith(date)); const gross=day.reduce((s,p)=>s+parseFloat(p.amount),0); const byMethod={}; day.forEach(p=>{if(!byMethod[p.method])byMethod[p.method]={count:0,gross:0,mdr:0,net:0};byMethod[p.method].count++;byMethod[p.method].gross+=parseFloat(p.amount);byMethod[p.method].mdr+=parseFloat(p.amount)*0.015;byMethod[p.method].net+=parseFloat(p.amount)*0.985;});
  res.json({date,gross,mdr:gross*0.015,net:gross*0.985,transactionCount:day.length,byMethod});
});

app.get('/api/admin/reconciliation', isAdminFinance, (req,res) => {
  const days=[]; for(let i=29;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const k=d.toISOString().slice(0,10);const t=db.payments.filter(p=>p.status==='success'&&p.createdAt.startsWith(k));const g=t.reduce((s,p)=>s+parseFloat(p.amount),0);days.push({date:k,count:t.length,gross:g,mdr:g*0.015,net:g*0.985});} res.json({reconciliation:days});
});

// Admin merchant management
app.get('/api/admin/merchants', isAdmin, (req,res) => res.json({ merchants:db.merchants }));
app.post('/api/admin/merchants', isAdminOnly, (req,res) => { const m=dbInsert('merchants',{id:uuidv4(),...req.body,totalSales:0,settleBalance:0,pendingSettle:0,createdAt:new Date().toISOString()}); addAudit(req.user.id,'MERCHANT_CREATE',`เพิ่ม Merchant: ${m.name}`,req.ip); res.json({success:true,merchant:m}); });
app.put('/api/admin/merchants/:id', isAdminOnly, (req,res) => { const m=dbUpdate('merchants',m=>m.id===req.params.id,req.body); if(!m) return res.status(404).json({error:'ไม่พบ'}); addAudit(req.user.id,'MERCHANT_UPDATE',`อัพเดท ${m.name}`,req.ip); res.json({success:true,merchant:m}); });

// Admin merchant transactions
app.get('/api/admin/merchant-txns', isAdmin, (req,res) => {
  const txns = db.merchantTxns.map(t=>{const m=dbFind('merchants',m=>m.id===t.merchantId);const o=dbFind('posOrders',o=>o.id===t.orderId);const u=o?dbFind('users',u=>u.id===o.userId):null;return {...t,merchantName:m?.name,merchantCode:m?.code,customerName:u?.name,studentId:u?.studentId};}).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({transactions:txns});
});

// Admin approve withdrawal
app.get('/api/admin/withdrawals', isAdminFinance, (req,res) => {
  const wds = db.merchantWithdrawals.map(w=>{const m=dbFind('merchants',m=>m.id===w.merchantId);return{...w,merchantName:m?.name,merchantCode:m?.code};}).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({withdrawals:wds});
});

app.put('/api/admin/withdrawals/:id', isAdminFinance, (req,res) => {
  const wd=dbUpdate('merchantWithdrawals',w=>w.id===req.params.id,{status:req.body.status,processedAt:new Date().toISOString(),processedBy:req.user.id});
  if(!wd) return res.status(404).json({error:'ไม่พบ'});
  addAudit(req.user.id,'WITHDRAWAL_'+(req.body.status==='approved'?'APPROVE':'REJECT'),`${req.body.status} ถอนเงิน ฿${wd.amount} → ${wd.merchantName||wd.merchantId}`,req.ip);
  res.json({success:true,withdrawal:wd});
});

app.post('/api/admin/notifications/broadcast', isAdminOnly, (req,res) => { const {title,message}=req.body; const n=dbInsert('notifications',{id:uuidv4(),userId:null,type:'broadcast',title,message,read:false,createdAt:new Date().toISOString()}); addAudit(req.user.id,'BROADCAST',`ส่งประกาศ: "${title}"`,req.ip); res.json({success:true,notification:n}); });

// ═══════════════════════════════════════════════════════════════════════════════
//  MERCHANT SELF-REGISTRATION (ลงทะเบียนร้านค้า / เจ้าของกิจการ)
//  ถูกต้องตาม พ.ร.บ. ธุรกิจสถาบันการเงิน / ประกาศ ธปท. เรื่องระบบชำระเงิน
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/merchant/register', async (req,res) => {
  try {
    const {
      // ── ข้อมูลกิจการ ──
      businessName, businessNameEn, businessType, category, taxId,
      registrationNumber, registeredAt,
      // ── ที่อยู่ ──
      address, subDistrict, district, province, postalCode,
      // ── ผู้ติดต่อ / เจ้าของ ──
      ownerName, ownerIdCard, ownerPhone, ownerEmail,
      contactPhone, contactEmail,
      // ── บัญชีธนาคาร ──
      bankCode, bankAccount, accountName,
      promptpayId,
      // ── ข้อมูลผู้ใช้งาน ──
      username, password,
      // ── เอกสาร (ชื่อไฟล์ / URL) ──
      docBusinessReg,   // สำเนาหนังสือรับรองบริษัท / ทะเบียนพาณิชย์
      docIdCard,        // สำเนาบัตรประจำตัวประชาชน
      docBankBook,      // สำเนาหน้าสมุดบัญชีธนาคาร
      docVatReg,        // สำเนาใบทะเบียนภาษีมูลค่าเพิ่ม (ถ้ามี)
    } = req.body;

    // ── Validate required ──
    if (!businessName || !taxId || !ownerName || !ownerIdCard || !ownerPhone
        || !bankCode || !bankAccount || !accountName || !username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน' });
    }
    if (!/^\d{13}$/.test(taxId.replace(/-/g,''))) {
      return res.status(400).json({ error: 'เลขประจำตัวผู้เสียภาษี / เลขบัตรประชาชน ต้องมี 13 หลัก' });
    }
    if (dbFind('users', u => u.username === username)) {
      return res.status(400).json({ error: 'ชื่อผู้ใช้งานนี้ถูกใช้แล้ว' });
    }

    // ── สร้าง merchant record ──
    const mId = uuidv4();
    const mCode = 'KKU-M' + String(db.merchants.length + 1).padStart(3,'0');
    const merchant = dbInsert('merchants', {
      id: mId, code: mCode,
      name: businessName, nameEn: businessNameEn || '',
      businessType: businessType || 'individual',
      category: category || 'other',
      subCategory: '',
      taxId: taxId.replace(/-/g,''),
      registrationNumber: registrationNumber || '',
      registeredAt: registeredAt || '',
      address: `${address} ต.${subDistrict} อ.${district} จ.${province} ${postalCode}`,
      ownerName, ownerIdCard, ownerPhone,
      contactName: ownerName, contactPhone: contactPhone || ownerPhone,
      contactEmail: contactEmail || ownerEmail,
      bankCode, bankAccount, bankName: (({kbank:'ธนาคารกสิกรไทย',scb:'ธนาคารไทยพาณิชย์',ktb:'ธนาคารกรุงไทย',bbl:'ธนาคารกรุงเทพ',ttb:'ธนาคารทีทีบี',gsb:'ธนาคารออมสิน',baac:'ธ.ก.ส.'})[bankCode] || bankCode),
      accountName, promptpayId: promptpayId || '',
      mdr: 1.5, status: 'pending',   // pending = รอ admin อนุมัติ
      settleBalance: 0, totalSales: 0, pendingSettle: 0,
      products: [],
      businessHours: '',
      description: '',
      // เอกสาร
      documents: {
        businessReg: docBusinessReg || null,
        idCard: docIdCard || null,
        bankBook: docBankBook || null,
        vatReg: docVatReg || null,
      },
      createdAt: new Date().toISOString(),
    });

    // ── สร้าง user account ──
    const hash = bcrypt.hashSync(password, 10);
    const newUser = dbInsert('users', {
      id: uuidv4(), studentId: mCode, username, password: hash,
      name: businessName, nameEn: businessNameEn || '',
      role: 'merchant', faculty: 'ร้านค้า', program: '-', year: 0,
      email: ownerEmail || contactEmail || '',
      phone: ownerPhone || contactPhone || '',
      merchantId: mId,
      createdAt: new Date().toISOString(),
    });

    addAudit(newUser.id, 'MERCHANT_REGISTER', `สมัครร้านค้า "${businessName}" (${mCode})`, req.ip);
    dbInsert('notifications', {
      id: uuidv4(), userId: null, type: 'broadcast',
      title: '📋 มีคำขอลงทะเบียนร้านค้าใหม่',
      message: `ร้าน "${businessName}" (${mCode}) สมัครเข้าระบบ รอการอนุมัติจาก Admin`,
      read: false, createdAt: new Date().toISOString(),
    });

    res.json({ success: true, merchantCode: mCode, message: 'ลงทะเบียนสำเร็จ รอ Admin อนุมัติภายใน 1-3 วันทำการ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin อนุมัติ / ปฏิเสธ merchant
app.put('/api/admin/merchants/:id/status', isAdminOnly, (req,res) => {
  const { status, note } = req.body; // 'active' หรือ 'rejected'
  const m = dbUpdate('merchants', m => m.id === req.params.id, { status, statusNote: note || '', updatedAt: new Date().toISOString() });
  if (!m) return res.status(404).json({ error: 'ไม่พบ merchant' });
  // อัพเดท user ที่ผูกอยู่ด้วย
  if (status === 'rejected') dbUpdate('users', u => u.merchantId === req.params.id, { role: 'merchant_rejected' });
  addAudit(req.user.id, 'MERCHANT_' + status.toUpperCase(), `${status} ร้านค้า "${m.name}"`, req.ip);
  res.json({ success: true, merchant: m });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SLIP UPLOAD & AUTO-CONFIRM (Internet Banking → admin ยืนยัน)
// ═══════════════════════════════════════════════════════════════════════════════
// ในระบบจริง ให้ integrate:
//   1) Slip Verification API (เช่น SlipOK.com / Omise slip verify)
//   2) ตรวจ hash ของ QR payload ใน slip ว่าตรงกับ orderId
//   3) เช็ค timestamp ว่าไม่เกิน expiry
//   4) เช็คยอดเงินตรงกับ payment.amount ± 0
//   5) Cross-check account number ว่าโอนถูกบัญชี
// Demo นี้จำลอง logic ด้วย rule-based check แทน OCR

app.post('/api/payments/upload-slip', authenticate, async (req,res) => {
  try {
    const { paymentId, slipData } = req.body;
    // slipData = { amount, transferDate, senderAccount, refCode, imgBase64 }
    const payment = dbFind('payments', p => p.id === paymentId);
    if (!payment) return res.status(404).json({ error: 'ไม่พบรายการชำระเงิน' });
    if (payment.userId !== req.user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
    if (payment.status === 'success') return res.status(400).json({ error: 'รายการนี้ยืนยันแล้ว' });

    // บันทึก slip ไว้ใน payment record
    dbUpdate('payments', p => p.id === paymentId, {
      slip: {
        uploadedAt: new Date().toISOString(),
        amount: slipData.amount,
        transferDate: slipData.transferDate,
        senderAccount: slipData.senderAccount,
        refCode: slipData.refCode,
        imgBase64: slipData.imgBase64 || null,
      },
      status: 'slip_uploaded',
    });
    if (payment.feeId) dbUpdate('feeItems', f => f.id === payment.feeId, { status: 'processing' });
    addAudit(req.user.id, 'SLIP_UPLOAD', `อัพโหลดสลิป Ref:${payment.ref} ยอด฿${slipData.amount}`, req.ip);

    res.json({ success: true, message: 'อัพโหลดสลิปเรียบร้อย รอระบบตรวจสอบ' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: ดู list payments ที่รอยืนยัน slip
app.get('/api/admin/pending-slips', isAdminFinance, (req,res) => {
  const pending = db.payments
    .filter(p => p.status === 'slip_uploaded' || (p.status === 'pending' && p.method === 'banking'))
    .map(p => {
      const u = dbFind('users', u => u.id === p.userId);
      const f = p.feeId ? dbFind('feeItems', f => f.id === p.feeId) : null;
      return { ...p, studentName: u?.name, studentId: u?.studentId, faculty: u?.faculty, feeLabel: f?.label };
    })
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ payments: pending });
});

// Admin: ยืนยัน / ปฏิเสธ slip (manual หรือ auto ตาม flag)
app.post('/api/admin/confirm-payment', isAdminFinance, (req,res) => {
  try {
    const { paymentId, action, note } = req.body; // action: 'approve' | 'reject'
    const payment = dbFind('payments', p => p.id === paymentId);
    if (!payment) return res.status(404).json({ error: 'ไม่พบรายการ' });

    if (action === 'approve') {
      dbUpdate('payments', p => p.id === paymentId, {
        status: 'success', paidAt: new Date().toISOString(),
        confirmedBy: req.user.id, confirmedAt: new Date().toISOString(), note,
      });
      if (payment.feeId) dbUpdate('feeItems', f => f.id === payment.feeId, {
        status: 'paid', paidAt: new Date().toISOString(),
      });
      dbInsert('notifications', {
        id: uuidv4(), userId: payment.userId, type: 'personal',
        title: '✅ ยืนยันการชำระเงินแล้ว',
        message: `รายการ ${payment.ref} ยอด ฿${payment.amount} ได้รับการยืนยันแล้ว`,
        read: false, createdAt: new Date().toISOString(),
      });
      addAudit(req.user.id, 'PAYMENT_CONFIRM', `ยืนยัน Ref:${payment.ref} ฿${payment.amount}`, req.ip);
      res.json({ success: true, message: 'ยืนยันการชำระเงินเรียบร้อย' });
    } else {
      dbUpdate('payments', p => p.id === paymentId, {
        status: 'rejected', rejectedAt: new Date().toISOString(),
        rejectedBy: req.user.id, note,
      });
      if (payment.feeId) dbUpdate('feeItems', f => f.id === payment.feeId, { status: 'pending' });
      dbInsert('notifications', {
        id: uuidv4(), userId: payment.userId, type: 'personal',
        title: '❌ ไม่สามารถยืนยันการชำระเงินได้',
        message: `รายการ ${payment.ref} ถูกปฏิเสธ เหตุผล: ${note || 'กรุณาติดต่อเจ้าหน้าที่'}`,
        read: false, createdAt: new Date().toISOString(),
      });
      addAudit(req.user.id, 'PAYMENT_REJECT', `ปฏิเสธ Ref:${payment.ref} เหตุผล:${note}`, req.ip);
      res.json({ success: true, message: 'ปฏิเสธรายการแล้ว' });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUTO-CONFIRM: จำลอง slip verification (demo) ──
// logic จริงต้องใช้ Slip Verify API / OCR
function autoVerifySlip(payment) {
  const slip = payment.slip;
  if (!slip) return { ok: false, reason: 'ไม่พบข้อมูลสลิป' };

  const checks = [];
  // 1. ตรวจยอดเงิน ต้องตรงกับ payment.amount ± 0 บาท
  const amtMatch = Math.abs(parseFloat(slip.amount) - parseFloat(payment.amount)) < 0.01;
  checks.push({ name: 'ยอดเงิน', pass: amtMatch, detail: `สลิป ฿${slip.amount} | รายการ ฿${payment.amount}` });

  // 2. ตรวจวันที่โอน ต้องไม่เกิน 24 ชั่วโมงหลังสร้าง payment
  const txTime = new Date(slip.transferDate || slip.uploadedAt);
  const created = new Date(payment.createdAt);
  const hoursDiff = (txTime - created) / 3600000;
  const timeOk = hoursDiff >= -1 && hoursDiff <= 24;
  checks.push({ name: 'วันที่โอน', pass: timeOk, detail: `ห่าง ${hoursDiff.toFixed(1)} ชม. จากเวลาสร้างรายการ` });

  // 3. ตรวจ ref code (ถ้ามี)
  const refOk = !slip.refCode || payment.ref.includes(slip.refCode) || slip.refCode.includes(payment.ref.slice(-6));
  checks.push({ name: 'Ref Code', pass: refOk, detail: `สลิป: ${slip.refCode || 'ไม่ระบุ'} | ระบบ: ${payment.ref}` });

  // 4. duplicate slip check — เช็คว่า refCode ซ้ำกับรายการอื่นไหม
  const isDup = slip.refCode
    ? db.payments.some(p => p.id !== payment.id && p.slip?.refCode === slip.refCode)
    : false;
  checks.push({ name: 'Duplicate', pass: !isDup, detail: isDup ? '⚠️ พบ refCode ซ้ำในระบบ' : 'ไม่พบซ้ำ' });

  const allPass = checks.every(c => c.pass);
  return { ok: allPass, checks };
}

// Endpoint: admin กด "Auto Verify & Confirm"
app.post('/api/admin/auto-confirm', isAdminFinance, (req,res) => {
  try {
    const { paymentId } = req.body;
    const payment = dbFind('payments', p => p.id === paymentId);
    if (!payment) return res.status(404).json({ error: 'ไม่พบรายการ' });
    if (!['pending','slip_uploaded'].includes(payment.status)) {
      return res.status(400).json({ error: `สถานะปัจจุบัน "${payment.status}" ไม่สามารถยืนยันได้` });
    }

    const result = autoVerifySlip(payment);
    // ส่ง result กลับก่อน ฝั่ง client จะแสดง loading 5 วิ แล้ว auto approve ถ้า ok
    res.json({ success: true, verifyResult: result, paymentId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
app.get('*', (req,res) => { if(!req.path.startsWith('/api')) res.sendFile(path.join(__dirname,'public','index.html')); else res.status(404).json({error:'API not found'}); });

app.listen(PORT, () => console.log(`✅ KKU Pay v2.1 on :${PORT} | Mock:${MOCK_PAYMENT} | Merchants:${db.merchants.length}`));
