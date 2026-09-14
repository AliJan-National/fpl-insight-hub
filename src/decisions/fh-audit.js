// ============ 🎯 FREE HIT AUDIT (suggested vs actual best, every completed GW) ============
// The self-check loop: after each GW completes, compare the Free Hit squad the
// model SUGGESTED (frozen pre-deadline in snapshots/GWxx/fh-suggested.json)
// against the best squad that actually existed that week (computed from real
// GW points in history.json), and surface what the model under/over-rated.
// Honest by construction: the suggestion can never be edited after the fact —
// if no frozen snapshot exists for a GW, we say so instead of "recomputing" it.
// Pure core (fhaHistoryRows / fhaBestSquad / fhaCompare / fhaLearn) is
// deterministic + tested; the renderer fetches snapshots lazily and is guarded.
const FHA_FORMS = [[5,4,1],[5,3,2],[4,5,1],[4,4,2],[4,3,3],[3,5,2],[3,4,3]];
function fhaCompletedGw() {
  try { return Math.max(0, +((DATA.fplmeta || {}).current_gw || 0)); } catch (e) { return 0; }
}
function fhaHistoryRows(gw) {
  const byId = {}; (DATA.players || []).forEach(p => { byId[p.id] = p; });
  const out = [];
  Object.entries(DATA.history || {}).forEach(([idS, rows]) => {
    const p = byId[+idS]; if (!p) return;
    const r = (rows || []).find(x => (x[0] || 0) === gw); if (!r) return;
    out.push({ p, pts: r[1] || 0, mins: r[4] || 0, cost: (r[7] != null ? r[7] : p.cost) });
  });
  return out;
}
function fhaBestSquad(gw, budget) {
  // The best legal 15 that ACTUALLY existed that GW (same constraints as the
  // Free Hit lab: 2/5/5/3, max 3 per club, budget cap, captain doubled).
  const rows = fhaHistoryRows(gw);
  if (!rows.length) return { gw, error: 'no completed-GW data' };
  budget = budget || 100;
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  rows.forEach(r => { if (r.p && r.p.pos) byPos[r.p.pos].push(r); });
  Object.keys(byPos).forEach(k => byPos[k].sort((a, b) => b.pts - a.pts));
  const QUOTA = { GK: 2, DEF: 5, MID: 5, FWD: 3 };
  // bench: cheapest played-anything per position (insurance, like the FH lab)
  const bench = [], left = Object.assign({}, QUOTA);
  ['GK', 'DEF', 'MID', 'FWD'].forEach(pos => {
    const cheap = byPos[pos].slice().sort((a, b) => a.cost - b.cost || b.pts - a.pts)[0];
    if (cheap) { bench.push(cheap); left[pos]--; }
  });
  if (bench.length < 4) return { gw, error: 'not enough players that GW' };
  const club = {}; bench.forEach(r => club[r.p.team] = (club[r.p.team] || 0) + 1);
  let spent = bench.reduce((s, r) => s + r.cost, 0);
  const picked = { GK: [], DEF: [], MID: [], FWD: [] };
  const B = budget - spent;
  const tryBuild = (l) => {
    const cc = {}; bench.forEach(r => cc[r.p.team] = (cc[r.p.team] || 0) + 1);
    const picks = []; let cost = 0;
    Object.keys(QUOTA).forEach(pos => {
      const need = left[pos]; if (need <= 0) return;
      let taken = 0;
      const pool = byPos[pos].slice().sort((a, b) => (b.pts - l * b.cost) - (a.pts - l * a.cost));
      for (const r of pool) { if (taken >= need) break; if ((cc[r.p.team] || 0) >= 3 || picks.includes(r)) continue; cc[r.p.team] = (cc[r.p.team] || 0) + 1; picks.push(r); cost += r.cost; taken++; }
    });
    return { ok: picks.filter(r => r.p.pos === 'GK').length === 1 && picks.length === 11 && cost <= B + 1e-9, picks, cost };
  };
  let lo = 0, hi = 4;
  for (let it = 0; it < 40; it++) { const l = (lo + hi) / 2; if (tryBuild(l).ok) hi = l; else lo = l; }
  let build = tryBuild(hi); if (!build.ok) build = tryBuild(4);
  build.picks.forEach(r => { picked[r.p.pos].push(r); spent += r.cost; club[r.p.team] = (club[r.p.team] || 0) + 1; });
  // upgrades: best affordable swap on actual points
  for (let guard = 0; guard < 300; guard++) {
    let best = null;
    Object.keys(QUOTA).forEach(pos => picked[pos].forEach(out => {
      for (const cand of byPos[pos]) {
        if (picked[pos].includes(cand) || bench.includes(cand) || cand.pts <= out.pts) break;
        if ((club[cand.p.team] || 0) >= 3) continue;
        if (spent - out.cost + cand.cost > budget + 1e-9) continue;
        const gain = cand.pts - out.pts;
        if (!best || gain > best.gain) best = { out, cand, gain };
      }
    }));
    if (!best) break;
    picked[best.out.p.pos] = picked[best.out.p.pos].filter(x => x !== best.out); spent -= best.out.cost; club[best.out.p.team]--;
    picked[best.cand.p.pos].push(best.cand); spent += best.cand.cost; club[best.cand.p.team] = (club[best.cand.p.team] || 0) + 1;
  }
  const squad = bench.concat([].concat(...Object.keys(picked).map(k => picked[k])));
  if (squad.length !== 15) return { gw, error: 'not enough players that GW (' + squad.length + '/15)' };
  let bestForm = null;
  FHA_FORMS.forEach(([d, m, f]) => {
    if (picked.DEF.length < d || picked.MID.length < m || picked.FWD.length < f) return;
    const gk = picked.GK[0];
    const dd = picked.DEF.slice().sort((a, b) => b.pts - a.pts).slice(0, d);
    const mm = picked.MID.slice().sort((a, b) => b.pts - a.pts).slice(0, m);
    const ff = picked.FWD.slice().sort((a, b) => b.pts - a.pts).slice(0, f);
    const tot = gk.pts + dd.concat(mm, ff).reduce((s, r) => s + r.pts, 0);
    if (!bestForm || tot > bestForm.tot) bestForm = { form: [d, m, f], tot, starters: [gk].concat(dd, mm, ff) };
  });
  if (!bestForm) return { gw, error: 'no legal formation' };
  const starters = bestForm.starters;
  const captain = starters.slice().sort((a, b) => b.pts - a.pts)[0];
  return {
    gw, budget, spent: Math.round(spent * 10) / 10, squad, starters, bench, formation: bestForm.form.join('-'),
    captain, total: Math.round((bestForm.tot + captain.pts) * 10) / 10,   // XI + captain doubled
  };
}
// score OUR frozen suggestion against what actually happened
function fhaCompare(sugg, gw) {
  const rows = fhaHistoryRows(gw);
  const byId = {}; rows.forEach(r => byId[r.p.id] = r);
  const act = (id) => (byId[id] ? byId[id].pts : null);
  const played = (id) => (byId[id] ? byId[id].mins > 0 : false);
  const xi = (sugg.squad || []).filter(r => r.starter);
  const cap = (sugg.squad || []).find(r => r.id === sugg.captainId) || xi[0] || (sugg.squad || [])[0] || null;
  if (!cap) return { gw, ourTotal: 0, predictedTotal: sugg.fhScore || 0, captain: null, picks: [], didNotPlay: 0, hits: 0, misses: 0 };
  let ours = 0, didNotPlay = 0;
  xi.forEach(r => { const a = act(r.id); ours += (a || 0); if (a == null) didNotPlay++; });
  const capAct = act(cap.id) || 0;
  ours += capAct;
  const picks = (sugg.squad || []).map(r => {
    const a = act(r.id);
    return { name: r.name, pos: r.pos, team: r.team, xp: r.xp, actual: a, starter: !!r.starter, captain: r.id === sugg.captainId,
      verdict: a == null ? 'did not play' : a >= 6 ? 'hit' : a <= 1 ? 'miss' : 'quiet' };
  });
  return {
    gw, ourTotal: ours, predictedTotal: sugg.fhScore,
    captain: { name: cap.name, xp: cap.xp, actual: capAct },
    picks, didNotPlay,
    hits: picks.filter(p => p.verdict === 'hit').length,
    misses: picks.filter(p => p.verdict === 'miss').length,
  };
}
// what the model under/over-rated that GW (from the frozen per-player xP)
function fhaLearn(preds, gw, n) {
  const rows = fhaHistoryRows(gw);
  const byId = {}; rows.forEach(r => byId[r.p.id] = r);
  const played = (preds || []).filter(p => byId[p.id] && byId[p.id].mins >= 60)
    .map(p => ({ name: p.name, pos: p.pos, team: p.team, xp: p.xp, actual: byId[p.id].pts, delta: byId[p.id].pts - p.xp }));
  const under = played.slice().sort((a, b) => b.delta - a.delta).slice(0, n || 5);
  const over = played.slice().sort((a, b) => a.delta - b.delta).slice(0, n || 5);
  const mae = played.length ? played.reduce((s, p) => s + Math.abs(p.delta), 0) / played.length : null;
  return { under, over, mae: mae == null ? null : Math.round(mae * 100) / 100, n: played.length };
}
// ---- renderer (lazy, guarded, snapshot-driven) ----
async function renderFreeHitAudit() {
  const host = $('#fhAudit'); if (!host) return;
  try {
    const gw = fhaCompletedGw();
    if (!gw) { host.innerHTML = '<p class="hint">No completed gameweek in the data yet.</p>'; return; }
    const best = fhaBestSquad(gw, 100);
    const nn = String(gw).padStart(2, '0');
    let sugg = null, preds = null;
    try { const r = await fetch('snapshots/GW' + nn + '/fh-suggested.json'); if (r.ok) sugg = await r.json(); } catch (e) {}
    try { const r = await fetch('snapshots/GW' + nn + '/predictions.json'); if (r.ok) preds = (await r.json()).preds; } catch (e) {}
    if (best.error) { host.innerHTML = '<p class="hint">GW' + gw + ' audit: ' + esc(best.error) + '.</p>'; return; }
    let html = '<div class="card"><h2>🎯 Free Hit Audit — GW' + gw + ' <span class="muted">— our suggestion vs what actually happened</span></h2>';
    if (!sugg) {
      html += '<p class="hint">The best squad that actually existed in GW' + gw + ' is below, but we have <b>no frozen pre-deadline suggestion for GW' + gw + '</b> (snapshots start with the GW they were introduced) — we will never "recompute" a past suggestion after results are known; that would be cheating.</p>'
        + '<p class="hint"><b>Actual best GW' + gw + ':</b> ' + best.total + ' pts · formation ' + best.formation + ' · captain ' + esc(best.captain.p.name) + ' (' + best.captain.pts + '×2) · £' + best.spent.toFixed(1) + 'm</p></div>';
      host.innerHTML = html; return;
    }
    const cmp = fhaCompare(sugg, gw);
    const gap = Math.round((best.total - cmp.ourTotal) * 10) / 10;
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px">'
      + '<div class="card" style="margin:0;text-align:center"><div class="muted" style="font-size:11px">OUR FH SQUAD SCORED</div><div style="font-size:26px;font-weight:800">' + cmp.ourTotal + '</div><div class="muted" style="font-size:11px">predicted ' + cmp.predictedTotal + ' xP</div></div>'
      + '<div class="card" style="margin:0;text-align:center"><div class="muted" style="font-size:11px">BEST POSSIBLE</div><div style="font-size:26px;font-weight:800;color:var(--green)">' + best.total + '</div><div class="muted" style="font-size:11px">captain ' + esc(best.captain.p.name) + ' ×2</div></div>'
      + '<div class="card" style="margin:0;text-align:center"><div class="muted" style="font-size:11px">GAP TO PERFECT</div><div style="font-size:26px;font-weight:800;color:' + (gap <= 15 ? 'var(--green)' : gap <= 30 ? 'var(--amber)' : 'var(--red)') + '">' + gap + '</div><div class="muted" style="font-size:11px">' + cmp.hits + ' hits · ' + cmp.misses + ' misses</div></div></div>';
    html += '<p class="hint" style="margin:0 0 8px">Our captain <b>' + esc(cmp.captain.name) + '</b>: predicted ' + cmp.captain.xp.toFixed(1) + ', actually <b>' + cmp.captain.actual + '</b>' + (cmp.captain.actual <= 1 ? ' — the painful one.' : '.') + (cmp.didNotPlay ? ' ' + cmp.didNotPlay + ' suggested starter(s) did not play.' : '') + '</p>';
    html += '<table class="data compact"><tr><th></th><th>Our pick</th><th>Pred</th><th>Actual</th><th>Δ</th><th></th></tr>'
      + cmp.picks.map(p => '<tr' + (p.starter ? '' : ' style="opacity:.6"') + '><td>' + posBadge(p.pos) + '</td><td>' + esc(p.name) + (p.captain ? ' <span class="mp-chip ok">C ×2</span>' : '') + (p.starter ? '' : ' <span class="mp-chip muted">bench</span>') + '</td><td class="num">' + p.xp.toFixed(1) + '</td><td class="num"><b>' + (p.actual == null ? '—' : p.actual) + '</b></td><td class="num">' + (p.actual == null ? '—' : (p.actual - p.xp >= 0 ? '+' : '') + (p.actual - p.xp).toFixed(1)) + '</td><td>' + (p.verdict === 'hit' ? '<span class="mp-chip ok">hit</span>' : p.verdict === 'miss' ? '<span class="mp-chip warn">miss</span>' : p.verdict === 'did not play' ? '<span class="mp-chip muted">DNP</span>' : '<span class="mp-chip muted">quiet</span>') + '</td></tr>').join('') + '</table>';
    if (preds) {
      const L = fhaLearn(preds, gw, 5);
      if (L.n) {
        html += '<p class="hint" style="margin:10px 0 4px"><b>What GW' + gw + ' taught the model</b> (starters only, n=' + L.n + ', xP MAE ' + L.mae + '):</p><div class="grid2">'
          + '<div><div class="mp-h up">UNDER-rated — we missed these</div>' + L.under.map(p => '<div class="mp-row"><div class="mp-top"><b>' + esc(p.name) + '</b> <span class="muted">' + p.pos + ' ' + esc(p.team) + '</span><span class="mp-net">+' + p.delta.toFixed(1) + '</span></div><div class="mp-why">predicted ' + p.xp.toFixed(1) + ' → actually ' + p.actual + '</div></div>').join('') + '</div>'
          + '<div><div class="mp-h down">OVER-rated — we trusted these too much</div>' + L.over.map(p => '<div class="mp-row"><div class="mp-top"><b>' + esc(p.name) + '</b> <span class="muted">' + p.pos + ' ' + esc(p.team) + '</span><span class="mp-net">' + p.delta.toFixed(1) + '</span></div><div class="mp-why">predicted ' + p.xp.toFixed(1) + ' → actually ' + p.actual + '</div></div>').join('') + '</div></div>';
      }
    }
    html += '<p class="hint" style="margin-top:8px">Suggestion frozen pre-deadline in <b>snapshots/GW' + nn + '/</b> — it cannot be edited after results. Every completed GW gets this audit automatically.</p></div>';
    host.innerHTML = html;
  } catch (e) { host.innerHTML = '<p class="hint">Free Hit Audit unavailable: ' + esc(e.message) + '</p>'; }
}
