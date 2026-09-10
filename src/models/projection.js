// ============ ONE FORECAST OBJECT (audit P0 · v30) ============
// Every decision surface reads forecastOf(p) — one canonical per-GW object that
// carries xP, return chances, the outcome spread, minutes and confidence from
// the SAME spine, so those numbers can never silently come from two different
// models again. Official FPL ep_next is kept only as a labelled reference field.
// Everything is a deterministic model estimate from real GW1-N data.
const MIN_MEMO = {}, FC_MEMO = {};
function minutesOf(p) {
  const key = 'm|' + p.id + '|' + (p.mins || 0) + '|' + (p.status || 'a');
  if (MIN_MEMO[key]) return MIN_MEMO[key];
  const rows = (DATA.history || {})[p.id] || [];
  const ps = startProb(p);
  let starts = 0, stMins = 0, allMins = 0, apps = 0;
  rows.forEach(r => { const m = r[4] || 0; allMins += m; if (m > 0) apps++; if (m >= 60) { starts++; stMins += m; } });
  // position prior for "real minutes per start" (whole-pool, memoised)
  if (!MIN_MEMO._pri) {
    const st = {};
    (DATA.players || []).forEach(pl => {
      for (const r of (DATA.history || {})[pl.id] || []) { const m = r[4] || 0; if (m >= 60) { const o = st[pl.pos] = st[pl.pos] || { n: 0, s: 0 }; o.n++; o.s += m; } }
    });
    const avg = {}; Object.keys(st).forEach(k => { avg[k] = st[k].n ? st[k].s / st[k].n : 80; });
    MIN_MEMO._pri = avg;
  }
  const playMin = starts ? stMins / starts : (MIN_MEMO._pri[p.pos] || 80);     // real mins per start (prior when new)
  const cameoAvg = apps > starts ? (allMins - stMins) / (apps - starts) : 22;  // real mins per cameo (prior 22)
  const expMin = Math.max(0, Math.min(96, Math.round((ps * playMin + (1 - ps) * cameoAvg) * 10) / 10));
  const p60 = apps ? Math.round(Math.min(ps, ps * (starts / apps)) * 100) / 100 : 0; // P(≥60) ≤ P(start) & real start share
  const o = { pStart: Math.round(ps * 100) / 100, p60, expMin, n: rows.length, avgAll: rows.length ? Math.round(100 * allMins / rows.length) / 100 : 0 };
  MIN_MEMO[key] = o;
  return o;
}
function confOf(p) {
  const P = playerProb(p);
  const M = minutesOf(p);
  const doubt = (p.status === 'i' || p.status === 's');
  const n = P.n || 0;
  let lvl, why;
  if (doubt) { lvl = 'LOW'; why = (p.status === 'i' ? 'injured' : 'suspended') + ' — not reliable this GW'; }
  else if (n === 0) { lvl = 'LOW'; why = 'no GW1-N data yet (new/returning signing)'; }
  else if (n === 1) { lvl = 'LOW'; why = 'only 1 GW of own data'; }
  else if (n === 2) { lvl = 'MED'; why = '2 GWs of own data'; }
  else { lvl = (M.pStart >= 0.75) ? 'HIGH' : 'MED'; why = (M.pStart >= 0.75) ? '3+ GWs + secure starts' : '3+ GWs but rotation risk'; }
  return { lvl, why, n };
}
// canonical next-GW forecast for a catalog player — one object, one spine
function forecastOf(p) {
  if (!p) return null;
  if (FC_MEMO[p.id]) return FC_MEMO[p.id];
  const P = playerProb(p), M = minutesOf(p), C = confOf(p), D = distOf(p);
  const o = {
    id: p.id, name: p.name, pos: p.pos, team: p.team,
    gw: ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3) + 1,   // the GW this forecast is FOR
    xp: Math.round(projP(p, 0) * 10) / 10,                       // model expected points (single voice)
    ep: p.ep_next ?? 0,                                          // official FPL reference (labelled, not the model)
    p6: P.p6, p10: P.p10, sd: P.sd, n: P.n,
    dist: D.prob, distMean: D.mean,
    minutes: M,
    conf: C,
  };
  FC_MEMO[p.id] = o;
  return o;
}
// model expected points for an element id (null when the player isn't in the catalog)
function modelXpById(id) {
  const p = (DATA.players || []).find(x => x.id === id);
  return p ? forecastOf(p).xp : null;
}
function fcOfId(id) {
  const p = (DATA.players || []).find(x => x.id === id);
  return p ? forecastOf(p) : null;
}
// one-line HTML: confidence + expected minutes, for any surface that shows an xP
function fcMetaLine(f) {
  if (!f) return '';
  const m = f.minutes, c = f.conf;
  const cc = c.lvl === 'HIGH' ? 'var(--green)' : c.lvl === 'MED' ? 'var(--amber)' : 'var(--red)';
  return '<span class="mrow">🎯 model xP <b>' + f.xp.toFixed(1) + '</b> · minutes ~' + Math.round(m.pStart * 100) + '% start / ~' + m.expMin + "′ exp · confidence <b style=\"color:" + cc + '">' + c.lvl + '</b> <span class="muted">(' + esc(c.why) + ')</span></span>';
}
// ---- Probability profile (audit P0 #3: expected points ≠ probability) ----
// xPts (projP) is the point ESTIMATE. These chips answer a different question:
// "how likely is a return/haul this GW?" They are calibrated from REAL results —
// every starter's GW1-N points across the player pool give a league base rate by
// position, blended with the player's OWN real GW1-N record (shrunk, so a 2-3 GW
// sample never dominates). Every output is a labelled model estimate.
const PP_MEMO = {};
const PP_K = 3; // shrinkage weight — own record trusted more as GWs accumulate
function ppScores(p) { return ((DATA.history || {})[p.id] || []).map(r => r[1] || 0); }
function ppBaseRates() {
  if (PP_MEMO.base) return PP_MEMO.base;
  const st = {}; // starters only (>=60 mins) — best proxy for "actually plays"
  for (const p of DATA.players) for (const r of (DATA.history || {})[p.id] || []) {
    if ((r[4] || 0) < 60) continue;
    const o = st[p.pos] = st[p.pos] || { n: 0, r6: 0, r10: 0, sum: 0, sq: 0 };
    const pts = r[1] || 0; o.n++; o.sum += pts; o.sq += pts * pts;
    if (pts >= 6) o.r6++; if (pts >= 10) o.r10++;
  }
  PP_MEMO.base = st;
  return st;
}
function playerProb(p, over) {
  const mins = over && over.mins != null ? over.mins : (p.mins || 0);
  const status = over && over.status != null ? over.status : (p.status || 'a');
  // v31 fixture-aware probabilities (B2): return chances respond to the opponent,
  // exactly like the xP already does — restores consistency inside forecastOf.
  const oppFx = (typeof fixtureFactor === 'function')
    ? fixtureFactor(p, over && over.i != null ? over.i : 0)
    : ((typeof oppFixOf === 'function') ? oppFixOf(p, over && over.i != null ? over.i : 0) : null);
  const key = p.id + '|' + mins + '|' + status + (oppFx ? '|' + oppFx.band + ':' + oppFx.opp + ':' + (oppFx.afdr == null ? '-' : oppFx.afdr) : '');
  if (PP_MEMO[key]) return PP_MEMO[key];
  const scores = ppScores(p);
  const n = scores.length;
  const obs6 = scores.filter(x => x >= 6).length, obs10 = scores.filter(x => x >= 10).length;
  const b = ppBaseRates()[p.pos] || { n: 1, r6: 0, r10: 0, sum: 0, sq: 0 };
  const prior6 = b.n ? 100 * b.r6 / b.n : 10;
  const prior10 = b.n ? 100 * b.r10 / b.n : 3;
  const w = n / (n + PP_K);
  let p6 = n ? w * (100 * obs6 / n) + (1 - w) * prior6 : prior6;
  let p10 = n ? w * (100 * obs10 / n) + (1 - w) * prior10 : prior10;
  // minutes gate: a benched player cannot return; scale both chances down
  const minProb = startProb(p, { mins, status });
  const gate = 0.25 + 0.75 * minProb;
  p6 = Math.max(1, Math.min(85, Math.round(p6 * gate)));
  p10 = Math.max(1, Math.min(60, Math.round(p10 * gate)));
  if (oppFx && oppFx.pf !== 1) {
    p6 = Math.max(1, Math.min(85, Math.round(p6 * oppFx.pf)));
    p10 = Math.max(1, Math.min(60, Math.round(p10 * oppFx.pf)));
    if (p10 > p6) p10 = p6;
  }
  const avg = n ? scores.reduce((a, x) => a + x, 0) / n : 0;
  let sd = n > 1 ? Math.sqrt(scores.reduce((s, x) => s + (x - avg) * (x - avg), 0) / (n - 1)) : 0;
  if (n < 2) sd = b.n ? Math.sqrt(Math.max(0, b.sq / b.n - (b.sum / b.n) * (b.sum / b.n))) : 3;
  sd = Math.max(1.5, Math.min(8, Math.round(sd * 10) / 10)); // typical per-GW swing
  const best = n ? Math.max.apply(null, scores) : 0;
  PP_MEMO[key] = { n, p6, p10, sd, best, obs6, obs10, prior6: Math.round(prior6), prior10: Math.round(prior10), fx: oppFx ? oppFx.band : null };
  return PP_MEMO[key];
}
// two labelled chance rows used inside H2H / Compare cards
function ppRows(p) {
  const P = playerProb(p);
  const c6 = P.p6 >= 40 ? 'var(--green)' : P.p6 >= 20 ? 'var(--amber)' : 'var(--red)';
  const c10 = P.p10 >= 12 ? 'var(--green)' : P.p10 >= 5 ? 'var(--amber)' : 'var(--red)';
  return '<div style="display:flex;justify-content:space-between"><span class="muted" title="chance of a 6+ point return this GW — own real GW1-3 record blended with the league base rate for his position">P(≥6) <i>chance</i></span><b style="color:' + c6 + '">' + P.p6 + '%</b></div>'
    + '<div style="display:flex;justify-content:space-between"><span class="muted" title="chance of a 10+ point haul this GW">P(≥10) <i>chance</i></span><b style="color:' + c10 + '">' + P.p10 + '%</b></div>'
    + '<div style="display:flex;justify-content:space-between"><span class="muted" title="typical per-GW swing from his real GW1-3 points">swing ±/GW</span><b>' + P.sd.toFixed(1) + '</b></div>';
}
// ---- Probabilistic per-GW projection (audit roadmap #7) ----
// A full next-GW OUTCOME SPREAD for a player over 5 bands:
//   ≤0 · 1–2 · 3–5 · 6–9 · 10+   (probabilities sum to 1)
// Construction keeps it exactly consistent with the P(≥6)/P(≥10) rows already
// shown: the ≥10 and 6–9 bands are pinned to those probabilities, and the
// remaining mass is split across the low bands using the player's REAL GW1-N
// scores blended with the position base (shrinkage) and gated by P(starts).
// Every number is a labelled model estimate from real results.
function distShape(p) {
  const band = (pts, mins) => { if ((mins || 0) < 60) return -1; return pts <= 0 ? 0 : pts <= 2 ? 1 : pts <= 5 ? 2 : pts <= 9 ? 3 : 4; };
  if (!PP_MEMO._posShape) {
    const st = { GK: [0, 0, 0, 0, 0], DEF: [0, 0, 0, 0, 0], MID: [0, 0, 0, 0, 0], FWD: [0, 0, 0, 0, 0] };
    (DATA.players || []).forEach(pl => {
      for (const r of (DATA.history || {})[pl.id] || []) { const b = band(r[1], r[4]); if (b >= 0 && st[pl.pos]) st[pl.pos][b]++; }
    });
    PP_MEMO._posShape = st;
  }
  const own = [0, 0, 0, 0, 0]; let n = 0;
  for (const r of (DATA.history || {})[p.id] || []) { const b = band(r[1], r[4]); if (b >= 0) { own[b]++; n++; } }
  const pos = PP_MEMO._posShape[p.pos] || [0, 0, 0, 0, 0];
  const posN = pos.reduce((a, b) => a + b, 0) || 1;
  const w = n / (n + 1.5);
  const blend = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) blend[i] = w * own[i] / (n || 1) + (1 - w) * pos[i] / posN;
  return { shape: blend, posN, ownN: n };
}
function distOf(p, over) {
  const P = playerProb(p, over);                       // p6 / p10 / sd — single source of truth
  let p6 = P.p6 / 100, p10 = P.p10 / 100;
  if (p10 > p6) p10 = p6;                              // defensive (shouldn't happen)
  const { shape } = distShape(p);
  const lowW = shape[0] + shape[1] + shape[2] || 1;    // real low-band split
  const prob = [
    shape[0] / lowW * (1 - p6),
    shape[1] / lowW * (1 - p6),
    shape[2] / lowW * (1 - p6),
    p6 - p10,                                          // 6–9  == P(≥6) − P(≥10)
    p10,                                               // 10+  == P(≥10)
  ];
  const mids = [0, 1.5, 4, 7.5, 12];
  const mean = Math.round(prob.reduce((a, x, i) => a + x * mids[i], 0) * 100) / 100;
  return { prob, mean, p6: P.p6, p10: P.p10 };
}
// one compact stacked "outcome spread" bar (5 coloured segments + tooltip %)
function distBar(p, over) {
  const D = distOf(p, over);
  const cols = ['#5a6a85', '#7a8bb0', '#e6a23c', '#4cd964', '#2dd4a7'];
  const lab = ['≤0', '1–2', '3–5', '6–9', '10+'];
  const segs = D.prob.map((x, i) => `<div style="flex:${Math.max(1, Math.round(x * 1000))};background:${cols[i]};min-width:${x > 0.03 ? 12 : 2}px;height:10px;border-radius:2px" title="${lab[i]}: ${Math.round(x * 100)}%"></div>`).join('');
  return `<div style="margin-top:5px"><div class="muted" style="font-size:11px">outcome spread (chance view — sums to 100%) · xP shown separately on the card</div><div style="display:flex;gap:2px;width:100%">${segs}</div></div>`;
}

