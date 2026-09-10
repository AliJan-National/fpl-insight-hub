// ============ 🏟️ TEAM STRENGTH V2 (v2.0 Phase 3) — attack/defence ratings ============
// teamRatingsV2() — NOT wired into production forecasts yet. Built beside the
// legacy osmBuild() (v25 opponent-strength) for A/B comparison (v2.0 audit,
// Phase 3). Upgrades over legacy:
//   1. blends real goals WITH xG (xG is stabler, goals capture finishing),
//   2. opponent-adjusts ratings (a goal vs a strong defence counts more) —
//      two multiplicative iterations, normalized to league mean 1.0,
//   3. home/away splits, shrunk toward the team's overall rating,
//   4. the audit's shrinkage schedule: w = n/(n+7) -> 30% current at n=3,
//      50% at n=7, 70% by n=16 (data-driven, not a hard 60/40 forever),
//   5. expectedGoals(home, away) — the feed the Phase-5 event model needs.
// Everything is deterministic from DATA.results (real GW1-N matches).
const TSR_MEMO = {};
function teamRatingsV2() {
  if (TSR_MEMO.out) return TSR_MEMO.out;
  const ms = (DATA.results || []).filter(m => m && m.home && m.away);
  if (ms.length < 10) { TSR_MEMO.out = { teams: {}, league: { n: 0 }, expectedGoals: () => ({ hg: 1.3, ag: 1.1 }) }; return TSR_MEMO.out; }

  // ---- league base rates (real) ----
  const totH = ms.reduce((s, m) => s + (m.hs || 0), 0), totA = ms.reduce((s, m) => s + (m.as_ || 0), 0);
  const baseH = totH / ms.length, baseA = totA / ms.length;          // goals per match, home & away
  const meanAtt = (totH + totA) / (2 * ms.length);                    // league mean output per team-game
  const W_XG = 0.6;                                                   // xG weight in the blend (goals 0.4)

  // ---- raw per-team signals (goals+xG blend), overall + home/away ----
  const R = {};
  ms.forEach(m => {
    const sides = [
      [m.home, 'H', m.hxg, m.axg, m.hs || 0, m.as_ || 0],
      [m.away, 'A', m.axg, m.hxg, m.as_ || 0, m.hs || 0]];
    sides.forEach(([t, ha, xgf, xga, gf, ga]) => {
      const o = R[t] = R[t] || { n: 0, att: 0, def: 0, oppAtt: 0, oppDef: 0, nH: 0, attH: 0, defH: 0, nA: 0, attA: 0, defA: 0, opp: [] };
      const attSig = W_XG * (xgf || 0) + (1 - W_XG) * gf;             // blended output
      const defSig = W_XG * (xga || 0) + (1 - W_XG) * ga;             // blended concession
      o.n++; o.att += attSig; o.def += defSig; o.opp.push(m[ha === 'H' ? 'away' : 'home']);
      if (ha === 'H') { o.nH++; o.attH += attSig; o.defH += defSig; } else { o.nA++; o.attA += attSig; o.defA += defSig; }
    });
  });
  const names = Object.keys(R);
  if (!names.length) { TSR_MEMO.out = { teams: {}, league: { n: 0 }, expectedGoals: () => ({ hg: 1.3, ag: 1.1 }) }; return TSR_MEMO.out; }

  // ---- shrinkage toward the league mean (audit schedule: w = n/(n+7)) ----
  const shr = (sum, n) => { const w = n / (n + 7); return w * (sum / n) + (1 - w) * meanAtt; };
  names.forEach(t => {
    const o = R[t];
    o.attRaw = o.att / o.n; o.defRaw = o.def / o.n;
    o.attShr = shr(o.att, o.n); o.defShr = shr(o.def, o.n);          // multiplicative form later
    o.attShrM = o.attShr / meanAtt; o.defShrM = o.defShr / meanAtt;  // 1.0 = league average
    // home/away: shrink toward the team's OWN overall rating (K=3 — tiny samples)
    const wH = o.nH / (o.nH + 3), wA = o.nA / (o.nA + 3);
    o.attHomeM = o.nH ? (wH * (o.attH / o.nH) + (1 - wH) * o.attShr) / o.attShr : 1;
    o.attAwayM = o.nA ? (wA * (o.attA / o.nA) + (1 - wA) * o.attShr) / o.attShr : 1;
    o.defHomeM = o.nH ? (wH * (o.defH / o.nH) + (1 - wH) * o.defShr) / o.defShr : 1;
    o.defAwayM = o.nA ? (wA * (o.defA / o.nA) + (1 - wA) * o.defShr) / o.defShr : 1;
  });

  // ---- opponent adjustment: 2 multiplicative iterations, mean-normalized ----
  let attM = {}, defM = {};
  names.forEach(t => { attM[t] = R[t].attShrM; defM[t] = R[t].defShrM; });
  for (let it = 0; it < 2; it++) {
    const nA2 = {}, nD2 = {};
    names.forEach(t => {
      const ops = R[t].opp, k = ops.length || 1;
      const defFaced = ops.reduce((s, o) => s + (defM[o] || 1), 0) / k;
      const attFaced = ops.reduce((s, o) => s + (attM[o] || 1), 0) / k;
      nA2[t] = (R[t].attShrM / (defFaced || 1));                     // scoring vs tough defences counts more
      nD2[t] = (R[t].defShrM / (attFaced || 1));                      // conceding vs strong attacks hurts less
    });
    const mA = names.reduce((s, t) => s + nA2[t], 0) / names.length;
    const mD = names.reduce((s, t) => s + nD2[t], 0) / names.length;
    names.forEach(t => { attM[t] = nA2[t] / mA; defM[t] = nD2[t] / mD; });
  }

  // ---- expose ----
  const teams = {};
  names.forEach(t => {
    const o = R[t];
    teams[t] = {
      short: t, n: o.n,
      attRaw: Math.round(o.attRaw * 1000) / 1000, defRaw: Math.round(o.defRaw * 1000) / 1000,
      attShr: Math.round(o.attShrM * 1000) / 1000, defShr: Math.round(o.defShrM * 1000) / 1000,
      att: Math.round(attM[t] * 1000) / 1000, def: Math.round(defM[t] * 1000) / 1000,
      attHome: Math.round(attM[t] * o.attHomeM * 1000) / 1000, attAway: Math.round(attM[t] * o.attAwayM * 1000) / 1000,
      defHome: Math.round(defM[t] * o.defHomeM * 1000) / 1000, defAway: Math.round(defM[t] * o.defAwayM * 1000) / 1000,
    };
  });

  const rawXG = (home, away) => {
    const H = teams[home], Aa = teams[away];
    return { hg: H && Aa ? baseH * H.attHome * Aa.defAway : baseH,
             ag: H && Aa ? baseA * Aa.attAway * H.defHome : baseA };
  };
  // multiplicative models drift high on small samples — calibrate the bases so the
  // model's predicted totals over the REAL matches equal the actual totals.
  let pH = 0, pA = 0;
  ms.forEach(m => { const g = rawXG(m.home, m.away); pH += g.hg; pA += g.ag; });
  const cH = pH > 0 ? Math.max(0.7, Math.min(1.4, totH / pH)) : 1;
  const cA = pA > 0 ? Math.max(0.7, Math.min(1.4, totA / pA)) : 1;
  const calH = baseH * cH, calA = baseA * cA;
  const expectedGoals = (home, away) => {
    const g = rawXG(home, away);
    const hg = teams[home] ? g.hg * cH : calH, ag = teams[away] ? g.ag * cA : calA;
    return { hg: Math.round(Math.max(0.15, Math.min(4.5, hg)) * 100) / 100, ag: Math.round(Math.max(0.1, Math.min(4.2, ag)) * 100) / 100 };
  };

  TSR_MEMO.out = {
    version: 2, teams,
    league: { n: ms.length, baseH: Math.round(calH * 100) / 100, baseA: Math.round(calA * 100) / 100, meanAtt: Math.round(meanAtt * 1000) / 1000, calib: { cH: Math.round(cH * 1000) / 1000, cA: Math.round(cA * 1000) / 1000 },
      shrinkage: 'w = n/(n+7) — 30% current at 3 games, 50% at 7, 70% at 16', blend: W_XG + ' xG / ' + (1 - W_XG) + ' goals' },
    expectedGoals,
  };
  return TSR_MEMO.out;
}

