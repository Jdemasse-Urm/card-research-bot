@echo off
rem Double-click to start Card Research Bot on Windows.
cd /d "%~dp0"
title Card Research Bot

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org then double-click this file again.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 (
  echo Your Node.js is too old. Install the LTS version from https://nodejs.org
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing ^(about a minute^)...
  call npm install --no-fund --no-audit
  if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

call npm start
pause
