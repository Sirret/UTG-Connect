@echo off
title UTG Connect - stop
echo.
echo   Stopping UTG Connect...
echo.

REM Kills only whatever is listening on the two project ports, so any other
REM Node process you have running is left alone.
powershell -NoProfile -Command ^
  "$p = Get-NetTCPConnection -LocalPort 4000,4321 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { $p | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Write-Host '   Stopped.' } else { Write-Host '   Nothing was running.' }"

echo.
REM Not `timeout` - that fails outright when stdin is redirected.
ping -n 3 127.0.0.1 >nul
