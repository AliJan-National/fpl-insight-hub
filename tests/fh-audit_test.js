// fh-audit_test.js — 🎯 FREE HIT AUDIT: suggested vs actual best, self-check loop
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
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__A = { fhaCompletedGw, fhaHistoryRows, fhaBestSquad, fhaCompare, fhaLearn, renderFreeHitAudit, freeHitPlan, renderFreeHit };');
const T = globalThis.__A;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };

// ---------- completed-GW detection ----------
A(T.fhaCompletedGw() === 3, 'detects the latest completed GW (3 with current data)');

// ---------- actual-best squad (GW3, real data) ----------
const best3 = T.fhaBestSquad(3, 100);
A(!best3.error, 'GW3 actual-best squad computes from real history');
const pos = {}, cl = {};
best3.squad.forEach(r => { pos[r.p.pos] = (pos[r.p.pos] || 0) + 1; cl[r.p.team] = (cl[r.p.team] || 0) + 1; });
A(best3.squad.length === 15 && pos.GK === 2 && pos.DEF === 5 && pos.MID === 5 && pos.FWD === 3, 'actual-best is a legal 15 (2/5/5/3)');
A(Object.values(cl).every(n => n <= 3), 'actual-best respects max 3 per club');
A(best3.spent <= 100 + 1e-6, 'actual-best fits the £100m budget (£' + best3.spent.toFixed(1) + 'm)');
A(best3.captain.pts === Math.max.apply(null, best3.starters.map(r => r.pts)), 'actual-best captain is the top-scoring starter (' + best3.captain.p.name + ' ' + best3.captain.pts + '×2)');
A(Math.abs(best3.total - (best3.starters.reduce((s, r) => s + r.pts, 0) + best3.captain.pts)) < 1e-9, 'actual-best total = XI + captain again (' + best3.total + ' pts)');
const topScorer = T.fhaHistoryRows(3).sort((a, b) => b.pts - a.pts)[0];
A(best3.starters.some(r => r.p.id === topScorer.p.id), 'the GW3 top scorer (' + topScorer.p.name + ', ' + topScorer.pts + ' pts) is in the actual-best XI');

// ---------- compare (injected suggestion, real GW3 actuals) ----------
const sugSquad = best3.starters.slice(0, 10).map(r => ({ id: r.p.id, name: r.p.name, pos: r.p.pos, team: r.p.team, xp: 3.0, starter: true }))
  .concat([{ id: topScorer.p.id, name: topScorer.p.name, pos: topScorer.p.pos, team: topScorer.p.team, xp: 4.0, starter: true }])
  .concat(best3.bench.slice(0, 4).map(r => ({ id: r.p.id, name: r.p.name, pos: r.p.pos, team: r.p.team, xp: 2.0, starter: false })));
const sug3 = { gw: 3, fhScore: 60, captainId: topScorer.p.id, squad: sugSquad };
const cmp3 = T.fhaCompare(sug3, 3);
const expTotal = best3.starters.slice(0, 10).reduce((s, r) => s + r.pts, 0) + topScorer.pts * 2;
A(cmp3.ourTotal === expTotal, 'comparison total = actual XI points + captain doubled (' + cmp3.ourTotal + ', expected ' + expTotal + ')');
A(cmp3.picks.length === 15 && cmp3.picks.every(p => p.actual != null || p.verdict === 'did not play'), 'every one of the 15 picks gets its actual points or an honest DNP');
A(cmp3.picks.every(p => p.verdict === 'hit' ? p.actual >= 6 : p.verdict === 'miss' ? p.actual <= 1 : true), 'hit/miss verdicts are exact (hit >=6, miss <=1)');

// ---------- learn ----------
const preds3 = T.fhaHistoryRows(3).map(r => ({ id: r.p.id, name: r.p.name, pos: r.p.pos, team: r.p.team, xp: Math.max(0.5, r.pts - 2) }));
const L3 = T.fhaLearn(preds3, 3, 5);
A(L3.under.length === 5 && L3.over.length === 5 && L3.under[0].delta >= L3.over[0].delta, 'learn panel ranks under/over-rated correctly');
const expMae = T.fhaHistoryRows(3).filter(r => r.mins >= 60).reduce((s, r) => s + Math.abs(r.pts - Math.max(0.5, r.pts - 2)), 0) / L3.n;
A(Math.abs(L3.mae - Math.round(expMae * 100) / 100) < 0.01, 'xP MAE is computed correctly (mirrors the synthetic transformation, MAE ' + L3.mae + ')');

