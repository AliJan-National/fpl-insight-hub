# FPL Insight Hub — v2.0 Phase 1 Map

**Status: tranche 1 complete. `app.js` is byte-identical to the pre-refactor file** — the split is proven by 
`node build.js --check` and by test 6 in `tests/run.js`. Zero user-visible change, zero maths change.

## The rule from now on

- **`app.js` is generated. Never edit it directly.** Edit the files in `src/`, then run `node build.js`.
- `build.js` concatenates the manifest below **in original order** and rewrites `app.js`.
- `node build.js --check` (and CI test 6) fail if `app.js` and `src/` drift apart.

## Manifest (order = original order in app.js)

| # | file | lines | bytes | content |
|---|------|-------|-------|---------|
| 1 | `src/legacy/part-a.js` | 1–857 | 52,560 | helpers, data load, captain/prices, my team, sell-honesty, charts, team lab |
| 2 | `src/intelligence/market.js` | 858–1033 | 10,313 | Market Pulse v36 (crowd vs model, chips, elite flow) |
| 3 | `src/intelligence/visuals.js` | 1034–1382 | 22,399 | Visuals v37 (market map, elite gap, chip timeline, bargain map) |
| 4 | `src/legacy/part-b.js` | 1383–2479 | 80,934 | opponent-strength, wildcard lab, decision matrix, assistant, mini league, pro suite |
| 5 | `src/models/fixture.js` | 2480–2657 | 9,692 | fixture-response model (calibration, smooth grading, projP base) |
| 6 | `src/models/projection.js` | 2658–3210 | 32,870 | ONE FORECAST OBJECT spine (forecastOf, minutes, probabilities) |
| 7 | `src/validation/backtest.js` | 3211–3349 | 9,477 | backtest lab (leakage-free, out-of-sample) |
| 8 | `src/validation/scorecard.js` | 3350–3566 | 17,543 | xP measurement vs baselines (official EP, form, history) |
| 9 | `src/intelligence/elite.js` | 3567–4117 | 39,131 | elite manager trends (ET data module + renderers) |
| 10 | `src/boot.js` | 4118–4166 | 2,385 | global wiring: tabs, search, team load, proxy, elite ask |

## Section migration map

| section (current) | final home | classification | when |
|---|---|---|---|
| core helpers & data loading | `src/core/utils.js + src/data/loader.js` | **KEEP** | T2 |
| Captain & Prices | `src/decisions/captain.js` | **REFACTOR** | T3 (Phase 9) |
| My Team (official FPL API) | `src/ui/my-team.js + src/data/` | **REFACTOR** | T2 |
| SELL? HONESTY (v32) | `src/decisions/transfer.js` | **REPLACE LATER** | Phase 10 |
| MY TEAM CHARTS (v33) | `src/ui/my-team.js` | **KEEP** | T3 |
| TEAM LAB (v34) | `src/ui/lab.js + src/decisions/lineup.js` | **KEEP** | T3 |
| MARKET PULSE (v36) | `src/intelligence/market.js` | **KEEP** | DONE |
| VISUALS (v37) | `src/intelligence/visuals.js` | **KEEP** | DONE |
| OPPONENT-STRENGTH MODEL | `src/models/team-strength.js` | **REFACTOR** | Phase 3 |
| Wildcard Lab | `src/decisions/wildcard.js` | **REPLACE LATER** | Phase 12 |
| DECISION-MATRIX TRACKER | `src/validation/decision-ledger.js` | **KEEP** | T3 |
| Assistant (data-grounded) | `src/ui/assistant.js` | **KEEP** | T3 (Phase 14 wires V2) |
| MINI LEAGUE WINNING ENGINE | `src/mini-league/*` | **REPLACE LATER** | Phase 13 |
| PRO SUITE (beam search etc.) | `src/decisions/planner.js` | **KEEP** | T3 (Phase 11 rescore) |
| FIXTURE-RESPONSE MODEL | `src/models/fixture.js` | **REFACTOR** | Phase 4 |
| ONE FORECAST OBJECT (v30) | `src/models/projection.js` | **REFACTOR** | Phases 5-7 |
| BACKTEST LAB | `src/validation/backtest.js` | **KEEP + EXTEND** | Phase 8 |
| xP MEASUREMENT | `src/validation/scorecard.js` | **KEEP** | DONE |
| ELITE MANAGER TRENDS | `src/intelligence/elite.js` | **KEEP** | DONE |
| boot & wiring | `src/boot.js` | **KEEP** | DONE |

## Audit-named functions — exact dispositions

