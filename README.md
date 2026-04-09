# 🛡️ KKU Pay — Demo System

ระบบชำระเงินดิจิทัลครบวงจรสำหรับมหาวิทยาลัยขอนแก่น  
**Version 1.0 Demo** | Frontend + Backend + Payment API (Omise Sandbox)

---

## ⚡ Quick Start (2 นาที)

### Mac / Linux:
```bash
chmod +x setup.sh
./setup.sh
npm start
```

### Windows:
```
ดับเบิ้ลคลิก setup.bat
```

### Manual:
```bash
npm install
cp .env.example .env
npm start
```

เปิด browser ที่ **http://localhost:3000**

---

## 🔑 Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| 🎓 นักศึกษา | somchai@kku.ac.th | demo1234 |
| 🎓 นักศึกษา 2 | wannisa@kku.ac.th | demo1234 |
| 🛡️ Admin | admin@kkupay.co.th | admin1234 |

---

## 🌐 Pages

| URL | ใช้งาน |
|-----|--------|
| http://localhost:3000 | Student Portal (ชำระเงิน, Wallet, ประวัติ) |
| http://localhost:3000/admin.html | Admin Dashboard (Statistics, Reports, API) |
| http://localhost:3000/api | API Documentation (JSON) |

---

## 💳 ฟีเจอร์ที่ Demo ได้

### Student Portal
- ✅ **Login** ด้วยอีเมล KKU + JWT Authentication
- ✅ **Dashboard** ยอดคงเหลือ Wallet, รายการค้างชำระ, ธุรกรรมล่าสุด
- ✅ **ชำระค่าเทอม** ผ่าน PromptPay QR / บัตรเครดิต / Wallet
- ✅ **PromptPay QR Code** สร้าง QR จริงพร้อม countdown 15 นาที
- ✅ **บัตรเครดิต** กรอก card details + ตรวจสอบ (Omise-ready)
- ✅ **KKU Wallet** — ดูยอด, เติมเงิน, ชำระเงิน
- ✅ **e-Receipt PDF** ดาวน์โหลดใบเสร็จ PDF ทุกรายการ
- ✅ **Transaction History** พร้อม filter และ download PDF

### Admin Dashboard
- ✅ **Real-time Statistics** — รายได้วันนี้, ธุรกรรมสำเร็จ, จำนวนนักศึกษา
- ✅ **Revenue Chart** — Bar chart 7 วันล่าสุด
- ✅ **Payment Method Chart** — Doughnut chart แยกตามช่องทาง
- ✅ **All Transactions** — ตารางพร้อม filter + Export CSV
- ✅ **Student Management** — รายชื่อนักศึกษา + ยอด Wallet
- ✅ **Reports** — MDR Revenue Share, SLA Performance
- ✅ **API Documentation** — Live API testing ใน browser
- ✅ **Auto-refresh** ทุก 30 วินาที

---

## 🔌 เชื่อม Omise (รับเงินจริง)

1. สมัคร free ที่ https://dashboard.omise.co/signup
2. ไปที่ **Settings → Keys** คัดลอก TEST keys
3. แก้ไฟล์ `.env`:
```
OMISE_PUBLIC_KEY=pkey_test_xxxxxxxxxxxx
OMISE_SECRET_KEY=skey_test_xxxxxxxxxxxx
MOCK_PAYMENT=false
```
4. รีสตาร์ท server

**Test Cards (Omise Sandbox):**
| Card | Number | Expiry | CVV |
|------|--------|--------|-----|
| Visa | 4242 4242 4242 4242 | 12/27 | 123 |
| Mastercard | 5555 5555 5555 4444 | 12/27 | 123 |

---

## 📡 API Endpoints

```
POST /api/auth/login          Login
GET  /api/auth/me             ข้อมูลผู้ใช้ปัจจุบัน

GET  /api/fees                รายการค้างชำระ
POST /api/payments/promptpay  สร้าง PromptPay QR
POST /api/payments/card       ชำระบัตรเครดิต (Omise)
POST /api/payments/wallet     ชำระจาก Wallet
GET  /api/payments            ประวัติธุรกรรม

GET  /api/wallet              ยอดและประวัติ Wallet
POST /api/wallet/topup        เติมเงิน Wallet

GET  /api/receipts/:id/pdf    ดาวน์โหลด e-Receipt PDF

GET  /api/admin/stats         สถิติ Dashboard [admin]
GET  /api/admin/transactions  ธุรกรรมทั้งหมด [admin]
GET  /api/admin/users         รายชื่อนักศึกษา [admin]
```

Auth: `Authorization: Bearer <token>`

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Database | SQLite (in-memory demo) → PostgreSQL (production) |
| Auth | JWT (jsonwebtoken) + bcrypt |
| Payment | Omise (PromptPay + Card) |
| QR Code | qrcode library |
| e-Receipt | PDFKit |
| Frontend | Vanilla JS + Chart.js |

---

## 📁 โครงสร้างไฟล์

```
kkupay-demo/
├── server.js          Backend server (Express + all APIs)
├── package.json       Dependencies
├── .env.example       Config template
├── .env               Config (สร้างจาก .env.example)
├── public/
│   ├── index.html     Student Portal (SPA)
│   └── admin.html     Admin Dashboard
├── setup.sh           Mac/Linux setup script
└── setup.bat          Windows setup script
```

---

## ⚠️ สำหรับ Production

สิ่งที่ต้องทำเพิ่มก่อน go-live จริง:
- [ ] เปลี่ยน SQLite → PostgreSQL
- [ ] ใส่ Omise LIVE keys (ผ่าน KYB verification)
- [ ] ตั้ง JWT_SECRET เป็น random string ยาว
- [ ] ใส่ HTTPS / TLS certificate
- [ ] ติดตั้ง Rate limiting (express-rate-limit)
- [ ] เปิด CORS เฉพาะ domain ที่อนุญาต
- [ ] ตั้ง Redis สำหรับ session + OTP
- [ ] เชื่อม Line OA Notification

---

*KKU Pay Demo v1.0 | Confidential | สร้างโดย CatLoop Studios*