function startersAt(squad, i) {
  return bestXI(squad, p => projP(p, i)) || squad.slice(0, 11);
}
const teamProjAt = (squad, i) => {
  const st = startersAt(squad, i);
  return st.reduce((s, p) => s + projP(p, i), 0) + Math.max(0, ...st.map(p => projP(p, i)));
};
// ---- Captain leverage (audit roadmap #10) ----
// Armband edge vs the FIELD captain (whom most rivals / the public will pick):
//   expected edge = E(C) - E(F)   haul edge = P(>=10|C) - P(>=10|F)
// +ve edge means captaining C is EXPECTED to beat the field this GW. Every
// figure is a single-GW model estimate — labelled, never a promise.
function capLev(C, F) {
  const eEp = Math.round(((C.ep || 0) - (F.ep || 0)) * 10) / 10;
  const eP6 = Math.round(((C.p6 || 0) - (F.p6 || 0)) * 10) / 10;
  const eP10 = Math.round(((C.p10 || 0) - (F.p10 || 0)) * 10) / 10;
  let cls = 'MATCH', txt = 'about what the field gets — zero leverage';
  if (eEp >= 0.4) { cls = 'UPSIDE'; txt = 'beats the field captain on expected pts'; }
  else if (eEp <= -0.4) { cls = 'BEHIND'; txt = 'trails the field on expected pts — a contrarian gamble'; }
  if (cls === 'UPSIDE' && eP10 < -4) { cls = 'SWING'; txt = 'expected edge over the field, but a LOWER haul chance — upside with ceiling risk'; }
  else if (cls !== 'UPSIDE' && eEp >= 0 && eP10 >= 4) { cls = 'HAUL'; txt = 'matched on expected pts but a higher ceiling than the field'; }
  return { eEp, eP6, eP10, cls, txt };
}
function capLevColor(cls) {
  return (cls === 'UPSIDE' || cls === 'HAUL') ? 'var(--green)' : cls === 'MATCH' ? 'var(--amber)' : cls === 'SWING' ? 'var(--amber)' : 'var(--red)';
}
// field captain = the candidate the most rivals currently captain (tie -> higher ep)
function capFieldOf(cands) {
  const c = cands.slice().sort((a, b) => ((b.fieldShare || 0) - (a.fieldShare || 0)) || ((b.ep || 0) - (a.ep || 0)))[0];
  return c || null;
}
// one-line HTML leverage readout for a candidate vs the field captain
function capLevLine(C, F) {
  if (!C || !F) return '';
  if (C === F || (C.name && C.name === F.name)) return '<span class="muted">field captain — captaining him is zero leverage (safe)</span>';
  const L = capLev(C, F);
  const col = capLevColor(L.cls);
  const epTxt = (L.eEp > 0 ? '+' : '') + L.eEp.toFixed(1);
  const haulTxt = (F.p10 != null && C.p10 != null) ? ' · haul ' + (L.eP10 > 0 ? '+' : '') + L.eP10.toFixed(0) + '%' : '';
  return '<span class="tk-opp">leverage vs field (' + esc(F.name) + '): <b style="color:' + col + '">' + epTxt + ' ep</b>' + haulTxt + ' · <i>' + L.txt + '</i></span>';
}
// haul/return profile for an element id if it exists in the player catalog (else null)
function ppOfId(id) {
  const p = (DATA.players || []).find(x => x.id === id);
  return p ? playerProb(p) : null;
}

