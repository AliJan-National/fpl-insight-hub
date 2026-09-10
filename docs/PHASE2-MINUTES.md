# Phase 2 — Minutes Model (minutesV2)

**Status: built, tested, NOT in production.** No decision surface consumes it yet — it ships beside the
legacy `startProb()`/`minutesOf()` for A/B comparison, exactly as the v2.0 spec requires. Production
behaviour is unchanged (CI test 6 still proves app.js == src/ manifest; the only payload change is the
new module itself plus the `app.js?v=38` cache stamp).

## Files changed

| file | change |
|---|---|
| `src/models/minutes.js` | NEW — `minutesV2(p)` + `v2mPriors()` (pool priors), 122 lines |
| `build.js` | manifest gains `src/models/minutes.js` (before projection.js) |
| `app.js` | regenerated (4,166 -> 4,288 lines); nothing else touched |
| `index.html` | `app.js?v=37` -> `app.js?v=38` (cache bust only) |
| `tests/run.js` | section 7: 5 real-data checks (nailed/injured+suspended/cameo/official-gate/full sweep) |
| `tests/minutesV2_test.js` | NEW dev suite — 21 checks, the audit's six archetypes on real players |

## Formulas (all pre-deadline features only)

- **Availability gate**: `avail = f(status, chance_next)` — suspension (status/news) -> 0.05;
  injured -> 0.05; official doubt -> `0.05 + 0.9 x chance/100` (a 75% doubt is more informative than
  the status letter); clean -> 1.
- **Start rate**: recency-weighted Beta-Binomial. `w = 0.85^(latestGW-gw)`; personal prior
  `bP = min(0.93, posStartRate + 0.45 x weightedShareOf75+MinuteStarts)` (playing 75+ whenever selected
  is role security); `pStartRaw = (S + 0.7*bP) / (W + 0.7)`.
- **Depth ladder**: his real >=60/>=75/>=90 shares among starts, each shrunk one pseudo-count toward
  the position prior; enforced `p90 <= p75 <= p60 <= pStart` where
  `pXX = pStart x depthXX` (a cameo cannot cross 60').
- **Expected minutes**: `avail x [ pStartRaw x minsPerStart(shrunk) + (1-pStartRaw) x P(play|bench) x cameoAvg ]`,
  clamped to 95.
- **Confidence**: `overall = 0.40 x data + 0.35 x minutesStability + 0.25 x availability`, each 0-1 and
  reported separately.

## Test results

- Dev suite `minutesV2_test.js`: **21 PASS / 0 FAIL** (six audit archetypes, official-gate checks,
  full-pool monotonic sweep over all 654 players, determinism).
- In-repo CI section 7: 5 checks on real data. Full battery: 24 suites green.

## Old vs new on representative real players (GW1-3)

| player (history) | legacy pStart | V2 pStart | V2 p60 / p90 | legacy expMin | V2 expMin |
|---|---|---|---|---|---|
| Haaland (90-90-90) | 0.97 | 0.93 | 0.93 / 0.83 | 88 | 82.6 |
| B.Fernandes (90-90-90) | 0.97 | 0.95 | 0.95 / 0.82 | 88 | 83.5 |
| Cherki (27-81-65) | 0.75 | 0.66 | 0.66 / 0.10 | 61.6 | 59.3 |
| Mukiele (0-90-90) | 0.80 | 0.72 | 0.72 / 0.66 | 76.2 | 63.9 |
| Wieffer (injured, 0%) | 0.04 | 0.03 | 0.03 / 0.01 | **24.1** | **2.5** |
| Gomes (suspended) | 0.02 | 0.01 | 0.01 / 0.00 | **39.8** | **0.9** |
| Isidor (23-26-26) | **0.39** | 0.05 | 0.05 / 0.03 | 47.3 | 28.0 |
| Collins (25% doubt) | 0.32 | 0.17 | 0.17 / 0.16 | 39.6 | 16.9 |
| Mosquera (75% doubt) | 0.30 | 0.45 | 0.45 / 0.27 | 40.6 | 38.4 |

The headline honesty wins: legacy gives a **suspended** player 39.8 expected minutes and an **injured**
one 24.1 — V2 gives 0.9 and 2.5. Legacy calls a 23-minute cameo player a 39% starter — V2 says 5%.
And V2 finally uses the official chance-to-play percentages (legacy ignores them).

## Known weaknesses (honest list)

1. Only 3 GW of history — priors carry real weight until ~GW6; the 0.85 recency decay needs re-tuning
   as the season ages.
2. No fixture-congestion feature yet (blank/double GWs, European midweeks) — needs a fixtures-per-GW
   feed from the team data.
3. News parsing is keyword-level only (suspension); injury return dates are not yet parsed.
4. Calibration vs actual GW4+ outcomes is the real test — that happens through the Backtest Lab once
   GW4 completes (the forecast ledger already records pre-deadline state).
5. The switch decision (replace startProb/minutesOf in the forecast spine) waits for that A/B evidence,
   per the spec's "do not switch until V2 demonstrates measurable improvement".
