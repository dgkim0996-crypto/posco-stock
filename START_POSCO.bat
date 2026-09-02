@echo off
cd /d "%~dp0"
echo [POSCO Securities] Project folder: %CD%
if not exist package.json (
  echo ERROR: package.json not found in this folder.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing npm packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Check the error above.
    pause
    exit /b 1
  )
)
echo Starting Vite dev server...
call npm run dev
pause
