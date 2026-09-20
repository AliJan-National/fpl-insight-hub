"""Build JSON datasets for the FPL dashboard from the FPL-Core-Insights repo CSVs."""
import pandas as pd, glob, json, os, re, csv

BASE = 'fpl-core-insights/data/2026-2027'
OUT = 'fpl_dashboard/api'
os.makedirs(OUT, exist_ok=True)

teams = pd.read_csv(f'{BASE}/teams.csv')
pl = pd.read_csv(f'{BASE}/players.csv')
ps = pd.read_csv(f'{BASE}/playerstats.csv')
gw = pd.read_csv(f'{BASE}/gameweek_summaries.csv').sort_values('id')

code2name = dict(zip(teams.code, teams.name))
code2short = dict(zip(teams.code, teams.short_name))
pos_abbr = {'Goalkeeper': 'GK', 'Defender': 'DEF', 'Midfielder': 'MID', 'Forward': 'FWD'}

# ---------------- League table + results (Premier League only) ----------------
mfiles = glob.glob(f'{BASE}/By Tournament/Premier League/GW*/matches.csv')
mm = pd.concat([pd.read_csv(f) for f in mfiles], ignore_index=True)
mm = mm.drop_duplicates(subset='match_id')
fin = mm[mm['finished'] & mm['home_score'].notna()].copy()

tbl = {}
for _, r in fin.iterrows():
    for code, gf, ga in [(r.home_team, r.home_score, r.away_score),
                          (r.away_team, r.away_score, r.home_score)]:
        d = tbl.setdefault(int(code), dict(P=0, W=0, D=0, L=0, GF=0, GA=0, Pts=0))
        d['P'] += 1; d['GF'] += int(gf); d['GA'] += int(ga)
        if gf > ga: d['W'] += 1; d['Pts'] += 3
        elif gf == ga: d['D'] += 1; d['Pts'] += 1
        else: d['L'] += 1
league = []
for code, d in tbl.items():
    league.append(dict(team=code2name.get(code, '?'), short=code2short.get(code, '?'),
                       GD=d['GF']-d['GA'], **d))
league.sort(key=lambda x: (-x['Pts'], -x['GD'], -x['GF']))

results = []
for _, r in fin.sort_values('kickoff_time').iterrows():
    results.append(dict(gw=int(r.gameweek),
                        home=code2short.get(r.home_team, '?'), away=code2short.get(r.away_team, '?'),
                        hs=int(r.home_score), as_=int(r.away_score),
                        ko=str(r.kickoff_time)[:10],
                        hxg=round(float(r.home_expected_goals_xg), 2) if pd.notna(r.home_expected_goals_xg) else None,
                        axg=round(float(r.away_expected_goals_xg), 2) if pd.notna(r.away_expected_goals_xg) else None))

# ---------------- Player match aggregates (deep stats) ----------------
pmfiles = glob.glob(f'{BASE}/By Tournament/Premier League/GW*/playermatchstats.csv')
pms = pd.concat([pd.read_csv(f) for f in pmfiles if os.path.getsize(f) > 100], ignore_index=True)
agg = pms.groupby('player_id').agg(
    pm_mins=('minutes_played', 'sum'), pm_goals=('goals', 'sum'), pm_assists=('assists', 'sum'),
    xg=('xg', 'sum'), xa=('xa', 'sum'), shots=('total_shots', 'sum'),
    sot=('shots_on_target', 'sum'), chances=('chances_created', 'sum'),
    touches_box=('touches_opposition_box', 'sum'),
    tackles=('tackles_won', 'sum'), intercepts=('interceptions', 'sum'),
    blocks=('blocks', 'sum'), clearances=('clearances', 'sum')).reset_index()
agg['cbit'] = agg.clearances.fillna(0) + agg.blocks.fillna(0) + agg.intercepts.fillna(0) + agg.tackles.fillna(0)

# ---------------- Player master snapshot ----------------
latest_gw = int(ps['gw'].max())
snap = ps[ps['gw'] == latest_gw].merge(
    pl[['player_id', 'position', 'team_code']], left_on='id', right_on='player_id', how='left')
snap = snap.merge(agg, left_on='id', right_on='player_id', how='left', suffixes=('', '_pm'))
snap['team'] = snap.team_code.map(code2short).fillna('?')
for c in ['xg', 'xa', 'shots', 'sot', 'chances', 'touches_box', 'cbit', 'pm_mins']:
    snap[c] = pd.to_numeric(snap.get(c), errors='coerce').fillna(0)
