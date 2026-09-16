#!/usr/bin/env python3
"""
gw_gate.py — the standing rule, enforced in code: NEVER refresh on partial GW data.

Reads raw/bootstrap.json + raw/fixtures.json (+ the CSV clone) and decides:
  ALLOW REFRESH  — the is_current gameweek is fully finished AND the CSV data
                   source has every match (post-GW refresh; snapshots freeze).
  ALLOW SOFT     — same, but the repo already carries this GW (price/news drift
                   refresh only; the frozen snapshot is never touched).
  BLOCK          — mid-gameweek, deadline-passed-but-not-kicked-off, or the CSV
                   repo is lagging. Exit 1, commit nothing, wait for the next run.

Postponed/blank fixtures (kickoff moved >7 days out) are ignored so a single
postponement can never stall the season. Writes the verdict to $GITHUB_OUTPUT
when run inside Actions.
"""
import json, sys, os, csv, datetime

RAW = 'raw'
CSV_BASE = 'fpl-core-insights/data/2026-2027'

def emit(k, v):
    out = os.environ.get('GITHUB_OUTPUT')
    if out:
        with open(out, 'a') as fh: fh.write(f'{k}={v}\n')
    print(f'  {k}: {v}')

def load(p):
    with open(p) as fh: return json.load(fh)

boot = load(f'{RAW}/bootstrap.json')
fxs = load(f'{RAW}/fixtures.json')
repo_gw = load('api/fplmeta.json').get('current_gw')

cur = next((e for e in boot['events'] if e.get('is_current')), None)
if cur is None:
    print('BLOCK | bootstrap has no is_current event'); sys.exit(1)
cid = cur['id']
now = datetime.datetime.now(datetime.timezone.utc)

def kickoff(f):
    return datetime.datetime.fromisoformat(f['kickoff_time'].replace('Z', '+00:00'))

fx = [f for f in fxs if f.get('event') == cid]
active = [f for f in fx if kickoff(f) <= now + datetime.timedelta(days=7)]
postponed = len(fx) - len(active)
fin = [f for f in active if f.get('finished')]

print(f'gate  | is_current GW{cid} ({cur.get("name", "")}) · fixtures {len(fin)}/{len(active)} finished' + (f' · {postponed} postponed/blank ignored' if postponed else ''))

if len(fin) == 0 and len(active) > 0:
    print('BLOCK | deadline passed but no GW%d matches have finished — nothing to refresh, matches not played yet' % cid)
    emit('action', 'BLOCK'); sys.exit(1)
if 0 < len(fin) < len(active):
    print('BLOCK | MID-GAMEWEEK: GW%d is %d/%d played — the standing rule forbids refreshing partial data' % (cid, len(fin), len(active)))
    emit('action', 'BLOCK'); sys.exit(1)

# CSV data-source lag guard: every finished match must exist in the CSV repo
csvgw = os.path.join(CSV_BASE, 'By Tournament', 'Premier League', f'GW{cid}', 'matches.csv')
if not os.path.exists(csvgw):
    print('BLOCK | CSV repo missing %s — data source lagging, retry next run' % csvgw)
    emit('action', 'BLOCK'); sys.exit(1)
with open(csvgw) as fh:
    csv_done = sum(1 for r in csv.DictReader(fh) if str(r.get('finished', '')).lower() == 'true')
if csv_done < len(fin):
    print('BLOCK | CSV repo has %d/%d GW%d matches — data source lagging, retry next run' % (csv_done, len(fin), cid))
    emit('action', 'BLOCK'); sys.exit(1)

action = 'REFRESH' if (repo_gw is None or cid > repo_gw) else 'SOFT'
print(f'ALLOW | {action} — GW{cid} complete ({len(fin)} matches, CSV verified {csv_done}); repo api current_gw = {repo_gw}')
emit('action', action)
emit('lastcomplete', cid)
sys.exit(0)
