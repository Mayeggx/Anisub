@echo off
setlocal EnableExtensions

cd /d "%~dp0" || exit /b 1

set "FRONTEND_URL=http://localhost:5173"
set "FRONTEND_WAIT_TIMEOUT_SECONDS=90"
set "BROWSER_OPEN_FLAG=%TEMP%\anisub-browser-opened-%RANDOM%-%RANDOM%.flag"
if exist "%BROWSER_OPEN_FLAG%" del /f /q "%BROWSER_OPEN_FLAG%" >nul 2>nul

where npm >nul 2>nul
if errorlevel 1 (
  echo [start-dev] npm was not found. Please install Node.js first.
  exit /b 1
)

call :RunDev "First attempt"
if not errorlevel 1 goto :eof

echo [start-dev] First start failed. Running npm install once...
call npm install
set "INSTALL_EXIT=%ERRORLEVEL%"
if not "%INSTALL_EXIT%"=="0" (
  echo [start-dev] npm install failed. Cannot continue.
  exit /b 1
)

call :RunDev "Second attempt"
if not errorlevel 1 goto :eof

echo [start-dev] Second start still failed. Check dependencies or port usage.
exit /b 1

:RunDev
set "LABEL=%~1"
call :WaitAndOpenBrowserAsync "%LABEL%"
echo [start-dev] %LABEL%: running npm run dev
call npm run dev
set "DEV_EXIT=%ERRORLEVEL%"
if not "%DEV_EXIT%"=="0" (
  echo [start-dev] %LABEL%: npm run dev exited with code %DEV_EXIT%
  exit /b 1
)
exit /b 0

:WaitAndOpenBrowserAsync
set "LABEL=%~1"
echo [start-dev] %LABEL%: waiting for frontend before opening browser...
start "" /B powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "$url='%FRONTEND_URL%';" ^
  "$timeout=%FRONTEND_WAIT_TIMEOUT_SECONDS%;" ^
  "$flag='%BROWSER_OPEN_FLAG%';" ^
  "$deadline=(Get-Date).AddSeconds($timeout);" ^
  "while((Get-Date) -lt $deadline){" ^
  "  if(Test-Path -LiteralPath $flag){ exit 0 }" ^
  "  try{ Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null; New-Item -Path $flag -ItemType File -Force | Out-Null; Start-Process $url; exit 0 } catch{}" ^
  "  Start-Sleep -Milliseconds 800" ^
  "}" ^
  "exit 0"
exit /b 0
