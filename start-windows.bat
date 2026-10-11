@echo off
rem Blockforge: start the game server and put it online with a free public link.
title Blockforge Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is needed to run the server.
  echo Install the LTS version from https://nodejs.org and then run this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\ws\" (
  echo Installing the server (one time only^)...
  call npm install --omit=dev
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server\online.js
pause
