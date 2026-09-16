@echo off
chcp 65001 >nul
cd /d "%~dp0"

taskkill /IM Hikari.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

node scripts\make-icon.mjs
if errorlevel 1 exit /b 1

call npm run dist
if errorlevel 1 (
  echo Build failed, retrying after killing Hikari.exe
  taskkill /IM Hikari.exe /F >nul 2>&1
  timeout /t 1 /nobreak >nul
  call npm run dist
)

if exist "dist\Hikari-Setup-*.exe" (
  echo Built installer in dist\
) else (
  echo Installer not found in dist\
  exit /b 1
)
