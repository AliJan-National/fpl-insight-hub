// channels_test.js — 🧭 CHANNEL MODEL (v2.0 Phase 5a)
// Real shot locations: team pitch-zone profiles + player lateral positions.
// Pins the honest-signal bar (xG-weighted, shrunk), the player classification
// the coordinate system was validated on, the mismatch math, the honest
// beside-production labelling, and the degrade paths.
const fs = require('fs');
const j = f => JSON.parse(fs.readFileSync('api/' + f, 'utf8'));
const DATA = { meta: j('meta.json'), league: j('league.json'), results: j('results.json'), players: j('players.json'),
  radar: j('radar.json'), fixtures: j('fixtures.json'), news: j('news.json'), captains: j('captains.json'),
  prices: j('prices.json'), fplmeta: j('fplmeta.json'), ticker: j('ticker.json'), teams: j('teams.json'),
  history: j('history.json'), elite: j('elite.json'), channels: j('channels.json') };
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
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__C = { chanTeam, chanPlayer, channelEdge, chanLine, chanTopEdges, channelCardHtml, chanLeague };');
const C = globalThis.__C;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const find = n => DATA.players.find(p => p.name === n);

// ---------- data shape ----------
const ch = DATA.channels;
A(ch && ch.meta && ch.teams && ch.players && ch.league, 'channels.json carries meta/league/teams/players');
A(Object.keys(ch.teams).length === 20, 'all 20 teams profiled');
A(Object.values(ch.teams).every(t => Math.abs(t.att.share.reduce((a, b) => a + b, 0) - 1) < 0.01
  && Math.abs(t.def.share.reduce((a, b) => a + b, 0) - 1) < 0.01), 'every team\'s att+def shares sum to 1');
A(ch.meta.shots >= 800 && ch.meta.dropped === 0, ch.meta.shots + ' real shots matched, 0 dropped');
A(/not yet in the xP spine|pending/i.test(ch.meta.note), 'the data itself carries the honest Phase-5a label');

// ---------- the validation trio (coordinate system proof) ----------
const mb = C.chanPlayer(find('Mbeumo'));
A(mb.known && mb.side === 'R' && mb.y > 58, 'Mbeumo classifies RIGHT (avg y ' + mb.y + ' — the coordinate system reads real wings)');
const hal = C.chanPlayer(find('Haaland'));
A(hal.known && hal.side === 'C' && Math.abs(hal.y - 50) < 6, 'Haaland classifies CENTRAL (avg y ' + hal.y + ')');
const sak = C.chanPlayer(find('Saka'));
A(sak.known && sak.side === 'R', 'Saka classifies RIGHT (' + sak.y + ')');

// ---------- mismatch math ----------
const lg = C.chanLeague().def;
const liv = C.chanTeam('LIV');
A(liv.def.share[0] / lg[0] >= 1.3, 'Liverpool leak the LEFT channel at >=1.3x league (' + (liv.def.share[0] / lg[0]).toFixed(2) + 'x) — a left-sided attacker is the play vs LIV');
const ars = C.chanTeam('ARS');
A(ars.def.share[2] / lg[2] >= 1.3, 'Arsenal concede at >=1.3x league down the RIGHT (' + (ars.def.share[2] / lg[2]).toFixed(2) + 'x)');
// synthetic left-winger vs LIV (plumbing through a fabricated player)
DATA.channels.players['-1001'] = { name: 'SynthLW', team: 'BOU', pos: 'MID', n: 10, y: 28, sd: 5, side: 'L', conf: 1 };
const synth = { id: -1001, name: 'SynthLW', pos: 'MID', team: 'BOU', next3: [{ opp: 'LIV', ha: 'A', gw: 5 }] };
const e = C.channelEdge(synth, 0);
A(e && e.side === 'L' && e.ratio > 1.3 && e.mult > 1.0 && e.mult <= 1.10, 'synthetic LW vs LIV: ratio ' + (e && e.ratio) + ', suggested mult ' + (e && e.mult) + ' (clamped <=1.10 pre-backtest)');
const line = C.chanLine(synth, 0);
delete DATA.channels.players['-1001'];
// guards: DEF/GK get no edge, central gets none, low-conf gets none
A(C.channelEdge({ ...synth, pos: 'DEF' }, 0) === null, 'DEFenders get no channel edge (clean-sheet driven)');
A(C.channelEdge({ id: 1, pos: 'MID', team: 'LIV', next3: [{ opp: 'LIV', ha: 'A' }] }, 0) === null, 'unknown player (no shot data) gets no edge');
A(C.chanTopEdges(0, 6).every(x => x.e.boost && x.e.ratio >= 1.2 && x.xp >= 3), 'chanTopEdges lists only material mismatches (>=1.2x, >=3 xP)');

// ---------- rendering ----------
const card = C.channelCardHtml();
A(card.includes('Channel model') && (card.match(/leakiest:/g) || []).length === 20, 'the pitch-map card renders all 20 teams');
A(!/NaN|undefined/.test(card), 'no NaN/undefined in the card');
A(/not yet in the xP spine/.test(card), 'the card carries the honest beside-production label');
A(line.includes('LEFT') && line.includes('LIV'), 'the scout line names the channel and the opponent');

// ---------- degrade: no channels data ----------
const savedCh = DATA.channels; DATA.channels = null;
A(C.chanTeam('LIV') === null && C.channelEdge(synth, 0) === null && C.channelCardHtml() === '', 'missing channels.json degrades to neutral everywhere (no crash)');
DATA.channels = savedCh;

// ---------- determinism ----------
A(JSON.stringify(C.chanTopEdges(0, 5)) === JSON.stringify(C.chanTopEdges(0, 5)), 'deterministic');

// ---------- assistant ----------
const ask = globalThis.__C2 || null;
