@echo off
title EduVerse - Server Game Laptop
cd /d "%~dp0"
color 0A
echo ============================================================
echo        EduVerse - Server Game Lokal (Laptop)
echo ============================================================
echo.
echo Server sedang berjalan...
echo - Akses dari Laptop : http://localhost:3000
echo - Panduan Guru      : http://localhost:3000/guru.html
echo - Dashboard Admin   : http://localhost:3000/admin.html
echo.
echo JANGAN TUTUP jendela ini selama murid sedang bermain.
echo ============================================================
echo.
node server.js
pause
