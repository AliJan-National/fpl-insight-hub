// minutesV2_test.js — 👟 MINUTES V2 (v2.0 Phase 2)
// Real-data harness: legacy startProb()/minutesOf() vs the new minutesV2() ladder.
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
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__M = { minutesV2, startProb, minutesOf };');
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

// ---------- archetype 3: injured player ----------
const wieffer = M.minutesV2(find('Wieffer'));
A(wieffer.pStart <= 0.06 && wieffer.expectedMinutes <= 5, 'INJURED: Wieffer (knee, 0% official) -> pStart ' + wieffer.pStart + ', expMin ' + wieffer.expectedMinutes);
A(wieffer.confidence.availability <= 0.2 && wieffer.evidence.some(e => /injured/.test(e)), 'INJURED: availability confidence crushed (' + wieffer.confidence.availability + ') + injury evidence line');

// ---------- archetype 4: suspended player ----------
const gomes = M.minutesV2(find('Gomes'));
A(gomes.pStart <= 0.06 && gomes.evidence.some(e => /suspended/i.test(e)), 'SUSPENDED: Gomes -> pStart ' + gomes.pStart + ' with suspension evidence');

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
const collins = M.minutesV2(find('Collins'));   // 25% official
const mosq = M.minutesV2(find('Mosquera'));     // 75% official
const hinsh = M.minutesV2(find('Hinshelwood')); // 50% official
const gate = ch => 0.05 + 0.9 * ch / 100;   // the availability bound V2 applies from the official %
A(collins.pStart <= gate(25) + 0.02 && hinsh.pStart <= gate(50) + 0.02 && mosq.pStart <= gate(75) + 0.02,
  'chance_next caps the gate: Collins(25%) ' + collins.pStart + ' <= ' + (gate(25)).toFixed(2) + ', Hinshelwood(50%) ' + hinsh.pStart + ' <= ' + gate(50).toFixed(2) + ', Mosquera(75%) ' + mosq.pStart + ' <= ' + gate(75).toFixed(2));
A(mosq.pStart > collins.pStart, 'a 75%-fit starter (' + mosq.pStart + ') outranks a 25%-fit one (' + collins.pStart + ') when their own records are comparable');
A([collins, mosq, hinsh].every(x => x.evidence.some(e => /official \d+% chance/.test(e))), 'each doubt cites the official % in evidence');

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
const show = n => { const p = find(n); const l = M.startProb(p), lo = M.minutesOf(p), v = M.minutesV2(p);
  console.log(p.name.padEnd(17) + '|     ' + l.toFixed(2) + '      |   ' + v.pStart.toFixed(2) + '   |  ' + v.p60.toFixed(2) + '  |  ' + v.p90.toFixed(2) + '  |      ' + String(lo.expMin).padEnd(4) + '     |    ' + String(v.expectedMinutes).padEnd(4) + '  |  ' + v.confidence.overall); };
['Haaland', 'B.Fernandes', 'Tzolakis', 'Cherki', 'Munoz', 'Mukiele', 'Mainoo', 'Wieffer', 'Gomes', 'Isidor', 'Šeško', 'J.Ramsey', 'Collins', 'Mosquera'].forEach(show);
console.log('\ndone.');
