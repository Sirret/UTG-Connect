@echo off
setlocal enabledelayedexpansion
title UTG Connect - launcher
cd /d "%~dp0"

echo.
echo   UTG Connect
echo   ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed, or is not on your PATH.
  echo   Install it from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

REM ---- API -------------------------------------------------------------------
if not exist "backend\node_modules" (
  echo   Installing API dependencies. First run only, takes about a minute...
  pushd backend
  call npm install
  popd
  if errorlevel 1 goto failed
)

if not exist "backend\.env" (
  copy /y "backend\.env.example" "backend\.env" >nul
  echo   Created backend\.env
)

if not exist "backend\data\utg.db" (
  echo   Building the database and seeding the demo campus...
  pushd backend
  call npm run reset
  popd
  if errorlevel 1 goto failed
)

REM ---- Web -------------------------------------------------------------------
if not exist "frontend\node_modules" (
  echo   Installing web dependencies. First run only, takes a few minutes...
  pushd frontend
  call npm install
  popd
  if errorlevel 1 goto failed
)

if not exist "frontend\.env" (
  copy /y "frontend\.env.example" "frontend\.env" >nul
  echo   Created frontend\.env
)

REM ---- Cache ------------------------------------------------------------------
REM `npm run dev` never registers the service worker at all (Base.astro skips
REM it in dev — a cache-first worker only fights Vite's own hot-reload), so
REM this is not needed for the usual localhost:4321 workflow. It only matters
REM if you later run `npm run preview` to sanity-check the real production
REM build, where the worker *is* active by design — this stamps it with a
REM fresh cache key first, so that check never serves a stale build by accident.
pushd frontend
call node scripts\bump-sw-cache.mjs
popd

REM ---- Run -------------------------------------------------------------------
echo.
echo   Starting both servers, each in its own window...
start "UTG Connect API" /D "%~dp0backend"  cmd /k npm run dev
start "UTG Connect Web" /D "%~dp0frontend" cmd /k npm run dev

echo   Waiting for the site to come up...
set /a tries=0

:wait
set /a tries+=1
curl -s -o nul http://localhost:4321/
if not errorlevel 1 goto ready
if !tries! geq 90 goto slow
REM Not `timeout` - it errors out whenever stdin isn't a real interactive console.
ping -n 2 127.0.0.1 >nul
goto wait

:slow
echo   Taking longer than expected - check the two server windows for errors.
goto open

:ready
echo   Ready.

:open
start "" http://localhost:4321/
echo.
echo   ------------------------------------------
echo     web    http://localhost:4321
echo     api    http://localhost:4000
echo.
echo     Sign in with any demo account shown on
echo     the login page. Password for all of them:
echo.
echo         utgconnect1
echo.
echo     To stop everything: run stop.bat, or just
echo     close the two server windows.
echo   ------------------------------------------
echo.
echo   You can close this window - the servers keep running.
echo.
pause
exit /b 0

:failed
echo.
echo   Install failed. Scroll up to see what went wrong.
echo.
pause
exit /b 1
