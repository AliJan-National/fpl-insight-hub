# Free Hit Audit — the self-check loop

**User request:** *"add the best performing team from GW4 and compare it with the Free Hit
team you suggested for GW4, continuously for upcoming GWs, and check how your prediction
is doing and improve."*

## How it works

For every **completed** gameweek, the Free Hit tab now shows a 🎯 **Free Hit Audit** card:

1. **Our suggestion** — read from the frozen pre-deadline snapshot
   (`snapshots/GWxx/fh-suggested.json`, captured BEFORE any results existed). It can
   never be edited after the fact; if no snapshot exists for that GW the app says so
   honestly instead of "recomputing" one (that would be cheating).
2. **The actual best squad** — the highest-scoring legal 15 (2/5/5/3, ≤3 per club,
   £100m, captain ×2) computed from that GW's real points in `history.json`.
3. **The comparison** — three headline cards (our actual total / best possible / gap
   to perfect), our captain's predicted-vs-actual line, and a per-pick table with
   hit (≥6) / quiet / miss (≤1) / DNP verdicts.
4. **What the GW taught the model** — top under-rated and over-rated players
   (starters only) with the GW's xP MAE. This is the input list for model
   improvements; changes are made deliberately between GWs, never silently.

## The snapshot ritual (per GW, before the data refresh)

1. Freeze `api/*.json` into `snapshots/GWxx/` (pre-deadline state).
2. Freeze `predictions.json` (all players' xP) and `fh-suggested.json`
   (the computed Free Hit squad) from that frozen state.
3. Push. After the refresh completes GWxx, the audit lights up automatically.

GW4 is the first snapshot (captured 2026-09-13, before the GW4 refresh). Its
suggestion — frozen on record: 92.4 xP, captain Gakpo (10.5), Trafford in goal.

## Files

`src/decisions/fh-audit.js` (new) · `build.js` manifest · `index.html` (`#fhAudit`
container, `app.js?v=44`) · `renderFreeHit` fires the audit lazily ·
`snapshots/GW04/*` deployed with the site · `tests/fh-audit_test.js` (26 checks,
including a full dress rehearsal of the post-refresh GW4 path) · CI section 12.

## Known limitations (honest list)

1. The actual-best squad is the same greedy+hill-climb optimizer, not a global
   optimum — a fine benchmark, though the true best could be marginally higher.
2. The audit needs the snapshot deployed with the site; a GW whose snapshot was
   never captured shows only the actual-best side (with an explicit note).
3. "Improve yourself" is deliberately human-in-the-loop: the learn panel feeds
   the phase backtests; we do not auto-tune weights on one GW of data.
