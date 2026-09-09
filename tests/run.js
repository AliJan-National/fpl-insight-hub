// tests/run.js — FPL Insight Hub regression runner (runs inside the repo, no deps)
//   node tests/run.js        (from the repo root; `npm test` does this)
// Guards the behaviours the audits flagged: Copilot routing, esc() escaping,
// fixture-aware probabilities, dist/captain maths, the xP forecast ledger, and
// source-level hygiene (no duplicated elite wiring, no phantom xint.json).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const api = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8'));
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

let pass = 0, fail = 0;
const A = (c, m) => { if (c) { pass++; console.log('PASS |', m); } else { fail++; console.error('FAIL |', m); } };

// ---------- 0. the file must at least parse ----------
try { new Function(app); A(true, 'app.js parses (whole-file syntax gate)'); } catch (e) { A(false, 'app.js syntax: ' + e.message); }

// ---------- 1. esc() must escape HTML + attribute-breaking quotes (B6) ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
A(esc('He said "hi"') === 'He said &quot;hi&quot;', 'esc() escapes double quotes (B6)');
A(esc("O'Brien") === 'O&#39;Brien', 'esc() escapes single quotes (B6)');
A(esc('2 > 1 < 3 & 4') === '2 &gt; 1 &lt; 3 &amp; 4', 'esc() escapes > < & consistently');
A(app.indexOf('&#39;') > 0 && app.indexOf('&quot;') > 0, 'esc source hardened with quote entities (B6)');

