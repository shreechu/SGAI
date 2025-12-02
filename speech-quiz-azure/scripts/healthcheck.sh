#!/usr/bin/env bash
# Simple healthcheck script for the generated project
BASE_URL="http://localhost:7071/api"

echo "Checking backend health..."
curl -sS --fail "http://localhost:7071/health" | jq || echo "Backend health endpoint failed or jq not installed"

echo
echo "Fetching next question (index 0)..."
curl -sS --fail "$BASE_URL/nextquestion?idx=0" | jq || echo "Next question endpoint failed or jq not installed"

echo
echo "Done."