// Legal FPL formations (outfield D+M+F = 10; each XI = GK1 + D3-5 + M3-5 + F1-3)
const LEGAL_FMS = (() => { const a = []; for (let d = 3; d <= 5; d++) for (let m = 3; m <= 5; m++) { const f = 10 - d - m; if (f >= 1 && f <= 3) a.push([1, d, m, f]); } return a; })();
const posKey = p => { const x = p.pos; return (x === 1 || x === 'GK') ? 'GK' : (x === 2 || x === 'DEF') ? 'DEF' : (x === 3 || x === 'MID') ? 'MID' : 'FWD'; };
// best legal 11 from a squad (players may carry pos as numeric 1-4 or string)
function bestXI(list, scoreFn) {
  const g = { GK: [], DEF: [], MID: [], FWD: [] };
  list.forEach(p => { (g[posKey(p)] || g.FWD).push(p); });
  ['GK', 'DEF', 'MID', 'FWD'].forEach(k => g[k].sort((a, b) => scoreFn(b) - scoreFn(a)));
  let best = null;
  for (const [gk, d, m, f] of LEGAL_FMS) {
    if (g.GK.length < gk || g.DEF.length < d || g.MID.length < m || g.FWD.length < f) continue;
    const cand = [...g.GK.slice(0, gk), ...g.DEF.slice(0, d), ...g.MID.slice(0, m), ...g.FWD.slice(0, f)];
    if (cand.length !== 11) continue;
    const sum = cand.reduce((x, p) => x + scoreFn(p), 0);
    if (!best || sum > best.sum) best = { sum, xi: cand };
  }
  return best ? best.xi : null;
}

