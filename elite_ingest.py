#!/usr/bin/env python3
"""
elite_ingest.py — REAL elite-manager intelligence from the official FPL API.

Server-side, run after each GW deadline. Reads the global Overall leaderboard
(classic league 1) top N REAL managers, fetches each one's multi-season history
(verifies credentials), transfer log (real transfers per GW) and per-GW picks
(real XI + captain + chip), then aggregates api/elite.json.

Nothing is fabricated — every number traces to an official API record with an
entry id + name. The dashboard renders this file directly.
"""
import json, os, time, datetime, urllib.request, concurrent.futures as cf

API = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'api')
UA = {'User-Agent': 'Mozilla/5.0 (FPL Insight Hub research)'}
BASE = 'https://fantasy.premierleague.com/api'
COHORT = 40            # world's current top-N to follow
MAXGW_PROBE = 12       # probe picks up to GW12; stops at first 404

def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1:
                return None
            time.sleep(1.0)
    return None

def main():
    lb = get(BASE + '/leagues-classic/1/standings/?page_standings=1&phase=1')
    if not lb:
        raise SystemExit('Could not fetch the global leaderboard')
    top = lb['standings']['results'][:COHORT]
    byid = {str(p['id']): p for p in json.load(open(os.path.join(API, 'players.json')))}

    elites = []
    def work(r):
        eid = r['entry']
        hist = get(BASE + f'/entry/{eid}/history/') or {}
        transfers = get(BASE + f'/entry/{eid}/transfers/') or []
        picks = {}
        for gw in range(1, MAXGW_PROBE + 1):
            p = get(BASE + f'/entry/{eid}/event/{gw}/picks/')
            if not p:
                break
            picks[str(gw)] = p
        past = [{'season': x.get('season_name'), 'rank': x.get('rank')}
                for x in (hist.get('past') or []) if x.get('rank')]
        best = min((x['rank'] for x in past), default=None)
        proven = bool(best and best <= 10000)
        captains, chips, squad = {}, {}, {}
        eh = {}
        for gw, p in picks.items():
            h = p.get('entry_history') or {}
            eh[gw] = {'pts': h.get('points'), 'total': h.get('total_points'),
                      'rank': h.get('overall_rank'), 'bank': h.get('bank'),
                      'value': (h.get('value') or 0) / 10}
            if p.get('active_chip'):
                chips[gw] = p['active_chip']
            for pk in p.get('picks', []):
                e = str(pk['element'])
                if pk.get('is_captain'):
                    captains[gw] = e
                if gw not in squad:
                    squad[gw] = []
                squad[gw].append(e)
        return {'entry': eid, 'player_name': r['player_name'], 'entry_name': r['entry_name'],
                'rank': r['rank'], 'total': r.get('total'), 'event_total': r.get('event_total'),
                'past': past, 'best_rank': best, 'proven_top10k': proven,
                'captains': captains, 'chips': chips, 'transfers': transfers,
                'history': eh, 'squad': squad}

    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        elites = list(ex.map(work, top))

    # ----- aggregate -----
    # Picks probe stops at the first 404 (the OPEN, not-yet-deadlined GW), so every
    # fetched GW is a COMPLETED one. The open GW = max fetched + 1.
    gws = sorted({int(g) for e in elites for g in e['history']})
    n = len(elites)
    latest = str(gws[-1]) if gws else None
    open_gw = str(gws[-1] + 1) if gws else None
    A = {'meta': {'mode': 'live', 'source': 'Official FPL API (fantasy.premierleague.com)',
                  'cohort': n, 'leaderboard': 'Global Overall (classic league 1)',
                  'latest_complete': latest, 'open_gw': open_gw,
                  'next_update_after': 'GW%s deadline' % open_gw if open_gw else None,
                  'generated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')},
         'elites': elites}

    # ownership & captaincy per completed GW from real squads
    gw_list = sorted(set(int(g) for e in elites for g in (e['squad'] or {})))
    agg = {}
    for gw in gw_list:
        g = str(gw)
        own = {}
        for e in elites:
            for pid in (e['squad'].get(g) or []):
                own[pid] = own.get(pid, 0) + 1
        caps = {}
        for e in elites:
            c = e['captains'].get(g)
            if c:
                caps[c] = caps.get(c, 0) + 1
        # bought / sold = real net roster movement vs previous GW (bounded, no wildcard churn)
        bought, sold = {}, {}
        if int(g) > 1:
            pg = str(int(g) - 1)
            for e in elites:
                before = set(e['squad'].get(pg) or [])
                after = set(e['squad'].get(g) or [])
                for pid in after - before:
                    bought[pid] = bought.get(pid, 0) + 1
                for pid in before - after:
                    sold[pid] = sold.get(pid, 0) + 1
        agg[g] = {'own': own, 'cap': caps, 'bought': bought, 'sold': sold, 'n': n}
    A['gw'] = agg

    # transfer events observed (event number = GW the move applied to)
    tev = {}
    for e in elites:
        for t in e['transfers']:
            g = str(t.get('event'))
            tev.setdefault(g, {'in': {}, 'out': {}, 'by': {}})
            tin, tout = str(t.get('element_in')), str(t.get('element_out'))
            tev[g]['in'][tin] = tev[g]['in'].get(tin, 0) + 1
            tev[g]['out'][tout] = tev[g]['out'].get(tout, 0) + 1
            tev[g]['by'].setdefault(e['entry'], []).append([tin, tout])
    A['transfers'] = tev

    json.dump(A, open(os.path.join(API, 'elite.json'), 'w'), indent=1)
    # ---- quick console summary for sanity ----
    def nm(pid):
        p = byid.get(str(pid))
        return p['name'] + ' (' + p['team'] + ')' if p else 'id' + str(pid)
    for g in sorted(A['transfers'], key=int):
        ti = sorted(A['transfers'][g]['in'].items(), key=lambda x: -x[1])[:5]
        to = sorted(A['transfers'][g]['out'].items(), key=lambda x: -x[1])[:5]
        print(f'=== transfer-log into GW{g} (real, incl. wildcard churn) ===')
        print('  IN :', ', '.join(f'{nm(k)} x{v}' for k, v in ti))
        print('  OUT:', ', '.join(f'{nm(k)} x{v}' for k, v in to))
    for g in sorted(agg):
        if int(g) < 2: continue
        bg = sorted(agg[g]['bought'].items(), key=lambda x: -x[1])[:6]
        sg = sorted(agg[g]['sold'].items(), key=lambda x: -x[1])[:6]
        print(f'=== NET elite roster moves into GW{g} (squad diff, bounded) ===')
        print('  BOUGHT:', ', '.join(f'{nm(k)} +{v}' for k, v in bg))
        print('  SOLD  :', ', '.join(f'{nm(k)} -{v}' for k, v in sg))
    last = str(max(int(g) for g in agg))
    print(f'=== GW{last} elite captaincy (real) ===')
    for pid, v in sorted(agg[last]['cap'].items(), key=lambda x: -x[1]):
        print(f'  {nm(pid)} x{v}')
    print('wrote', os.path.join(API, 'elite.json'), '| elites', n, '| gws', gw_list)

if __name__ == '__main__':
    main()
