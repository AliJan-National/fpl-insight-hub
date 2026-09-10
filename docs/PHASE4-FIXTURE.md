# Phase 4 — Position-Aware Fixture Difficulty (fixtureDifficultyV2)

**Status: built, tested, NOT in production.** Sits beside the legacy v36 `fixtureFactor()`/`oppFixOf()`.
Consumes Phase 3's `teamRatingsV2()` (opponent-adjusted, home/away split, calibrated).

## Files changed

| file | change |
|---|---|
| `src/models/fixture-v2.js` | NEW — `fixtureDifficultyV2(team, opp, ha)` + `posFixGrade(p, i)` player bridge |
| `build.js` | manifest gains `src/models/fixture-v2.js` |
| `app.js` | regenerated; production behaviour unchanged |
| `index.html` | `app.js?v=39` -> `app.js?v=40` (cache bust only) |
| `tests/run.js` | section 9: 4 real-data checks |
| `tests/fixtureV2_test.js` | NEW dev suite — 19 checks |
| `docs/PHASE3-TEAMSTRENGTH.md` | corrected a sample line that used a nonexistent club (WHU — league-average fallback had fired silently) |

## Formulas (continuous, no bucket edges — the v36 lesson)

- **FWD**: piecewise-linear map of his team's expected goals in the fixture (0.5 xG → 4.8 hard … 3.5 xG → 1.0 easy).
- **DEF**: piecewise-linear map of clean-sheet probability `P(opp scores 0) = exp(-oppXG)` (10% CS → 4.8 … 72% CS → 1.2).
- **GK**: DEF map, minus 0.2 when ≥3.5 expected saves (busy keepers bank save points).
- **MID**: `0.65 x FWD + 0.35 x DEF` (mids earn both).
- Labels: great ≤1.8 < good ≤2.6 < neutral ≤3.4 < tricky ≤4.2 < tough.

## Real GW4 grades (the audit's example, with real clubs)

| fixture | xG for–against | CS% | FWD | MID | DEF | GK |
|---|---|---|---|---|---|---|
| MUN v MCI (H) | 1.87–2.15 | 12% | **1.83** | 2.81 | **4.64** | 4.44 |
| LEE v ARS (A) | 0.67–1.35 | 26% | **4.35** | 3.98 | 3.31 | 3.31 |
| SUN v MCI (A) | 0.81–1.54 | 21% | 3.97 | 3.88 | 3.70 | 3.70 |
| CHE v HUL (H) | 1.57–1.14 | 32% | 2.24 | 2.46 | 2.85 | 2.85 |
| BHA v COV (A) | 1.65–1.53 | 22% | 2.13 | 2.67 | 3.68 | 3.68 |

MUN v MCI is the poster child: easy for attackers, brutal for defenders — one official number cannot say that.

## Honest finding: the official FDR disagrees with real GW1-3 data

Spearman correlations over the 60 real upcoming fixtures:

- our DEF/GK/MID grades vs official FDR: **+0.31 / +0.31 / +0.36** (positive, moderate)
- **the official FDR vs opponents' real attack strength: only +0.35** (and −0.26 vs defence)

So our alignment sits at the ceiling the data allows: the official lens itself is only 0.35-correlated
with what actually happened. The divergence is the product ("Real FDR: instead of trusting the coarse
1-5 official difficulty" — the v25 module's founding line, now quantified).

## Test results

Dev suite **19 PASS / 0 FAIL**; CI section 9 green; monotonicity proven both directions
(MCI-home opponents by away attack; CHE-away opponents by home attack).

## Known weaknesses (honest list)

1. Poisson clean-sheet simplification (no score-state, no red cards, no late-game CS loss patterns).
2. GK save estimate is a constant (1.86 × oppXG) from a league-average conversion rate.
3. No player-level context yet (penalties/set pieces are Phase 5; a fixture easy for a team is not
   equally easy for every player in it).
4. Same 30-match sample limits as Phase 3 — ratings firm up as GWs accumulate.
5. Switch decision (replacing fixtureFactor in the spine) waits for the GW4+ holdout gate with the
   other V2 modules.
