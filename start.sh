#!/usr/bin/env bash
# UTG Connect launcher for Git Bash / WSL / macOS / Linux.
# On Windows, double-clicking start.bat is easier - this is the same thing for a shell.
set -u

cd "$(dirname "$0")"

printf '\n  UTG Connect\n  ==========================================\n\n'

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed, or is not on your PATH."
  echo "  Install it from https://nodejs.org then run this again."
  exit 1
fi

# ---- API --------------------------------------------------------------------
if [ ! -d backend/node_modules ]; then
  echo "  Installing API dependencies. First run only, takes about a minute..."
  (cd backend && npm install) || { echo "  Install failed."; exit 1; }
fi
[ -f backend/.env ] || { cp backend/.env.example backend/.env; echo "  Created backend/.env"; }

if [ ! -f backend/data/utg.db ]; then
  echo "  Building the database and seeding the demo campus..."
  (cd backend && npm run reset) || { echo "  Seed failed."; exit 1; }
fi

# ---- Web --------------------------------------------------------------------
if [ ! -d frontend/node_modules ]; then
  echo "  Installing web dependencies. First run only, takes a few minutes..."
  (cd frontend && npm install) || { echo "  Install failed."; exit 1; }
fi
[ -f frontend/.env ] || { cp frontend/.env.example frontend/.env; echo "  Created frontend/.env"; }

# ---- Run --------------------------------------------------------------------
echo
echo "  Starting both servers..."

(cd backend && npm run dev) &
API_PID=$!
(cd frontend && npm run dev) &
WEB_PID=$!

# Ctrl+C takes both down together, rather than orphaning one of them.
cleanup() {
  echo
  echo "  Stopping..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null
  wait "$API_PID" "$WEB_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo "  Waiting for the site to come up..."
for _ in $(seq 1 90); do
  if curl -s -o /dev/null http://localhost:4321/ 2>/dev/null; then break; fi
  sleep 1
done

# Open a browser with whatever this platform provides.
if command -v cmd.exe >/dev/null 2>&1; then cmd.exe /c start http://localhost:4321/ >/dev/null 2>&1
elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:4321/ >/dev/null 2>&1
elif command -v open >/dev/null 2>&1; then open http://localhost:4321/ >/dev/null 2>&1
fi

cat <<'EOF'

  ------------------------------------------
    web    http://localhost:4321
    api    http://localhost:4000

    Sign in with any demo account shown on
    the login page. Password for all of them:

        utgconnect1

    Press Ctrl+C here to stop both servers.
  ------------------------------------------

EOF

wait
