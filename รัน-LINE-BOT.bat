@echo off
chcp 65001 > nul
echo ====================================================
echo    เซิร์ฟเวอร์ LINE Bot ตรวจสอบสลิป (Auto-Tunnel)
echo ====================================================

:: เพิ่ม PATH ของ Node.js
set "PATH=C:\Program Files\nodejs;%PATH%"

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ผิดพลาด] ไม่พบ Node.js ในเครื่อง
    pause
    exit /b 1
)

node start-all.js
pause
