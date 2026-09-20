// tools/smoke_test.js — BLOCKING data-integrity gate for the automated refresh.
// If any check fails, the workflow commits NOTHING. These are data-SHAPE checks
// (not prediction pins) — they must hold after every legitimate refresh.
const fs = require('fs');
const j = f => JSON.parse(fs.readFileSync('api/' + f, 'utf8'));
let fails = 0;
const A = (c, m) => { if (!c) { console.error('FAIL | ' + m); fails++; } else console.log('PASS | ' + m); };

const fm = j('fplmeta.json');
A(Number.isInteger(fm.current_gw) && fm.current_gw >= 1 && fm.current_gw <= 38, 'fplmeta.current_gw sane: ' + fm.current_gw);
A(fm.next_gw === fm.current_gw + 1, 'fplmeta.next_gw = current+1: ' + fm.next_gw);

const teams = j('teams.json');
A(Array.isArray(teams) && teams.length === 20, 'teams.json has all 20 teams');

const players = j('players.json');
A(Array.isArray(players) && players.length >= 600, 'players.json has a full squad universe: ' + players.length);
A(players.every(p => p.id && p.name && p.pos && p.team && p.cost != null), 'every player has id/name/pos/team/cost');
const withFx = players.filter(p => p.next3 && p.next3[0] && p.next3[0].opp);
A(withFx.length >= 400, 'most players carry next-fixtures: ' + withFx.length + '/' + players.length);
A(players.filter(p => typeof p.ep_next === 'number').length >= 600, 'ep_next enrichment present');

const hist = j('history.json');
const rows = Object.values(hist).reduce((s, rs) => s + rs.length, 0);
const maxGw = Math.max(...Object.values(hist).flat().map(r => r[0] || 0));
A(rows >= 2000, 'history has real volume: ' + rows + ' rows');
A(maxGw === fm.current_gw, 'history includes the just-completed GW: max ' + maxGw + ' == current_gw ' + fm.current_gw);

const ticker = j('ticker.json');
A(Array.isArray(ticker.past_gws) && ticker.past_gws.length >= 1 && ticker.past_gws[ticker.past_gws.length - 1] === fm.current_gw,
  'ticker past window ends at the completed GW: [' + ticker.past_gws + ']');
const nullPast = ticker.rows.reduce((s, r) => s + r.cells.slice(0, ticker.past_gws.length).filter(c => c === null).length, 0);
A(nullPast === 0, 'no blank cells in the ticker past window (the v46 invariant): ' + nullPast);

const fixt = j('fixtures.json');
A(fixt['GW' + fm.next_gw] && fixt['GW' + fm.next_gw].length >= 1, 'fixtures.json carries the upcoming GW' + fm.next_gw);

const elite = j('elite.json');
A(elite && elite.gw && elite.meta && Number(elite.meta.latest_complete) === fm.current_gw,
  'elite.json is current: latest_complete ' + (elite && elite.meta && elite.meta.latest_complete) + ' == ' + fm.current_gw);

const ch = j('channels.json');
A(ch && ch.teams && Object.keys(ch.teams).length === 20, 'channels.json profiles all 20 teams');
A(Object.values(ch.teams).every(t => Math.abs(t.att.share.reduce((a, b) => a + b, 0) - 1) < 0.01), 'channel shares sum to 1');
A(ch.players && Object.keys(ch.players).length >= 100 && ch.meta.shots >= 500, 'channel model has real volume: ' + ch.meta.shots + ' shots, ' + Object.keys(ch.players).length + ' players');

for (const f of ['fplmeta.json', 'teams.json', 'ticker.json', 'league.json', 'channels.json']) {
  A(!/NaN|undefined/.test(fs.readFileSync('api/' + f, 'utf8')), 'no NaN/undefined tokens in ' + f);
}
if (fails) { console.error('\nSMOKE FAILED — committing nothing.'); process.exit(1); }
console.log('\nSMOKE OK — data is shape-complete and self-consistent.');
