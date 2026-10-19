@echo off
rem Double-click to start Card Research Bot on Windows.
rem The download from GitHub Releases carries its own Node.js in .\runtime, so nothing needs installing.
cd /d "%~dp0"
title Card Research Bot

set "NODE=%~dp0runtime\node.exe"
if exist "%NODE%" goto haveNode

rem No bundled runtime (e.g. a git clone): use an installed Node.js.
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 goto noNode
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 20 goto oldNode

:haveNode
if exist node_modules goto run
where npm >nul 2>nul
if errorlevel 1 goto noModules
echo First run: installing (about a minute)...
call npm install --no-fund --no-audit --omit=dev
if errorlevel 1 goto installFailed

:run
"%NODE%" server.js
echo.
echo The bot has stopped. You can close this window.
pause
exit /b 0

:noNode
echo Node.js is not installed. Download the Windows release from GitHub (it includes everything),
echo or install the LTS version from https://nodejs.org and double-click this file again.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:oldNode
echo Your Node.js is too old. Install the LTS version from https://nodejs.org
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:noModules
echo This folder is missing its node_modules. Download the Windows release zip from GitHub Releases.
pause
exit /b 1

:installFailed
echo Install failed - check the internet connection and try again.
pause
exit /b 1
