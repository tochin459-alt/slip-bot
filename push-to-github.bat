@echo off
title Push Slip Bot to GitHub
cd /d C:\tchin-slip-bot
"C:\Program Files\Git\cmd\git.exe" push -u origin main
echo ====================================================
echo Finished! Check Render dashboard now.
echo ====================================================
pause
