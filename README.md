# ⚽ FPL Insight Hub — 2026/27

A free Fantasy Premier League analytics dashboard built entirely on **open data**. No paywall, no account needed.

**Live demo data season:** 2026/27 · updates via the open dataset below.

## Features

| Tab | What it does |
|---|---|
| **Overview** | Live league table, top FPL scorers, results with xG |
| **My Team** | Enter your FPL Team ID → your squad with upcoming fixture difficulty, affordable transfer targets, chip strategy (double/blank GW detection) |
| **Transfer Radar** | Buy/sell signals with reasons: xG regression, transfer momentum, differentials |
| **Captain & Prices** | Ranked captain picks (fixture + penalty adjusted) and predicted price rises/falls from official FPL transfer momentum |
| **Players** | 650+ players — searchable & sortable by points, xG, G−xG, CBIT defensive actions, ownership, price, form |
| **Fixtures** | Next 3 gameweeks with colour-coded fixture difficulty |
| **Injuries & News** | All flagged players with return chances |

## Data sources

- **[olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights)** — the open dataset (official FPL API + detailed match stats + Elo), refreshed 3× daily. Thanks to the author for making this freely available.
- **Official FPL API** (`fantasy.premierleague.com/api/`) — live fixtures, expected points, price projections, team picks.

## How it works

This is a 100% static site: `index.html` + `app.js` + `styles.css` + pre-built JSON in `api/`. The "My Team" feature calls the official FPL API directly from your browser (with a CORS-relay fallback for static hosting). No server, no database, no tracking.

## Updating the data

The `api/` JSON is a snapshot. To rebuild it from the latest source data, run:

```bash
bash refresh.sh
```

(Requires Python 3 + `pandas`, and clones the FPL-Core-Insights repo next to this folder.)

## Deploying

See [DEPLOY.md](DEPLOY.md). Quick version: this repo root is GitHub-Pages-ready — enable Pages in **Settings → Pages → Deploy from branch → main / root** (the `.nojekyll` file is included).

## Credits & rights

- Data: [olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights) (free & open) — please keep the attribution.
- FPL data © Premier League. This is an unofficial fan project, not affiliated with the Premier League.
- Signals (captain picks, price predictions, transfer suggestions) are heuristics for fun and insight — not guarantees.
