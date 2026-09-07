# ⚽ FPL Insight Hub — 2026/27

A free Fantasy Premier League analytics dashboard built entirely on **open data**. No paywall, no account needed.

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

- **[olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights)** — the open dataset (official FPL API + detailed match stats + Elo), refreshed 3× daily.
- **Official FPL API** (`fantasy.premierleague.com/api/`) — live fixtures, expected points, price projections, team picks (via a small Cloudflare Worker proxy).

## Updating the data

The `api/` JSON is a snapshot. Rebuild from latest sources with `bash refresh.sh` (needs Python 3 + pandas), then commit and push.

## Credits & rights

- Data: [olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights) — please keep the attribution.
- FPL data © Premier League. Unofficial fan project, not affiliated with the Premier League.
- Signals are heuristics for fun and insight — not guarantees.
