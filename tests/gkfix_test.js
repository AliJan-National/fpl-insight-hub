// gkfix_test.js — 🧤 GK/DEF STRUCTURAL FIXTURE RESPONSE (v42)
// The regression named for the user's catch: "why is the Free Hit team selecting
// Tzolakis, playing away at Chelsea?" — a GK's value is mostly situation (CS +
// saves - conceding), not a hot baseline carried through any fixture.
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
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__K = { projP, fixtureFactor, fxXgaOf, gkStructXp, defPosAdjOf, minutesOf, freeHitPlan, renderAll, FH_MEMO };');
const K = globalThis.__K;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const find = n => DATA.players.find(p => p.name === n);
const gks = () => DATA.players.filter(p => p.pos === 'GK' && (p.next3 || [])[0]).map(p => ({ p, xp: K.projP(p, 0), xga: K.fxXgaOf(p, 0) })).sort((a, b) => b.xp - a.xp);

// ---------- the user's case ----------
const tzo = K.projP(find('Tzolakis'), 0);
A(tzo >= 3.4 && tzo <= 5.0, 'Tzolakis away at Chelsea: ' + tzo.toFixed(2) + ' xP (was 6.33 — the save-machine baseline no longer rides through an elite attack)');
A(tzo < 6.33 - 1.5, 'the correction is material (>= 1.5 xP drop, now ' + (6.33 - tzo).toFixed(2) + ')');
const rank = gks().findIndex(r => r.p.name === 'Tzolakis') + 1;
A(rank >= 2, 'he is no longer the runaway #1 GK (rank ' + rank + ' — Trafford home to Newcastle leads)');

// ---------- fixture-driven ordering (the structural rule) ----------
const table = gks();
A(table[0].xga != null && table[0].xga <= 1.35, 'the #1 GW4 GK faces a genuinely modest attack (expected goals against: ' + table[0].p.name + ', xGA ' + table[0].xga + ')');
const top4Att = Object.entries(((() => { const osm = {}; DATA.players.forEach(p => { }); return null; })() || {}));
// sensitivity: SAME goalkeeper (same baseline/minutes), only the fixture varies
const base0 = find('Tzolakis');
const opps = DATA.teams.map(t => t.short).filter(o => o !== 'HUL');
const variants = opps.map(o => { const clone = Object.assign({}, base0, { next3: [Object.assign({}, base0.next3[0], { opp: o, ha: 'A' }), base0.next3[1], base0.next3[2]] }); return { o, xga: K.fxXgaOf(clone, 0), xp: K.projP(clone, 0) }; }).filter(v => v.xga != null);
variants.sort((a, b) => a.xga - b.xga);
let monoOK = true;
for (let i = 1; i < variants.length; i++) { if (variants[i].xp > variants[i - 1].xp + 0.05) { monoOK = false; break; } }
A(monoOK, 'same keeper, only the opponent varies: xP falls monotonically as expected-goals-against rises (' + variants.length + ' real opponents, from ' + variants[0].o + ' xGA ' + variants[0].xga + ' -> ' + variants[variants.length - 1].o + ' xGA ' + variants[variants.length - 1].xga + ')');
const spread = variants[variants.length - 1].xp - variants[0].xp;
A(spread <= -0.4, 'the swing between easiest and hardest fixture for the SAME keeper is real (' + spread.toFixed(2) + ' xP) without being outfield-sized');

// ---------- quiet keepers get lifted ----------
const ver = K.projP(find('Verbruggen'), 0);
A(ver >= 2.9, 'a quiet keeper with a modest fixture is lifted by structure (Verbruggen ' + ver.toFixed(2) + ', was 2.56)');

// ---------- the whole GK pool: realistic band ----------
const pool = gks();
const starters = pool.filter(r => { try { return K.minutesOf(r.p).expMin >= 60; } catch (e) { return false; } });
A(starters.length >= 15 && starters.every(r => r.xp >= 1.5 && r.xp <= 5.0), 'likely-starter GKs (>=60 exp mins) live in a realistic 1.5-5.0 band (' + starters.length + ' keepers, max ' + starters[0].xp.toFixed(2) + ', min ' + starters[starters.length - 1].xp.toFixed(2) + ')');
A(pool.filter(r => r.xp <= 1.2).every(r => { try { return K.minutesOf(r.p).expMin < 60; } catch (e) { return true; } }), 'sub-1.2 xP keepers are ONLY rotation keepers (<60 exp mins) — fringe pricing is minutes-driven, not broken');
const spear = (a, b) => { const rk = arr => arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).map(([, i], k) => [i, k]).sort((x, y) => x[0] - y[0]).map(([, k2]) => k2);
  const ra = rk(a), rb = rk(b), n = a.length, ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return num / Math.sqrt(da * db); };
const act = pool.filter(r => r.xga != null);
A(spear(act.map(r => -r.xga), act.map(r => r.xp)) >= 0.5, 'GK xP now correlates with clean-sheet odds across the pool (Spearman ' + spear(act.map(r => -r.xga), act.map(r => r.xp)).toFixed(3) + ', n=' + act.length + ')');

// ---------- defenders: clean-sheet pricing ----------
const fE = K.fixtureFactor(find('Calafiori'), 0), fH = K.fixtureFactor(find('Ajayi'), 0);   // ARS@SUN (easy) vs HUL vs CHE (brutal)
A(fE.defAdj != null && fH.defAdj != null && fE.defAdj - fH.defAdj >= 0.25, 'defenders get clean-sheet adjustments — Calafiori away at Sunderland ' + fE.defAdj + ' vs Ajayi (Hull) facing CHELSEA ' + fH.defAdj + ' (the defender mirror of the user\'s GK catch)');
const anyDef = DATA.players.filter(p => p.pos === 'DEF' && (p.next3 || [])[0]);
let dmin = 2, dmax = 0;
anyDef.forEach(p => { const f = K.fixtureFactor(p, 0); if (f && f.defAdj != null) { dmin = Math.min(dmin, f.defAdj); dmax = Math.max(dmax, f.defAdj); } });
A(dmax - dmin >= 0.25 && dmax <= 1.15 && dmin >= 0.85, 'the DEF adjustment sweeps a real but controlled range (' + dmin.toFixed(2) + ' - ' + dmax.toFixed(2) + ')');

// ---------- the Free Hit consequence (the user's actual complaint) ----------
K.FH_MEMO.plan = null;
const P = K.freeHitPlan();
const okG = P.gws.filter(g => !g.error);
const gk0 = okG[0].squad.find(r => r.p.pos === 'GK' && okG[0].starters.includes(r));
A(gk0.p.name !== 'Tzolakis', 'the GW4 Free Hit XI no longer starts Tzolakis away at Chelsea (now: ' + gk0.p.name + ' vs ' + gk0.f.opp + ')');
A(K.fxXgaOf(gk0.p, 0) <= 1.4, 'the starting GK now faces a modest attack (xGA ' + K.fxXgaOf(gk0.p, 0) + ')');
console.log('GATE  | new FH scores: ' + okG.map(g => 'GW' + g.gw + ' ' + g.fhScore).join(', ') + ' | best GW' + P.best.gw);

// ---------- stability ----------
try { K.renderAll(); console.log('PASS | renderAll clean after the v42 change'); } catch (e) { console.error('FAIL | renderAll threw: ' + e.message); process.exitCode = 1; }
console.log('\ndone.');
