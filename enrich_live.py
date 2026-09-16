"""Enrich dashboard data with live FPL API info: next fixtures, FDR, ep_next,
captain picks, and price-change predictions."""
import json, os
from collections import defaultdict

RAW = 'raw'
API = 'api'

boot = json.load(open(f'{RAW}/bootstrap.json'))
fxs = json.load(open(f'{RAW}/fixtures.json'))

teams = {t['id']: t for t in boot['teams']}          # FPL team id -> team
code_of = {t['id']: t['code'] for t in boot['teams']} # FPL team id -> FPL code
short_of = {t['id']: t['short_name'] for t in boot['teams']}
short_by_code = {t['code']: t['short_name'] for t in boot['teams']}

events = boot['events']
current_ev = next(e['id'] for e in events if e['is_current'])
next_ev = next((e for e in events if e['is_next']), None)
total_players = boot.get('total_players')

# ---------------- Next 3 league fixtures per team (FPL code keyed) ----------------
open_fx = [f for f in fxs if not f['finished'] and f.get('event')]
open_fx.sort(key=lambda f: (f['event'], f.get('kickoff_time') or ''))
next5 = defaultdict(list)
for f in open_fx:
    h, a = f['team_h'], f['team_a']
    if len(next5[code_of[h]]) < 5:
        next5[code_of[h]].append(dict(opp=short_of[a], ha='H', fdr=f.get('team_h_difficulty') or 3,
                                      gw=f['event'], ko=str(f.get('kickoff_time') or '')[:16]))
    if len(next5[code_of[a]]) < 5:
        next5[code_of[a]].append(dict(opp=short_of[h], ha='A', fdr=f.get('team_a_difficulty') or 3,
                                      gw=f['event'], ko=str(f.get('kickoff_time') or '')[:16]))
next3 = {c: v[:3] for c, v in next5.items()}

# ---------------- DGW / BGW detection for next 4 gameweeks ----------------
counts = defaultdict(lambda: defaultdict(int))
for f in open_fx:
    if f['event'] <= current_ev + 4:
        counts[f['event']][code_of[f['team_h']]] += 1
        counts[f['event']][code_of[f['team_a']]] += 1
schedule_flags = {}
for ev, cnt in counts.items():
    for code, n in cnt.items():
        schedule_flags.setdefault(code, {})[ev] = n  # 2 = DGW, 0 absent = BGW

# ---------------- Element-level live info keyed by FPL player code ----------------
live = {}
for e in boot['elements']:
    try:
        ep = float(e.get('ep_next') or 0)
    except (TypeError, ValueError):
        ep = 0.0
    proj = e.get('price_change_projections') or []
    likelihood = proj[0].get('likelihood', 0) if proj else 0
    live[e['code']] = dict(ep_next=round(ep, 1), status=e.get('status', 'a'),
                           pen_order=e.get('penalties_order') or 99,
                           proj_likelihood=likelihood,
                           in_event=e.get('transfers_in_event') or 0,
                           out_event=e.get('transfers_out_event') or 0)

# ---------------- Captain picks ----------------
players = json.load(open(f'{API}/players.json'))
fdr_mult = {1: 1.15, 2: 1.08, 3: 1.0, 4: 0.92, 5: 0.85}

# repo players.csv gives dataset player_id -> (FPL player code, FPL team code)
pl_meta, pl_team = {}, {}
import csv
with open('raw/players.csv') as fh:
    for row in csv.DictReader(fh):
        pid = int(row['player_id'])
        pl_meta[pid] = int(row['player_code'])
        pl_team[pid] = int(row['team_code'])

captains = []
for p in players:
    code = pl_meta.get(p['id'])
    tcode = pl_team.get(p['id'])
    l = live.get(code, {})
    if l.get('status') not in (None, 'a') or l.get('ep_next', 0) <= 0 or p['mins'] < 45:
        continue
    nxt = next3.get(tcode, [])
    fdr = nxt[0]['fdr'] if nxt else 3
    ha = nxt[0]['ha'] if nxt else '?'
    opp = nxt[0]['opp'] if nxt else '?'
    mult = fdr_mult.get(fdr, 1.0) * (1.03 if ha == 'H' else 0.97)
    if l.get('pen_order') == 1:
        mult *= 1.10
    score = round(l['ep_next'] * mult, 1)
    reasons = []
    if fdr <= 2: reasons.append(f'Easy fixture: {opp}({ha}) FDR{fdr}')
    if l.get('pen_order') == 1: reasons.append('On penalties')
    if p['xg'] + p['xa'] >= 1.5: reasons.append(f"xGI {round(p['xg']+p['xa'],2)} in {p['mins']}'")
    if p['form'] >= 7: reasons.append(f'Form {p["form"]}')
    captains.append(dict(name=p['name'], team=p['team'], pos=p['pos'], cost=p['cost'],
                         own=p['own'], ep=l['ep_next'], form=p['form'],
                         opp=f"{opp}({ha})", fdr=fdr, score=score,
                         pts=p['pts'], mins=p['mins'], reasons=reasons[:3]))
