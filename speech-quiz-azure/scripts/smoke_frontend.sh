#!/usr/bin/env bash
# Simple smoke-test for the frontend (Vite)
URL="http://localhost:5173/"

echo "Checking frontend at $URL"
if curl -sS --fail "$URL" >/dev/null; then
  echo "Frontend reachable"
  curl -sS "$URL" | sed -n '1,40p'
else
  echo "Frontend not reachable"
  exit 2
fi