| function | line | disposition |
|---|---|---|
| `sellUpgrade()` | 155 | REPLACE in Phase 10 — "highest same-position proj" becomes value = horizon xP − hit − opportunity + fixture/role gain |
| `mlSimulate()` | 2104 | REPLACE in Phase 13 — manager-level Gaussian becomes player-level Monte Carlo |
| `startProb()` | 2452 | REFACTOR in Phase 2 — becomes minutesV2() with P(60+)/P(75+)/P(90), shrinkage; legacy kept for A/B |
| `fixCalib()` | 2488 | KEEP — real GW1-3 opponent calibration (fitted band multipliers) |
| `fixSmooth()` | 2572 | KEEP — v36 smooth fixture interpolation (audit: "good foundation, keep it") |
| `fixtureFactor()` | 2605 | KEEP — the single fixture voice feeding xP and return probabilities (v36) |
| `oppFixOf()` | 2621 | KEEP — per-fixture object incl. displayed-FDR blend (v36) |
| `projP()` | 2645 | REPLACE in Phase 5 — the 0.55×ep_next + 0.45×form blend is the primary projection; ep_next becomes a benchmark |
| `minutesOf()` | 2665 | REFACTOR in Phase 2 — consumed by the forecast spine |
| `forecastOf()` | 2703 | KEEP interface — the canonical forecast spine every decision surface consumes (audit: "very good design") |
| `teamProjAt()` | 2858 | REFACTOR in Phase 11 — beam search KEPT, scoring switched to the V2 distribution |
| `fxLedgerRecord()` | 3360 | KEEP — forecast ledger written before every deadline (leakage control) |

## Full function inventory (212 declarations) — grouped by section


### core helpers & data loading → src/core/utils.js + src/data/loader.js (KEEP, T2)

| line | declaration |
|---|---|
| 3 | `DATA` |
| 5 | `load` |
| 14 | `esc` |
| 15 | `fmtK` |
| 16 | `posBadge` |
| 18 | `renderAll` |

### Captain & Prices → src/decisions/captain.js (REFACTOR, T3 (Phase 9))

| line | declaration |
|---|---|
| 54 | `renderCaptains` |
| 75 | `renderPrices` |

### My Team (official FPL API) → src/ui/my-team.js + src/data/ (REFACTOR, T2)

| line | declaration |
|---|---|
| 80 | `IDS` |
| 81 | `loadIds` |
| 85 | `fetchWithTimeout` |
| 94 | `fplApi` |
| 113 | `ALL_CHIPS` |
| 115 | `loadMyTeam` |

### SELL? HONESTY (v32) → src/decisions/transfer.js (REPLACE LATER, Phase 10)

| line | declaration |
|---|---|
| 148 | `SELL_BAR3` |
| 149 | `SELL_RUN_MAX` |
| 150 | `TOUGH_RUN_MIN` |
| 151 | `runAvg3Of` |
| 155 | `sellUpgrade` |
| 175 | `sellInfo` |

### MY TEAM CHARTS (v33) → src/ui/my-team.js (KEEP, T3)

| line | declaration |
|---|---|
| 188 | `teamMomChart` |
| 238 | `squadHeatHtml` |
| 272 | `posStackHtml` |
| 295 | `renderTeam` |

### TEAM LAB (v34) → src/ui/lab.js + src/decisions/lineup.js (KEEP, T3)

| line | declaration |
|---|---|
| 599 | `LAB_POS_L` |
| 602 | `labUniverse` |
| 627 | `labEpOf` |
| 637 | `labRawOf` |
| 642 | `labFxsOf` |
| 661 | `labTotal` |
| 668 | `labSeries` |
| 679 | `labCompute` |
| 697 | `labCandidateList` |
| 723 | `renderTeamLab` |

### MARKET PULSE (v36) → src/intelligence/market.js (KEEP, DONE)

| line | declaration |
|---|---|
| 869 | `CHIP_LABELS` |
| 872 | `crowdList` |
| 884 | `crowdVerdict` |
| 896 | `crowdSellVerdict` |
| 905 | `chipTrends` |
| 931 | `eliteFlow` |
| 949 | `crowdRowHtml` |
| 974 | `crowdModelHtml` |
| 982 | `chipTrendsHtml` |
| 997 | `eliteFlowHtml` |
| 1013 | `renderMarketPulse` |

### VISUALS (v37) → src/intelligence/visuals.js (KEEP, DONE)