snap['xg_diff'] = snap.goals_scored.fillna(0) - snap.xg

players = []
for _, r in snap.iterrows():
    players.append(dict(
        id=int(r.id), name=r.web_name, team=r.team, pos=pos_abbr.get(r.position, r.position),
        pts=int(r.total_points or 0), ep=int(r.event_points or 0), mins=int(r.minutes or 0),
        g=int(r.goals_scored or 0), a=int(r.assists or 0),
        cost=round(float(r.now_cost or 0), 1),
        own=round(float(r.selected_by_percent or 0), 1),
        form=round(float(r.form or 0), 1),
        price_chg=round(float(r.cost_change_event or 0), 1),
        t_in=int(r.transfers_in_event or 0), t_out=int(r.transfers_out_event or 0),
        t_in_total=int(r.transfers_in or 0), t_out_total=int(r.transfers_out or 0),
        xg=round(float(r.xg), 2), xa=round(float(r.xa), 2),
        xg_diff=round(float(r.xg_diff), 2),
        shots=int(r.shots or 0), sot=int(r.sot or 0),
        chances=int(r.chances or 0), tbox=int(r.touches_box or 0),
        cbit=int(r.cbit or 0),
        status=r.status, news=r.news if isinstance(r.news, str) else '',
        chance_next=None if pd.isna(r.chance_of_playing_next_round) else float(r.chance_of_playing_next_round)))

players.sort(key=lambda p: -p['pts'])

# ---------------- Upcoming fixtures with difficulty ----------------
strength = dict(zip(teams.code, (teams.strength_overall_home.fillna(3) + teams.strength_overall_away.fillna(3)) / 2))
ranks = {c: i for i, c in enumerate(sorted(strength, key=lambda c: -strength[c]))}
def fdr(opp_code):
    r = ranks.get(opp_code, 10)
    return 5 if r < 4 else 4 if r < 8 else 3 if r < 12 else 2 if r < 16 else 1

fixtures = {}
for gwn in [latest_gw + 1, latest_gw + 2, latest_gw + 3]:
    path = f'{BASE}/By Gameweek/GW{gwn}/fixtures.csv'
    if not os.path.exists(path):
        continue
    fx = pd.read_csv(path)
    if 'gameweek' not in fx.columns:
        continue
    fx = fx[fx['gameweek'] == gwn]
    fx = fx[fx.home_team.isin(teams.code) & fx.away_team.isin(teams.code)].drop_duplicates('match_id')
    rows = []
    for _, r in fx.iterrows():
        rows.append(dict(home=code2short.get(r.home_team, '?'), away=code2short.get(r.away_team, '?'),
                         ko=str(r.kickoff_time)[:16].replace('T', ' '),
                         fdr_home=fdr(r.away_team), fdr_away=fdr(r.home_team)))
    if rows:
        fixtures[f'GW{gwn}'] = sorted(rows, key=lambda x: x['ko'])

# ---------------- Injuries ----------------
status_label = {'i': 'Injured', 'd': 'Doubtful', 's': 'Suspended', 'u': 'Unavailable', 'a': 'Available', 'n': 'Not in squad'}
news = [dict(name=p['name'], team=p['team'], pos=p['pos'], own=p['own'], cost=p['cost'],
             status=status_label.get(p['status'], p['status']), text=p['news'],
             chance=p['chance_next'], pts=p['pts'])
        for p in players if p['news'] and p['status'] != 'a']
news.sort(key=lambda n: -n['own'])

# ---------------- Season ticker: ranked teams, past results + form-adjusted future FDR ----------------
import math
perf = {}
for _, r in fin.iterrows():
    for code, gf, ga, xgf, xga, shf, sha in [
        (r.home_team, r.home_score, r.away_score, r.home_expected_goals_xg, r.away_expected_goals_xg, r.home_total_shots, r.away_total_shots),
        (r.away_team, r.away_score, r.home_score, r.away_expected_goals_xg, r.home_expected_goals_xg, r.away_total_shots, r.home_total_shots)]:
        d = perf.setdefault(int(code), dict(P=0, Pts=0, xgf=0.0, xga=0.0, shf=0, sha=0))
        d['P'] += 1
        d['Pts'] += 3 if gf > ga else 1 if gf == ga else 0
        if pd.notna(xgf): d['xgf'] += xgf
        if pd.notna(xga): d['xga'] += xga
        d['shf'] += (shf or 0); d['sha'] += (sha or 0)
