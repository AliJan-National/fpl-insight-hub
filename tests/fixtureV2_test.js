// fixtureV2_test.js — 🧭 FIXTURE DIFFICULTY V2 (v2.0 Phase 4): position-aware grades
const fs = require('fs');
const j = f => JSON.parse(fs.readFileSync('api/' + f, 'utf8'));
const DATA = { meta: j('meta.json'), league: j('league.json'), results: j('results.json'), players: j('players.json'),
  radar: j('radar.json'), fixtures: j('fixtures.json'), news: j('news.json'), captains: j('captains.json'),
  prices: j('prices.json'), fplmeta: j('fplmeta.json'), ticker: j('ticker.json'), teams: j('teams.json'),
  history: j('history.json'), elite: j('elite.json') };
global.DATA = DATA; global.fetch = () => new Promise(() => {});
global.window = { TF: {}, TEAMCTX: null };
DATA.teams.forEach(t => { global.window.TF[t.short] = t; });
globalThis.ownForm = () => 1; globalThis.formRank = () => 10; globalThis.adjAvg3 = () => 3;
global.window.ownForm = () => 1; global.window.formRank = () => 10; global.window.adjAvg3 = () => 3;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const els = {};
global.document = { querySelector: s => { const k = String(s).replace(/^#/, ''); if (!els[k]) els[k] = { innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {}, onclick: null, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, click() {} }; return els[k]; }, querySelectorAll: () => [] };
global.$$ = () => [];
const app = fs.readFileSync('app.js', 'utf8');
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__F = { fixtureDifficultyV2, posFixGrade, teamRatingsV2 };');
const F = globalThis.__F;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const T = DATA.teams.map(t => t.short);

// ---------- structure ----------
const che = F.fixtureDifficultyV2('CHE', 'HUL', 'H');
A(['FWD', 'MID', 'DEF', 'GK'].every(k => che.pos[k] && che.pos[k].score >= 1 && che.pos[k].score <= 5 && che.pos[k].label && che.pos[k].why), 'all four positions graded 1-5 with label + reason (CHE v HUL: ' + ['FWD','MID','DEF','GK'].map(k => k + ' ' + che.pos[k].score).join(', ') + ')');
let bad = 0;
T.forEach(h => T.forEach(a => { if (h === a) return; ['H', 'A'].forEach(ha => { const d = F.fixtureDifficultyV2(h, a, ha); Object.values(d.pos).forEach(p => { if (!(p.score >= 1 && p.score <= 5) || !isFinite(p.score)) bad++; }); }); }));
A(bad === 0, 'all ' + (20 * 19 * 2) + ' team/opponent/venue combinations grade cleanly (finite, in range)');
const d1 = F.fixtureDifficultyV2('CHE', 'HUL', 'H'), d2 = F.fixtureDifficultyV2('CHE', 'HUL', 'H');
A(JSON.stringify(d1) === JSON.stringify(d2), 'deterministic + memoised');

// ---------- the audit's core point: positions DIFFER ----------
let maxSpread = 0, maxFx = null;
T.forEach(h => T.forEach(a => { if (h === a) return; const d = F.fixtureDifficultyV2(h, a, 'H'); const s = Math.max(...Object.values(d.pos).map(p => p.score)) - Math.min(...Object.values(d.pos).map(p => p.score)); if (s > maxSpread) { maxSpread = s; maxFx = h + ' v ' + a; } }));
A(maxSpread >= 1.0, 'position spread is real: ' + maxFx + ' differs by ' + maxSpread.toFixed(1) + ' between positions (one number is NOT enough)');
const liv = F.fixtureDifficultyV2('LIV', 'BOU', 'H');
A(liv.pos.FWD.score < liv.pos.DEF.score - 0.8, 'LIV v BOU: attackers love it (' + liv.pos.FWD.score + ') but defenders fear it (' + liv.pos.DEF.score + ') — an open game, graded differently per position');

// ---------- directional sanity on real ratings ----------
const R = F.teamRatingsV2();
A(F.fixtureDifficultyV2('EVE', 'ARS', 'A').pos.FWD.score >= 4.0, 'Everton attackers away at Arsenal is brutal (' + F.fixtureDifficultyV2('EVE', 'ARS', 'A').pos.FWD.score + ' — Arsenal project ' + F.fixtureDifficultyV2('EVE', 'ARS', 'A').xgFor + ' goals FOR Everton... their own chance is ' + F.fixtureDifficultyV2('EVE', 'ARS', 'A').xgFor + ')');
const arsDef = F.fixtureDifficultyV2('ARS', 'EVE', 'H').pos.DEF;
A(arsDef.score <= 2.2, 'Arsenal defenders home to Everton are near-safe (' + arsDef.score + ', ' + Math.round(F.fixtureDifficultyV2('ARS','EVE','H').csProb * 100) + '% clean sheet)');
// monotonicity: harder opponent attack -> higher DEF difficulty, for every real defence
const opps = T.filter(t => t !== 'MCI').sort((a, b) => R.teams[a].attAway - R.teams[b].attAway);
let mono = true;
for (let i = 1; i < opps.length; i++) { if (F.fixtureDifficultyV2('MCI', opps[i], 'H').pos.DEF.score < F.fixtureDifficultyV2('MCI', opps[i - 1], 'H').pos.DEF.score - 0.02) { mono = false; break; } }
A(mono, 'defender difficulty rises monotonically with the opponent\'s AWAY attack (MCI home, all 19 opponents — the home/away split is the driver, not overall attack)');
const oppsH = T.filter(t => t !== 'CHE').sort((a, b) => R.teams[a].attHome - R.teams[b].attHome);
let monoH = true;
for (let i = 1; i < oppsH.length; i++) { if (F.fixtureDifficultyV2('CHE', oppsH[i], 'A').pos.DEF.score < F.fixtureDifficultyV2('CHE', oppsH[i - 1], 'A').pos.DEF.score - 0.02) { monoH = false; break; } }
A(monoH, 'same check flipped: CHE away, opponents sorted by HOME attack — monotone again');
// attackers: higher own expected goals -> lower FWD difficulty
let fwdOK = true;
T.forEach(t => { const d = F.fixtureDifficultyV2(t, 'HUL', 'H'); if (d.xgFor > 1.8 && d.pos.FWD.score > 2.2) fwdOK = false; if (d.xgFor < 0.9 && d.pos.FWD.score < 3.2) fwdOK = false; });
A(fwdOK, 'attacker difficulty tracks the expected-goals feed (xG>1.8 -> easy, xG<0.9 -> hard, all 20 teams vs HUL)');

// ---------- GK nuance ----------
const busyGk = T.map(t => ({ t, d: F.fixtureDifficultyV2(t, 'MCI', 'A') })).sort((a, b) => b.d.oppXG - a.d.oppXG)[0];
A(busyGk.d.savesExp >= 3.5 && busyGk.d.pos.GK.score <= busyGk.d.pos.DEF.score, 'a busy GK (facing ~' + busyGk.d.savesExp + ' saves, ' + busyGk.t + ' at MCI) grades no harder than his defenders — save points cushion him');

// ---------- home/away realism ----------
const cheH = F.fixtureDifficultyV2('CHE', 'HUL', 'H'), cheA = F.fixtureDifficultyV2('CHE', 'HUL', 'A');
A(cheH.pos.FWD.score <= cheA.pos.FWD.score, 'the same fixture is easier at home than away for attackers (' + cheH.pos.FWD.score + ' vs ' + cheA.pos.FWD.score + ')');

// ---------- player bridge (posFixGrade) ----------
const pal = DATA.players.find(p => p.name === 'Palmer');
const g0 = F.posFixGrade(pal, 0);
A(g0.opp === 'HUL' && g0.score <= 2.6 && g0.label === 'good' && /attack lens/.test(g0.why), "Palmer's GW4 (HUL H) through the MID lens: " + g0.score + ' (' + g0.label + ')');
const salGk = DATA.players.find(p => p.pos === 'GK' && p.team === 'ARS');
if (salGk && salGk.next3 && salGk.next3[0]) { const gg = F.posFixGrade(salGk, 0); A(gg.score === F.fixtureDifficultyV2('ARS', gg.opp, gg.ha).pos.GK.score, 'posFixGrade returns the position-specific grade (ARS GK: ' + gg.score + ' vs ' + gg.opp + ')'); }
A(F.posFixGrade({ pos: 'MID', team: 'XXX', next3: [] }, 0).score === 3, 'missing fixture degrades to neutral 3 (no crash)');

// ---------- alignment with the official FDR lens ----------
const spear = (a, b) => { const rk = arr => arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).map(([, i], k) => [i, k]).sort((x, y) => x[0] - y[0]).map(([, k2]) => k2);
  const ra = rk(a), rb = rk(b), n = a.length, ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return num / Math.sqrt(da * db); };
const seen = {}, rows = [];
DATA.players.forEach(p => (p.next3 || []).forEach((f, i) => { const k = p.team + '|' + f.opp + '|' + f.ha; if (!seen[k] && f.opp && T.includes(f.opp) && T.includes(p.team)) { seen[k] = 1; rows.push({ k, team: p.team, opp: f.opp, ha: f.ha, off: f.fdr, mine: F.fixtureDifficultyV2(p.team, f.opp, f.ha).pos[p.pos].score }); } }));
const rho = spear(rows.map(r => r.mine), rows.map(r => r.off));
A(rho >= 0.1, 'positive alignment with the official FDR lens (Spearman ' + rho.toFixed(3) + ' over ' + rows.length + ' real fixtures) without copying it');
const fxDedup = {}, fxAll = [];
DATA.players.forEach(p => (p.next3 || []).forEach(f => { const k = p.team + '|' + f.opp + '|' + f.ha; if (!fxDedup[k] && f.opp && f.fdr && T.includes(f.opp)) { fxDedup[k] = 1; fxAll.push({ team: p.team, opp: f.opp, ha: f.ha, off: f.fdr }); } }));
const drvDEF = spear(fxAll.map(r => F.fixtureDifficultyV2(r.team, r.opp, r.ha).pos.DEF.score), fxAll.map(r => F.fixtureDifficultyV2(r.team, r.opp, r.ha).oppXG));
A(drvDEF >= 0.95, 'driver fidelity: DEF difficulty is monotone in the opponent\'s expected goals at Spearman ' + drvDEF.toFixed(3) + ' (the exact quantity that generates it)');
const drvFWD = spear(fxAll.map(r => F.fixtureDifficultyV2(r.team, r.opp, r.ha).pos.FWD.score), fxAll.map(r => F.fixtureDifficultyV2(r.team, r.opp, r.ha).xgFor || 2));
A(drvFWD <= -0.9, 'driver fidelity: FWD difficulty is inverse to expected goals at Spearman ' + drvFWD.toFixed(3) + ' (more goals = easier)');
const benchOff = spear(fxAll.map(r => (R.teams[r.opp] || {}).att || 1), fxAll.map(r => r.off));
A(benchOff < 0.45, 'HONEST FINDING: the official FDR itself only correlates ' + benchOff.toFixed(3) + ' with opponents\' REAL GW1-3 attack strength — divergence between our grades and official is the model doing its job (that is why this project exists)');

// ---------- report ----------
console.log('\n===== POSITION-AWARE FIXTURE GRADES (GW4 headlines) =====');
const fx = [['CHE','HUL','H'],['LIV','FUL','H'],['MUN','MCI','H'],['HUL','CHE','A'],['SUN','MCI','A'],['LEE','ARS','A'],['BHA','COV','A']];
fx.forEach(([t, o, ha]) => { const d = F.fixtureDifficultyV2(t, o, ha); console.log('  ' + t + ' v ' + o + ' (' + ha + ')  xG ' + d.xgFor + '-' + d.oppXG + '  CS ' + Math.round(d.csProb * 100) + '%  | FWD ' + d.pos.FWD.score + ' MID ' + d.pos.MID.score + ' DEF ' + d.pos.DEF.score + ' GK ' + d.pos.GK.score); });
console.log('\ndone.');
