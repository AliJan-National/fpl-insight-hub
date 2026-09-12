# v42 — GK/DEF Structural Fixture Response

**Triggered by the user's catch:** *"why is the Free Hit team selecting Tzolakis,
playing against Chelsea?"* — a real, systemic flaw. Every tab shares one forecast
spine (projP), so the flaw propagated everywhere. This is a production fix.

## The flaw

projP priced a GK like an outfielder: `baseline x small fixture multiplier`.
Tzolakis's baseline was enormous (ep_next 8.7, form 8.7 — a real GW1-3 save
haul), and the fitted fixture discount away at Chelsea was only x0.867 ->
**6.33 xP**, the highest GK projection in the pool. Meanwhile a quiet keeper
with an easy fixture (Verbruggen, 2.56) was badly under-priced. The model was
fixture-insensitive in BOTH directions for GKs.

## The fix (same trusted inputs: OSM attack/defence rates, results.json, H/A)

- **fxXgaOf(p,i)** — expected goals conceded by the player's team in fixture i:
  `leagueGoals x opponentAttackRel x ownDefenceRel x (H 0.88 / A 1.12)`, clamped [0.3, 3.2].
- **gkStructXp(xga)** — a GK's structural value: `2.3 (play+bonus) + 4 x P(CS) + 0.27 x xGA (save cushion)`.
- **projP for GK**: `clamp(0.30 x outfield-style result + 0.70 x structural, 1.0, 6.5)` —
  70% situation, 30% personal.
- **fixtureFactor for DEF**: xG-for-multiplier now scaled by `defPosAdjOf(xga)` —
  clean-sheet/conceding pricing at 60% strength, clamped [0.85, 1.15].

## Results (real data, GW4)

| | before | after |
|---|---|---|
| Tzolakis (HUL GK, at CHE) | 6.33 (#1) | **4.22 (#2)** |
| Trafford (LEE GK, v NEW H) | 4.94 | **4.26 (#1)** |
| Verbruggen (BHA GK, at COV) | 2.56 | **3.26** |
| Ajayi (HUL DEF, v CHE) adj | 1.0 | **0.85** |
| Calafiori (ARS DEF, at SUN) adj | 1.0 | **1.15** |
| Free Hit GW4 starting GK | Tzolakis (at CHE) | **Trafford (v NEW, xGA 0.96)** |

Monotonicity proven: same keeper, 19 different opponents — xP falls monotonically
as expected-goals-against rises. GK-pool Spearman vs clean-sheet odds: 0.53.

## Tests

`tests/gkfix_test.js` (15 checks — the user's case is the named regression) +
CI section 11. Full battery: **867 PASS / 0 FAIL (28 suites)** — zero fallout.

## Honest notes

1. GKs facing elite attacks DO bank save points — the discount is real but
   bounded (the structural curve never collapses); what died is the baseline
   transfer, not the fixture itself.
2. playerProb distributions (P>=6 etc.) for GKs still use the old pf path —
   acceptable while GKs rarely cross those thresholds; full V2 event model
   (Phase 5-7) supersedes this anyway.
3. League scoring average is a scalar from results.json — becomes the Phase-3
   expectedGoals feed when the V2 spine switches after the GW4 gate.
