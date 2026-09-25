@echo off
setlocal
cd /d "%~dp0"
title Vision Intelligence Lab - Setup

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install the LTS version from https://nodejs.org then run setup.bat again.
  pause
  exit /b 1
)

echo [1/3] Installing dependencies (also downloads the YOLO runtime files)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] npm install failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo [2/3] Checking YOLO model and runtime...
call node scripts\setup-yolo.mjs

echo [3/3] Checking environment file...
if not exist ".env" (
  if exist ".env.example" copy /y ".env.example" ".env" >nul
  echo Created .env - open it and paste your GEMINI_API_KEY if you want Deep Scan.
)

echo.
echo Setup complete. Double-click run.bat to start.
pause
