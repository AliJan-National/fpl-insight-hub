// minutesV2_test.js — 👟 MINUTES V2 (v2.0 Phase 2)
// Real-data harness: legacy startProbLegacy()/minutesOfLegacy() vs the production minutesV2() ladder (v45 spine switch).
const fs = require('fs');
const j = f => JSON.parse(fs.readFileSync('api/' + f, 'utf8'));
const DATA = { meta: j('meta.json'), league: j('league.json'), results: j('results.json'), players: j('players.json'),
  radar: j('radar.json'), fixtures: j('fixtures.json'), news: j('news.json'), captains: j('captains.json'),
  prices: j('prices.json'), fplmeta: j('fplmeta.json'), ticker: j('ticker.json'), teams: j('teams.json'),
  history: j('history.json'), elite: j('elite.json') };
global.DATA = DATA; global.fetch = () => new Promise(() => {});
global.window = { TF: {}, TEAMCTX: null, NEXT3_BY_CODE: DATA.fplmeta.next3_by_code || {}, NEXT_BY_CODE: DATA.fplmeta.fixtures_by_code || {}, ownForm: () => 1, formRank: () => 10, adjAvg3: () => 3 };
DATA.teams.forEach(t => { global.window.TF[t.short] = t; });
globalThis.ownForm = () => 1; globalThis.formRank = () => 10; globalThis.adjAvg3 = () => 3;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const els = {};
global.document = { querySelector: s => { const k = String(s).replace(/^#/, ''); if (!els[k]) els[k] = { innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {}, onclick: null, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, click() {} }; return els[k]; }, querySelectorAll: () => [] };
global.$$ = () => [];
const app = fs.readFileSync('app.js', 'utf8');
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__M = { minutesV2, startProb, minutesOf, startProbLegacy, minutesOfLegacy, V2M_MEMO, SEL_MEMO, MIN_MEMO };');
const M = globalThis.__M;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const find = n => DATA.players.find(p => p.name === n);

// ---------- archetype 1: nailed starter ----------
const hal = M.minutesV2(find('Haaland'));
A(hal.pStart >= 0.9 && hal.p90 >= 0.75 && hal.expectedMinutes >= 82, 'NAILED: Haaland (3x90) -> pStart ' + hal.pStart + ', p90 ' + hal.p90 + ', expMin ' + hal.expectedMinutes);
A(hal.confidence.overall >= 0.7 && hal.evidence.some(e => /role security/.test(e)), 'NAILED: evidence flags role security, confidence ' + hal.confidence.overall);
const bf = M.minutesV2(find('B.Fernandes'));
A(bf.pStart >= 0.9 && bf.p90 >= 0.7, 'NAILED: B.Fernandes (3x90) -> pStart ' + bf.pStart + ', p90 ' + bf.p90);

// ---------- archetype 2: rotation player ----------
const cherki = M.minutesV2(find('Cherki'));
A(cherki.pStart < hal.pStart && cherki.pStart > 0.3, 'ROTATION: Cherki (27-81-65) -> pStart ' + cherki.pStart + ' (below nailed, above fringe)');
A(cherki.evidence.some(e => /starts \(GW/.test(e)), 'ROTATION: evidence cites his real 2/3 start record');
const mukiele = M.minutesV2(find('Mukiele'));
A(mukiele.pStart > 0.45 && mukiele.pStart < 0.85, 'ROTATION: Mukiele (0-90-90, trending in) -> pStart ' + mukiele.pStart + ' (recency weighting sees the trend)');

// ---------- archetype 3: injured player (dynamic — whoever is officially out now) ----------
const injuredNow = DATA.players.filter(p => p.status === 'i').sort((a, b) => (b.mins || 0) - (a.mins || 0))[0];
if (injuredNow) {
  const inj = M.minutesV2(injuredNow);
  A(inj.pStart <= 0.06 && inj.expectedMinutes <= 5, 'INJURED: ' + injuredNow.name + ' (officially out) -> pStart ' + inj.pStart + ', expMin ' + inj.expectedMinutes);
  A(inj.confidence.availability <= 0.2 && inj.evidence.some(e => /injured/.test(e)), 'INJURED: availability confidence crushed (' + inj.confidence.availability + ') + injury evidence line');
} else console.log('SKIP  | no officially injured player in the current data');

// ---------- archetype 4: suspended player (dynamic — whoever is banned now) ----------
const susNow = DATA.players.filter(p => p.status === 's' || /suspen/i.test(String(p.news || ''))).sort((a, b) => (b.mins || 0) - (a.mins || 0))[0];
if (susNow) {
  const sus = M.minutesV2(susNow);
  A(sus.pStart <= 0.06 && sus.evidence.some(e => /suspended/i.test(e)), 'SUSPENDED: ' + susNow.name + ' -> pStart ' + sus.pStart + ' with suspension evidence');
} else console.log('SKIP  | no suspended player in the current data');

// ---------- archetype 5: new / low-sample player (synthetic — none exist yet at GW3) ----------
const newbie = M.minutesV2({ id: -999, name: 'NewSigning', pos: 'MID', team: 'LIV', status: 'a', mins: 0 });
A(newbie.pStart >= 0.3 && newbie.pStart <= 0.8, 'NEW/LOW-SAMPLE: no history -> position prior, pStart ' + newbie.pStart + ' (no extreme guess)');
A(newbie.confidence.data === 0 && newbie.evidence.some(e => /position prior/.test(e)), 'NEW/LOW-SAMPLE: data confidence 0 + prior disclosed in evidence');
A(newbie.p90 <= newbie.p75 && newbie.p75 <= newbie.p60 && newbie.p60 <= newbie.pStart, 'NEW/LOW-SAMPLE: ladder still monotonic under pure priors');

// ---------- archetype 6: cameo player ----------
const isidor = M.minutesV2(find('Isidor'));
A(isidor.pStart <= 0.35 && isidor.expectedMinutes <= 30, 'CAMEO: Isidor (23-26-26) -> pStart ' + isidor.pStart + ', expMin ' + isidor.expectedMinutes);
A(isidor.evidence.some(e => /cameo pattern/.test(e)), 'CAMEO: evidence names the bench role');
const sesko = M.minutesV2(find('Šeško'));
A(sesko.pStart <= 0.35 && sesko.expectedMinutes <= 25, 'CAMEO: Šeško (23-10-20) -> pStart ' + sesko.pStart + ', expMin ' + sesko.expectedMinutes);

// ---------- official chance_next respected ----------
// official chance_next respected (dynamic — the current doubters, one per chance band)
const doubters = [];
[75, 50, 25].forEach(band => {
  const pick = DATA.players.filter(p => p.status !== 'i' && p.status !== 's' && typeof p.chance_next === 'number' && p.chance_next < 100
    && Math.abs(p.chance_next - band) <= 25 && !doubters.includes(p))
    .sort((a, b) => (b.mins || 0) - (a.mins || 0))[0];
  if (pick && !doubters.some(d => d.chance_next === pick.chance_next)) doubters.push(pick);
});
const gate = ch => 0.05 + 0.9 * ch / 100;   // the availability bound V2 applies from the official %
if (doubters.length >= 2) {
  const dts = doubters.map(p => ({ p, v: M.minutesV2(p) })).sort((a, b) => b.p.chance_next - a.p.chance_next);
  A(dts.every(d => d.v.pStart <= gate(d.p.chance_next) + 0.02),
    'chance_next caps the gate: ' + dts.map(d => d.p.name + '(' + d.p.chance_next + '%) ' + d.v.pStart + ' <= ' + gate(d.p.chance_next).toFixed(2)).join(', '));
  const hi = dts[0], lo = dts[dts.length - 1];
  A(hi.v.pStart > lo.v.pStart || hi.p.chance_next === lo.p.chance_next, 'a ' + hi.p.chance_next + '%-fit player (' + hi.v.pStart + ') outranks a ' + lo.p.chance_next + '%-fit one (' + lo.v.pStart + ') when records are comparable');
  A(dts.every(d => d.v.evidence.some(e => /official \d+% chance/.test(e))), 'each doubt cites the official % in evidence');
} else console.log('SKIP  | fewer than 2 official doubters in the current data');

// ---------- full-pool sweep: no NaN, ladder monotonic, sane ranges ----------
let bad = 0, minsSum = 0;
DATA.players.forEach(p => {
  const r = M.minutesV2(p);
  const vals = [r.pStart, r.p60, r.p75, r.p90, r.expectedMinutes, r.confidence.overall];
  if (vals.some(v => !isFinite(v) || v < 0)) bad++;
  if (!(r.p90 <= r.p75 && r.p75 <= r.p60 && r.p60 <= r.pStart)) bad++;
  if (r.expectedMinutes > 95 || r.confidence.overall > 1) bad++;
  if (!(r.evidence instanceof Array) || !r.evidence.length || r.evidence.some(e => typeof e !== 'string')) bad++;
  minsSum += r.expectedMinutes;
});
A(bad === 0, 'full pool sweep: ' + DATA.players.length + ' players, ladder monotonic + finite + evidenced (0 violations)');
A(minsSum / DATA.players.length < 60, 'pool mean expected minutes is realistic (' + (minsSum / DATA.players.length).toFixed(1) + ' — most squad players are part-timers)');

// ---------- determinism ----------
const a1 = M.minutesV2(find('Haaland')), a2 = M.minutesV2(find('Haaland'));
A(JSON.stringify(a1) === JSON.stringify(a2), 'deterministic + memoised (same input, same output)');

// ---------- legacy vs V2 comparison table (the Phase-2 deliverable) ----------
console.log('\n===== LEGACY vs MINUTES V2 (real players) =====');
console.log('player            | legacy pStart | V2 pStart | V2 p60 | V2 p90 | legacy expMin | V2 expMin | conf');
const show = n => { const p = find(n); const l = M.startProbLegacy(p), lo = M.minutesOfLegacy(p), v = M.minutesV2(p);  // v45: legacy engines by their explicit names
  console.log(p.name.padEnd(17) + '|     ' + l.toFixed(2) + '      |   ' + v.pStart.toFixed(2) + '   |  ' + v.p60.toFixed(2) + '  |  ' + v.p90.toFixed(2) + '  |      ' + String(lo.expMin).padEnd(4) + '     |    ' + String(v.expectedMinutes).padEnd(4) + '  |  ' + v.confidence.overall); };
['Haaland', 'B.Fernandes', 'Tzolakis', 'Cherki', 'Munoz', 'Mukiele', 'Mainoo', 'Wieffer', 'Gomes', 'Isidor', 'Šeško', 'J.Ramsey', 'Collins', 'Mosquera'].forEach(show);

// ---------- GW4+ AUTO-GATE: legacy vs V2 minutes on the latest completed GW (holdout) ----------
// Arms automatically once history.json contains a 4th gameweek (after the GW4
// deadline + data refresh). Trains BOTH models on gw < L only, then scores them
// against the real GW-L minutes. Disclosed limitation: players.json status /
// chance_next fields are the CURRENT (post-refresh) values for both models alike.
const allRows = Object.values(DATA.history).flat();
const maxGw = allRows.length ? Math.max.apply(null, allRows.map(r => r[0] || 0)) : 0;
if (maxGw >= 4) {
  const L = maxGw;
  const fullHist = DATA.history;
  const stripped = {};
  Object.entries(fullHist).forEach(([id, rows]) => { const k = rows.filter(r => (r[0] || 0) < L); if (k.length) stripped[id] = k; });
  const clearMemos = () => { [M.V2M_MEMO, M.SEL_MEMO, M.MIN_MEMO].forEach(mem => Object.keys(mem).forEach(k => delete mem[k])); };
  DATA.history = stripped; clearMemos();
  const sample = DATA.players.filter(p => (fullHist[p.id] || []).some(r => (r[0] || 0) === L));
  let bL = 0, bV = 0, maeL = 0, maeV = 0, n = 0;
  sample.forEach(p => {
    const act = (fullHist[p.id] || []).filter(r => (r[0] || 0) === L)[0][4] || 0;
    const started = act >= 60 ? 1 : 0;
    const preMins = (stripped[p.id] || []).reduce((sm, r) => sm + (r[4] || 0), 0);
    const psL = M.startProbLegacy(p, { mins: preMins, status: p.status });   // legacy engine fed its pre-deadline mins
    const v2 = M.minutesV2(p);
    bL += (psL - started) ** 2; bV += (v2.pStart - started) ** 2;
    maeL += Math.abs(M.minutesOfLegacy(p).expMin - act); maeV += Math.abs(v2.expectedMinutes - act);
    n++;
  });
  DATA.history = fullHist; clearMemos();
  bL /= n; bV /= n; maeL /= n; maeV /= n;
  A(n > 100 && isFinite(bL) && isFinite(bV) && isFinite(maeL) && isFinite(maeV),
    'GW' + L + ' HOLDOUT A/B (' + n + ' players): start-probability Brier  legacy ' + bL.toFixed(4) + '  vs  V2 ' + bV.toFixed(4) + '   |   expected-minutes MAE  legacy ' + maeL.toFixed(1) + '  vs  V2 ' + maeV.toFixed(1) + '   (lower = better)');
  console.log('GATE  | Switch decision for the production minutes spine is made from these numbers — see docs/PHASE2-MINUTES.md. Limitation: status/chance fields are current, applied to both models alike.');
} else {
  console.log('SKIP  | GW4 A/B gate not armed yet: history.json latest complete GW is ' + maxGw + ' (GW4 deadline 12 Sep 12:30 + data refresh needed). It runs automatically once GW4 data lands.');
}
console.log('\ndone.');
