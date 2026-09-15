// spine_test.js — v45 PRODUCTION SPINE SWITCH guard
// Proves startProb()/minutesOf() really serve the minutesV2() engine, that the
// legacy engines survive beside them for the ongoing A/B, and that counterfactual
// what-if overrides still route to the legacy engine. If any future edit quietly
// disconnects the spine, this suite fails.
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
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__SP = { startProb, startProbLegacy, minutesOf, minutesOfLegacy, minutesV2, V2M_MEMO, projP, forecastOf };');
const S = globalThis.__SP;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const find = n => DATA.players.find(p => p.name === n);

// ---------- 1. delegation identity over the whole pool ----------
let bad = 0, diffs = 0;
DATA.players.forEach(p => {
  const v = S.minutesV2(p), ps = S.startProb(p), mo = S.minutesOf(p);
  if (ps !== v.pStart) bad++;
  if (mo.expMin !== v.expectedMinutes || mo.p60 !== v.p60 || mo.p75 !== v.p75 || mo.p90 !== v.p90) bad++;
  if (mo.engine !== 'V2' || !(mo.confidence && mo.confidence.overall >= 0) || !(Array.isArray(mo.evidence) && mo.evidence.length)) bad++;
  if (Math.abs(S.startProbLegacy(p) - v.pStart) > 1e-9) diffs++;
});
A(bad === 0, 'all ' + DATA.players.length + ' players: startProb/minutesOf serve the minutesV2 ladder exactly (engine=V2, evidence carried)');
A(diffs > 50, 'legacy and V2 genuinely differ on ' + diffs + ' players — the A/B is alive, not a mirror');

// ---------- 2. delegation PROVEN by memo poisoning, through to projP ----------
const gak = find('Gakpo');
const ch = (typeof gak.chance_next === 'number' && gak.chance_next < 100) ? gak.chance_next : null;
const key = 'v2|' + gak.id + '|' + (gak.mins || 0) + '|' + gak.status + '|' + (ch == null ? '' : ch);
const saved = S.V2M_MEMO[key];
const realP = S.minutesV2(gak).pStart;
const before = S.projP(gak, 0);
S.V2M_MEMO[key] = Object.assign({}, saved, { pStart: 0.5 });
const poisonedPs = S.startProb(gak);
const poisonedProj = S.projP(gak, 0);
delete S.V2M_MEMO[key]; if (saved) S.V2M_MEMO[key] = saved;
A(poisonedPs === 0.5, 'startProb reads the minutesV2 memo — delegation proven (poisoned pStart 0.5 came straight back)');
A(Math.abs(poisonedProj * realP - before * 0.5) < 1e-6 * Math.max(1, before), 'projP scales with the V2 pStart exactly (xP gateway is on the V2 spine)');

// ---------- 3. counterfactual what-if still routes to the legacy engine ----------
const cf = { mins: 60, status: 'i' };
A(S.startProb(gak, cf) === S.startProbLegacy(gak, cf), 'what-if override (mins/status changed) routes to startProbLegacy');
A(S.startProb(gak, cf) <= 0.06, 'injured what-if stays crushed (' + S.startProb(gak, cf) + ')');
const sameState = { mins: gak.mins || 0, status: gak.status || 'a' };
A(S.startProb(gak, sameState) === S.minutesV2(gak).pStart, 'over-object with the REAL state still serves V2 (no false legacy fallback)');

// ---------- 4. legacy engines survive, bounded and deterministic ----------
let badL = 0;
DATA.players.forEach(p => { const s = S.startProbLegacy(p); if (!(s >= 0.02 && s <= 0.97)) badL++; const m = S.minutesOfLegacy(p); if (!(m.expMin >= 0 && m.expMin <= 96) || !('pStart' in m)) badL++; });
A(badL === 0, 'startProbLegacy/minutesOfLegacy intact over the pool (legacy bounds 0.02-0.97, expMin 0-96)');

// ---------- 5. forecastOf carries the V2 ladder ----------
const fc = S.forecastOf(find('Haaland'));
A(fc && fc.minutes && fc.minutes.engine === 'V2' && fc.minutes.p90 <= fc.minutes.p75 && fc.minutes.p75 <= fc.minutes.p60, 'forecastOf.minutes is the V2 ladder (p90<=p75<=p60, engine V2)');
A(Array.isArray(fc.minutes.evidence) && fc.minutes.evidence.length > 0, 'forecast surfaces get the V2 evidence lines');

console.log('\ndone.');
