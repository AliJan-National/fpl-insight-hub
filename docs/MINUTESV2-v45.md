# v45 — minutesV2 becomes the production minutes spine

**Date:** 2026-09-15 (after GW4 completed, before the GW5 deadline)
**Verdict that authorised the switch:** the armed A/B gate in `minutesV2_test.js` fired on real GW4 data
(training on GW1-3 only, scoring the hidden GW4):

| metric (GW4 holdout, 659 players) | legacy engine | **minutesV2** | delta |
|---|---|---|---|
| Start-probability Brier (lower = better) | 0.1255 | **0.0811** | **-35%** |
| Expected-minutes MAE | 28.2 min | **13.0 min** | **-54%** |

(The exam-night numbers computed against final GW4 live data were Brier 0.1384 -> 0.0885 and MAE 29.0 -> 13.4; the gate's stripped-history protocol is the stricter, canonical figure.)

## What changed

- `startProb(p)` now **delegates to `minutesV2(p).pStart`** (src/legacy/part-b.js). The legacy engine survives verbatim as `startProbLegacy(p, over)` for the ongoing per-GW A/B.
- `minutesOf(p)` now **serves the minutesV2 ladder** (src/models/projection.js): same field names as before (`pStart`, `p60`, `expMin`, `n`, `avgAll`) plus `p75`, `p90`, `confidence`, `evidence`, `starts`, `minsPerStart`, `engine: 'V2'`. The legacy engine survives as `minutesOfLegacy(p)`.
- Counterfactual what-ifs (`startProb(p, {mins, status})` with changed values) still route to the legacy engine — minutesV2 is built from a player's real pre-deadline state and cannot answer hypotheticals.
- Every consumer — `projP` (the xP gateway), `playerProb`, `forecastOf`, `confOf`, the Free Hit optimizer, wildcard pScore, h2h cards — is now on the V2 spine automatically. `spine_test.js` proves the delegation by memo-poisoning through to `projP`, and fails loudly if a future edit disconnects it.
- Scout/H2H cards: the minutes denominator now tracks `current_gw` (`191/360`, not the stale `/270` that showed Haaland at 133%).
- Retired: `xint_test.js` + `api/xint.json` (the standalone X-intelligence module was replaced by the Elite Manager Trends module several versions ago; the suite had been silently dead since. The frozen `snapshots/GW04/xint.json` keeps the historical copy.)

## The Gakpo case, closed

GW4's captain miss was the trigger. Legacy: 97% start, 81.5 expected minutes. V2: pStart 0.92 but **p75 0.62, p90 0.56** — it saw a ~4-in-10 chance he would not reach the 75th minute. After the refresh his V2 ladder prices the 30-minute withdrawal in: GW5 xP 4.1, and he drops to the FADE quadrant on the crowd map (crowd selling, model cooled). Captain surfaces now have the V2 p90 available for a withdrawal-risk flag (queued for v46).

## Scorecard context (why Phase 5-7 still matters)

- Starters MAE: our xP 2.57 vs official EP 2.62 vs plain form 2.62 — we win, slightly.
- Captain lens (their top-10 actually delivered): **ours 7.2 pts vs 4.2 for EP/form** — the big edge.
- Bias: our xP over-predicts starters by ~1.1 pts/GW — the 0.55*ep + 0.45*form blend extrapolates hot streaks (noted: `ep_next` and `form` are identical for 617/659 players in the current feed, so the blend is effectively pure EP; the real levers are fixture x minutes x reliability). Phases 5-7 (event model) replace this blend.

## Test state

Dev battery: **907 PASS / 0 FAIL across 29 suites** on refreshed GW5 data (was 895 on GW3-era data; +10 spine guards, +2 gate/dynamic-archetype lines, xint's silent zeros retired). The minutes A/B gate re-fires automatically after every refresh: it must keep showing V2 >= legacy, or the switch gets revisited.
