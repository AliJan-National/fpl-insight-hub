// reconcile_test.js — 🧩 CROSS-SURFACE RECONCILIATION (v47)
// The Wildcard (3/5-GW squad, £100m budget) and the Free Hit (one-week max)
// legitimately disagree — this suite pins that the disagreements are COMPUTED,
// EXPLAINED, and honest, using the Ødegaard case the user actually caught.
const fs = require('fs');
const j = f => JSON.parse(fs.readFileSync('api/' + f, 'utf8'));
const DATA = { meta: j('meta.json'), league: j('league.json'), results: j('results.json'), players: j('players.json'),
  radar: j('radar.json'), fixtures: j('fixtures.json'), news: j('news.json'), captains: j('captains.json'),
  prices: j('prices.json'), fplmeta: j('fplmeta.json'), ticker: j('ticker.json'), teams: j('teams.json'),
  history: j('history.json'), elite: j('elite.json') };
global.DATA = DATA; global.fetch = () => new Promise(() => {});
global.window = { TF: {}, TEAMCTX: null };
DATA.teams.forEach(t => { global.window.TF[t.short] = t; });
global.window.ownForm = p => (global.window.TF[p.team] || {}).tf ?? 1;
global.window.formRank = p => (global.window.TF[p.team] || {}).rank || 10;
global.window.adjAvg3 = () => 3;
globalThis.ownForm = global.window.ownForm; globalThis.formRank = global.window.formRank; globalThis.adjAvg3 = global.window.adjAvg3;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const els = {};
global.document = { querySelector: s => { const k = String(s).replace(/^#/, ''); if (!els[k]) els[k] = { innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {}, onclick: null, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, click() {} }; return els[k]; }, querySelectorAll: () => [] };
global['$$'] = () => [];
const app = fs.readFileSync('app.js', 'utf8');
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__RC = { reconcileSet, renderReconcile, renderWildcard, renderFreeHit, buildWildcard, askAI, WC: () => WC, FH_MEMO };');
const RC = globalThis.__RC;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const find = n => DATA.players.find(p => p.name === n);

// ---------- the user's case: Ødegaard ----------
const R = RC.reconcileSet();
A(R && R.wcOnly && R.fhOnly && typeof R.both === 'number', 'reconcileSet computes the full conflict set (shared ' + (R && R.both) + '/15)');
const ode = R.wcOnly.find(r => r.name === 'Ødegaard');
A(!!ode, 'Ødegaard appears in the Wildcard-only list (the case the user caught)');
A(ode && ode.rank >= 5 && ode.rank <= 9 && ode.xp > 4, 'his reason is computed with real numbers: #' + (ode && ode.rank) + ' MID for his best FH week GW' + (ode && ode.bestGw) + ' at ' + (ode && ode.xp) + ' xP');
A(ode && ode.ahead.length >= 3 && ode.ahead.every(a => a.xp > ode.xp), 'the reason names the FH starters ahead of him (' + (ode ? ode.ahead.map(a => a.name).join(', ') : '') + ') — all rated higher that week');
A(ode && ode.pScore != null && ode.pScore > 15, 'the Wildcard side of the reason cites his ' + (ode && ode.pScore) + ' pScore (horizon + price efficiency)');
// the mirror: FH starters the Wildcard skips
const saka = R.fhOnly.find(r => r.name === 'Saka');
A(!!saka, 'the mirror case renders: Saka is in the FH XI but skipped by the Wildcard');
A(saka && /£/.test(String(saka.price)) === false && saka.wcPos && saka.wcPos.includes('Ødegaard') || (saka && saka.wcPos.length > 0), 'his reason names the Wildcard picks that won the budget race at his position');

// ---------- determinism ----------
const R2 = RC.reconcileSet();
A(JSON.stringify(R) === JSON.stringify(R2), 'deterministic (two runs identical)');

// ---------- rendering: both tabs, no NaN ----------
RC.renderReconcile('wcReconcile');
const html = els.wcReconcile.innerHTML;
A(html.includes('why they disagree') && html.includes('Ødegaard') && html.includes('Saka'), 'the cross-check card renders with both named cases');
A(!/NaN|undefined/.test(html), 'no NaN/undefined anywhere in the card');
A(html.includes('GW' + R.bestGw), 'the card states the Free Hit\'s best week (GW' + R.bestGw + ')');
els.fhReconcile = { innerHTML: '' };
RC.renderReconcile('fhReconcile');
A(els.fhReconcile.innerHTML.includes('why they disagree'), 'the same card renders into the Free Hit tab container');

// ---------- tab hooks exist in source ----------
A(app.includes("renderReconcile('#wcReconcile')") && app.includes("renderReconcile('#fhReconcile')"), 'renderWildcard and renderFreeHit both hook the cross-check');

// ---------- assistant answers the question ----------
const ans = RC.askAI('why is odegaard not in the free hit team?');
A(/Ødegaard/.test(ans) && /#7 MID|#[0-9] MID/.test(ans) && /pScore/.test(ans), 'the assistant answers the named conflict with his computed rank + pScore');
const ans2 = RC.askAI('why do the wildcard and free hit disagree?');
A(/share|two different questions|one-week/i.test(ans2), 'the assistant answers the general conflict question');
const ans3 = RC.askAI('why is saka not in the wildcard?');
A(/Saka/.test(ans3) && /budget|pScore/.test(ans3), 'the assistant answers the mirror direction (FH player skipped by Wildcard)');

// ---------- degrade: broken engines -> honest empty, no crash ----------
const realFHP = RC.FH_MEMO.plan;
RC.FH_MEMO.plan = null;
const savedPlan = Object.assign({}, realFHP || {});
// simulate an engine failure by removing players' fixtures temporarily
const backupNext3 = DATA.players.map(p => p.next3);
DATA.players.forEach(p => { p.next3 = null; });
const R3 = RC.reconcileSet();
A(R3 === null || (R3.wcOnly.length === 0 && R3.fhOnly.length === 0), 'with no fixtures the reconciliation degrades to empty/null, never crashes');
DATA.players.forEach((p, i) => { p.next3 = backupNext3[i]; });
RC.FH_MEMO.plan = null;
A(RC.reconcileSet() && RC.reconcileSet().wcOnly.some(r => r.name === 'Ødegaard'), 'restores cleanly after the degrade');

console.log('\ndone.');
