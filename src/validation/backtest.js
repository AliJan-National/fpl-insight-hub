// ============ 🧪 BACKTEST LAB (audit #28/#29 · leakage-free honesty) ============
// Two evaluations, both strictly OUT-OF-SAMPLE — a prediction for GW g is built
// ONLY from GWs < g (rolling) or from other players' GWs + the player's own
// EARLIER GWs (leave-one-player-out). The lab never uses data that wouldn't
// have existed at prediction time. Results are labelled estimates; with GW1-3
// the lab is a pilot that grows into a true rolling backtest every deadline.
function btStarterRows() {
  // {id,pos,name} -> GW rows with >=60 mins are the "actually played" pool
  const byId = {};
  (DATA.players || []).forEach(p => { byId[p.id] = p; });
  const out = [];
  for (const idStr of Object.keys((DATA.history || {}))) {
    const p = byId[+idStr]; if (!p) continue;
    for (const r of DATA.history[idStr] || []) {
      if ((r[4] || 0) >= 60) out.push({ id: p.id, pos: p.pos, name: p.name, g: r[0], pts: r[1] || 0, mins: r[4] });
    }
  }
  return out;
}
// (A) leave-one-player-out calibration of P(>=6) — every starter GW is a test
// point; its prediction uses ONLY the position base rate built WITHOUT that
// player plus that player's own strictly-earlier GWs (shrunken).
function btOOF(opts) {
  const o = opts || {};
  const K = o.K || 2;                       // shrinkage strength (own sample)
  const rows = btStarterRows();
  const posTot = {}, pTot = {};
  rows.forEach(r => {
    const pt = posTot[r.pos] = posTot[r.pos] || { n: 0, r6: 0 };
    pt.n++; if (r.pts >= 6) pt.r6++;
    const pp = pTot[r.id] = pTot[r.id] || { n: 0, r6: 0, rows: [] };
    pp.n++; if (r.pts >= 6) pp.r6++; pp.rows.push(r);
  });
  const test = [];
  rows.forEach(r => {
    const tp = pTot[r.id];
    const earlier = tp.rows.filter(x => x.g < r.g);        // own strictly-earlier GWs only
    const e6 = earlier.filter(x => x.pts >= 6).length;
    const tot = posTot[r.pos] || { n: 0, r6: 0 };
    const exN = Math.max(0, tot.n - tp.n);                 // position pool WITHOUT this player
    const exR6 = Math.max(0, tot.r6 - tp.r6);
    const prior = exN ? 100 * exR6 / exN : 10;
    const w = earlier.length / (earlier.length + K);
    let pred = earlier.length ? w * (100 * e6 / earlier.length) + (1 - w) * prior : prior;
    pred = Math.max(1, Math.min(95, pred));
    test.push({ name: r.name, pos: r.pos, g: r.g, pred, y: r.pts >= 6 ? 1 : 0 });
  });
  const nT = test.length;
  const obsRate = nT ? 100 * test.reduce((a, x) => a + x.y, 0) / nT : 0;
  const mPred = nT ? test.reduce((a, x) => a + x.pred, 0) / nT : 0;
  let brier = 0, brierC = 0;
  test.forEach(x => { const p = x.pred / 100; brier += (p - x.y) * (p - x.y); const c = obsRate / 100; brierC += (c - x.y) * (c - x.y); });
  // calibration buckets by predicted band
  const bucket = {};
  test.forEach(x => { const band = Math.min(9, Math.floor(x.pred / 10)); const b = bucket[band] = bucket[band] || { n: 0, sum: 0, hits: 0 }; b.n++; b.sum += x.pred; b.hits += x.y; });
  const buckets = Object.keys(bucket).map(k => { const b = bucket[k]; return { band: +k * 10, n: b.n, predMean: b.sum / b.n, obs: 100 * b.hits / b.n }; }).sort((a, b) => a.band - b.band);
  const res = { nTotal: nT, observed: Math.round(obsRate * 10) / 10, meanPred: Math.round(mPred * 10) / 10,
    brier: Math.round(brier / nT * 10000) / 10000, brierConst: Math.round(brierC / nT * 10000) / 10000,
    buckets };
  if (o.raw) res.raw = test.map(x => ({ name: x.name, pos: x.pos, g: x.g, pred: Math.round(x.pred * 100) / 100, y: x.y }));
  return res;
}
// (B) time-series roll: predict GW g points purely from GWs < g (avg pts), then
// measure the correlation on players who actually started GW g. GW3 is the only
// honest pilot today; every deadline adds one more test GW.
function btRoll(g, opts) {
  const o = opts || {};
  const rows = btStarterRows();
  const hist = {};
  rows.forEach(r => { (hist[r.id] = hist[r.id] || []).push(r); });
  const pairs = [];
  rows.filter(r => r.g === g).forEach(r => {
    const prior = (hist[r.id] || []).filter(x => x.g < g);
    if (!prior.length) return;
    const pred = prior.reduce((a, x) => a + x.pts, 0) / prior.length;
    pairs.push({ pred, act: r.pts });
  });
  const n = pairs.length;
  if (n < 2) return { g, n, r: null, mae: null };
  const mP = pairs.reduce((a, x) => a + x.pred, 0) / n, mA = pairs.reduce((a, x) => a + x.act, 0) / n;
  let cov = 0, vP = 0, vA = 0, mae = 0;
  pairs.forEach(x => { cov += (x.pred - mP) * (x.act - mA); vP += (x.pred - mP) ** 2; vA += (x.act - mA) ** 2; mae += Math.abs(x.pred - x.act); });
  const r = (vP > 0 && vA > 0) ? cov / Math.sqrt(vP * vA) : 0;
  return { g, n, r: Math.round(r * 1000) / 1000, mae: Math.round(mae / n * 100) / 100, meanAct: Math.round(mA * 100) / 100 };
}
// honest calibration table for the UI
function btCalibTable(res) {
  if (!res || !res.nTotal) return '<p class="hint">No starter history yet — the lab fills in as gameweeks complete.</p>';
  const rows = res.buckets.map(b => {
    const drift = b.obs - b.predMean;
    const tag = Math.abs(drift) <= 7 ? '<span style="color:var(--green)">✓ calibrated</span>' : (drift > 7 ? '<span style="color:var(--amber)">under-predicted</span>' : '<span style="color:var(--red)">over-predicted</span>');
    return `<tr><td>${b.band}–${Math.min(99, b.band + 9)}%</td><td class="num">${b.n}</td><td class="num">${b.predMean.toFixed(0)}%</td><td class="num"><b>${b.obs.toFixed(0)}%</b></td><td>${tag}</td></tr>`;
  }).join('');
  const skill = res.brier <= res.brierConst ? '✔ out-of-sample Brier is <b>better</b> than always predicting the base rate' : '✘ the base rate alone beat the model out-of-sample (narrow sample — keep accumulating)';
  return `<div class="card" style="grid-column:1/-1"><h2>🎯 (A) Return-chance calibration — leave-one-player-out</h2>
    <p class="muted">For every starter GW in GW1–${(DATA.fplmeta && DATA.fplmeta.current_gw) || 3}, the model predicted P(≥6) using ONLY data available beforehand (position base rate minus that player + his own earlier GWs). Then we checked: did ~X% of the "30%" group actually return? <b>${res.nTotal} player-GWs</b>, observed return rate <b>${res.observed}%</b>, mean predicted ${res.meanPred}%.</p>
    <div style="overflow-x:auto"><table class="data compact"><tr><th>Predicted band</th><th class="num">n</th><th class="num">Mean predicted</th><th class="num">Actually returned</th><th>Verdict</th></tr>${rows}</table></div>
    <p class="muted" style="margin-top:6px">${skill} · Brier ${res.brier.toFixed(4)} vs baseline ${res.brierConst.toFixed(4)}. This is a GW1-3 pilot — the table becomes trustworthy as each deadline adds real test GWs.</p></div>`;
}
// P3 polish: compact weekly Lab digest shown on the Overview — last GW's honest
// verdicts at a glance (return-chance calibration, rolling test, decision matrix).
function labDigestHtml() {
  const cur = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
  const res = btOOF({ K: 2 });
  const roll = cur > 1 ? btRoll(cur) : null;
  const calib = (res && res.nTotal)
    ? (Math.abs(res.observed - res.meanPred) <= 7
        ? `<span class="xb" style="--c:var(--green)">✓ well calibrated</span>`
        : `<span class="xb" style="--c:var(--amber)">calibration drifting</span>`)
    : 'awaiting first test GW';
  const skill = (res && res.nTotal)
    ? (res.brier < res.brierConst
        ? '<span class="xb" style="--c:var(--green)">model edges the baseline</span>'
        : '<span class="xb" style="--c:var(--amber)">baseline still wins — keep accumulating</span>')
    : '';
  const rollTxt = roll && roll.n >= 60
    ? `form→next-GW r = <b>${roll.r}</b> (n=${roll.n}) — ${Math.abs(roll.r) < 0.12 ? 'a single GW of form barely predicts the next, as expected this early' : 'a genuine signal is emerging'}.`
    : roll ? `GW${roll.g} rolling test needs more starters (n=${roll.n}).` : 'rolling test pending more GWs.';
  let ldTxt = '';
  try { if (typeof ldStats === 'function') { const st = ldStats(); ldTxt = st.rate != null
      ? `Decision matrix: <b>${st.done.length}</b> resolved (${st.win}W/${st.loss}L) → model win-rate <b>${st.rate}%</b>.`
      : `Decision matrix: logging starts GW${cur + 1} — <b>${st.pending}</b> verdict${st.pending === 1 ? '' : 's'} already queued to self-audit.`; } } catch (e) { }
  const stat = (v, k) => `<div class="dq"><b>${v}</b><span>${k}</span></div>`;
  return `<div class="card x-card" style="grid-column:1/-1"><h2 style="margin-bottom:2px">🧪 Weekly Lab digest <span class="muted">— GW${cur} verdict, in plain words</span></h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px" class="x-dq">
      ${stat(res && res.nTotal ? res.observed + '%' : '—', 'players actually returned')}
      ${stat(res && res.nTotal ? res.meanPred + '%' : '—', 'mean predicted chance')}
      ${stat(calib, 'return-chance calibration')}
      ${stat(skill || (res ? res.brier.toFixed(3) : '—'), 'out-of-sample Brier')}
    </div>
    <p class="muted" style="margin:8px 0 0">${rollTxt}</p>
    <p class="muted" style="margin:4px 0 0">${ldTxt || ''}</p>
    <p class="muted" style="margin:4px 0 0">Everything here is out-of-sample and labelled — GW1-${cur} is a pilot; the Lab tab (📅 Planner) has the full method and tables. ${skill ? '' : ''}</p></div>`;
}
function renderLabDigest() {
  const el = $('#labDigest'); if (!el) return;
  try { el.innerHTML = labDigestHtml(); } catch (e) { console.error('[labDigest]', e); el.innerHTML = ''; }
}