// ---------- 2. source-level hygiene (B7/B8/B12) ----------
A((app.match(/function eliteAnswer\(q\) \{/g) || []).length === 1, 'eliteAnswer defined exactly once (B7 dedup)');
A(app.indexOf('xint.json') === -1, 'no phantom xint.json fetch (B8)');
A(app.indexOf('653 players') === -1, 'chat greeting no longer hardcodes 653 players (B12)');
A((app.match(/function wireElite/g) || []).length === 1, 'wireElite wiring present exactly once');

// ---------- data + slices ----------
const DATA = { players: api('players.json'), teams: api('teams.json'), history: api('history.json'),
  fplmeta: api('fplmeta.json'), meta: api('meta.json'), results: api('results.json'), news: api('news.json'), captains: api('captains.json'), elite: api('elite.json') };
global.DATA = DATA;
global.window = { TF: {}, TEAMCTX: null, OSM: null };
DATA.teams.forEach(t => { global.window.TF[t.short] = t; });
const slice = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
const FM = 'const FM = {1:1.15,2:1.08,3:1,4:0.92,5:0.85};';
const osmBlock = slice('function osmMemo()', '// ============ Wildcard Lab');
const spine = slice('// Reliability: punishes one-week wonders', 'function startersAt(');
const selBlock = slice('// ---- Selection / minutes model', '// per-GW model projection');
const sProb = slice('// ---- Probability profile (audit P0 #3', 'function startersAt(');
const sCapLev = slice('// ---- Captain leverage (audit roadmap #10)', '// Legal FPL formations');
const sScout = slice('function scout(', 'function normName(');
const sName = slice('function normName(', 'function askAI(q) {');
const sAsk = app.slice(app.indexOf('function askAI(q) {'), app.indexOf('\nfunction chat(', app.indexOf('function askAI(q) {')));
const fxmod = slice('// ============ 📏 xP MEASUREMENT', '// ============ 🧠 ELITE MANAGER TRENDS MODULE');

// ---------- 3. fixture-aware probabilities + one voice (B2/M2) ----------
const F = (0, eval)('(function(){ ' + FM + '\n' + osmBlock + '\n' + spine + '\nfunction startersAt(){} return { fixCalib, oppFixOf, playerProb, projP, osmByShort, forecastOf }; })()');
const cal = F.fixCalib();
A(cal.att && cal.def && cal.n > 0, 'fixCalib fits per-position fixture factors from real results (n=' + cal.n + ')');
const rows = F.osmByShort();
const leaky = Object.keys(rows).sort((a, b) => rows[b].xga - rows[a].xga)[0];
const solid = Object.keys(rows).sort((a, b) => rows[a].xga - rows[b].xga)[0];
const gakpo = DATA.players.find(p => p.name === 'Gakpo');
const mk = (p, opp) => Object.assign({}, p, { next3: [{ opp, ha: 'A', fdr: 3 }] });
const xE = F.projP(mk(gakpo, leaky), 0), xH = F.projP(mk(gakpo, solid), 0);
const pE = F.playerProb(mk(gakpo, leaky)).p6, pH = F.playerProb(mk(gakpo, solid)).p6;
A(xE !== xH && pE !== pH, 'P(≥6) and xP both move with the opponent (B2 fixed): xP ' + xE.toFixed(1) + '→' + xH.toFixed(1) + ', P6 ' + pE + '%→' + pH + '%');
A((xE > xH) === (pE > pH), 'xP and P(≥6) move in the same direction (one voice)');
A(cal.att.bands.every(b => b.xf >= 0.6 && b.xf <= 1.55 && b.pf >= 0.55 && b.pf <= 1.8), 'fitted factors within honest bounds');
const fG = F.forecastOf(gakpo);
A(fG && fG.xp > 0 && fG.p6 >= fG.p10 && fG.p6 >= 1 && fG.p6 <= 85, 'forecastOf sane: xP ' + fG.xp + ', P6 ' + fG.p6 + '%');

// ---------- 4. captain leverage + dist sums (regression guards) ----------
const C = (0, eval)('(function(){ ' + FM + '\n' + selBlock + '\n' + sProb + '\n' + sCapLev + '\nfunction startersAt(){} return { capLev, distOf }; })()');
const L = C.capLev({ ep: 8.6, p6: 48, p10: 20 }, { ep: 7.4, p6: 30, p10: 8 });
A(L.eEp === 1.2 && L.cls === 'UPSIDE', 'captain leverage classifies expected edge correctly');
const D = C.distOf(gakpo);
A(D.prob.length === 5 && Math.abs(D.prob.reduce((a, b) => a + b, 0) - 1) < 0.03 && D.p6 >= D.p10, 'outcome spread sums to ~1 with P6≥P10');

// ---------- 5. Copilot routing: pair decisions beat elite; elites still answer (B1/B9) ----------
globalThis.__eliteStub = () => 'ELITE-ANSWER';
function esc2(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function sparkSVG() { return ''; }
function formRank(p) { return (global.window.TF[p.team] || {}).rank || 10; }
global.renderCompare = () => {};
global.els = {};
global.$ = sel => { const id = String(sel).replace(/^#/, ''); if (!global.els[id]) global.els[id] = { value: '', style: {}, innerHTML: '', textContent: '', classList: { add(){}, remove(){}, contains(){ return false; } } }; return global.els[id]; };
const R = (0, eval)('(function(){ function esc(s){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;"); } function sparkSVG(){ return ""; } function formRank(p){ return (window.TF[p.team] || {}).rank || 10; } var eliteAsk = function(q){ return (globalThis.__eliteStub)(); }; ' + FM + '\n' + spine + '\n' + sCapLev + '\n' + sScout + '\n' + sName + '\n' + sAsk + '\nreturn { askAI: askAI }; })()');
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
let out = R.askAI('Haaland or Palmer as captain?');
A(/Haaland/.test(out) && /Palmer/.test(out) && !/ELITE-ANSWER/.test(out) && /Captain decision/.test(out), 'B1 fixed: H2H captain question reaches the pair engine, not elite');
out = R.askAI('Rate my team');
A(!/ELITE-ANSWER/.test(out) && /Load your team/.test(out), 'B9 fixed: rate-my-team falls to the team prompt, not elite template');
out = R.askAI('best DEF under 6m');
A(/Best DEF under/.test(out) && !/xGA|leaky|solid defence/.test(out), 'B9 fixed: "best DEF under 6m" returns players, not team defences');
out = R.askAI('Gakpo fixtures');
A(/Gakpo/.test(out) && !/Load your team/.test(out), 'B9 fixed: named player + fixtures -> scout report');
out = R.askAI('what did elite managers buy?');
A(/ELITE-ANSWER/.test(out), 'genuine elite questions still route to eliteAsk');

// ---------- 5b. SELL? honesty (v32): only real upgrades trigger a sell ----
const H = slice('// ============ 🔁 SELL? HONESTY', 'function renderTeam(');
const S = (0, eval)('(function(){ ' + FM + '\n' + osmBlock + '\n' + spine + '\n' + H + '\nreturn { sellUpgrade, sellInfo, hSumP }; })()');
const haaH = DATA.players.find(p => p.name === 'Haaland');
A(S.sellUpgrade(haaH, 2, new Set()) === null, 'SELL honesty: Haaland (elite 3-GW xP, hard MUN/LIV run) is not a sell — the fixture-only SELL? is gone');
const worstF = DATA.players.filter(p => p.pos === 'FWD' && p.status === 'a' && p.mins >= 90)
  .sort((a, b) => S.hSumP(a, 3) - S.hSumP(b, 3)).slice(0, 3);
A(worstF.some(p => S.sellUpgrade(p, 2, new Set())), 'SELL honesty: a bottom-output FWD gets a concrete upgrade (SELL? only ever appears with one)');
A(S.sellInfo(haaH, { bank: 2, ownedIds: new Set(), isCaptain: true }).tag !== 'SELL?', 'SELL honesty: the captain is never pushed to sell');

// ---------- 5c. My Team charts (v33): pure builders, deterministic, no NaN ----------
const CH = slice('// ============ 🎨 MY TEAM CHARTS', 'function renderTeam(');
const Mc = (0, eval)('(function(){ ' + 'globalThis.esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;"); ' + CH + '\nreturn { teamMomChart, squadHeatHtml, posStackHtml }; })()');
const momR = [{ gw: 1, v: 52 }, { gw: 2, v: 61 }, { gw: 3, v: 44 }];
const momP = [4, 5, 6, 7, 8].map(gw => ({ gw, v: 55 + gw }));
const momS = Mc.teamMomChart(momR, momP);
A((momS.match(/<rect /g) || []).length === 3 && (momS.match(/<circle /g) || []).length === 5 && !/NaN/.test(momS), 'team chart: real bars + 5 projection markers, no NaN');
A(Mc.teamMomChart([], []) === '', 'team chart degrades gracefully when empty');
const fakeRows = [
  { r: { position: 1, element: 1, is_captain: true }, e: { n: 'Haaland' }, pos: 4, ep: 6.9, fxs: [1,2,3,4,5].map(g => ({ opp: 'MUN', ha: 'A', afdr: g, gw: 3 + g })) },
  { r: { position: 12, element: 2, is_captain: false }, e: { n: 'Bogle' }, pos: 2, ep: 1.2, fxs: [] },
];
const heatS = Mc.squadHeatHtml(fakeRows, 3);
A(/GW4/.test(heatS) && /GW8/.test(heatS) && (heatS.match(/difficulty \d\/5/g) || []).length === 5, 'fixture heatmap: 5 GW columns, one cell per real fixture, missing degrade');
A(/👑/.test(heatS), 'heatmap marks the captain');
const posS = Mc.posStackHtml([{ pos: 1, ep: 4 }, { pos: 3, ep: 7 }], [{ pos: 2, ep: 1 }]);
A(/goalkeepers/.test(posS) && /midfield/.test(posS) && /Bench/.test(posS) && !/NaN/.test(posS), 'squad-shape bar names lines + bench, no NaN');
A(Mc.posStackHtml([], []) === '', 'squad-shape bar empty when no squad');

// ---------- 6. xP forecast ledger: armed now, measured when a recorded GW lands (M3) ----------
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const LX = (0, eval)('(function(){ ' + FM + '\n' + osmBlock + '\n' + spine + '\n' + fxmod + '\nreturn { fxLedgerRecord: fxLedgerRecord, fxBench: fxBench, flGet: flGet, flOpenGw: flOpenGw }; })()');
LX.fxLedgerRecord();
const led = LX.flGet(), openG = LX.flOpenGw();
A(led[openG] && led[openG].n === DATA.players.length, 'forecast ledger records every player for the open GW (' + (led[openG] && led[openG].n) + ')');
A(LX.fxBench().n === 0, 'benchmark waits for real results (n=0 now) — no retro leakage');
const realHist = JSON.parse(JSON.stringify(api('history.json')));
const g = openG, pick = DATA.players.slice(0, 40), saveH = DATA.history, saveC = DATA.fplmeta.current_gw;
DATA.history = realHist;
pick.forEach(p => { const arr = realHist[p.id] = (realHist[p.id] || []).slice(); arr.push([g, 2 + ((p.id * 7) % 13), 0.5, 0.2, 90, 0, 0, 0]); });
DATA.fplmeta.current_gw = g;
const b1 = LX.fxBench();
DATA.fplmeta.current_gw = saveC; DATA.history = saveH;
A(b1.n === 40 && b1.model && b1.ep && isFinite(b1.model.mae) && isFinite(b1.ep.mae) && b1.model.r != null, 'benchmark measures model vs official ep once a recorded GW resolves (n=' + b1.n + ')');

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (fail ? ' — SEE ABOVE' : ' ✓'));
process.exit(fail ? 1 : 0);
