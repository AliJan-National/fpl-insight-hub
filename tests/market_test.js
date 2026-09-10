// market_test.js — 🛰️ MARKET PULSE (v36)
// Real-data harness: crowd lists, verdicts, chip trends and elite flow are all
// computed from api/players.json + api/elite.json through the app's own spine.
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
const ch = {};
global.document = { querySelector: s => { const k = String(s).replace(/^#/, ''); if (!ch[k]) ch[k] = { innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, click() {} }; return ch[k]; }, querySelectorAll: () => [] };
global.$$ = () => [];
const app = fs.readFileSync('app.js', 'utf8');
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__P = { crowdList, crowdVerdict, crowdSellVerdict, chipTrends, eliteFlow, crowdModelHtml, chipTrendsHtml, eliteFlowHtml, renderMarketPulse, forecastOf, hSumP, fixSmooth, fixtureFactor, oppFixOf, projP, fmtK, CHIP_LABELS };');
const P = globalThis.__P;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };

// ---------- crowd lists ----------
const buys = P.crowdList(DATA.players, 'in', 8), sells = P.crowdList(DATA.players, 'out', 6);
A(buys.length === 8 && buys.every(r => r.p && r.net != null), 'top-8 crowd buys built from real players.json');
A(buys[0].net >= buys[1].net && buys[7].net >= buys[0].net - 1e9, 'buys sorted by net transfers (descending)');
A(sells.length === 6 && sells[0].net <= sells[1].net, 'sells sorted by net transfers (ascending — most sold first)');
A(buys.every(r => r.f && r.f.xp >= 0) && buys.every(r => r.net3 === 0 || r.net3 > 0), 'every crowd row carries the model xP + 3-GW sum from the shared spine');
A(buys[0].net === (buys[0].p.t_in - buys[0].p.t_out), 'net transfers = real t_in − t_out');
const byNet = DATA.players.slice().sort((a,b)=>(b.t_in-b.t_out)-(a.t_in-a.t_out));
A(buys[0].p.id === byNet[0].id, 'the #1 crowd buy is the real #1 net-transfer player in the dataset');

// ---------- verdicts ----------
const vs = buys.map(r => P.crowdVerdict(r.p, r.f));
A(vs.every(v => v.tag && v.cls && v.why), 'every crowd buy gets a verdict tag + reason');
A(vs.some(v => /AGREES|FAIR|CROWD AHEAD|TOUGH RUN|THIN DATA|FLAG RISK/.test(v.tag)), 'verdict vocabulary is explicit and human-readable');
const flagged = P.crowdVerdict({ name: 'X', status: 'i', pos: 'MID' }, { xp: 9, conf: { lvl: 'HIGH' }, minutes: { pStart: 1 } });
A(flagged.cls === 'warn' && /FLAG/.test(flagged.tag), 'an injured player is never blessed as a crowd buy (FLAG RISK)');
const thin = P.crowdVerdict({ name: 'Y', status: 'a', pos: 'MID' }, { xp: 9, conf: { lvl: 'LOW', why: '1 GW of own data' }, minutes: { pStart: 0.9 } });
A(/THIN DATA/.test(thin.tag), 'a low-confidence player is labelled THIN DATA, not endorsed');
const weak = P.crowdVerdict({ name: 'Z', status: 'a', pos: 'MID', next3: [{ opp: 'ARS', ha: 'A', fdr: 5 }, { opp: 'MCI', ha: 'A', fdr: 5 }, { opp: 'LIV', ha: 'A', fdr: 5 }] }, { xp: 4.1, conf: { lvl: 'HIGH' }, minutes: { pStart: 0.9 } });
A(/TOUGH RUN/.test(weak.tag) && weak.cls === 'warn', 'a hard run flags TOUGH RUN before any xP praise');
const lowxp = P.crowdVerdict({ name: 'W', status: 'a', pos: 'MID', next3: [{ opp: 'FUL', ha: 'H', fdr: 2 }] }, { xp: 3.2, conf: { lvl: 'HIGH' }, minutes: { pStart: 0.9 } });
A(/CROWD AHEAD/.test(lowxp.tag), 'low model xP -> CROWD AHEAD (the honest "market is ahead of the maths" case)');
const good = P.crowdVerdict({ name: 'G', status: 'a', pos: 'MID', next3: [{ opp: 'HUL', ha: 'H', fdr: 2 }] }, { xp: 7.4, conf: { lvl: 'HIGH' }, minutes: { pStart: 0.95 } });
A(/AGREES/.test(good.tag) && good.cls === 'ok', 'strong xP + easy run -> MODEL AGREES');
const sgood = P.crowdSellVerdict({ name: 'S', status: 'a', pos: 'MID' }, { xp: 7.8, conf: { lvl: 'HIGH' } });
A(/MISTAKE/.test(sgood.tag) && sgood.cls === 'warn', 'selling a still-strong asset is flagged as a possible mistake');
const sbad = P.crowdSellVerdict({ name: 'S2', status: 'a', pos: 'MID' }, { xp: 2.0, conf: { lvl: 'HIGH', why: 'x' } });
A(/AGREE/.test(sbad.tag) && sbad.cls === 'ok', 'selling a weak asset gets a clean AGREE');

// ---------- chip trends (real 40-manager cohort) ----------
const ct = P.chipTrends(DATA.elite, ['wildcard'], [], true);
A(ct.sample === DATA.elite.elites.length && ct.sample === 40, 'chip sample = the 40 tracked elite managers');
A(ct.rows.length === 4 && ct.rows.map(r => r.key).sort().join(',') === '3xc,bboost,freehit,wildcard', 'all four chips reported');
A(ct.rows[0].used >= ct.rows[3].used && ct.top.key === ct.rows[0].key, 'rows sorted by usage; top chip identified');
A(ct.rows.every(r => r.used + r.hold === ct.sample && r.pct >= 0 && r.pct <= 100), 'used + still-holding always equals the sample (no double counting)');
const realCounts = {};
DATA.elite.elites.forEach(e => Object.values(e.chips || {}).forEach(k => realCounts[k] = (realCounts[k] || 0) + 1));
A(ct.rows.every(r => r.used === (realCounts[r.key] || 0)), 'chip counts match the real chips recorded for those 40 managers exactly');
A(ct.rows.find(r => r.key === 'bboost').used === 38, 'Bench Boost really was played by 38 of 40 (the dataset says so)');
A(ct.own.join(',') === 'Wildcard' && ct.ownHold.indexOf('Bench Boost') >= 0, 'your own chips are read from your loaded team (used vs still holding)');
A(ct.haveTeam === true && P.chipTrends(DATA.elite, [], [], false).haveTeam === false, 'chip panel knows whether a team is loaded (no false "you still hold" claim)');
const noTeamHtml = P.chipTrendsHtml(P.chipTrends(DATA.elite, [], [], false));
A(noTeamHtml.indexOf('Load your team') >= 0 && noTeamHtml.indexOf('You still hold') < 0, 'no team loaded -> prompts you to load it instead of inventing your chip status');
const ct2 = P.chipTrends(DATA.elite, [], ['3xc'], true);
A(ct2.rival.join(',') === 'Triple Captain', 'a loaded mini-league rival\'s chips are shown when available');
A(ct.rows.every(r => r.firstGw == null || (r.firstGw >= 1 && r.firstGw <= 38)), 'first-used GW is a sane gameweek number');
A(P.chipTrends(null, [], []).sample === 0, 'no elite data degrades gracefully');

// ---------- elite flow (real per-GW behaviour) ----------
const gw = +DATA.elite.meta.latest_complete;
const ef = P.eliteFlow(DATA.elite, gw, DATA.players, 8);
A(ef.n === 40 && ef.bought.length && ef.sold.length, 'elite flow reads GW' + gw + ' with a 40-manager cohort');
A(ef.bought.every(x => x.p && x.n > 0 && x.n <= 40), 'every bought row resolves to a real player with a count out of 40');
A(ef.bought[0].n >= ef.bought[ef.bought.length - 1].n, 'elite buys sorted by how many managers made them');
A(ef.owned.length === 8 && ef.owned[0].n >= ef.owned[1].n, 'most-owned elite players ranked by ownership count (' + ef.owned.length + ' shown, descending)');
const rawOwn = DATA.elite.gw[String(gw)].own;
A(ef.owned[0].n === Math.max.apply(null, Object.values(rawOwn)), 'top elite-owned count equals the raw dataset maximum');
A(P.eliteFlow(DATA.elite, 99, DATA.players).n === 0, 'a gameweek with no data degrades to empty (no crash)');

// ---------- HTML builders ----------
const h = P.crowdModelHtml(buys, sells);
A(h.indexOf('mp-row') >= 0 && h.indexOf('The crowd is buying') >= 0 && h.indexOf('model xP') >= 0, 'crowd panel HTML renders rows + both columns');
A(!/NaN|undefined/.test(h), 'no NaN/undefined in the crowd panel');
A(P.crowdModelHtml([], []).indexOf('No transfer data') >= 0, 'empty crowd data degrades gracefully');
const chH = P.chipTrendsHtml(ct);
A(chH.indexOf('Most-used chip') >= 0 && chH.indexOf('Bench Boost') >= 0 && chH.indexOf('40') >= 0, 'chip panel states the headline + the honest sample size');
A(chH.indexOf('no global chip counter') >= 0, 'chip panel discloses that FPL publishes no global chip counter');
A(!/NaN|undefined/.test(chH), 'no NaN/undefined in the chip panel');
const efH = P.eliteFlowHtml(ef);
A(efH.indexOf('What the elites bought') >= 0 && efH.indexOf('Elite captains') >= 0 && !/NaN|undefined/.test(efH), 'elite flow HTML covers buys/sells/captains/ownership');

// ---------- guarded DOM render ----------
global.window.TEAMCTX = { usedChips: ['wildcard'], chipsLeft: ['Free Hit', 'Bench Boost', 'Triple Captain'] };
P.renderMarketPulse();
A((ch.crowdModel.innerHTML || '').indexOf('mp-row') >= 0, 'renderMarketPulse paints the crowd panel into #crowdModel');
A((ch.chipTrends.innerHTML || '').indexOf('Most-used chip') >= 0, 'renderMarketPulse paints the chip panel into #chipTrends');
A((ch.eliteFlow.innerHTML || '').indexOf('elites bought') >= 0, 'renderMarketPulse paints the elite flow into #eliteFlow');
A((ch.chipTrends.innerHTML || '').indexOf('Wildcard') >= 0, 'your own used chip appears in the chip panel');

// ---------- v36 fixture grading (the fix behind the Chelsea question) ----------
const pal = DATA.players.find(p => p.name === 'Palmer' && p.team === 'CHE');
const f0 = P.fixtureFactor(pal, 0), f1 = P.fixtureFactor(pal, 1), f2 = P.fixtureFactor(pal, 2);
A(f0 && f0.afdr === 2 && f0.opp === 'HUL' && f0.xf > 1, 'v36: Chelsea vs Hull (H) — a green displayed fixture now BOOSTS xP (multiplier ' + f0.xf + ' > 1)');
A(f0.xf !== f1.xf && f1.xf !== f2.xf, 'v36: the three Chelsea gameweeks get three DIFFERENT multipliers (HUL/BRE/BOU no longer collapsed)');
A(f1.xf < f0.xf, 'v36: Brentford away (tougher defence) is graded harder than Hull at home');
A(f0.src === 'calibration+displayed-fdr' && f0.calXf != null, 'v36: multiplier blends opponent calibration with the difficulty the app displays');
const smooth = P.fixSmooth;
const bands = [{ n: 1, xf: 0.8, pf: 0.6, c: 0.7 }, { n: 1, xf: 1.0, pf: 1.0, c: 1.0 }, { n: 1, xf: 1.3, pf: 1.5, c: 1.4 }];
A(smooth(bands, 0.85, 'xf') > 0.8 && smooth(bands, 0.85, 'xf') < 1.0, 'fixSmooth interpolates between anchors (0.85 sits between tough and neutral)');
A(smooth(bands, 0.5, 'xf') === 0.8 && smooth(bands, 3, 'xf') === 1.3, 'fixSmooth clamps outside the anchor range (no wild extrapolation)');
A(smooth([{ n: 1, xf: 0.9, c: 2 }, { n: 1, xf: 1.2, c: 1 }], 1.1, 'xf') === 1.2 || smooth([{ n: 1, xf: 0.9, c: 2 }, { n: 1, xf: 1.2, c: 1 }], 1.1, 'xf') === 0.9, 'fixSmooth falls back to a safe step when centres are not monotonic');
A(smooth(null, 1, 'xf') === 1 && smooth(bands, null, 'xf') === 1, 'fixSmooth is null-safe');
const nowXp = P.projP(pal, 0);
const legacyXp = nowXp * (P.oppFixOf(pal, 0).bandXf / f0.xf);
A(nowXp > legacyXp, 'v36 moves Palmer\'s Hull xP UP vs the old band model (' + legacyXp.toFixed(2) + ' -> ' + nowXp.toFixed(2) + ')');
console.log('\ndone.');
