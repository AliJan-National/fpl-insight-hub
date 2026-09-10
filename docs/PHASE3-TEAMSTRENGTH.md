# Phase 3 — Team Strength Model (teamRatingsV2)

**Status: built, tested, NOT in production.** Ships beside the legacy `osmBuild()` (v25).
No decision surface consumes it yet — it is the feed the Phase-5 event model needs.

## Files changed

| file | change |
|---|---|
| `src/models/team-strength.js` | NEW — `teamRatingsV2()` + calibrated `expectedGoals(home, away)` |
| `build.js` | manifest gains `src/models/team-strength.js` |
| `app.js` | regenerated; production behaviour unchanged |
| `index.html` | `app.js?v=38` -> `app.js?v=39` (cache bust only) |
| `tests/run.js` | section 8: 5 real-data checks |
| `tests/teamstrengthV2_test.js` | NEW dev suite — 21 checks |
| `tests/minutesV2_test.js` | GW4 holdout auto-gate appended (dormant until GW4 data lands) |

## Formulas

- **Signal blend**: `0.6 xG + 0.4 goals` for attack and defence (xG stabler, goals capture finishing).
- **Shrinkage**: `w = n/(n+7)` toward the league mean — **30% current at 3 games, 50% at 7, 70% at 16**
  (the audit's schedule, continuous and data-driven). Home/away splits shrink toward the team's own
  overall rating (K=3) because each is a 1-2 game sample.
- **Opponent adjustment**: two multiplicative iterations, mean-renormalized —
  `att[t] = attShr[t] / mean(def of opponents faced)`, symmetric for defence.
- **Expected goals**: `hg = baseH x attHome[home] x defAway[away]`, calibrated by a scalar so predicted
  totals over the real matches equal actual totals (this season: cH 0.86, cA 1.076).

## Real numbers (GW1-3, 30 matches)

- Top attacks (opponent-adjusted): **BHA 1.28 · MUN 1.19 · BRE 1.18 · CHE 1.13 · MCI 1.12**
- Best defences: **ARS 0.75 · MCI 0.86 · LEE 0.86** (lower = better)
- Home/away tilts legacy cannot see: MUN attack 1.74 at home vs 1.04 away
- Sample pairings from the ratings (any two real clubs): CHE–HUL **1.57–1.14**, LIV–BOU 1.64–1.46, ARS–EVE 1.65–0.70. (An earlier draft quoted MUN–WHU 1.38–1.33 — that was the league-average fallback firing: there is no WHU in this league. Corrected.)
- Calibration: predicted totals 48.0–37.0 vs actual 48–37 (exact after correction)
- Rank agreement with legacy osmBuild: Spearman **0.941** — an evolution, not a random walk

## Test results

Dev suite **21 PASS / 0 FAIL**; CI section 8 green; full battery 25 suites.

## Known weaknesses (honest list)

1. 30 matches is a small sample — the 70% prior weight is doing real work until ~GW6-7.
2. No player-level data (injuries/suspensions weaken a team's true strength) — the model is team-sheet-blind.
3. Two opponent-adjustment iterations, not full convergence — cheap and stable, but approximate.
4. No promotion-team priors from last season's data (all teams start at league mean).
5. Switch decision (replace osmBuild in the fixture model) waits for the GW4+ holdout A/B, same gate as minutes.