const shapeOK = (squad, out, inn) => {
  const c = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  squad.forEach(p => c[p.pos]++);
  c[out.pos]--; c[inn.pos]++;
  return c.GK >= 1 && c.GK <= 2 && c.DEF >= 3 && c.DEF <= 5 && c.MID >= 3 && c.MID <= 5 && c.FWD >= 2 && c.FWD <= 3;
};

// P2 polish: per-player "schedule strip" — REAL past form (bars) + next-5
// projection (dashed line) with the opponent & difficulty colouring each GW.
function pfxCol(fdr) {
  const i = Math.max(0, Math.min(4, (Math.round(+fdr) || 3) - 1));
  return ['#2dd4a7', '#82c91e', '#e6a23c', '#ffa94d', '#ff6b6b'][i];
}
function playerScheduleSVG(p, opts) {
  const o = opts || {};
  const W = o.w || 560, Hpx = o.h || 178, PL = 26, PR = 6, PT = 12, PB = 44;
  const rows = (DATA.history || {})[p.id] || [];
  const cur = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
  const real = rows.filter(r => (r[0] || 0) <= cur)
    .map(r => ({ g: r[0], pts: r[1] || 0, st: (r[4] || 0) >= 60 }))
    .sort((a, b) => a.g - b.g);
  const projFn = (typeof projP === 'function') ? projP : () => (+(p.ep_next || 0));
  const fut = [];
  for (let i = 0; i < 5; i++) {
    const f = (p.next3 || [])[i] || null;
    fut.push({ g: cur + 1 + i, proj: projFn(p, i), f });
  }
  const xs = [];
  real.forEach(r => xs.push({ t: 'r', g: r.g, pts: r.pts, st: r.st, proj: r.pts }));
  fut.forEach(x => xs.push({ t: 'f', g: x.g, proj: x.proj, f: x.f, opp: (x.f && x.f.opp) || '—', ha: (x.f && x.f.ha) || '?' }));
  if (!xs.length) return '';
  const X = i => PL + (W - PL - PR) * (xs.length === 1 ? 0.5 : i / (xs.length - 1));
  const yMax = Math.max(4, Math.ceil(Math.max.apply(null, xs.map(x => x.proj)) * 1.15));
  const Y = v => PT + (Hpx - PT - PB) * (1 - v / yMax);
  let g = '';
  // gridlines + y labels
  for (let t = 0; t <= 4; t++) {
    const v = yMax * t / 4, y = Y(v);
    g += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,${t === 0 ? 0.25 : 0.06})"/>`;
    g += `<text x="${PL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#8a93a6">${Math.round(v)}</text>`;
  }
  const realXs = [], futXs = [];
  xs.forEach((x, i) => {
    if (x.t === 'r') realXs.push({ i, x });
    else futXs.push({ i, x });
  });
  // real form bars
  realXs.forEach(({ i, x }) => {
    const h = Math.max(1.5, (x.pts / yMax) * (Hpx - PT - PB));
    const fill = !x.st ? '#4a5568' : x.pts >= 6 ? '#00ff85' : '#4dc3ff';
    const op = !x.st ? 0.6 : 0.9;
    g += `<rect x="${(X(i) - 7).toFixed(1)}" y="${(Y(x.pts) - 2).toFixed(1)}" width="14" height="${h.toFixed(1)}" rx="2" fill="${fill}" opacity="${op}"><title>GW${x.g}: ${x.pts} pts${x.st ? '' : ' (sub/bench)'}</title></rect>`;
  });
  // future projection line + dots + fixture labels
  if (futXs.length) {
    const pts = futXs.map(({ i, x }) => `${X(i).toFixed(1)},${Y(x.proj).toFixed(1)}`).join(' ');
    g += `<polyline points="${pts}" fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="5 3"/>`;
    futXs.forEach(({ i, x }) => {
      const c = x.f && x.f.afdr != null ? pfxCol(x.f.afdr) : (x.f && x.f.fdr != null ? pfxCol(x.f.fdr) : '#e6a23c');
      g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.proj).toFixed(1)}" r="4" fill="${c}" stroke="#0b0e17" stroke-width="1"><title>GW${x.g}: proj ${x.proj.toFixed(1)}</title></circle>`;
    });
  }
  // divider between real & future
  if (realXs.length && futXs.length) {
    const dx = (X(realXs[realXs.length - 1].i) + X(futXs[0].i)) / 2;
    g += `<line x1="${dx.toFixed(1)}" y1="${PT}" x2="${dx.toFixed(1)}" y2="${Hpx - PB}" stroke="rgba(255,255,255,.3)" stroke-dasharray="2 3"/>`;
  }
  // x labels: real GW numbers, then GW + opponent(+ha) + coloured difficulty
  xs.forEach((x, i) => {
    if (x.t === 'r') {
      g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 12}" text-anchor="middle" font-size="9.5" fill="#8a93a6">GW${x.g}</text>`;
      return;
    }
    const c = x.f && x.f.afdr != null ? pfxCol(x.f.afdr) : (x.f && x.f.fdr != null ? pfxCol(x.f.fdr) : '#e6a23c');
    const fd = x.f ? (x.f.afdr ?? x.f.fdr) : '—';
    g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 12}" text-anchor="middle" font-size="8.5" fill="#8a93a6">GW${x.g}</text>`;
    g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 24}" text-anchor="middle" font-size="9.5" fill="#e8ecf4">${x.opp}${x.ha === 'H' ? '(H)' : x.ha === 'A' ? '(A)' : ''}</text>`;
    g += `<text x="${X(i).toFixed(1)}" y="${Hpx - PB + 36}" text-anchor="middle" font-size="9" font-weight="700" fill="${c}">${fd}</text>`;
  });
  return `<svg width="${W}" height="${Hpx}" viewBox="0 0 ${W} ${Hpx}" style="max-width:100%;background:rgba(255,255,255,.035);border-radius:8px">
    <text x="${PL}" y="${PT - 2}" font-size="10" fill="#8a93a6">GW1-${cur} real pts <tspan fill="#00ff85">■</tspan> &nbsp;·&nbsp; GW${cur + 1}+ projection <tspan fill="#ffd166">╌</tspan> · dot colour = fixture difficulty (green easy → red hard)</text>
    ${g}</svg>`;
}

