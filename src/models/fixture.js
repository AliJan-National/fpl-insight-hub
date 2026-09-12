// ============ 🎯 FIXTURE-RESPONSE MODEL (audit B2/M2 · v31) ============
// The one-spine fix: previously the xP moved with the fixture but P(>=6)/P(>=10)
// did not (they never saw the opponent). Now BOTH respond to the same fitted,
// REAL-data opponent strength. Defenders/GK respond to the opponent's ATTACK
// (xG per match — CS odds), attackers/MID to the opponent's DEFENCE (xGA per
// match). Ratios of observed GW1-3 points & return-rates vs the league mean are
// shrunk hard (small sample) — labelled model estimates, never a promise.
const FIX_MEMO = {};
function fixCalib() {
  if (FIX_MEMO.ready) return FIX_MEMO;
  const res = { att: null, def: null, mean: null, n: 0, note: '' };
  try {
    if (!DATA.results || !DATA.results.length || !DATA.history || !DATA.players) return res;
    const byTeam = {};
    (DATA.results || []).forEach(m => {
      [['home', m.hxg, m.axg], ['away', m.axg, m.hxg]].forEach(([side, xgf, xga]) => {
        const o = byTeam[m[side]] = byTeam[m[side]] || { n: 0, xgf: 0, xga: 0 };
        o.n++; o.xgf += xgf || 0; o.xga += xga || 0;
      });
    });
    const teams = Object.keys(byTeam);
    if (!teams.length) return res;
    const meanOf = k => teams.reduce((a, t) => a + byTeam[t][k] / byTeam[t].n, 0) / teams.length;
    const meanXgf = meanOf('xgf'), meanXga = meanOf('xga');
    const gwOpp = {};
    (DATA.results || []).forEach(m => {
      (gwOpp[m.gw] = gwOpp[m.gw] || {})[m.home] = m.away;
      (gwOpp[m.gw] = gwOpp[m.gw] || {})[m.away] = m.home;
    });
    const byId = {}; (DATA.players || []).forEach(p => { byId[p.id] = p; });
    // pools measure RELATIVE response: ratio of band stats to the pool's own mean
    const mk = () => ({ band: [{ n: 0, sum: 0, r6: 0, rSum: 0, rN: 0 }, { n: 0, sum: 0, r6: 0, rSum: 0, rN: 0 }, { n: 0, sum: 0, r6: 0, rSum: 0, rN: 0 }], n: 0, sum: 0, r6: 0 });
    const att = mk(), def = mk();
    const bandOf = rel => rel <= 0.86 ? 0 : rel <= 1.16 ? 1 : 2;
    // v36: track the mean relative strength of each band so the fitted factors can
    // be interpolated SMOOTHLY instead of applied as 3 hard steps (the step was why
    // Hull(H), Brentford(A) and Bournemouth(H) all got the identical multiplier).
    const push = (pool, b, pts, rel) => {
      pool.n++; pool.sum += pts; if (pts >= 6) pool.r6++;
      pool.band[b].n++; pool.band[b].sum += pts; if (pts >= 6) pool.band[b].r6++;
      if (rel != null && isFinite(rel)) { pool.band[b].rSum += rel; pool.band[b].rN++; }
    };
    for (const idStr of Object.keys(DATA.history)) {
      const pl = byId[+idStr]; if (!pl || !pl.team) continue;
      const pool = (pl.pos === 'GK' || pl.pos === 'DEF') ? def : att;
      const teamRow = byTeam[pl.team]; if (!teamRow) continue;
      for (const r of DATA.history[idStr] || []) {
        if ((r[4] || 0) < 60) continue;                     // starters only (best "actually plays" proxy)
        const g = r[0], opp = (gwOpp[g] || {})[pl.team];
        const op = opp && byTeam[opp]; if (!op) continue;
        // lens: attacker faces opp defence (xga); defender faces opp attack (xgf)
        const rel = (pl.pos === 'GK' || pl.pos === 'DEF')
          ? meanXgf / Math.max(0.05, op.xgf / op.n)          // >1 => opp attack weak => easier
          : (op.xga / op.n) / meanXga;                       // >1 => opp defence leaky => easier
        push(pool, bandOf(rel), r[1] || 0, rel);
      }
    }
    const fit = (pool, K) => {
      const totPts = pool.n ? pool.sum / pool.n : 0;
      const tot6 = pool.n ? pool.r6 / pool.n : 0;
      const DEF_C = [0.7, 1, 1.35];   // fallback centres (rel<0.86 / <=1.16 / else)
      const bands = pool.band.map((b, bi) => {
        const n = b.n;
        let xf = 1, pf = 1;
        if (n && totPts > 0) {
          const w = n / (n + K);
          xf = Math.max(0.6, Math.min(1.55, 1 + w * ((b.sum / n) / totPts - 1)));
        }
        if (n && tot6 > 0) {
          const w = n / (n + K);
          pf = Math.max(0.55, Math.min(1.8, 1 + w * ((b.r6 / n) / tot6 - 1)));
        }
        const c = b.rN ? b.rSum / b.rN : DEF_C[bi];
        return { n, xf: Math.round(xf * 1000) / 1000, pf: Math.round(pf * 1000) / 1000, c: Math.round(c * 1000) / 1000, cN: b.rN };
      });
      return { bands, n: pool.n, bounds: [0.86, 1.16] };
    };
    res.att = fit(att, 12); res.def = fit(def, 12);
    res.mean = { meanXgf: Math.round(meanXgf * 1000) / 1000, meanXga: Math.round(meanXga * 1000) / 1000 };
    res.n = att.n + def.n;
  } catch (e) { console.error('[fixCalib]', e); }
  FIX_MEMO.ready = true; FIX_MEMO.att = res.att; FIX_MEMO.def = res.def; FIX_MEMO.mean = res.mean; FIX_MEMO.n = res.n; FIX_MEMO.note = res.note;
  return FIX_MEMO;
}
// per-player fixture response for GW index i (default 0 = next GW). Returns
// {xf,pf,band,opp} or null when the opponent isn't known / no data yet.
// ---- v36 SMOOTH FIXTURE GRADING -------------------------------------------------
// The old model bucketed every opponent into TOUGH / NEUTRAL / EASY and applied ONE
// fitted multiplier per bucket, so three different opponents in the same bucket were
// indistinguishable (Hull(H), Brentford(A) and Bournemouth(H) all got x0.94) and a
// fixture the app paints green could be penalised. fixSmooth interpolates between the
// FITTED band anchors, so relative strength moves the multiplier continuously.
function fixSmooth(bands, rel, key) {
  if (!bands || !bands.length || rel == null || !isFinite(rel)) return 1;
  const k = key || 'xf';
  const cs = bands.map(b => (b.c == null ? NaN : b.c));
  const ok = cs.every(x => isFinite(x)) && cs.every((x, i) => i === 0 || x > cs[i - 1]);
  if (!ok) {                                  // noisy/degenerate centres -> safe step fallback
    const b = rel <= 0.86 ? 0 : rel <= 1.16 ? 1 : 2;
    return (bands[b] && bands[b][k] != null) ? bands[b][k] : 1;
  }
  if (rel <= cs[0]) return bands[0][k];
  const last = cs.length - 1;
  if (rel >= cs[last]) return bands[last][k];
  for (let i = 1; i <= last; i++) {
    if (rel <= cs[i]) {
      const t = (rel - cs[i - 1]) / Math.max(1e-6, cs[i] - cs[i - 1]);
      const v = bands[i - 1][k] + t * (bands[i][k] - bands[i - 1][k]);
      return Math.round(v * 1000) / 1000;
    }
  }
  return bands[last][k];
}
// ONE fixture voice for the whole app: the opponent-calibration multiplier (smooth)
// blended GEOMETRICALLY with the adjusted difficulty the app DISPLAYS on the fixture
// map / ticker (afx -> 1.15 / 1.08 / 1.00 / 0.92 / 0.85). Because both the points
// estimate and the return probabilities read this single object, a green fixture can
// no longer boost one surface while penalising another.
// the displayed adjusted-difficulty -> multiplier table (identical to FM; kept as a
// named lookup so this module also works in the isolated regression slices that do
// not carry FM, and so the two can never silently drift apart)
function fdrMultOf(afdr) {
  const M = (typeof FM !== 'undefined' && FM && FM[3] === 1) ? FM : { 1: 1.15, 2: 1.08, 3: 1, 4: 0.92, 5: 0.85 };
  return M[afdr] || 1;
}
// ============ 🧤 GK/DEF STRUCTURAL FIXTURE RESPONSE (v42) ============
// A GK's points are mostly SITUATION: 2 for playing + 4 x P(clean sheet) + save
// points (which cushion busy games) - 1 per 2 conceded. The outfield-style
// "baseline x small multiplier" cannot represent that: a hot save-machine
// baseline transferred almost unchanged into an elite-attack fixture (the
// Tzolakis-at-Chelsea flaw), and easy fixtures barely lifted quiet keepers.
// These helpers price GK/DEF fixtures from the SAME real inputs the model
// already trusts: opponent attack rate + own defence rate (OSM), league
// scoring (results.json) and home/away — no new data, no new network calls.
function fxLeagueGoals() {  // real goals per team per game
  const ms = (DATA.results || []).filter(m => m && m.home);
  if (!ms.length) return 1.4;
  const tot = ms.reduce((sm, m) => sm + (m.hs || 0) + (m.as_ || 0), 0);
  return Math.max(0.8, Math.min(2.4, tot / (ms.length * 2)));
}
function fxXgaOf(p, i) {    // expected goals conceded by p's team in fixture i
  const cal = (typeof fixCalib === 'function') ? fixCalib() : null;
  const f = (p.next3 || [])[i == null ? 0 : i] || null;
  if (!cal || !cal.mean || !f || !f.opp) return null;
  const osm = (typeof osmByShort === 'function') ? osmByShort() : null;
  const opp = osm ? osm[f.opp] : null, own = osm ? osm[p.team] : null;
  if (!opp || !own) return null;
  const oppAttRel = Math.max(0.4, Math.min(2.6, opp.att / Math.max(0.05, cal.mean.meanXgf)));
  const ownDefRel = Math.max(0.4, Math.min(2.6, own.xga / Math.max(0.05, cal.mean.meanXga)));
  const xga = fxLeagueGoals() * oppAttRel * ownDefRel * (f.ha === 'H' ? 0.88 : f.ha === 'A' ? 1.12 : 1);
  return Math.round(Math.max(0.3, Math.min(3.2, xga)) * 100) / 100;
}
function gkStructXp(xga) {  // structural GK value: play+bonus, clean sheet, saves, conceding
  return 2.3 + 4 * Math.exp(-xga) + 0.27 * xga;
}
function defPosAdjOf(xga) { // clean-sheet multiplier for defenders (60% strength, clamped)
  const lg = fxLeagueGoals();
  const cs = Math.exp(-xga), csL = Math.exp(-lg);
  const val = 2 + 4 * cs - 0.5 * xga, valL = 2 + 4 * csL - 0.5 * lg;
  return Math.max(0.85, Math.min(1.15, 1 + 0.6 * (val / valL - 1)));
}
function fixtureFactor(p, i) {
  const f = (p && p.next3) ? (p.next3[i == null ? 0 : i] || null) : null;
  const cal = oppFixOf(p, i);
  const afdrRaw = f ? (f.afdr != null ? f.afdr : (f.adjv != null ? Math.round(f.adjv) : f.fdr)) : null;
  const afdr = (afdrRaw == null) ? null : Math.max(1, Math.min(5, Math.round(afdrRaw)));
  const drM = (afdr == null) ? null : fdrMultOf(afdr);
  if (!cal) return null;
  const xfRaw = drM == null ? cal.xf : Math.sqrt(cal.xf * drM);
  const pf = drM == null ? cal.pf : Math.sqrt(cal.pf * drM);
  // v42: defender fixtures priced by clean-sheet structure too (CS is most of a
  // defender's swing; the outfield multiplier alone under-reacts to it)
  const xga = (p && p.pos === 'DEF') ? fxXgaOf(p, i) : null;
  const defAdj = xga != null ? defPosAdjOf(xga) : 1;
  const xf = xfRaw * defAdj;
  return {
    xf: Math.round(Math.max(0.55, Math.min(1.7, xf)) * 1000) / 1000,
    pf: Math.round(Math.max(0.5, Math.min(1.8, pf)) * 1000) / 1000,
    band: cal.band, opp: cal.opp, rel: cal.rel, afdr, calXf: cal.xf, calPf: cal.pf,
    defAdj: Math.round(defAdj * 1000) / 1000, xga,
    src: drM == null ? 'calibration' : 'calibration+displayed-fdr',
  };
}
function oppFixOf(p, i) {
  if (!p) return null;
  const ix = i == null ? 0 : i;
  const f = (p.next3 || [])[ix] || null;
  const opp = f ? f.opp : null;
  if (!opp) return null;
  const cal = fixCalib();
  if (!cal.att) return null;
  const isDef = p.pos === 'GK' || p.pos === 'DEF';
  const team = (typeof osmByShort === 'function') ? osmByShort()[opp] : null;
  if (!team || !cal.mean) return null;
  // higher rel == easier for this position (attacker: leaky opp defence; defender: weak opp attack)
  const rel = isDef ? cal.mean.meanXgf / Math.max(0.05, team.att) : team.xga / cal.mean.meanXga;
  const b = rel <= 0.86 ? 0 : rel <= 1.16 ? 1 : 2;
  const tab = isDef ? cal.def : cal.att;
  const blk = tab.bands[b];
  const xf = fixSmooth(tab.bands, rel, 'xf');
  const pf = fixSmooth(tab.bands, rel, 'pf');
  return { xf, pf, band: ['tough', 'neutral', 'easy'][b], opp, n: blk.n,
    bandXf: blk.xf, bandPf: blk.pf,          // the old step value (kept for the before/after diff)
    rel: Math.round(rel * 1000) / 1000, mode: 'smooth' };
}