// ---------- degrade ----------
A(T.fhaBestSquad(99, 100).error, 'a GW with no data degrades to an honest error');
A(T.fhaCompare({ gw: 99, squad: [], captainId: 0 }, 99).ourTotal === 0, 'compare with an empty suggestion degrades to 0 without crashing');

// ---------- DRESS REHEARSAL: the exact GW4 path the site will run after the refresh ----------
// synthetic-but-deterministic GW4 actuals from the FROZEN suggestions/predictions,
// real frozen squad, real module code, stubbed fetch serving the real snapshot files.
const FRZ_SUGG = JSON.parse(fs.readFileSync('snapshots/GW04/fh-suggested.json', 'utf8'));
const FRZ_PREDS = JSON.parse(fs.readFileSync('snapshots/GW04/predictions.json', 'utf8')).preds;
const histBak = DATA.history, metaBak = DATA.fplmeta;
const hist4 = JSON.parse(JSON.stringify(DATA.history));
// deterministic pseudo-actuals: starters realize ~half their xP (clamped), non-starters blank
const rngOf = (id) => ((id * 2654435761) % 1000) / 1000;
FRZ_PREDS.forEach(p => {
  const rows = hist4[p.id] = hist4[p.id] || [];
  const starter = FRZ_SUGG.squad.find(s => s.id === p.id && s.starter);
  const mins = starter ? 90 : rngOf(p.id) < 0.25 ? 25 : 0;
  const pts = starter ? Math.max(0, Math.min(13, Math.round(p.xp * 0.5 + (rngOf(p.id) * 4 - 2)))) : (mins > 0 ? 1 : 0);
  rows.push([4, pts, 0, 0, mins, 0, 0, p.cost]);
});
DATA.history = hist4; DATA.fplmeta = Object.assign({}, metaBak, { current_gw: 4 });
global.fetch = (u) => Promise.resolve({ ok: /fh-suggested/.test(u) || /predictions/.test(u), json: async () => (/fh-suggested/.test(u) ? FRZ_SUGG : { preds: FRZ_PREDS }) });
(async () => {
  await T.renderFreeHitAudit();
  const html = els.fhAudit.innerHTML;
  A(html.indexOf('Free Hit Audit — GW4') >= 0, 'DRESS REHEARSAL: the audit renders for completed GW4');
  A(/OUR FH SQUAD SCORED/.test(html) && /BEST POSSIBLE/.test(html) && /GAP TO PERFECT/.test(html), 'the three headline cards render (ours / best / gap)');
  A(/captain Gakpo|Gakpo/.test(html), 'the frozen captain (Gakpo) appears with his actual result');
  A((html.match(/mp-chip ok">hit/g) || []).length + (html.match(/mp-chip warn">miss/g) || []).length > 0, 'per-pick hit/miss verdicts render');
  A(/UNDER-rated/.test(html) && /OVER-rated/.test(html), 'the learn panel (under/over-rated) renders');
  A(!/NaN|undefined/.test(html), 'no NaN/undefined anywhere in the audit');
  const cmp4 = T.fhaCompare(FRZ_SUGG, 4);
  A(cmp4.ourTotal <= T.fhaBestSquad(4, 100).total, 'our actual total can never exceed the best possible (sanity)');
  A(cmp4.picks.length === 15 && cmp4.picks.some(p => p.captain), 'all 15 frozen picks audited, captain identified');
  // restore
  DATA.history = histBak; DATA.fplmeta = metaBak; global.fetch = () => new Promise(() => {});
  // no-snapshot branch (GW3, fetch misses)
  global.fetch = () => Promise.resolve({ ok: false });
  await T.renderFreeHitAudit();
  A(/no frozen pre-deadline suggestion/.test(els.fhAudit.innerHTML) && /never .recompute./.test(els.fhAudit.innerHTML), 'a GW without a snapshot gets the honest "we will not recompute" message');
  A(/Actual best GW3/.test(els.fhAudit.innerHTML), 'the actual-best total still shows for GWs without a snapshot');
  global.fetch = () => new Promise(() => {});
  try { T.renderFreeHit(); } catch (e) { console.error('FAIL | renderFreeHit threw: ' + e.message); process.exitCode = 1; }
  console.log('PASS | renderFreeHit fires the audit without throwing');
  console.log('\ndone.');
})();
