// freehit_test.js — 🃏 FREE HIT LAB: one-GW squad optimizer for the next 3 GWs
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
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__FH = { freeHitPlan, fhSquadFor, fhBudget, freeHitAnswer, renderFreeHit, FH_MEMO, projP, renderAll };');
const FH = globalThis.__FH;
const A = (c, m) => { if (!c) { console.error('FAIL |', m); process.exitCode = 1; } else console.log('PASS |', m); };
const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

// ---------- the plan ----------
const P = FH.freeHitPlan();
A(P.gws.length === 3 && P.gws.filter(g => !g.error).length === 3, 'three Free Hit squads built (GW' + P.gws.map(g => g.gw).join(', GW') + ')');
A(P.gws.filter(g => !g.error).every(g => g.fhScore > 50 && isFinite(g.fhScore)), 'every FH score is a sane total (' + P.gws.filter(g => !g.error).map(g => 'GW' + g.gw + ' ' + g.fhScore).join(', ') + ' xP)');

// ---------- squad legality (the FPL rules) ----------
P.gws.filter(g => !g.error).forEach(g => {
  const pos = {}; g.squad.forEach(r => pos[r.p.pos] = (pos[r.p.pos] || 0) + 1);
  A(g.squad.length === 15, 'GW' + g.gw + ': exactly 15 players');
  A(Object.keys(QUOTA).every(k => pos[k] === QUOTA[k]), 'GW' + g.gw + ': formation quota 2 GK / 5 DEF / 5 MID / 3 FWD (' + JSON.stringify(pos) + ')');
  const clubs = {}; g.squad.forEach(r => clubs[r.p.team] = (clubs[r.p.team] || 0) + 1);
  A(Object.values(clubs).every(n => n <= 3), 'GW' + g.gw + ': max 3 per club (' + Object.entries(clubs).filter(([t, n]) => n > 1).map(([t, n]) => t + 'x' + n).join(', ') + ')');
  A(g.spent <= g.budget + 1e-6, 'GW' + g.gw + ': spends £' + g.spent.toFixed(1) + 'm within the £' + g.budget.toFixed(1) + 'm budget');
  A(g.squad.every(r => r.p.status === 'a' || r.p.status === 'd'), 'GW' + g.gw + ': no injured/suspended players in the squad');
  A(g.squad.every(r => r.xp > 0), 'GW' + g.gw + ': every pick has a positive projection');
  const [d, m, f] = g.formation.split('-').map(Number);
  A(g.starters.length === 11 && d + m + f === 10, 'GW' + g.gw + ': legal XI (' + g.formation + ', ' + g.starters.length + ' starters)');
  A(g.captain.xp === Math.max.apply(null, g.starters.map(r => r.xp)), 'GW' + g.gw + ': captain is the top projected starter (' + g.captain.p.name + ' ' + g.captain.xp.toFixed(1) + ')');
  A(Math.abs(g.fhScore - (g.starters.reduce((s, r) => s + r.xp, 0) + g.captain.xp)) < 0.06, 'GW' + g.gw + ': FH score = XI xP + captain xP again (' + g.fhScore + ')');
});

// ---------- the recommendation ----------
const ok = P.gws.filter(g => !g.error);
A(P.best.fhScore === Math.max.apply(null, ok.map(g => g.fhScore)), 'recommended week (GW' + P.best.gw + ', ' + P.best.fhScore + ' xP) is the argmax');
A(new Set(ok.map(g => g.squad.map(r => r.p.id).join(','))).size > 1, 'the three weeks produce different squads (fixtures actually matter)');
A(/xP over GW/.test(P.why), 'the verdict quantifies the gap (' + P.why + ')');
const P2 = FH.freeHitPlan();
A(JSON.stringify(P2.best.squad.map(r => r.p.id)) === JSON.stringify(P.best.squad.map(r => r.p.id)), 'deterministic + memoised (same plan on re-run)');

