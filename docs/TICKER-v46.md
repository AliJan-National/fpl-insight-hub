# v46 — Fixtures ticker GW-blank fix (data pipeline)

**Symptom (live, GW4):** the Fixtures tab showed GW1-3 results and GW5+ fixtures, but the
GW4 column was blank ("—") for every team — first reported from the live site on a phone,
2026-09-15.

**Root cause:** `build_data.py` hardcoded the season ticker's window — `past_gws=[1,2,3]`,
`future_gws=range(4,11)`, and the row builder read result cells only for GW1-3. Once GW4
completed, its results existed in `results.json` but were never read, and its fixtures no
longer existed (finished), so every team got a `null` GW4 cell. A seasonal time bomb: it
would have blanked every newly-completed GW from GW4 onward.

**Fix (build_data.py):** the window is now derived from the data —
`past_gws` = the last 4 completed GWs (from finished matches), `future_gws` = the next 7
unplayed GWs (from unfinished fixtures, unbounded hardcode removed). After the GW4 refresh:
past `[1,2,3,4]`, future `[5..11]`, zero null cells in the past window (ARS GW4 = 2-0 W @SUN,
LEE 4-1 W v NEW).

**Deploy note:** data-only change (`api/ticker.json`) plus the version bump for cache
clarity; `app.js` is byte-identical to v45. The GW05 snapshot's ticker.json was corrected
pre-deadline and the correction is noted in its MANIFEST — `predictions.json` and
`fh-suggested.json` are untouched (the honesty rule is about predictions, and those never
read the ticker).

**Tests:** dev battery 907 PASS / 0 FAIL (unchanged — no suite pinned the old split, which
is itself noted: the ticker now has a data-driven shape worth a future assertion).