perf_rows = []
for code, d in perf.items():
    p = d['P'] or 1
    perf_rows.append(dict(code=code, ppg=d['Pts']/p, xgd=(d['xgf']-d['xga'])/p, shotd=(d['shf']-d['sha'])/p))
perf_rows.sort(key=lambda x: -(x['ppg']*1.0 + x['xgd']*0.8 + x['shotd']*0.05))
rank_of = {r['code']: i+1 for i, r in enumerate(perf_rows)}
n = len(perf_rows) or 20
def form_mod(opp_code):
    rk = rank_of.get(opp_code, 10)
    if rk <= 4: return 0.6
    if rk <= 8: return 0.3
    if rk >= n-3: return -0.6
    if rk >= n-7: return -0.3
    return 0.0

past_cells = {c: {} for c in rank_of}
for _, r in fin.iterrows():
    gwp = int(r.gameweek)
    for code, gf, ga, xgf, xga, shf, sha, opp in [
        (r.home_team, r.home_score, r.away_score, r.home_expected_goals_xg, r.away_expected_goals_xg, r.home_total_shots, r.away_total_shots, r.away_team),
        (r.away_team, r.away_score, r.home_score, r.away_expected_goals_xg, r.home_expected_goals_xg, r.away_total_shots, r.home_total_shots, r.home_team)]:
        past_cells.setdefault(int(code), {})[gwp] = dict(
            opp=code2short.get(int(opp), '?'), ha='H' if code == r.home_team else 'A',
            sc=f'{int(gf)}-{int(ga)}', res='W' if gf > ga else 'D' if gf == ga else 'L',
            xg=(f'{xgf:.1f}-{xga:.1f}' if pd.notna(xgf) else ''), sh=f'{int(shf or 0)}-{int(sha or 0)}')

future_cells = {c: {} for c in rank_of}
raw_fix_path = os.path.join(os.path.dirname(__file__), 'raw', 'fixtures.json')
if os.path.exists(raw_fix_path):
    boot_path = os.path.join(os.path.dirname(__file__), 'raw', 'bootstrap.json')
    bteams = {t['id']: t for t in json.load(open(boot_path))['teams']}
    id2code = {t['id']: t['code'] for t in bteams.values()}
    bshort = {t['id']: t['short_name'] for t in bteams.values()}
    for f in json.load(open(raw_fix_path)):
        ev = f.get('event')
        if not ev or f.get('finished'):
            continue
        h, a = f['team_h'], f['team_a']
        if h in id2code:
            future_cells.setdefault(id2code[h], {})[ev] = dict(
                opp=bshort[a], ha='H', fdr=f.get('team_h_difficulty') or 3, oc=id2code[a])
        if a in id2code:
            future_cells.setdefault(id2code[a], {})[ev] = dict(
                opp=bshort[h], ha='A', fdr=f.get('team_a_difficulty') or 3, oc=id2code[h])

# v46: derive the window from the data — the last 4 COMPLETED GWs and the next
# 7 unplayed ones. The old hardcode ([1,2,3] past / range(4,11) future) blanked
# the column of every newly-completed gameweek (first seen live with GW4).
completed_gws = sorted({g for m in past_cells.values() for g in m})
past_gws = completed_gws[-4:]
last_done = completed_gws[-1] if completed_gws else 0
future_gws = [g for g in sorted({g for m in future_cells.values() for g in m}) if g > last_done][:7]
ticker_rows = []
for i, pr in enumerate(perf_rows):
    cells = []
    for gwn in past_gws:
        cells.append(past_cells.get(pr['code'], {}).get(gwn))
    for gwn in future_gws:
        fc = future_cells.get(pr['code'], {}).get(gwn)
        if fc:
            adj = max(1, min(5, fc['fdr'] + form_mod(fc['oc'])))
            fc = dict(fc, adj=round(adj, 1), adji=int(round(adj)))
        cells.append(fc)
    ticker_rows.append(dict(rank=i+1, short=code2short.get(pr['code'], '?'),
                            name=code2name.get(pr['code'], '?'),
                            ppg=round(pr['ppg'], 2), xgd=round(pr['xgd'], 2), shotd=int(pr['shotd']),
                            cells=cells))
ticker = dict(rows=ticker_rows, past_gws=past_gws, future_gws=future_gws)