| line | declaration |
|---|---|
| 1041 | `crowdMapLayout` |
| 1066 | `crowdMapSVG` |
| 1117 | `eliteGapData` |
| 1140 | `eliteGapHtml` |
| 1154 | `chipTimelineData` |
| 1173 | `chipTimelineSVG` |
| 1204 | `bargainLayout` |
| 1233 | `bargainMapSVG` |
| 1276 | `renderVisuals` |
| 1287 | `renderLeague` |
| 1298 | `renderTopScorers` |
| 1307 | `renderResults` |
| 1317 | `sigCard` |
| 1329 | `renderRadar` |
| 1342 | `PCOLS` |
| 1349 | `sortKey` |
| 1351 | `renderPlayers` |

### OPPONENT-STRENGTH MODEL → src/models/team-strength.js (REFACTOR, Phase 3)

| line | declaration |
|---|---|
| 1391 | `osmMemo` |
| 1392 | `osmBuild` |
| 1423 | `osmByShort` |
| 1427 | `osmOppLens` |
| 1435 | `osmCardHtml` |
| 1451 | `renderFixtures` |
| 1474 | `renderOsm` |
| 1479 | `renderNews` |

### Wildcard Lab → src/decisions/wildcard.js (REPLACE LATER, Phase 12)

| line | declaration |
|---|---|
| 1493 | `avgN` |
| 1496 | `WC_H` |
| 1497 | `pScore` |
| 1502 | `WC` |
| 1503 | `buildWildcard` |
| 1540 | `renderWildcard` |

### DECISION-MATRIX TRACKER → src/validation/decision-ledger.js (KEEP, T3)

| line | declaration |
|---|---|
| 1589 | `LD_KEY` |
| 1590 | `ldGet` |
| 1591 | `ldSet` |
| 1592 | `ldKey` |
| 1593 | `ldCurGw` |
| 1594 | `ldRecord` |
| 1606 | `ldActual` |
| 1612 | `ldScored` |
| 1624 | `ldStats` |
| 1634 | `ldRenderHtml` |

### Assistant (data-grounded) → src/ui/assistant.js (KEEP, T3 (Phase 14 wires V2))

| line | declaration |
|---|---|
| 1658 | `scout` |
| 1677 | `normName` |
| 1683 | `findPlayer` |
| 1715 | `resolvePair` |
| 1725 | `fxBadges` |
| 1729 | `fxAvgN` |
| 1734 | `hbar` |
| 1737 | `teamDefLine` |
| 1744 | `pairDecision` |
| 1823 | `fxAvg3S` |
| 1824 | `suggestAnswer` |
| 1860 | `osmAsk` |
| 1882 | `askAI` |
| 2033 | `renderLedger` |
| 2038 | `chat` |

### MINI LEAGUE WINNING ENGINE → src/mini-league/* (REPLACE LATER, Phase 13)

| line | declaration |
|---|---|
| 2054 | `ML` |
| 2055 | `FM` |
| 2056 | `mlGw` |
| 2057 | `mlCacheGet` |
| 2058 | `mlCacheSet` |
| 2064 | `ML_POP_SD` |
| 2065 | `ML_SHRINK_K` |
| 2067 | `ML_PLANS` |
| 2073 | `mlVol` |
| 2084 | `mulberry32` |
| 2093 | `mlRandn` |
| 2104 | `mlSimulate` |
| 2137 | `mlFetchEntry` |
| 2154 | `mlSquadStats` |
| 2178 | `mlLoadLeague` |
| 2195 | `mlBuild` |
| 2402 | `mlSummary` |

### PRO SUITE (beam search etc.) → src/decisions/planner.js (KEEP, T3 (Phase 11 rescore))

| line | declaration |
|---|---|
| 2413 | `REL_MEMO` |
| 2414 | `reliab` |
| 2445 | `SEL_MEMO` |
| 2446 | `selState` |
| 2452 | `startProb` |
| 2467 | `selLabel` |
| 2474 | `selLine` |

### FIXTURE-RESPONSE MODEL → src/models/fixture.js (REFACTOR, Phase 4)

| line | declaration |
|---|---|
| 2487 | `FIX_MEMO` |
| 2488 | `fixCalib` |
| 2572 | `fixSmooth` |
| 2601 | `fdrMultOf` |
| 2605 | `fixtureFactor` |
| 2621 | `oppFixOf` |
| 2645 | `projP` |
| 2656 | `hSumP` |

### ONE FORECAST OBJECT (v30) → src/models/projection.js (REFACTOR, Phases 5-7)

