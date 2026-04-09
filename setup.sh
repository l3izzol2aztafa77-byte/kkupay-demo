#!/bin/bash
echo "🚀 KKU Pay Demo — Setup Script"
echo "================================"

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ ไม่พบ Node.js — กรุณาติดตั้งจาก https://nodejs.org (v18+)"
  exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 16 ]; then
  echo "❌ Node.js เวอร์ชัน $NODE_VER ต่ำเกินไป — ต้องการ v16+"
  exit 1
fi

echo "✅ Node.js $(node -v) — OK"

# Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ สร้างไฟล์ .env แล้ว (ใช้ Mock Payment mode)"
fi

# Install dependencies
echo ""
echo "📦 กำลังติดตั้ง dependencies..."
npm install

echo ""
echo "✅ ติดตั้งเสร็จแล้ว!"
echo ""
echo "🎯 เริ่มรัน Demo:"
echo "   npm start"
echo ""
echo "🌐 จากนั้นเปิด browser:"
echo "   Student Portal: http://localhost:3000"
echo "   Admin Dashboard: http://localhost:3000/admin.html"
echo ""
echo "🔑 Demo accounts:"
echo "   นักศึกษา: somchai@kku.ac.th / demo1234"
echo "   Admin:   admin@kkupay.co.th / admin1234"
