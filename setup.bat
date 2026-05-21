@echo off
setlocal enabledelayedexpansion
title PocraEnd - Developer Setup

echo ============================================
echo   PocraEnd developer setup
echo ============================================
echo.

REM --- Check Node is installed ---
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is NOT installed.
  echo  Download Node 20 LTS from https://nodejs.org  ^(click the green LTS button^)
  echo.
  pause
  exit /b 1
)

REM --- Read Node major version ---
for /f "tokens=1 delims=." %%v in ('node -v') do set NODEVER=%%v
set NODEVER=!NODEVER:v=!

if !NODEVER! LSS 18 (
  echo  Node !NODEVER! is too old. Install Node 20 ^(or newer^) from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo  Node !NODEVER! detected - good.
echo.

REM --- Clean any broken previous install ---
if exist node_modules (
  echo  Removing old node_modules...
  rmdir /s /q node_modules
)
if exist package-lock.json del /f /q package-lock.json

REM --- Install dependencies ---
echo  Installing dependencies ^(this can take a few minutes^)...
echo.
call npm install
if errorlevel 1 (
  echo.
  echo  Install failed - see the messages above.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Setup complete.
echo   Start the app with:   npm run dev
echo ============================================
pause
