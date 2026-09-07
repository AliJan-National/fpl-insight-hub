#!/usr/bin/env bash
# Refresh all data: repo CSVs + live FPL API, then rebuild dashboard JSON.
set -e
cd "$(dirname "$0")/.."

echo "[1/4] Pulling latest FPL-Core-Insights CSVs..."
if [ -d fpl-core-insights/.git ]; then
  git -C fpl-core-insights pull --ff-only || echo "  (pull skipped/failed — using existing clone)"
else
  echo "  Cloning repo (first run)..."
  git clone --depth 1 --filter=blob:none https://github.com/olbauday/FPL-Core-Insights.git fpl-core-insights
fi

echo "[2/4] Fetching live FPL API (bootstrap + fixtures)..."
UA="Mozilla/5.0 (compatible; FPLInsightHub/1.0)"
curl -s -A "$UA" "https://fantasy.premierleague.com/api/bootstrap-static/" -o fpl_dashboard/raw/bootstrap.json
curl -s -A "$UA" "https://fantasy.premierleague.com/api/fixtures/"        -o fpl_dashboard/raw/fixtures.json

echo "[3/4] Rebuilding base JSON from CSVs..."
python3 fpl_dashboard/build_data.py

echo "[4/4] Enriching with live fixtures, captain picks & price predictions..."
python3 fpl_dashboard/enrich_live.py

echo "Done. Restart the server (python3 fpl_dashboard/server.py) or redeploy /api."
