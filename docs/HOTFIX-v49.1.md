# v49.1 hotfix — hub build OUT path

**Symptom:** every scheduled `data-refresh` run since the v49 push (Sep 22 onward) failed at the
smoke gate; the site's api/ stayed frozen at the v49-push state (GW1-4).

**Root cause:** the hub copy of `build_data.py` shipped with the dev-tree output path
`OUT = 'fpl_dashboard/api'` (line 5). The workflow therefore wrote every rebuilt dataset into a
stray `fpl_dashboard/api/` folder inside the runner while the real `api/` folder never changed.
The smoke test (correctly) refused to commit the inconsistent state — `history max 4 == current_gw 5`,
`ticker past [1,2,3,4]`, `elite latest_complete 4`. The gate itself verified GW5 complete via
matches.csv, so the run reached the build step and failed only at smoke. No bad data was ever
published; the blocking design worked exactly as intended.

**Fix:** one line — `OUT = 'api'`.

**Verified end-to-end (fresh clone, fresh bootstrap/fixtures):**
gate SOFT/REFRESH → build (history 3250 rows max GW5, ticker [2,3,4,5], channels 1394 shots /
206 players / 0 dropped) → enrich → elite (latest_complete 5) → smoke **ALL PASS** →
snapshot GW06 freeze OK.

**Post-deploy:** the next run (manual "Run workflow" or the scheduled Fri Oct 10 04:00 UTC)
takes REFRESH (remote api current_gw=4 → 5), rebuilds GW1-5 data, runs elite post-GW, freezes the
GW06 snapshot, and commits as fpl-bot.

**Lesson recorded:** every hub sync must re-run the FULL pipeline simulation (gate → build →
enrich → elite → smoke → freeze) against a fresh CSV clone — extraction checks cannot catch
path bugs. This is now part of the release checklist.
