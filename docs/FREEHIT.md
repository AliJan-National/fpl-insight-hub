# Free Hit Lab — one-week squad optimizer + assistant

**User-facing feature** (first consumer of the audit's Phase-12 squad-optimization
technology, applied to the single-GW Free Hit chip). New tab: **🃏 Free Hit**.

## What it does

For each of the next 3 gameweeks it builds the best legal Free Hit squad:

- **15 players** — 2 GK / 5 DEF / 5 MID / 3 FWD, max **3 per club** (one shared club
  map across all positions; a per-position map was the first draft's bug, caught by
  the test suite: HUL had stacked 5 players across positions).
- **Budget**: your squad value + bank when your team is loaded in My Team
  (£100m standard otherwise).
- **Objective**: that GW's XI xP with the captain doubled (bench = cheapest playable
  insurance). All projections come from the SAME production spine as the app
  (projP + the minutes model) — no separate maths.
- **Optimizer**: Lagrangian greedy (binary-search lambda on xp − λ·cost) for the XI,
  then hill-climbing single-best-affordable-swap until convergence, then best legal
  formation from the 15 (3-4-3 … 5-4-1 enumerated).
- Injured/suspended players excluded outright; only official 50%+ doubts may enter,
  and they are labelled in the squad table.

## Verdict + assistant

- Comparison cards for the 3 GWs with the recommended week and quantified gaps.
- **Free Hit Assistant** (deterministic, grounded — the pattern of every assistant in
  this app): which week / show the team / captain / bench / budget / why / risks /
  overlap, plus a fallback that lists capabilities. It only reads the computed plan.
- Warns honestly if your loaded team shows Free Hit as already played.

## Real numbers (GW4-6, this dataset)

GW4 **91.9** xP (best) · GW5 87.5 · GW6 90.0. GW4 wins: Liverpool–Fulham and
Chelsea–Hull are the standout fixtures; captain Gakpo (10.5 vs FUL).

## Files changed

`src/decisions/freehit.js` (new) · `build.js` manifest · `index.html` (tab + panel,
`app.js?v=41`) · `src/boot.js` (lazy render on tab click) · `tests/run.js` (section
10) · `tests/freehit_test.js` (51 checks) · this doc.

## Known limitations (honest list)

1. Hill-climbing is a local optimum, not a global solver — good enough at this pool
   size, revisit if scores look beatable.
2. Bench is cheapest-playable, not optimized for points-through-injury scenarios.
3. Captain = highest single-GW xP; no rival-ownership differential logic here
   (that is the Mini League engine's job, Phase 13).
4. No team-news timing: builds from current official status only (pre-deadline rule
   respected by construction).
