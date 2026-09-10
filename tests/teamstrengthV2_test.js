// teamstrengthV2_test.js — 🏟️ TEAM STRENGTH V2 (v2.0 Phase 3)
// Real-data harness: ratings, shrinkage, opponent adjustment, home/away splits,
// calibration and the legacy osmBuild() comparison.
const fs = require('fs');
const j = f => JSON.parse(fs.readFileSync('api/' + f, 'utf8'));
const DATA = { meta: j('meta.json'), league: j('league.json'), results: j('results.json'), players: j('players.json'),
  radar: j('radar.json'), fixtures: j('fixtures.json'), news: j('news.json'), captains: j('captains.json'),
  prices: j('prices.json'), fplmeta: j('fplmeta.json'), ticker: j('ticker.json'), teams: j('teams.json'),
  history: j('history.json'), elite: j('elite.json') };
global.DATA = DATA; global.fetch = () => new Promise(() => {});
global.window = { TF: {}, TEAMCTX: null };
DATA.teams.forEach(t => { global.window.TF[t.short] = t; });
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const els = {};
global.document = { querySelector: s => { const k = String(s).replace(/^#/, ''); if (!els[k]) els[k] = { innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {}, onclick: null, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, click() {} }; return els[k]; }, querySelectorAll: () => [] };
global.$$ = () => [];
const app = fs.readFileSync('app.js', 'utf8');
(0, eval)(app + '\nDATA = global.DATA; globalThis.__T = { teamRatingsV2, osmBuild };');
const T = globalThis.__T;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const r = T.teamRatingsV2();
const teams = Object.values(r.teams);

// ---------- structure & sanity ----------
A(teams.length === 20 && teams.every(t => isFinite(t.att) && isFinite(t.def) && t.att > 0 && t.def > 0), 'ratings exist for all 20 teams, finite and positive');
A(teams.every(t => t.attRaw > 0 && t.attShr > 0 && t.attHome > 0 && t.attAway > 0 && t.defHome > 0 && t.defAway > 0), 'raw/shrunk/home/away variants all present and finite');
A(teams.every(t => t.att > 0.3 && t.att < 2.5 && t.def > 0.3 && t.def < 2.5), 'all ratings in sane multiplicative ranges (0.3-2.5)');

// ---------- shrinkage (the audit's 30/70 rule at n=3) ----------
let viol = 0;
teams.forEach(t => { const rawM = t.attRaw / r.league.meanAtt; if (Math.abs(t.attShr - 1) > Math.abs(rawM - 1) + 1e-9) viol++; });
A(viol === 0, 'shrinkage pulls EVERY raw rating toward the league mean at n=3 (0 violations, w = n/(n+7))');
A(r.league.shrinkage.indexOf('30% current at 3') >= 0, 'the shrinkage schedule is disclosed in the league meta');

// ---------- opponent adjustment ----------
const changed = teams.filter(t => Math.abs(t.att - t.attShr) > 0.005).length;
A(changed >= 10, 'opponent adjustment actually moves ratings (' + changed + '/20 teams shifted — strength of schedule is real)');
const attMean = teams.reduce((s, t) => s + t.att, 0) / 20, defMean = teams.reduce((s, t) => s + t.def, 0) / 20;
A(Math.abs(attMean - 1) < 0.02 && Math.abs(defMean - 1) < 0.02, 'adjusted ratings stay mean-normalized (att ' + attMean.toFixed(3) + ', def ' + defMean.toFixed(3) + ')');

// ---------- home/away splits ----------
const split = teams.filter(t => Math.abs(t.attHome - t.attAway) > 0.02).length;
A(split >= 12, 'home/away splits differentiate (' + split + '/20 teams have a real home-vs-away tilt)');
const mun = r.teams.MUN;
A(mun.attHome > mun.attAway, 'MUN really is stronger at home this season (attH ' + mun.attHome + ' vs attA ' + mun.attAway + ') — legacy cannot see this');

// ---------- real football sanity ----------
const bestAtt = teams.slice().sort((a, b) => b.att - a.att)[0];
const bestDef = teams.slice().sort((a, b) => a.def - b.def)[0];
A(bestAtt.short === 'BHA', 'Brighton have the top opponent-adjusted attack (' + bestAtt.att + ') — matches the real GW1-3 data');
A(bestDef.short === 'ARS' && bestDef.def < 0.8, 'Arsenal have the best defence (' + bestDef.def + ')');
A(r.teams.HUL.att < 0.95 && r.teams.TOT.att < 0.95, 'Hull and Spurs attacks grade below average (real early data)');
A(r.league.baseH > r.league.baseA, 'home advantage is real and visible (baseH ' + r.league.baseH + ' > baseA ' + r.league.baseA + ')');

// ---------- expected goals: the Phase-5 feed ----------
const che = r.expectedGoals('CHE', 'HUL');
A(che.hg > 1.2 && che.hg < 2.1 && che.ag > 0.6 && che.ag < 1.4 && che.hg > che.ag, 'CHE vs HUL: ' + che.hg + '-' + che.ag + ' (Chelsea clear favourites at home to Hull)');
const liv = r.expectedGoals('LIV', 'BOU');
A(liv.hg > liv.ag, 'LIV vs BOU favours Liverpool (' + liv.hg + '-' + liv.ag + ')');
const fb = r.expectedGoals('XXX', 'YYY');
A(isFinite(fb.hg) && isFinite(fb.ag), 'unknown teams fall back to league-average goals (no crash)');
let sane = 0;
DATA.results.forEach(m => { const g = r.expectedGoals(m.home, m.away); if (g.hg >= 0.15 && g.hg <= 4.5 && g.ag >= 0.1 && g.ag <= 4.2) sane++; });
A(sane === DATA.results.length, 'expected goals stay in realistic bounds for all ' + DATA.results.length + ' real fixtures');

// ---------- calibration (the bias fix) ----------
let ph = 0, pa = 0, ah = 0, aa = 0;
DATA.results.forEach(m => { const g = r.expectedGoals(m.home, m.away); ph += g.hg; pa += g.ag; ah += m.hs; aa += m.as_; });
A(Math.abs(ph - ah) / ah <= 0.03, 'calibrated: predicted home goals ' + ph.toFixed(1) + ' vs actual ' + ah + ' (within 3%)');
A(Math.abs(pa - aa) / aa <= 0.03, 'calibrated: predicted away goals ' + pa.toFixed(1) + ' vs actual ' + aa + ' (within 3%)');
A(r.league.calib && isFinite(r.league.calib.cH) && isFinite(r.league.calib.cA), 'calibration factors disclosed in league meta (' + JSON.stringify(r.league.calib) + ')');

// ---------- legacy comparison ----------
const leg = T.osmBuild();
const legAtt = {}; leg.forEach(x => legAtt[x.short] = x.att);
const spear = (a, b) => { const rk = arr => arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).map(([, i], k) => [i, k]).sort((x, y) => x[0] - y[0]).map(([, k2]) => k2);
  const ra = rk(a), rb = rk(b), n = a.length, ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; } return num / Math.sqrt(da * db); };
const common = Object.keys(r.teams).filter(t => legAtt[t] != null);
const rho = spear(common.map(t => r.teams[t].att), common.map(t => legAtt[t]));
A(rho >= 0.85, 'rank agreement with the legacy model is high (Spearman ' + rho.toFixed(3) + ' over ' + common.length + ' teams — V2 is an evolution, not a random walk)');
const r2 = T.teamRatingsV2();
A(JSON.stringify(Object.keys(r2.teams)) === JSON.stringify(Object.keys(r.teams)), 'deterministic + memoised (same teams, same order)');

// ---------- report ----------
console.log('\n===== TEAM STRENGTH V2 (real GW1-3 data) =====');
console.log('league:', JSON.stringify(r.league));
console.log('\ntop 5 attacks:'); teams.slice().sort((a, b) => b.att - a.att).slice(0, 5).forEach(t => console.log('  ' + t.short.padEnd(4), 'att', String(t.att).padEnd(6), 'attH', String(t.attHome).padEnd(6), 'attA', t.attAway));
console.log('best defences:'); teams.slice().sort((a, b) => a.def - b.def).slice(0, 5).forEach(t => console.log('  ' + t.short.padEnd(4), 'def', String(t.def).padEnd(6), 'defH', String(t.defHome).padEnd(6), 'defA', t.defAway));
console.log('\nGW4 headline fixtures:');
[['CHE','HUL'],['LIV','BOU'],['MUN','WHU'],['ARS','EVE']].forEach(([h,a]) => { try { console.log('  ' + h + ' vs ' + a + ':', JSON.stringify(r.expectedGoals(h,a))); } catch(e){} });
console.log('\ndone.');