function sparkSVG(id, w = 110, h = 30) {
  const s = (DATA.history || {})[id];
  if (!s || !s.length) return '';
  const pts = s.map(r => r[1]), xg = s.map(r => +(r[2] + r[3]).toFixed(2));
  const max = Math.max(4, ...pts, ...xg);
  const X = i => s.length === 1 ? w / 2 : 4 + i * ((w - 8) / (s.length - 1));
  const Y = v => h - 4 - (v / max) * (h - 8);
  const line = a => a.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" style="vertical-align:middle;background:rgba(255,255,255,.04);border-radius:6px">
    <polyline points="${line(xg)}" fill="none" stroke="#4dc3ff" stroke-width="1.5" stroke-dasharray="3 2"/>
    <polyline points="${line(pts)}" fill="none" stroke="#00ff85" stroke-width="2"/>
    <title>per-GW points (green) vs xG+xA (blue dashed)</title></svg>`;
}

// ---- Multi-period planner engine (audit roadmap #8) ----
// The classic greedy solver commits each GW to the single move that looks best
// THIS week (+0.6x next week) — so a transfer that only pays off in GW+2/3, or a
// two-move sequence that needs an "enabler" first, was routinely missed.
// The engine below runs a small BEAM of competing squads across the whole
// horizon and scores every candidate branch with a full forward pass over the
// remaining GWs, then commits only at the end. Result is never worse than the
// old greedy plan (the greedy path is always one of the explored branches).
const PLAN_MARK = 1; // (no-op marker so the block is locatable in tests)
function planPoolCand(squad) {
  return DATA.players.filter(p => p.status === 'a' && p.mins >= 60 && !squad.some(x => x.id === p.id));
}
// one full horizon of decisions: at each GW pick the single best move (or roll)
function planGreedy(squad, bank, ft, H, opts) {
  const o = opts || {};
  const oOut = o.oOut || 6, oIn = o.oIn || 16;
  let sq = squad.slice(), b = bank, f = ft;
  const rows = [];
  for (let i = 0; i < H; i++) {
    const rem = H - i;
    const base = teamProjAt(sq, i);
    let best = null, bestVal = -Infinity;
    const outs = sq.slice().sort((a, c) => hSumP(a, rem) - hSumP(c, rem)).slice(0, oOut);
    const ins = planPoolCand(sq).sort((a, c) => hSumP(c, rem) - hSumP(a, rem)).slice(0, oIn);
    for (const out of outs) for (const inn of ins) {
      if (inn.cost > b + out.cost + 0.1 || !shapeOK(sq, out, inn)) continue;
      const sq2 = sq.map(p => (p === out ? inn : p));
      let val = teamProjAt(sq2, i) - base;
      if (i + 1 < H) val += 0.6 * (teamProjAt(sq2, i + 1) - teamProjAt(sq, i + 1));
      if (f <= 0) val -= 4;
      if (val > bestVal + 0.25) { bestVal = val; best = { out, inn }; }
    }
    const hit = !!best && f <= 0;
    if (best) { b += best.out.cost - best.inn.cost; sq = sq.map(p => (p === best.out ? best.inn : p)); f = Math.max(0, f - 1); }
    else f = Math.min(5, f + 1);
    const st = startersAt(sq, i);
    const cap = st.slice().sort((a, c) => projP(c, i) - projP(a, i))[0];
    rows.push({ gw: i, act: best, hit, cap, proj: teamProjAt(sq, i), ft: f });
  }
  const total = rows.reduce((s, r) => s + r.proj, 0);
  return { squad: sq, bank: b, rows, total };
}
// replay an act-list into the same {rows, total} schema (caps + FT bookkeeping)
function planReplay(squad0, bank0, ft0, acts) {
  let sq = squad0.slice(), b = bank0, f = ft0;
  const rows = acts.map((a, i) => {
    if (a && a.inn) { b += a.out.cost - a.inn.cost; sq = sq.map(p => (p === a.out ? a.inn : p)); f = Math.max(0, f - 1); }
    else f = Math.min(5, f + 1);
    const st = startersAt(sq, i);
    const cap = st.slice().sort((x, c) => projP(c, i) - projP(x, i))[0];
    return { gw: i, act: a && a.inn ? a : null, hit: a && a.inn && a.hit, cap, proj: teamProjAt(sq, i), ft: f };
  });
  const total = rows.reduce((s, r) => s + r.proj, 0);
  return { squad: sq, bank: b, rows, total, acts };
}
// beam search: W competing squads per GW, K candidate moves each, every branch
// carries its banked projected points AND is scored by the FULL remaining-horizon
// forward pass (fast greedy continuation), so a good prefix is never discarded.
function planBeam(squad, bank, ft, H, opts) {
  const o = opts || {};
  const W = o.W || 5, K = o.K || 8;
  const cOut = o.cOut || 5, cIn = o.cIn || 10;
  let beam = [{ sq: squad.slice(), b: bank, f: ft, acts: [], acc: 0 }];
  for (let i = 0; i < H; i++) {
    const rem = H - i;
    const expanded = [];
    for (const nd of beam) {
      const base = teamProjAt(nd.sq, i);
      const outs = nd.sq.slice().sort((a, c) => hSumP(a, rem) - hSumP(c, rem)).slice(0, cOut);
      const ins = planPoolCand(nd.sq).sort((a, c) => hSumP(c, rem) - hSumP(a, rem)).slice(0, cIn);
      const quick = [{ out: null, inn: null, sq2: nd.sq, b2: nd.b, f2: Math.min(5, nd.f + 1), hit: false, val: 0 }];
      for (const out of outs) for (const inn of ins) {
        if (inn.cost > nd.b + out.cost + 0.1 || !shapeOK(nd.sq, out, inn)) continue;
        const sq2 = nd.sq.map(p => (p === out ? inn : p));
        let val = teamProjAt(sq2, i) - base;
        if (i + 1 < H) val += 0.6 * (teamProjAt(sq2, i + 1) - teamProjAt(nd.sq, i + 1));
        if (nd.f <= 0) val -= 4;
        quick.push({ out, inn, sq2, b2: nd.b + out.cost - inn.cost, f2: Math.max(0, nd.f - 1), hit: nd.f <= 0, val });
      }
      quick.sort((a, c) => c.val - a.val).slice(0, K + 1).forEach(c => {
        expanded.push({ sq: c.sq2, b: c.b2, f: c.f2, acc: nd.acc + teamProjAt(c.sq2, i),
          acts: nd.acts.concat([c.inn ? { gw: i, out: c.out, inn: c.inn, hit: c.hit } : null]) });
      });
    }
    // score each branch = points banked so far + full forward pass over the rest
    expanded.forEach(nd => { nd.est = nd.acc + (i + 1 < H ? planGreedy(nd.sq, nd.b, nd.f, H - i - 1, { oOut: 4, oIn: 8 }).total : 0); });
    expanded.sort((a, c) => c.est - a.est);
    beam = expanded.slice(0, W);
  }
  beam.sort((a, c) => c.est - a.est);
  const chosen = beam[0];
  const res = planReplay(squad, bank, ft, chosen.acts);
  res.est = Math.round(chosen.est * 100) / 100;
  // absolute floor: never return a plan worse than the full-width greedy baseline
  const gRes = planGreedy(squad, bank, ft, H, { oOut: 6, oIn: 16 });
  if (gRes.total > res.total) { gRes.est = res.est; return gRes; }
  return res;
}

function solvePlan() {
  const out = $('#planOut');
  try {
    const ctx = window.TEAMCTX;
    if (!ctx || !ctx.squad || !ctx.squad.length) {
      out.innerHTML = '<div class="card"><p class="hint">Load your team in <b>My Team</b> first — the solver plans <b>your</b> squad, bank and free transfers.</p></div>';
      $('#chipOpt').innerHTML = '';
      return;
    }
    out.innerHTML = '<div class="card"><p class="hint">🧮 Solving your optimal transfers…</p></div>';
    const H = Math.max(1, Math.min(6, +$('#planHorizon').value || 4));
    const byName = {}; DATA.players.forEach(p => { byName[p.name] = p; });
    let squad = ctx.squad.map(s => DATA.players.find(p => p.id === s.r.element) || (s.e && byName[s.e.n])).filter(Boolean);
    if (squad.length < 11) {
      out.innerHTML = `<div class="card"><p class="hint">⚠️ Only matched <b>${squad.length}/15</b> of your squad to the player database — your team has players newer than this data snapshot. Reload <b>My Team</b> and try again, or ask the Copilot for transfer advice meanwhile.</p></div>`;
      $('#chipOpt').innerHTML = '';
      return;
    }
    const bank = ctx.bank || 0, ft = 1;
    const g = planGreedy(squad, bank, ft, H);
    // multi-period beam: looks across the WHOLE horizon, not just this week
    const b = H >= 2 ? planBeam(squad, bank, ft, H, { W: 5, K: 8 }) : g;
    const best = b.total >= g.total - 1e-9 ? b : g; // beam always contains the greedy path
    const rows = best.rows;
    const tot = best.total;
    const betterBy = b.total - g.total;
    const cmp = b !== g && betterBy > 0.05
      ? `<span class="mrow">🔭 Multi-period lookahead beat the greedy plan by <b class="up">+${betterBy.toFixed(1)}</b> projected pts (${b.total.toFixed(1)} vs ${g.total.toFixed(1)}) — it saw a move that only pays off in a later GW.</span>`
      : `<span class="mrow">🔭 ${H}-GW lookahead explored the whole horizon (beam ${b === g ? 'n/a' : 'searched'}); best plan ties the greedy baseline at <b>${tot.toFixed(1)}</b> projected pts — nothing on the horizon beats a simple path.</span>`;
    out.innerHTML = `<div class="card"><h2>🧾 Optimal ${H}-GW plan · projected ≈ ${tot.toFixed(1)} pts</h2>
    <table class="data"><tr><th>GW</th><th>Move</th><th>Captain</th><th class="num">Proj XI+cap</th><th>FT left</th></tr>
    ${rows.map(r => `<tr><td><b>GW${DATA.fplmeta.current_gw + 1 + r.gw}</b></td>
      <td>${r.act ? `<span class="down">− ${esc(r.act.out.name)}</span> → <span class="up">+ ${esc(r.act.inn.name)}</span>${r.hit ? ' <b class="down">(hit −4)</b>' : ''}` : 'Roll (save FT)'}</td>
      <td><b>${r.cap ? esc(r.cap.name) : '—'}</b></td><td class="num">${r.proj.toFixed(1)}</td><td class="num">${r.ft}</td></tr>`).join('')}
    </table>
    ${cmp}
    <p class="muted">Projections use the shared form-adjusted model (ep × adj FDR × home/away × minutes × reliability). Re-solve after every deadline — plans are dynamic, not promises.</p></div>`;
    chipOptimizer(best.squad, H);
  } catch (e) {
    console.error('[solvePlan]', e);
    out.innerHTML = `<div class="card"><p class="hint">⚠️ The solver hit an error: <b>${esc(e.message || e)}</b>.<br>Fix: reload your team in <b>My Team</b>, then press Solve again. If it persists, hard-refresh (Ctrl+Shift+R) to clear old cached files.</p></div>`;
    $('#chipOpt').innerHTML = '';
  }
}


function chipOptimizer(squad, H) {
  const chips = window.TEAMCTX ? window.TEAMCTX.chipsLeft : [];
  const cards = [];
  if (chips.includes('Triple Captain')) {
    let best = null;
    for (let i = 0; i < Math.min(H + 2, 6); i++) {
      const st = startersAt(squad, i);
      const cap = st.slice().sort((a, b) => projP(b, i) - projP(a, i))[0];
      const bonus = cap ? projP(cap, i) : 0;
      if (!best || bonus > best.bonus) best = { i, cap, bonus };
    }
    if (best) cards.push(`<div class="ml-rival"><h4>🧨 Triple Captain</h4><div class="gapline">Best window: <b>GW${DATA.fplmeta.current_gw + 1 + best.i}</b> on <b>${esc(best.cap.name)}</b> (+${best.bonus.toFixed(1)} bonus pts) — but cross-check vs your Mini League mode: in DEFEND, TC the same player your rivals will captain.</div></div>`);
  }
  if (chips.includes('Bench Boost')) {
    let best = null;
    for (let i = 0; i < Math.min(H + 2, 6); i++) {
      const s = squad.reduce((x, p) => x + projP(p, i), 0);
      if (!best || s > best.s) best = { i, s };
    }
    cards.push(`<div class="ml-rival"><h4>💪 Bench Boost</h4><div class="gapline">Best window: <b>GW${DATA.fplmeta.current_gw + 1 + best.i}</b> (all-15 projection ${best.s.toFixed(1)}) — ideally a week your bench plays FDR ≤3 and no blanks.</div></div>`);
  }
  if (chips.includes('Free Hit')) {
    let best = null;
    for (let i = 0; i < Math.min(H + 2, 6); i++) {
      const fh = buildFH(i);
      const s = fh.reduce((x, p) => x + projP(p, i), 0);
      if (!best || s > best.s) best = { i, s, fh };
    }
    const gain = best.s - squad.reduce((x, p) => x + projP(p, best.i), 0);
    cards.push(`<div class="ml-rival"><h4>🎯 Free Hit</h4><div class="gapline">Best window: <b>GW${DATA.fplmeta.current_gw + 1 + best.i}</b> (+${Math.max(0, gain).toFixed(1)} over your XI). Draft: ${best.fh.slice(0, 6).map(p => esc(p.name)).join(', ')}…</div></div>`);
  }
  $('#chipOpt').innerHTML = cards.length ? `<div class="card"><h2>🃏 Chip Optimiser (over your horizon)</h2><div class="ml-grid">${cards.join('')}</div></div>` : '';
}
function buildFH(i) {
  const need = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  const pick = [];
  const tc = {};
  const pool = DATA.players.filter(p => p.status === 'a').sort((a, b) => projP(b, i) - projP(a, i));
  for (const p of pool) {
    if (!need[p.pos]) continue;
    if ((tc[p.team] || 0) >= 3) continue;
    pick.push(p); tc[p.team] = (tc[p.team] || 0) + 1; need[p.pos]--;
    if (pick.length === 15) break;
  }
  return pick;
}