// ---------- budget: uses your squad value when a team is loaded ----------
A(FH.fhBudget() === 100, 'no team loaded -> standard £100m budget');
FH.FH_MEMO.plan = null; global.window.TEAMCTX = { value: 103.5, bank: 1.2, squad: [], usedChips: [] };
A(FH.fhBudget() === 104.7, 'team loaded -> budget = squad value + bank (£104.7m)');
const PL = FH.freeHitPlan();
A(PL.budget === 104.7 && PL.gws.filter(g => !g.error).every(g => g.spent <= 104.7 + 1e-6), 'squads respect the personal budget');
FH.FH_MEMO.plan = null; global.window.TEAMCTX = { value: 103.5, bank: 1.2, squad: [], usedChips: ['freehit'] };
A(FH.freeHitPlan().chipUsed === true, 'detects when Free Hit is already played (honesty warning)');

// ---------- assistant: grounded answers, no invented maths ----------
global.window.TEAMCTX = null; FH.FH_MEMO.plan = null;
const ans = q => FH.freeHitAnswer(q);
A(/GW\d+ is the strongest Free Hit week/.test(ans('which week should I play it?')), '"which week" -> the recommended GW with numbers');
A(ans('which week?').indexOf(String(P.best.fhScore.toFixed(1))) >= 0, 'the answer quotes the real score (' + P.best.fhScore.toFixed(1) + ')');
A(/captain|★/i.test(ans('who is captain?')) && ans('captain').indexOf(P.best.captain.p.name) >= 0, '"captain" names the real captain');
A((ans('show the team').match(/<br>/g) || []).length >= 14, '"show the team" lists all 15 players');
A(/£/.test(ans('budget')) && ans('budget').indexOf('100.0') >= 0, '"budget" quotes the real budget/spend');
A(/excluded|risk|doubt/i.test(ans('risks')), '"risks" answers from the real squads');
A(/overlap/.test(ans('overlap')) || /Load your team/.test(ans('overlap')), '"overlap" answers honestly (no team loaded)');
A(!/NaN|undefined/.test(ans('which week') + ans('captain') + ans('show team') + ans('bench') + ans('budget') + ans('why') + ans('risks') + ans('overlap') + ans('random gibberish')), 'no NaN/undefined in ANY assistant answer, including the fallback');

// ---------- rendering ----------
try { FH.renderFreeHit(); console.log('PASS | renderFreeHit paints without throwing'); } catch (e) { console.error('FAIL | renderFreeHit threw: ' + e.message); process.exitCode = 1; }
const html = els.fhBody.innerHTML;
A(html.indexOf('BEST WEEK') >= 0 && html.indexOf('GW' + P.best.gw) >= 0, 'renders the comparison cards + BEST WEEK badge');
A((html.match(/class="data compact"/g) || []).length === 3, 'renders all three squad tables');
A(!/NaN|undefined/.test(html), 'no NaN/undefined in the rendered tab');
try { FH.renderAll(); console.log('PASS | renderAll still clean with the new tab'); } catch (e) { console.error('FAIL | renderAll threw: ' + e.message); process.exitCode = 1; }

// ---------- empty-data degrade ----------
const savedPlayers = DATA.players; DATA.players = []; FH.FH_MEMO.plan = null;
try { const empty = FH.freeHitPlan(); A(empty.gws.every(g => g.error) && !empty.best, 'empty player data degrades gracefully (no squad, no crash)'); } catch (e) { console.error('FAIL | empty data threw: ' + e.message); process.exitCode = 1; }
DATA.players = savedPlayers; FH.FH_MEMO.plan = null;

// ---------- report ----------
console.log('\n===== FREE HIT LAB (real data) =====');
console.log('budget:', P.budget, 'm');
ok.forEach(g => console.log('GW' + g.gw + ': ' + g.fhScore + ' xP | formation ' + g.formation + ' | £' + g.spent.toFixed(1) + 'm | captain ' + g.captain.p.name + ' (' + g.captain.xp.toFixed(1) + ' vs ' + g.captain.f.opp + ')'));
console.log('BEST: GW' + P.best.gw, '-', P.why);
console.log('\nGW' + P.best.gw + ' squad:');
P.best.squad.forEach(r => console.log('  ' + r.p.pos, (r === P.best.captain ? '★C ' : P.best.starters.includes(r) ? '   ' : 'ben ') + r.p.name.padEnd(14), r.p.team, '£' + r.p.cost + 'm', r.xp.toFixed(1), 'vs ' + r.f.opp + (r.f.ha === 'H' ? '(H)' : '(A)')));
console.log('\ndone.');