# canonical team model shared by ALL tabs (wildcard, radar, captaincy, assistant)
teams_out = []
for i, pr in enumerate(perf_rows):
    code = pr['code']
    fc = future_cells.get(code, {})
    afx = []
    for g in range(4, 11):
        c = fc.get(g)
        afx.append(round(max(1, min(5, c['fdr'] + form_mod(c['oc']))), 1) if c else None)
    v3 = [v for v in afx[:3] if v is not None]
    v5 = [v for v in afx[:5] if v is not None]
    teams_out.append(dict(short=code2short.get(code, '?'), name=code2name.get(code, '?'),
                          rank=i + 1, ppg=pr['ppg'], xgd=pr['xgd'], shotd=pr['shotd'],
                          af3=round(sum(v3)/len(v3), 2) if v3 else 3.0,
                          af5=round(sum(v5)/len(v5), 2) if v5 else 3.0,
                          tf=round((len(perf_rows)-i)/len(perf_rows)*2, 2), afx=afx))
TEAMS_OUT = teams_out

# ---------------- Meta + write ----------------
cur = gw[gw['is_current']].iloc[0] if gw['is_current'].any() else gw.iloc[0]
meta = dict(season='2026/27', latest_gw=latest_gw, current_gw=int(cur['id']),
            current_gw_name=cur['name'], deadline=str(cur['deadline_time'])[:16].replace('T', ' '),
            avg_score=int(cur['average_entry_score'] or 0),
            high_score=int(cur['highest_score']) if pd.notna(cur['highest_score']) else None,
            n_players=len(players), generated='2026-09-06',
            source='github.com/olbauday/FPL-Core-Insights')