// per-GW model projection: blend(official ep, form) × form-adjusted FDR × H/A × minutes × reliability
const projP = (p, i) => {
  const t = window.TF[p.team] || {};
  const a = (t.afx || [3, 3, 3, 3, 3, 3, 3])[i] ?? 3;
  const f = (p.next3 || [])[i] || null;
  const ha = f ? f.ha : null;
  const minProb = startProb(p);
  const base = 0.55 * (p.ep_next || 0) + 0.45 * (p.form || 0);
  const fx = (typeof fixtureFactor === 'function') ? fixtureFactor(p, i) : oppFixOf(p, i);
  const mult = fx ? fx.xf : (FM[Math.max(1, Math.min(5, Math.round(a)))] || 1);
  let out = base * mult * (ha === 'H' ? 1.06 : ha === 'A' ? 0.94 : 1) * minProb * (0.6 + 0.4 * reliab(p));
  // v42: GK projections are mostly SITUATION (play + CS + saves - conceding).
  // 70% structural / 30% personal — a hot baseline no longer rides through an
  // elite-attack fixture, and easy fixtures lift quiet keepers.
  if (p.pos === 'GK') {
    const xga = fxXgaOf(p, i);
    if (xga != null) out = Math.max(1.0, Math.min(6.5, 0.30 * out + 0.70 * gkStructXp(xga) * Math.max(0.4, minProb)));
  }
  return out;
};
const hSumP = (p, H) => { let s = 0; for (let i = 0; i < H; i++) s += projP(p, i); return s; };

