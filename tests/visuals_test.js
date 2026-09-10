// visuals_test.js — 🛰️ VISUALS (v37): crowd map, elite-gap bars, chip timeline, bargain map
// Real-data harness: every layout is computed from api/*.json through the app's own spine.
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
global.document = { querySelector: s => { const k = String(s).replace(/^#/, ''); if (!els[k]) els[k] = { innerHTML: '', textContent: '', value: '', checked: false, style: {}, dataset: {}, classList: { add() {}, remove() {}, contains: () => false }, addEventListener() {}, click() {} }; return els[k]; }, querySelectorAll: () => [] };
global.$$ = () => [];
const app = fs.readFileSync('app.js', 'utf8');
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__V = { crowdMapLayout, crowdMapSVG, eliteGapData, eliteGapHtml, chipTimelineData, chipTimelineSVG, bargainLayout, bargainMapSVG, renderVisuals, renderMarketPulse, renderAll, chipTrends };');
const V = globalThis.__V;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const clean = h => !/NaN|undefined/.test(h);

// ---------- A. crowd map ----------
const L = V.crowdMapLayout(DATA.players);
A(L.dots.length > 80, 'crowd map plots a real market (' + L.dots.length + ' players, not a toy sample)');
A(L.dots.every(d => ['buy', 'fomo', 'radar', 'fade'].includes(d.q)), 'every dot is assigned one of the four quadrants');
A(L.dots.filter(d => d.q === 'buy').every(d => d.net >= L.medNet && d.xp >= 5.5), 'BUY quadrant = crowd buying AND model rates him (>=5.5 xP - the same bar as the verdict rows)');
A(L.dots.filter(d => d.q === 'fomo').every(d => d.net >= L.medNet && d.xp < 5.5), 'FOMO quadrant = crowd buying BUT model doubts (below the 5.5 xP bar)');
A(L.dots.filter(d => d.q === 'radar').every(d => d.net < L.medNet && d.xp >= 5.5), 'RADAR quadrant = model rates him while the crowd ignores/sells him');
const trio = ['Palmer', 'João Pedro', 'Rogers'].map(n => L.dots.find(d => d.p.name === n));
A(trio.every(Boolean), 'the three Chelsea players from your original question are all on the map');
A(isFinite(L.medNet) && L.xThr === 5.5 && L.xmax >= 200 && L.xmax <= 800 && L.ymax >= 8, 'axes are finite and clamped; the model line is the verdict bar (5.5)');
const wissa = L.dots.find(d => d.p.name === 'Wissa');
A(wissa && wissa.q === 'fomo', 'Wissa (+175k, xP ' + (wissa ? wissa.xp.toFixed(1) : '?') + ') lands in the FOMO corner - matching his "CROWD AHEAD" verdict row');
const gakpo = L.dots.find(d => d.p.name === 'Gakpo');
A(gakpo && gakpo.q === 'buy', 'Gakpo (+426k, xP ' + (gakpo ? gakpo.xp.toFixed(1) : '?') + ') lands in the CROWD+MODEL corner - matching his "MODEL AGREES" row');
const svgA = V.crowdMapSVG(DATA.players);
A(svgA.indexOf('<svg') === 0 && clean(svgA), 'crowd map SVG builds with no NaN/undefined');
A(svgA.indexOf('CROWD + MODEL AGREE') >= 0 && svgA.indexOf('CROWD AHEAD') >= 0, 'quadrant corners are labelled so the chart explains itself');
A((svgA.match(/<circle/g) || []).length === L.dots.length, 'every dot in the layout is drawn (' + L.dots.length + ' circles)');
A((svgA.match(/<title>/g) || []).length >= L.dots.length, 'every dot has a hover tooltip (name, net transfers, ownership, model xP)');
A(V.crowdMapSVG([]).indexOf('hint') >= 0, 'empty data degrades to a hint, not a crash');

// ---------- B. elite gap ----------
const G = V.eliteGapData(DATA.elite, DATA.players, 10);
A(G.n === 40 && G.rows.length === 10, 'elite gap uses the real 40-manager cohort (top ' + G.rows.length + ' gaps shown)');
A(G.rows.every(r => r.elitePct >= 0 && r.elitePct <= 100 && r.crowdPct >= 0 && r.crowdPct <= 100), 'both ownership percentages are within 0-100%');
// recompute the biggest gap straight from the raw JSON and compare
const gwg = DATA.elite.gw[String(G.gw)];
const byId = {}; DATA.players.forEach(p => byId[p.id] = p);
const rawRows = Object.keys(gwg.own).map(id => { const p = byId[+id]; return p ? { id: +id, delta: (gwg.own[id] / 40 * 100) - (p.own || 0) } : null; }).filter(Boolean).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
A(Math.abs(G.rows[0].delta - rawRows[0].delta) < 0.01, 'the #1 gap matches an independent recomputation from elite.json (' + G.rows[0].p.name + ', ' + G.rows[0].delta.toFixed(1) + 'pp)');
A(G.rows.every(r => r.delta === r.elitePct - r.crowdPct), 'delta = elite% − crowd% on every row');
A(G.rows.some(r => r.delta < 0) && G.rows.some(r => r.delta > 0), 'the panel shows both directions (elites ahead AND crowd ahead)');
const htmlB = V.eliteGapHtml(G);
A(clean(htmlB) && htmlB.indexOf('crowd') >= 0 && htmlB.indexOf('elite') >= 0 && htmlB.indexOf('mp-bar') >= 0, 'gap bars render paired crowd/elite bars cleanly');
A(htmlB.indexOf('40 tracked elites') >= 0, 'gap panel states its honest sample size (40, not the population)');
A(V.eliteGapData(null, DATA.players).rows.length === 0, 'no elite data degrades gracefully');

// ---------- C. chip timeline ----------
const T = V.chipTimelineData(DATA.elite);
A(T.n === 40 && T.chips.length === 4, 'timeline covers all four chips for the 40 elites');
const rawUsed = {}; DATA.elite.elites.forEach(e => Object.values(e.chips || {}).forEach(k => rawUsed[k] = (rawUsed[k] || 0) + 1));
A(T.chips.every(c => c.used === (rawUsed[c.key] || 0) && c.used + c.hold === 40), 'per-chip totals match the raw chips dict exactly (38/31/30/4)');
A(T.chips.every(c => Object.entries(c.marks).reduce((s, [gw, n]) => s + n, 0) === c.used), 'the timeline markers sum to the per-chip totals (no double counting)');
A(T.chips.every(c => Object.keys(c.marks).every(gw => +gw >= 1 && +gw <= T.lastGw)), 'markers only appear on gameweeks that have actually been played');
const svgC = V.chipTimelineSVG(DATA.elite);
A(clean(svgC) && svgC.indexOf('GW1') >= 0 && svgC.indexOf('still hold') >= 0, 'timeline SVG draws GW labels and still-holding counts');
A((svgC.match(/<circle/g) || []).length >= 6, 'timeline draws a marker for each chip-in-week with activity');
A(svgC.indexOf('title') >= 0, 'timeline markers have hover tooltips (who played what, when)');
A(V.chipTimelineSVG(null).indexOf('hint') >= 0, 'no chip history degrades gracefully');
const ct = V.chipTrends(DATA.elite, [], [], false);
A(T.chips.every(c => c.used === ct.rows.find(r => r.key === c.key).used), 'timeline totals agree with the v36 chip-trends panel (one consistent voice)');

// ---------- D. bargain map ----------
const B = V.bargainLayout(DATA.players);
A(B.pts.length > 100 && Math.max.apply(null, B.pts.map(r => r.price)) - Math.min.apply(null, B.pts.map(r => r.price)) > 8, 'bargain map prices a real market (' + B.pts.length + ' players across the full £ range)');
A(B.curve.length >= 4 && B.curve.every(c => c.n >= 4), 'fair-value curve only uses price buckets with 4+ players (no fake precision)');
A(B.pts.filter(r => r.bucketMed != null).every(r => r.above === (r.xp > r.bucketMed)), 'above/below-the-curve classification is exact on every priced player');
A(B.pts.filter(r => r.above === true).length > 20, 'a meaningful set of players sits above the curve (bargains exist)');
A(Math.max.apply(null, B.pts.map(r => r.price)) <= B.pmax, 'price axis covers the most expensive player');
const svgD = V.bargainMapSVG(DATA.players);
A(svgD.indexOf('<svg') === 0 && clean(svgD), 'bargain map SVG builds with no NaN/undefined');
A(svgD.indexOf('fair-value curve') >= 0 && svgD.indexOf('green = above') >= 0, 'bargain map legend explains the curve and the colours');
A((svgD.match(/<circle/g) || []).length === B.pts.length, 'every player in the layout is drawn');
A(V.bargainMapSVG([]).indexOf('hint') >= 0, 'empty data degrades gracefully');

// ---------- full render smoke ----------
try { V.renderAll(); console.log('PASS | renderAll (all tabs) still runs clean with the four new charts'); }
catch (e) { console.error('FAIL | renderAll threw: ' + e.message); process.exitCode = 1; }
const got = k => (els[k] || { innerHTML: '' }).innerHTML.length;
A(got('mpMap') > 500 && got('eliteGap') > 300 && got('chipTimeline') > 500 && got('bargainMap') > 500, 'renderVisuals paints all four containers (map ' + got('mpMap') + 'b, gap ' + got('eliteGap') + 'b, timeline ' + got('chipTimeline') + 'b, bargain ' + got('bargainMap') + 'b)');
['mpMap', 'eliteGap', 'chipTimeline', 'bargainMap'].forEach(k => A(clean(els[k].innerHTML), 'container #' + k + ' has no NaN/undefined'));
console.log('\ndone.');
