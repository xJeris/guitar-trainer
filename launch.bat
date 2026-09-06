@echo off
setlocal
if exist "%~dp0.node\node.exe" (
  set "PATH=%~dp0.node;%PATH%"
)
cd /d "%~dp0app"
if not exist "node_modules" (
  echo Installing dependencies (first run only)...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Make sure Node.js is installed: https://nodejs.org/
    pause
    exit /b 1
  )
)
call npm run dev
