// tools/freeze_snapshot.js — the snapshot ritual, automated (v48).
// After every post-GW refresh, freezes snapshots/GW{next}/ from the freshly
// refreshed api/ BEFORE any results for that GW can exist: all api files +
// predictions.json (model xP for every player) + fh-suggested.json (the Free Hit
// squad) + a MANIFEST with sha256s. IMMOVABLE RULE: if the GW already has a
// frozen snapshot, this script never touches it — a past suggestion can never
// be recomputed (the honesty rule, enforced in code).
const fs = require('fs');
const path = require('path');

const fm = JSON.parse(fs.readFileSync('api/fplmeta.json', 'utf8'));
const gw = fm.next_gw;
const dir = path.join('snapshots', 'GW' + String(gw).padStart(2, '0'));
const frozenFlag = path.join(dir, 'fh-suggested.json');
if (fs.existsSync(frozenFlag)) {
  console.log('SKIP  | ' + dir + ' already frozen — past suggestions are never recomputed.');
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });

// ---- the app harness (same stubs as the test suites) ----
const j = f => JSON.parse(fs.readFileSync('api/' + f, 'utf8'));
const DATA = { meta: j('meta.json'), league: j('league.json'), results: j('results.json'), players: j('players.json'),
  radar: j('radar.json'), fixtures: j('fixtures.json'), news: j('news.json'), captains: j('captains.json'),
  prices: j('prices.json'), fplmeta: j('fplmeta.json'), ticker: j('ticker.json'), teams: j('teams.json'),
  history: j('history.json'), elite: j('elite.json') };
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
(0, eval)(app + '\nDATA = global.DATA;\n(function(){ (DATA.players||[]).forEach(p => { const a=((window.TF[p.team]||{}).afx)||[]; (p.next3||[]).forEach((f,i)=>{ if(a[i]!=null){ f.adjv=a[i]; f.afdr=Math.max(1,Math.min(5,Math.round(a[i]))); } }); }); })();\nglobalThis.__FRZ = { projP, minutesV2, freeHitPlan, FH_MEMO };');
const F = globalThis.__FRZ;

// ---- copy the api files ----
const copied = [];
for (const f of fs.readdirSync('api')) {
  if (f.endsWith('.json')) { fs.copyFileSync(path.join('api', f), path.join(dir, f)); copied.push(f); }
}

// ---- predictions.json ----
const preds = (DATA.players || []).filter(p => p.next3 && p.next3[0]).map(p => ({
  id: p.id, name: p.name, pos: p.pos, team: p.team, cost: p.cost,
  opp: p.next3[0].opp, ha: p.next3[0].ha,
  xp: Math.round(F.projP(p, 0) * 10) / 10,
  pStart: F.minutesV2(p).pStart,
  ep_next: p.ep_next ?? null, form: p.form ?? null, status: p.status || 'a',
  chance_next: (typeof p.chance_next === 'number' && p.chance_next < 100) ? p.chance_next : null,
}));
const captured = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(dir, 'predictions.json'), JSON.stringify({
  gw, captured,
  note: 'FROZEN pre-deadline model forecasts (production spine at freeze time) + baseline fields, judged against post-GW' + gw + ' actuals',
  n: preds.length, preds }, null, 1));

// ---- fh-suggested.json ----
F.FH_MEMO.plan = null;
const P = F.freeHitPlan();
const g = P.gws.find(x => x.gw === gw && !x.error);
if (!g) { console.error('FREEZE ABORTED | no Free Hit plan for GW' + gw + ': ' + JSON.stringify(P.gws.map(x => x.error))); process.exit(1); }
const squad = g.squad.map(r => ({ id: r.p.id, name: r.p.name, pos: r.p.pos, team: r.p.team, cost: pCost(r), xp: Math.round(r.xp * 10) / 10, opp: r.f ? r.f.opp : '', ha: r.f ? r.f.ha : '', starter: g.starters.includes(r) }));
function pCost(r) { return r.p.cost; }
fs.writeFileSync(path.join(dir, 'fh-suggested.json'), JSON.stringify({
  gw, captured, budget: 100, fhScore: g.fhScore, formation: g.formation, captainId: g.captain.p.id,
  note: 'FROZEN pre-deadline: the Free Hit squad our model suggested for GW' + gw + ', computed from snapshots/GW' + String(gw).padStart(2, '0') + ' data BEFORE any GW' + gw + ' results existed. Judged by fh-audit against actual GW' + gw + ' points.',
  squad }, null, 1));

// ---- MANIFEST ----
const crypto = require('crypto');
const files = {};
for (const f of fs.readdirSync(dir)) {
  if (f === 'MANIFEST.json') continue;
  const b = fs.readFileSync(path.join(dir, f));
  files[f] = { bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16), ok: true };
}
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify({
  gw, captured,
  note: 'pre-deadline state frozen by the automated post-GW' + (gw - 1) + ' refresh — the truth the GW' + gw + ' scorecard will be judged against',
  files }, null, 1));

console.log('FROZE | ' + dir + ' (' + copied.length + ' api files + predictions(' + preds.length + ') + fh-suggested ' + g.fhScore + ' xP, captain ' + g.captain.p.name + ', formation ' + g.formation + ')');
