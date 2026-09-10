// ============ 👟 MINUTES V2 (v2.0 Phase 2) — selection & minutes ladder ============
// minutesV2(p) — NOT wired into production forecasts yet. Built beside the legacy
// startProb()/minutesOf() engine for A/B comparison (v2.0 audit, Phase 2). It uses
// ONLY pre-deadline evidence: GW1-N minute history, official status, official
// chance_next and the public news line. Returns the audit-required ladder:
//   { pStart, p60, p75, p90, expectedMinutes,
//     confidence: { overall, data, minutes, availability }, evidence: [...] }
// Design notes:
//   * start rate: Beta-Binomial shrinkage with a PERSONAL prior — the pool start
//     rate lifted by how completely he plays when on the pitch (a guy playing
//     75'+ every week is not a rotation piece), recency-weighted (0.85^age).
//   * minute depth among starts: his real ≥60/≥75/≥90 shares, shrunk to position
//     priors — so P(90) < P(75) < P(60) <= P(start) always holds.
//   * availability gate: official status + official chance_next (a 75% doubt is
//     more informative than the status letter alone) + suspension news.
//   * confidence: data (sample size), minutes (variability), availability.
const V2M_MEMO = {};
function v2mPriors() {
  if (V2M_MEMO._pri) return V2M_MEMO._pri;
  const H = DATA.history || {}, P = DATA.players || [];
  const acc = {};
  P.forEach(pl => {
    const a = acc[pl.pos] = acc[pl.pos] ||
      { rows: 0, starts: 0, m60: 0, m75: 0, m90: 0, stMin: 0, stN: 0, camN: 0, camMin: 0, nonStart: 0, nonStartPlayed: 0 };
    (H[pl.id] || []).forEach(r => {
      const m = r[4] || 0;
      a.rows++;
      if (m >= 60) { a.starts++; a.stN++; a.stMin += m; if (m >= 60) a.m60++; if (m >= 75) a.m75++; if (m >= 90) a.m90++; }
      else { a.nonStart++; if (m > 0) { a.nonStartPlayed++; a.camN++; a.camMin += m; } }
    });
  });
  const pri = { _def: { startRate: .55, d60: .93, d75: .8, d90: .55, minsPerStart: 80, cameoAvg: 22, playNotStart: .4 } };
  Object.keys(acc).forEach(pos => {
    const a = acc[pos];
    pri[pos] = {
      startRate: a.rows ? a.starts / a.rows : .55,
      d60: a.starts ? a.m60 / a.starts : .93,
      d75: a.starts ? a.m75 / a.starts : .8,
      d90: a.starts ? a.m90 / a.starts : .55,
      minsPerStart: a.stN ? a.stMin / a.stN : 80,
      cameoAvg: a.camN ? a.camMin / a.camN : 22,
      playNotStart: a.nonStart ? a.nonStartPlayed / a.nonStart : .4,
      n: a.rows,
    };
  });
  V2M_MEMO._pri = pri;
  return pri;
}
function minutesV2(p) {
  const ch = (typeof p.chance_next === 'number' && p.chance_next < 100) ? p.chance_next : null;
  const key = 'v2|' + p.id + '|' + (p.mins || 0) + '|' + p.status + '|' + (ch == null ? '' : ch);
  if (V2M_MEMO[key]) return V2M_MEMO[key];
  const pri = v2mPriors(), A = pri[p.pos] || pri._def;
  const rows = ((DATA.history || {})[p.id] || []).map(r => ({ gw: r[0] || 0, m: r[4] || 0 }));
  const latest = rows.length ? Math.max.apply(null, rows.map(r => r.gw)) : 0;
  const news = String(p.news || '');
  const ev = [];

  // ---- availability gate (official pre-deadline signals only) ----
  const st = p.status || 'a';
  let avail = 1;
  if (st === 's' || /susp/i.test(news)) { avail = 0.05; ev.push('suspended' + (news ? ' — ' + news : '')); }
  else if (st === 'i') { avail = 0.05; ev.push('injured' + (news ? ' — ' + news : '') + (ch != null ? ' · official ' + ch + '% to play' : '')); }
  else if (st === 'u') { avail = 0.5; ev.push('unavailable per official status'); }
  else if (ch != null) { avail = 0.05 + 0.9 * ch / 100; ev.push('official ' + ch + '% chance to play' + (news ? ' (' + news + ')' : '')); }
  else if (st === 'd') { avail = 0.65; ev.push('doubtful per official status' + (news ? ' — ' + news : '')); }

  // ---- recency-weighted start rate with a personal prior ----
  let S = 0, W = 0, comp = 0;
  rows.forEach(r => { const w = Math.pow(0.85, latest - r.gw); W += w; if (r.m >= 60) S += w; if (r.m >= 75) comp += w; });
  const compShare = W ? comp / W : 0;
  const bP = Math.min(0.93, A.startRate + 0.45 * compShare);   // personal prior from minute completeness
  const K = 0.7;                                                 // prior strength (~0.7 GW of evidence)
  const pStartRaw = W > 0 ? (S + K * bP) / (W + K) : bP;
  if (rows.length) {
    const starts = rows.filter(r => r.m >= 60).length;
    ev.push(starts + '/' + rows.length + ' starts (GW' + rows[0].gw + '-' + latest + ', recency-weighted ' + (W ? Math.round(100 * S / W) : 0) + '%)');
    if (compShare >= 0.9 && starts >= 2) ev.push('plays 75+ whenever selected — role security');
  } else ev.push('no GW history yet — position prior applied (start base ' + Math.round(A.startRate * 100) + '%)');

  // ---- minute-depth ladder among his starts, shrunk to position priors ----
  const stRows = rows.filter(r => r.m >= 60), n = stRows.length;
  const depth = (thr, prior) => Math.min(1, (stRows.filter(r => r.m >= thr).length + prior) / (n + 1));
  const d90 = depth(90, A.d90), d75 = Math.max(d90, Math.min(1, depth(75, A.d75))), d60 = Math.max(d75, Math.min(1, depth(60, A.d60)));

  // ---- minutes when involved: starts shrunk to prior, cameos from his own record ----
  const stAvg = n ? stRows.reduce((s, r) => s + r.m, 0) / n : A.minsPerStart;
  const minsPerStart = (n * stAvg + 1 * A.minsPerStart) / (n + 1);   // shrunk toward the position prior
  const camRows = rows.filter(r => r.m > 0 && r.m < 60);
  const cameoAvg = camRows.length ? camRows.reduce((s, r) => s + r.m, 0) / camRows.length : A.cameoAvg;
  const nonStart = rows.filter(r => r.m < 60);
  const pPlayBench = nonStart.length ? nonStart.filter(r => r.m > 0).length / nonStart.length : A.playNotStart;
  if (camRows.length >= 2 && n === 0) ev.push('cameo pattern (' + camRows.map(r => Math.round(r.m) + "'").join(', ') + ') — bench role');

  // ---- the ladder ----
  const pStart = Math.max(0.01, Math.min(0.97, avail * pStartRaw));
  const p60 = pStart * d60, p75 = pStart * d75, p90 = pStart * d90;
  const expectedMinutes = Math.max(0, Math.min(95, avail * (pStartRaw * minsPerStart + (1 - pStartRaw) * pPlayBench * cameoAvg)));

  // ---- confidence (three honest components) ----
  const data = Math.min(1, rows.length / 4);
  let stability;
  if (rows.length >= 2) {
    const ms = rows.map(r => r.m), mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    const sd = Math.sqrt(ms.reduce((s, m) => s + (m - mean) * (m - mean), 0) / ms.length);
    stability = Math.max(0, Math.min(1, 1 - sd / 45));
    if (sd > 30 && rows.length >= 3) ev.push('variable minutes (' + ms.map(m => Math.round(m)).join('-') + ") — rotation/sub pattern");
  } else stability = 0.4;
  const availabilityC = (st === 'a' && ch == null) ? 1 : Math.max(0.05, 0.15 + 0.85 * avail);
  const overall = Math.round(100 * (0.4 * data + 0.35 * stability + 0.25 * availabilityC)) / 100;

  const out = {
    pStart: Math.round(pStart * 100) / 100, p60: Math.round(p60 * 100) / 100,
    p75: Math.round(p75 * 100) / 100, p90: Math.round(p90 * 100) / 100,
    expectedMinutes: Math.round(expectedMinutes * 10) / 10,
    confidence: { overall, data: Math.round(data * 100) / 100, minutes: Math.round(stability * 100) / 100, availability: Math.round(availabilityC * 100) / 100 },
    evidence: ev, n: rows.length, starts: n, minsPerStart: Math.round(minsPerStart), cameoAvg: Math.round(cameoAvg),
  };
  V2M_MEMO[key] = out;
  return out;
}

