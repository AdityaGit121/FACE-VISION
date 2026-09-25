@echo off
setlocal
cd /d "%~dp0"
title Vision Intelligence Lab

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)

REM First run: do the full setup automatically
if not exist "node_modules" call setup.bat
if not exist "public\ort\ort-wasm-simd-threaded.jsep.wasm" call node scripts\setup-yolo.mjs

REM Open the browser a few seconds after the server starts
start "" /min cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:3000"

echo Starting server on http://localhost:3000  (close this window to stop)
call npm run dev
pause
