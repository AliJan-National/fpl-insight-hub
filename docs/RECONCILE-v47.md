# v47 — Cross-surface reconciliation (Wildcard vs Free Hit)

**The user's catch (2026-09-15, live site):** "Ødegaard is suggested by the Wildcard but
absent from all three Free Hit teams — I think this is illogical. Apply to all players."

## Diagnosis — not a bug, but an unexplained disagreement

Both engines are internally consistent; they answer different questions:

| | Wildcard Lab | Free Hit Lab |
|---|---|---|
| objective | max 3/5-GW pScore inside £100m | max ONE week's xP |
| MID slots | 5 (squad of 15) | 4 (best XI, e.g. 4-4-2) |
| extra terms | +0.6 × team-form (ownForm), DEF clean-sheet bit bonus | none — pure single-GW xP |
| budget behaviour | downtrades expensive points (Saka £9.5m → Ødegaard £6.7m) | spends to £100m for the week |

Ødegaard on the current data: **#7 MID for GW5 (6.20 xP)** — the FH starts the four above
him (Gibbs-White 7.2, Groß 6.9, Saka 6.9, Tavernier 6.8); over 3 GWs his 19.6 pScore at
£6.7m wins the Wildcard's budget race (it downtraded Saka to fit £100m). Both right, both
unexplained — which is what made it look illogical.

## The fix (apply to all players, as requested)

New module `src/decisions/reconcile.js`:
- `reconcileSet()` — computes EVERY conflict between the Wildcard 15 and the FH squads:
  for each Wildcard-only player, his best FH week, per-GW xP, position rank, the FH
  starters rated ahead of him that week, club-quota blocks, and his pScore/price (the
  Wildcard's side of the argument); for each FH-only starter, the mirror (one-week ceiling
  vs the budget race he lost).
- `renderReconcile()` — a "🧩 Wildcard vs Free Hit — why they disagree" card rendered into
  BOTH tabs (`#wcReconcile`, `#fhReconcile`), stating the shared count ("13 of 15") and
  every disagreement with its computed reason.
- Assistant wiring: "why is X not in the free hit team / the wildcard?" and "why do the
  wildcard and free hit disagree?" return the grounded, player-specific reason.

Deterministic, degrade-safe (no fixtures → honest empty), no future data. Test suite
`reconcile_test.js` (18 checks) pins the Ødegaard case, the Saka mirror, determinism,
rendering, assistant answers in both directions, and the degrade path.

## Test state
Dev battery: **925 PASS / 0 FAIL across 30 suites** (was 907/29 — +18 reconciliation checks).
