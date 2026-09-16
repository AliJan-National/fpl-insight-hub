# v48 — the automated refresh loop (data-refresh workflow)

**What the user asked for:** "the engine refines itself and updates automatically after every GW."

## What runs

`.github/workflows/refresh.yml` — scheduled **Tue/Wed/Fri 07:00 Riyadh (04:00 UTC)** plus a
manual **Run workflow** button (Actions tab → data-refresh). Each run:

1. **Fetches open data** — the FPL-Core-Insights CSV repo + the official FPL bootstrap and
   fixtures endpoints. Nothing paid, no secrets, public data only.
2. **The gate** (`tools/gw_gate.py`) — the standing rule enforced in code:
   - **BLOCKS** mid-gameweek (some matches played, some not) — partial data can never reach
     the live site. Also blocks when the deadline has passed but matches have not kicked
     off, and when the CSV source lags behind the completed GW (auto-retries next run).
   - **REFRESH** after a GW completes, **SOFT** in between (price/news drift only).
   - Postponed/blank fixtures (kickoff >7 days out) are ignored so one postponement cannot
     stall a season.
3. **Rebuilds** every dataset (`build_data.py`, `enrich_live.py`) — all model numbers
   (minutesV2 ladders, team strengths, fixture pricing, form) recompute from the new GW.
4. **Elite trends** (`elite_ingest.py`, post-GW runs only) — the world top-40's real picks.
5. **Smoke test** (`tools/smoke_test.js`) — BLOCKING data-shape gate: 20 teams, full player
   universe, history includes the completed GW, ticker window filled (the v46 invariant),
   elite current, no NaN. A failure commits nothing.
6. **Snapshot freeze** (`tools/freeze_snapshot.js`) — freezes `snapshots/GW{next}/`
   (api + predictions + the Free Hit suggestion + MANIFEST) **once**: if the folder exists
   it is never touched. The honesty rule, enforced in code.
7. **Regression report** — the full 85-test suite runs non-blocking with a step summary;
   prediction-pin drift after a new GW is expected weekly and re-baselines with the next
   engine release. Structural breakage is caught by the smoke test.
8. **Commits** `api/` + `snapshots/` to main only if anything changed → GitHub Pages
   deploys it. The Free Hit Audit card lights up for the completed GW automatically.

## What this changes for you

- **No more weekly zips for data.** Zips are now only for engine changes (like v45-v47).
- The Tuesday run replaces the manual "refresh after the GW finishes" ritual entirely.
- If a Tuesday run is blocked (data lag), Wednesday's retries automatically.

## Known limits (honest)

- The CSV path is season-hardcoded (`data/2026-2027`) — needs a one-line bump next season.
- Prediction-pin drift shows as amber in the report, not red X's on the repo.
- `elite_ingest.py` reads the world top-40 each post-GW run (~600 public API calls, ~20s).
- The models recompute automatically; the model WEIGHTS still change only through the
  gated A/B process (audit spec rule — one GW is noise, no self-tuning).

## Deploy note

One-time deploy of this workflow + tools (v48 zip). After it is pushed, the loop is live:
the first scheduled run is the next Tue/Wed/Fri 07:00 Riyadh. GW05 completes Sep 20 → the
Sep 22 run refreshes, freezes `snapshots/GW06/`, and the audit lights up for GW05.