captains.sort(key=lambda c: -c['score'])

# ---------------- Price change predictions ----------------
def predict(p):
    code = pl_meta.get(p['id'])
    l = live.get(code, {})
    net = l.get('in_event', p.get('t_in', 0)) - l.get('out_event', p.get('t_out', 0))
    lk = l.get('proj_likelihood', 0)
    if lk >= 1 and net != 0:
        return dict(dir='rise' if net > 0 else 'fall', likelihood=lk, net=net)
    return dict(dir='none', likelihood=0, net=net)

price_risers, price_fallers = [], []
for p in players:
    pr = predict(p)
    if pr['dir'] == 'none' or pr['likelihood'] < 2:
        continue
    row = dict(name=p['name'], team=p['team'], pos=p['pos'], cost=p['cost'],
               own=p['own'], likelihood=pr['likelihood'], net=pr['net'],
               net_pct=round(100 * pr['net'] / max(1, total_players), 2),
               already=round((p.get('price_chg') or 0), 1))
    if pr['dir'] == 'rise':
        price_risers.append(row)
    else:
        price_fallers.append(row)
price_risers.sort(key=lambda r: (-r['likelihood'], -r['net']))
price_fallers.sort(key=lambda r: (-r['likelihood'], r['net']))

LK_LABEL = {5: 'almost certain', 4: 'very likely', 3: 'likely', 2: 'possible', 1: 'unlikely'}
for r in price_risers + price_fallers:
    r['label'] = LK_LABEL.get(r['likelihood'], '?')

# ---------------- Patch players.json with live fields ----------------
for p in players:
    code = pl_meta.get(p['id'])
    tcode = pl_team.get(p['id'])
    l = live.get(code, {})
    p['ep_next'] = l.get('ep_next', 0)
    p['next3'] = next3.get(tcode, [])
    pr = predict(p)
    p['price_dir'] = pr['dir']; p['price_lk'] = pr['likelihood']

with open(f'{API}/players.json', 'w') as f:
    json.dump(players, f, separators=(',', ':'))

with open(f'{API}/captains.json', 'w') as f:
    json.dump(captains[:15], f, separators=(',', ':'))
with open(f'{API}/prices.json', 'w') as f:
    json.dump(dict(risers=price_risers[:15], fallers=price_fallers[:15], total_players=total_players),
              f, separators=(',', ':'))
with open(f'{API}/fplmeta.json', 'w') as f:
    json.dump(dict(total_players=total_players, current_gw=current_ev,
                   next_gw=next_ev['id'] if next_ev else None,
                   next_deadline=str(next_ev['deadline_time'])[:16].replace('T', ' ') if next_ev else None,
                   schedule_flags=schedule_flags,
                   next3_by_code=dict(next3),
                   fixtures_by_code=dict(next5)), f, separators=(',', ':'))

# ---------------- Rebuild fplids.json catalog (My Team + ML + Planner matching) ----------------
def _f(x):
    try: return round(float(x or 0), 1)
    except (TypeError, ValueError): return 0.0
elements = {e['id']: dict(n=e.get('web_name'), t=e.get('team'), et=e.get('element_type'),
                         c=e.get('now_cost'), s=e.get('status'), ep=_f(e.get('ep_next')),
                         pts=e.get('total_points'), form=_f(e.get('form')))
            for e in boot['elements']}
teams_cat = {t['id']: dict(short=t['short_name'], code=t['code']) for t in boot['teams']}
with open(f'{API}/fplids.json', 'w') as f:
    json.dump(dict(elements=elements, teams=teams_cat), f, separators=(',', ':'))

print(f"captains: {len(captains)} ranked, top: {captains[0]['name']} ({captains[0]['score']})")
print(f"price risers: {len(price_risers)}, fallers: {len(price_fallers)}")
print(f"total FPL managers: {total_players:,}")
print('DONE')