| line | declaration |
|---|---|
| 2664 | `MIN_MEMO` |
| 2665 | `minutesOf` |
| 2689 | `confOf` |
| 2703 | `forecastOf` |
| 2721 | `modelXpById` |
| 2725 | `fcOfId` |
| 2730 | `fcMetaLine` |
| 2742 | `PP_MEMO` |
| 2743 | `PP_K` |
| 2744 | `ppScores` |
| 2745 | `ppBaseRates` |
| 2757 | `playerProb` |
| 2795 | `ppRows` |
| 2811 | `distShape` |
| 2829 | `distOf` |
| 2847 | `distBar` |
| 2855 | `startersAt` |
| 2858 | `teamProjAt` |
| 2867 | `capLev` |
| 2878 | `capLevColor` |
| 2882 | `capFieldOf` |
| 2887 | `capLevLine` |
| 2897 | `ppOfId` |
| 2903 | `LEGAL_FMS` |
| 2904 | `posKey` |
| 2906 | `bestXI` |
| 2921 | `shapeOK` |
| 2930 | `pfxCol` |
| 2934 | `playerScheduleSVG` |
| 3005 | `sparkSVG` |
| 3027 | `PLAN_MARK` |
| 3028 | `planPoolCand` |
| 3032 | `planGreedy` |
| 3062 | `planReplay` |
| 3077 | `planBeam` |
| 3118 | `solvePlan` |
| 3164 | `chipOptimizer` |
| 3197 | `buildFH` |

### BACKTEST LAB → src/validation/backtest.js (KEEP + EXTEND, Phase 8)

| line | declaration |
|---|---|
| 3217 | `btStarterRows` |
| 3233 | `btOOF` |
| 3276 | `btRoll` |
| 3297 | `btCalibTable` |
| 3312 | `labDigestHtml` |
| 3345 | `renderLabDigest` |

### xP MEASUREMENT → src/validation/scorecard.js (KEEP, DONE)

| line | declaration |
|---|---|
| 3356 | `FL_KEY` |
| 3357 | `flGet` |
| 3358 | `flSet` |
| 3359 | `flOpenGw` |
| 3360 | `fxLedgerRecord` |
| 3377 | `fxBench` |
| 3403 | `btXpCard` |
| 3422 | `renderBacktest` |
| 3447 | `CMP_COLORS` |
| 3449 | `cmpChartSVG` |
| 3490 | `distCompareCard` |
| 3509 | `renderCompare` |

### ELITE MANAGER TRENDS → src/intelligence/elite.js (KEEP, DONE)

| line | declaration |
|---|---|
| 3574 | `ET` |
| 3780 | `eh` |
| 3781 | `eBar` |
| 3785 | `ePos` |
| 3786 | `eCls` |
| 3787 | `eLink` |
| 3790 | `eliteDq` |
| 3816 | `elitePulse` |
| 3846 | `eliteSkillLens` |
| 3870 | `eliteTrends` |
| 3892 | `eliteCap` |
| 3912 | `eliteTemplate` |
| 3922 | `elitePlayers` |
| 3946 | `FOLDN` |
| 3947 | `eliteVerdict` |
| 3957 | `eliteMoves` |
| 3980 | `eliteTeam` |
| 4001 | `eliteReport` |
| 4025 | `eliteAsk` |
| 4102 | `D2` |
| 4105 | `renderElite` |

### boot & wiring → src/boot.js (KEEP, DONE)

| line | declaration |
|---|---|
| 4132 | `savedProxy` |
| 4151 | `eliteAnswer` |

## Phase gates (from the v2.0 spec — do not skip)

- **Phase 2**: Minutes model — `minutesV2()` beside legacy `startProb()`; A/B on real data before switching
- **Phase 3**: Team strength — attack/defence ratings with shrinkage; backtest vs v1
- **Phase 4**: Fixture model — position-aware difficulty (att/mid/def/GK), keep v36 smooth grading
- **Phase 5**: Event model — goal/assist/CS/bonus probabilities from underlying stats
- **Phases 6-7**: forecastV2() + full points distribution (floor/median/ceiling); ep_next demoted to benchmark
- **Phase 8**: Backtest matrix — decisions, not just predictions; baselines mandatory (EP, form, history, xGI)
- **Phase 9**: Captain engine — SAFE / BALANCED / DIFFERENTIAL with distribution-aware scoring
- **Phase 10**: Transfer engine — horizon value with hit/opportunity/fixture/role decomposition
- **Phase 11**: Planner — beam search kept, objective switched to V2 forecast
- **Phase 12**: Wildcard — global squad optimization with correlation
- **Phase 13**: Mini League — player-level Monte Carlo (10k+ sims), effective gap, strategy engine
- **Phase 14**: Assistant wired to the V2 engine (LLM explains, never predicts)
- **Phase 15**: UI polish — floor/median/ceiling displays etc.

Every phase gate requires: old vs new numbers on real data, all tests green, and a rollback path.