def dump(name, obj):
    with open(f'{OUT}/{name}.json', 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    print(f'{name}.json: {os.path.getsize(f"{OUT}/{name}.json")//1024} KB')

dump('meta', meta)
dump('league', league)
dump('results', results)
dump('players', players)
# ---------------- Transfer radar (same team model as ticker & wildcard) ----------------
by_tin = sorted(players, key=lambda p: -p['t_in'])[:15]
by_tout = sorted(players, key=lambda p: -p['t_out'])[:15]
team_by_short = {t['short']: t for t in TEAMS_OUT}
def tinfo(p): return team_by_short.get(p['team'], {})
def suggest_buy(p):
    reasons = []
    ti = tinfo(p)
    if p['mins'] >= 90 and p['xg_diff'] <= -0.7:
        reasons.append(f"Due a return: {p['g']} goals vs {p['xg']} xG")
    if p['t_in'] - p['t_out'] > 15000:
        reasons.append(f"Hot: +{(p['t_in']-p['t_out'])//1000}k net transfers")
    if p['form'] >= 7 and p['own'] < 20:
        reasons.append(f"Differential: form {p['form']} at {p['own']}% owned")
    if ti.get('rank', 20) <= 8:
        reasons.append(f"In-form team: #{ti['rank']} in the performance table")
    if ti.get('af3', 3) <= 2.6:
        reasons.append(f"Kind run: adj FDR {ti['af3']} next 3 (same as Fixtures ticker)")
    return reasons
def suggest_sell(p):
    reasons = []
    ti = tinfo(p)
    if p['mins'] >= 90 and p['xg_diff'] >= 0.9:
        reasons.append(f"Overperforming: {p['g']} goals vs {p['xg']} xG")
    if p['t_out'] - p['t_in'] > 15000:
        reasons.append(f"Cooling: -{(p['t_out']-p['t_in'])//1000}k net transfers")
    if p['status'] in ('i', 'd', 's') and p['news']:
        reasons.append(f"Flagged: {p['news'][:50]}")
    if ti.get('rank', 1) >= 15:
        reasons.append(f"Struggling team: #{ti['rank']} in the performance table")
    if ti.get('af3', 3) >= 3.4:
        reasons.append(f"Hard run: adj FDR {ti['af3']} next 3")
    return reasons
buys = [dict(p=p, reasons=suggest_buy(p)) for p in players if p['mins'] >= 90 and p['status'] == 'a']
buys = [b for b in buys if b['reasons']]
buys.sort(key=lambda b: (-len(b['reasons']), -b['p']['pts']))
sells = [dict(p=p, reasons=suggest_sell(p)) for p in players if p['mins'] >= 45]
sells = [s for s in sells if s['reasons']]
sells.sort(key=lambda s: -len(s['reasons']))

dump('radar', dict(buys=buys[:12], sells=sells[:12], most_in=by_tin, most_out=by_tout))
dump('fixtures', fixtures)
dump('news', news)
dump('ticker', ticker)
dump('teams', TEAMS_OUT)

# ---------------- per-GW player history (sparklines / compare / planner) ----------------
gwfiles = sorted(glob.glob(f'{BASE}/By Gameweek/GW*/playerstats.csv'),
                 key=lambda f: int(f.split('GW')[1].split(os.sep)[0]))
hist, prev = {}, {}
for f in gwfiles:
    gwn = int(f.split('GW')[1].split(os.sep)[0])
    d = pd.read_csv(f, usecols=['id', 'minutes', 'event_points', 'expected_goals', 'expected_assists',
                                'goals_scored', 'assists', 'bonus', 'now_cost'])
    for r in d.itertuples(index=False):
        i = int(r.id)
        cum = (float(r.expected_goals or 0), float(r.expected_assists or 0), int(r.minutes or 0),
               int(r.goals_scored or 0), int(r.assists or 0))
        p = prev.get(i, (0, 0, 0, 0, 0))
        prev[i] = cum
        hist.setdefault(i, []).append([
            gwn, int(r.event_points or 0),
            round(cum[0] - p[0], 2), round(cum[1] - p[1], 2), int(cum[2] - p[2]),
            int(cum[3] - p[3]), int(cum[4] - p[4]), round(float(r.now_cost or 0), 1)])
dump('history', hist)

# ---------------- 🧭 CHANNELS (v2.0 Phase 5a): pitch-zone attack/defence profiles ----------------
# Source: By Gameweek/GW*/shots.csv — every real shot with start_y in ATTACKING
# view (0-100, both teams normalised; validated: Mbeumo avg 62.8 = right wing).
# Channels: L = y < 40, C = 40-60, R = > 60. Team profiles are xG-weighted
# shares shrunk toward the league profile (K=30 shots) so a few GWs of noise
# cannot mint a fake flank monster. Player lateral position = his own shot
# cloud (n>=4 and |mean-50|>=5 to classify a side). ANALYSIS-ONLY until the
# Phase 8 A/B gate promotes it into the xP spine.
CH_K = 2.5  # prior strength in xG-units (~35% weight at GW4, fading as the season grows)
def _chan(y): return 0 if y < 40 else 1 if y < 60 else 2

# match_ids use FULL names ('manchester-city'), teams.csv uses short ones
# ('man-city') — alias the 8 that differ; warn loudly if anything is unmapped.
_SLUG_ALIAS = {'afc-bournemouth': 'bournemouth', 'brighton-hove-albion': 'brighton',
               'leeds-united': 'leeds', 'manchester-city': 'man-city',
               'manchester-united': 'man-utd', 'newcastle-united': 'newcastle',
               'nottingham-forest': 'nott-m-forest', 'tottenham-hotspur': 'spurs'}
_slug_misses = set()
slug2code = {}
for _, t in teams.iterrows():
    slug2code[re.sub(r'[^a-z0-9]+', '-', str(t['name']).lower()).strip('-')] = int(t['code'])
def _code_of_slug(s):
    c = slug2code.get(_SLUG_ALIAS.get(s, s))
    if c is None: _slug_misses.add(s)
    return c
pid2meta = {}
for _, r in pl.iterrows():
    pid2meta[int(r['player_id'])] = (str(r['web_name']), int(r['team_code']), str(r['position']))

finished_ids = set()
for mf in glob.glob(f'{BASE}/By Tournament/Premier League/GW*/matches.csv'):
    mdf = pd.read_csv(mf)
    for _, r in mdf[mdf['finished'] == True].iterrows():
        finished_ids.add(str(r['match_id']))

_ch_att_s, _ch_att_x = {}, {}
_ch_def_s, _ch_def_x = {}, {}
_ch_py = {}
_ch_shots = _ch_matched = _ch_dropped = 0
for sf in sorted(glob.glob(f'{BASE}/By Gameweek/GW*/shots.csv'),
                 key=lambda f: int(f.split('GW')[1].split(os.sep)[0])):
    for r in csv.DictReader(open(sf)):
        mid = str(r.get('match_id') or '')
        if mid not in finished_ids:
            _ch_dropped += 1
            continue
        core = mid.split('prem-')[-1]
        if '-vs-' not in core:
            _ch_dropped += 1
            continue
        a_slug, b_slug = core.rsplit('-vs-', 1)
        ac, bc = _code_of_slug(a_slug), _code_of_slug(b_slug)
        if ac is None or bc is None:
            _ch_dropped += 1
            continue
        try:
            y = float(r.get('start_y') or 0); xg = float(r.get('xg') or 0)
            pid = int(float(r.get('player_id') or 0))
        except ValueError:
            _ch_dropped += 1
            continue
        is_home = str(r.get('is_home')) == 'True'
        att_c, def_c = (ac, bc) if is_home else (bc, ac)
        c = _chan(y)
        for d, key in ((_ch_att_s, att_c), (_ch_def_s, def_c)):
            row = d.setdefault(key, [0, 0, 0]); row[c] += 1
        for d, key in ((_ch_att_x, att_c), (_ch_def_x, def_c)):
            row = d.setdefault(key, [0.0, 0.0, 0.0]); row[c] += xg
        _ch_py.setdefault(pid, []).append(y)
        _ch_shots += 1; _ch_matched += 1

def _shrunk(xrow, k):
    tot = sum(xrow) or 1.0
    lg = [x / tot for x in xrow]
    return lg
_lg_att = [0.0, 0.0, 0.0]; _lg_def = [0.0, 0.0, 0.0]
for row in _ch_att_x.values():
    for i in range(3): _lg_att[i] += row[i]
for row in _ch_def_x.values():
    for i in range(3): _lg_def[i] += row[i]
_lg_att = [v / (sum(_lg_att) or 1.0) for v in _lg_att]
_lg_def = [v / (sum(_lg_def) or 1.0) for v in _lg_def]

def _team_block(srow, xrow, lg):
    n = sum(srow); xt = sum(xrow)
    raw = [v / (xt or 1.0) for v in xrow]
    shr = [(xrow[i] + CH_K * lg[i]) / (xt + CH_K) for i in range(3)]
    return {'n': n, 'xg': [round(v, 2) for v in xrow],
            'raw': [round(v, 3) for v in raw], 'share': [round(v, 3) for v in shr],
            'xgTotal': round(xt, 2)}

channels_teams = {}
for code, short in code2short.items():
    channels_teams[short] = {
        'att': _team_block(_ch_att_s.get(code, [0, 0, 0]), _ch_att_x.get(code, [0.0, 0.0, 0.0]), _lg_att),
        'def': _team_block(_ch_def_s.get(code, [0, 0, 0]), _ch_def_x.get(code, [0.0, 0.0, 0.0]), _lg_def),
    }

channels_players = {}
for pid, ys in _ch_py.items():
    n = len(ys)
    if n < 2: continue
    ym = sum(ys) / n
    sd = (sum((y - ym) ** 2 for y in ys) / n) ** 0.5 if n > 1 else 0.0
    meta = pid2meta.get(pid)
    if not meta: continue
    side = 'L' if (n >= 4 and ym < 45) else 'R' if (n >= 4 and ym > 55) else 'C'
    channels_players[str(pid)] = {
        'name': meta[0], 'team': code2short.get(meta[1], '?'),
        'pos': {'Goalkeeper': 'GK', 'Defender': 'DEF', 'Midfielder': 'MID', 'Forward': 'FWD'}.get(meta[2], 'MID'),
        'n': n, 'y': round(ym, 1), 'sd': round(sd, 1), 'side': side,
        'conf': round(min(1.0, n / 10.0), 2),
    }

channels = {
    'meta': {'gw_through': max([int(f.split('GW')[1].split(os.sep)[0]) for f in glob.glob(f'{BASE}/By Gameweek/GW*/shots.csv')] or [0]),
             'shots': _ch_shots, 'dropped': _ch_dropped, 'k': CH_K,
             'note': 'Real shot locations (attacking view, y 0-100). Channels L=y<40, C=40-60, R=>60. '
                     'Team shares are xG-weighted and shrunk to the league profile (K=30 shots). '
                     'Phase 5a: analysis-only, NOT yet in the xP spine (pending the Phase 8 A/B gate).'},
    'league': {'att': [round(v, 3) for v in _lg_att], 'def': [round(v, 3) for v in _lg_def]},
    'teams': channels_teams,
    'players': channels_players,
}
dump('channels', channels)
print(f'channels: {len(channels_teams)} teams, {len(channels_players)} players, {_ch_matched} shots matched, {_ch_dropped} dropped')
if _slug_misses: print(f'CHANNELS WARNING — unmapped team slugs: {sorted(_slug_misses)}')
print('DONE')
