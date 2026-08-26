@echo off
title UTG Connect - stop
echo.
echo   Stopping UTG Connect...
echo.

REM Two ways to find our processes, feeding the same kill: (1) whatever owns
REM ports 4000/4321 - nothing else on the machine binds those - and (2) a
REM command-line fingerprint sweep, for an earlier launch that was never
REM stopped and lost the port race to a newer one (its node/astro processes
REM are still running, just not listening on anything anymore).
REM
REM Either way, the PID found is buried several layers deep (node --watch's
REM actual child -> the --watch parent -> npm's own cmd.exe wrapper -> the
REM "cmd /k npm run dev" window start.bat opened), so killing just that one
REM PID leaves the visible window and everything above it running. Both paths
REM walk back up to that "npm run dev" window and taskkill /T the whole tree.
powershell -NoProfile -Command ^
  "function RootDevWindow($startId) {" ^
  "  $id = $startId; $best = $startId;" ^
  "  for ($i = 0; $i -lt 8; $i++) {" ^
  "    $proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$id\" -ErrorAction SilentlyContinue;" ^
  "    if (-not $proc) { break };" ^
  "    if ($proc.Name -eq 'cmd.exe' -and $proc.CommandLine -match 'npm run dev') { $best = $id; break };" ^
  "    $id = $proc.ParentProcessId;" ^
  "    if (-not $id) { break }" ^
  "  };" ^
  "  return $best" ^
  "};" ^
  "$leaves = @();" ^
  "$leaves += Get-NetTCPConnection -LocalPort 4000,4321 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess;" ^
  "$leaves += Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='cmd.exe'\" -ErrorAction SilentlyContinue |" ^
  "  Where-Object { $_.CommandLine -match 'src/boot\.js' -or $_.CommandLine -match '--port 4321' } |" ^
  "  Select-Object -ExpandProperty ProcessId;" ^
  "if (-not $leaves) { Write-Host '   Nothing was running.'; exit };" ^
  "$roots = $leaves | Select-Object -Unique | ForEach-Object { RootDevWindow $_ } | Select-Object -Unique;" ^
  "foreach ($r in $roots) { Start-Process taskkill -ArgumentList '/F','/T','/PID',$r -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue };" ^
  "Write-Host '   Stopped.'"

echo.
REM Not `timeout` - that fails outright when stdin is redirected.
ping -n 3 127.0.0.1 >nul
