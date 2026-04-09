@echo off
echo 🚀 KKU Pay Demo — Windows Setup
echo =================================

node --version >nul 2>&1
IF ERRORLEVEL 1 (
  echo ❌ ไม่พบ Node.js — กรุณาติดตั้งจาก https://nodejs.org
  pause
  exit /b
)

echo ✅ Node.js พร้อม

IF NOT EXIST .env (
  copy .env.example .env
  echo ✅ สร้างไฟล์ .env แล้ว
)

echo.
echo 📦 กำลังติดตั้ง dependencies...
npm install

echo.
echo ✅ ติดตั้งเสร็จ!
echo.
echo กำลังเริ่ม server...
npm start
