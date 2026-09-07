# ⚽ FPL Insight Hub — 2026/27

A free Fantasy Premier League analytics dashboard built entirely on **open data**. No paywall, no account needed.

## Features

| Tab | What it does |
|---|---|
| **Overview** | Live league table, top FPL scorers, results with xG |
| **My Team** | FPL Team ID → projected best XI, verdicts, captaincy (form+fixture), budget-checked sell→buy pairs, GW-by-GW game plan, 5-fixture swing, targets, chips |
| **Transfer Radar** | Buy/sell signals: xG regression, transfer momentum, differentials |
| **Captain & Prices** | Ranked captain picks + predicted price rises/falls |
| **Players** | 650+ players — sortable by points, xG, G−xG, CBIT, ownership, price, form |
| **Fixtures** | Next 3 gameweeks with fixture difficulty |
| **Injuries & News** | Flagged players with return chances |

## Data sources

- **[olbauday/FPL-Core-Insights](https://github.com/olbauday/FPL-Core-Insights)** — open dataset, refreshed 3× daily.
- **Official FPL API** — via a small Cloudflare Worker proxy.

## Updating

`bash refresh.sh` (Python 3 + pandas), then commit & push.

## Credits

Data: olbauday/FPL-Core-Insights (free & open) — attribution kept. FPL data © Premier League. Unofficial fan project. Signals are heuristics — not guarantees.
