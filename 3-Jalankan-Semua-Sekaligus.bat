@echo off
title EduVerse - Peluncur Game Online
cd /d "%~dp0"
color 0E
echo ============================================================
echo        EduVerse - Memulai Server & Jalur Online
echo ============================================================
echo.
echo 1. Membuka jendela Server Laptop...
start "EduVerse - Server Game" cmd /k "cd /d ""%~dp0"" && node server.js"
timeout /t 2 /nobreak >nul
echo 2. Membuka jendela Cloudflare Tunnel...
start "EduVerse - Jalur Online" cmd /k "cd /d ""%~dp0"" && npx cloudflared tunnel --url http://127.0.0.1:3000"
echo.
echo Selesai! Kedua jendela sudah dibuka di layar Anda.
echo Salin link 'https://....trycloudflare.com' di jendela Tunnel untuk murid.
echo ============================================================
timeout /t 5
