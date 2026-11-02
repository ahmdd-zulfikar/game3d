@echo off
title EduVerse - Jalur Online (Cloudflare Tunnel)
cd /d "%~dp0"
color 0B
echo ============================================================
echo      EduVerse - Jalur Online Murid (Cloudflare Tunnel)
echo ============================================================
echo.
echo Sedang menyiapkan jalur online...
echo Tunggu sebentar sampai muncul link:
echo 'https://xxxx-xxxx-xxxx.trycloudflare.com'
echo.
echo Salin dan kirim link tersebut ke grup WA / HP murid.
echo JANGAN TUTUP jendela ini selama murid sedang bermain.
echo ============================================================
echo.
npx cloudflared tunnel --url http://localhost:3000
pause
