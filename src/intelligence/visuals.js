// ============ 🛰️ VISUALS (v37): crowd map, elite-gap bars, chip timeline, bargain map ============
// All charts are pure inline SVG built from data the app already loads — no new
// network calls, no libraries. Every chart states its sample + that values are
// model estimates. Layout functions return plain data so tests can assert the
// semantics (which player lands in which quadrant) without parsing SVG.

// ---------- A. Crowd vs Model quadrant map ----------
function crowdMapLayout(players) {
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };
  const rows = [];
  (players || []).forEach(p => {
    if (!p || !p.name) return;
    let f = null;
    try { f = (typeof forecastOf === 'function') ? forecastOf(p) : null; } catch (e) { f = null; }
    if (!f || f.xp == null || !isFinite(f.xp)) return;
    const net = (p.t_in || 0) - (p.t_out || 0);
    if ((p.own == null || p.own < 2.5) && Math.abs(net) < 40) return;   // only meaningful players
    rows.push({ p, net, xp: f.xp });
  });
  if (rows.length < 4) return { dots: [], medNet: 0, xThr: 5.5, xmax: 200, ymax: 8 };
  const medNet = med(rows.map(r => r.net));
  const xThr = 5.5;   // the SAME bar the verdict rows use: >=5.5 model at least rates him, <5.5 = "crowd ahead" zone
  const absNet = rows.map(r => Math.abs(r.net)).sort((a, b) => a - b);
  let xmax = Math.max(200, Math.min(800, Math.ceil((absNet[Math.floor(absNet.length * .97)] || 400) / 50) * 50));
  const ymax = Math.max(8, Math.ceil((rows.map(r => r.xp).sort((a, b) => a - b)[Math.floor(rows.length * .97)] || 8) * 1.05));
  const dots = rows.map(r => {
    const q = (r.net >= medNet && r.xp >= xThr) ? 'buy' : (r.net >= medNet) ? 'fomo' : (r.xp >= xThr) ? 'radar' : 'fade';
    return { p: r.p, net: r.net, xp: r.xp, q, own: r.p.own || 0 };
  });
  return { dots, medNet, xThr, xmax, ymax };
}

function crowdMapSVG(players) {
  const L = crowdMapLayout(players);
  if (!L.dots.length) return '<p class="hint">Not enough data for the market map yet.</p>';
  const W = 640, H = 380, x0 = 46, x1 = 626, y0 = 26, y1 = 336;
  const sx = (net) => x0 + (Math.max(-L.xmax, Math.min(L.xmax, net)) + L.xmax) / (2 * L.xmax) * (x1 - x0);
  const sy = (xp) => y1 - Math.max(0, Math.min(L.ymax, xp)) / L.ymax * (y1 - y0);
  const fmtK = (n) => (n >= 0 ? '+' : '−') + Math.round(Math.abs(n) / 1000) + 'k';
  const QC = { buy: '#00ff85', fomo: '#ffc94d', radar: '#4dc3ff', fade: '#b7a4da' };
  let g = '';
  // grid + ticks
  for (let t = 0; t <= 4; t++) {
    const gx = x0 + (x1 - x0) * t / 4;
    g += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y1}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${gx}" y="${y1 + 16}" text-anchor="middle" font-size="10" fill="#b7a4da">${fmtK(-L.xmax + 2 * L.xmax * t / 4)}</text>`;
  }
  const ystep = Math.max(2, Math.round(L.ymax / 5));
  for (let v = 0; v <= L.ymax; v += ystep) {
    const gy = sy(v);
    g += `<line x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${x0 - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="#b7a4da">${v}</text>`;
  }
  // quadrant medians
  const mx = sx(L.medNet), my = sy(L.xThr);
  g += `<line x1="${mx}" y1="${y0}" x2="${mx}" y2="${y1}" stroke="rgba(177,140,255,.5)" stroke-dasharray="5 4"/>` +
    `<line x1="${x0}" y1="${my}" x2="${x1}" y2="${my}" stroke="rgba(0,255,133,.45)" stroke-dasharray="5 4"/>` +
    `<text x="${x0 + 4}" y="${my - 4}" font-size="9" fill="#00ff85" opacity=".8">model "rates him" line — 5.5 xP, the same bar as the verdict rows</text>`;
  // corner labels
  const corners = [
    ['MODEL AHEAD ↑ / crowd selling', x0 + 8, y0 + 14, 'radar'], ['CROWD + MODEL AGREE', x1 - 8, y0 + 14, 'buy'],
    ['NOBODY WANTS / model doubts', x0 + 8, y1 - 8, 'fade'], ['CROWD AHEAD / model doubts', x1 - 8, y1 - 8, 'fomo']];
  corners.forEach(c => { g += `<text x="${c[1]}" y="${c[2]}" text-anchor="${c[1] > (x0 + x1) / 2 ? 'end' : 'start'}" font-size="9.5" font-weight="700" fill="${QC[c[3]]}" opacity=".75">${c[0]}</text>`; });
  // dots (biggest crowd moves + model favourites first so labels sit on top)
  const order = L.dots.slice().sort((a, b) => (Math.abs(b.net) + b.xp) - (Math.abs(a.net) + a.xp));
  const labelSet = new Set(order.slice(0, 12).map(d => d.p.name));
  order.forEach(d => {
    const cx = sx(d.net), cy = sy(d.xp), r = d.own >= 20 ? 5.5 : d.own >= 8 ? 4.5 : 3.5;
    g += `<g><title>${d.p.name} (${d.p.pos}, ${d.p.team}) — net ${fmtK(d.net)}, ${d.own.toFixed(1)}% owned, model xP ${d.xp.toFixed(1)}</title>` +
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${QC[d.q]}" opacity=".85"/></g>`;
  });
  // labels for the headliners (stagger to reduce overlap)
  order.slice(0, 12).forEach((d, i) => {
    const cx = sx(d.net), cy = sy(d.xp);
    const up = i % 2 === 0;
    g += `<text x="${(cx + (cx > x1 - 90 ? -8 : 8)).toFixed(1)}" y="${(cy + (up ? -8 : 13)).toFixed(1)}" text-anchor="${cx > x1 - 90 ? 'end' : 'start'}" font-size="10" font-weight="700" fill="#efeafd" paint-order="stroke" stroke="rgba(18,10,40,.9)" stroke-width="3">${d.p.name.split(' ').slice(-1)[0]}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><title>Market map: crowd transfers (left-right) vs model expected points (up-down). Model estimate.</title>` +
    `<text x="${x0}" y="14" font-size="10" fill="#b7a4da">↑ model xP (next GW, estimate) · → net transfers this GW (clamped ±${L.xmax / 1000}k) · dot size = ownership</text>${g}` +
    `<text x="${(x0 + x1) / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#8d7bb5">dashed lines = medians of the ${L.dots.length} tracked players — every dot is a model estimate, not a promise</text></svg>`;
}

// ---------- B. Smart-money gap: elite ownership vs crowd ownership ----------
function eliteGapData(elite, players, n) {
  if (!elite || !elite.gw || !elite.elites || !elite.elites.length) return { rows: [], n: 0, gw: 0 };
  const gw = +((elite.meta || {}).latest_complete || 0);
  const g = elite.gw[String(gw)];
  if (!g || !g.own) return { rows: [], n: 0, gw };
  const N = elite.elites.length;
  const byId = {}; (players || []).forEach(p => { if (p && p.id != null) byId[p.id] = p; });
  const cand = new Set();
  Object.entries(g.own).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([id]) => cand.add(+id));
  Object.entries(g.bought || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([id]) => cand.add(+id));
  Object.entries(g.sold || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([id]) => cand.add(+id));
  const rows = [];
  cand.forEach(id => {
    const p = byId[id];
    if (!p) return;
    const ePct = (g.own[id] || 0) / N * 100;
    const cPct = (p.own != null ? p.own : 0);
    rows.push({ p, elitePct: ePct, crowdPct: cPct, delta: ePct - cPct, bought: (g.bought || {})[id] || 0, sold: (g.sold || {})[id] || 0 });
  });
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { rows: rows.slice(0, n || 10), n: N, gw };
}

function eliteGapHtml(data) {
  if (!data || !data.rows.length) return '<p class="hint">No elite ownership data yet.</p>';
  const rows = data.rows.map(r => {
    const tag = r.delta >= 0 ? 'elites ahead' : 'crowd ahead';
    const cls = r.delta >= 0 ? 'ok' : 'warn';
    return `<div class="vg-gap-row"><div class="vg-gap-name"><b>${esc(r.p.name)}</b> <span class="muted">${r.p.pos} · ${esc(r.p.team)} · £${(r.p.cost || 0).toFixed(1)}m</span>` +
      ` <span class="mp-chip ${cls}">${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(0)}pp ${tag}</span></div>` +
      `<div class="vg-gap-bars"><span class="vg-lab">crowd</span><div class="mp-bar"><div class="mp-bar-fill" style="width:${Math.min(100, r.crowdPct).toFixed(1)}%"></div></div><span class="vg-num">${r.crowdPct.toFixed(0)}%</span>` +
      `<span class="vg-lab">elite</span><div class="mp-bar"><div class="mp-bar-fill alt" style="width:${Math.min(100, r.elitePct).toFixed(1)}%"></div></div><span class="vg-num">${r.elitePct.toFixed(0)}%</span></div></div>`;
  }).join('');
  return `<p class="hint" style="margin:2px 0 8px">Who do the <b>${data.n} tracked elites</b> hold vs the whole population (GW${data.gw})? Biggest gaps first — “elites ahead” = they back a player the crowd hasn't found yet.</p>${rows}`;
}

// ---------- C. Chip timeline: when the 40 elites spent each chip ----------
function chipTimelineData(elite) {
  if (!elite || !elite.elites || !elite.elites.length) return { chips: [], lastGw: 0, n: 0 };
  const lastGw = Math.max(1, +((elite.meta || {}).latest_complete || 1));
  const N = elite.elites.length;
  const names = { bboost: 'Bench Boost', '3xc': 'Triple Captain', freehit: 'Free Hit', wildcard: 'Wildcard' };
  const per = {}; Object.keys(names).forEach(k => per[k] = {});
  const used = {}; Object.keys(names).forEach(k => used[k] = 0);
  elite.elites.forEach(e => {
    Object.entries(e.chips || {}).forEach(([gw, k]) => {
      if (!names[k]) return;
      per[k][gw] = (per[k][gw] || 0) + 1;
      used[k]++;
    });
  });
  const chips = Object.keys(names).map(k => ({ key: k, label: names[k], used: used[k], hold: N - used[k], marks: per[k] }));
  chips.sort((a, b) => b.used - a.used);
  return { chips, lastGw, n: N };
}

function chipTimelineSVG(elite) {
  const T = chipTimelineData(elite);
  if (!T.chips.length) return '<p class="hint">No chip history yet.</p>';
  const COL = { bboost: '#4dc3ff', '3xc': '#ffc94d', freehit: '#b18cff', wildcard: '#ff5575' };
  const slots = Math.max(T.lastGw, 5);
  const laneL = 118, x0 = 126, x1 = 470, holdX = 480, W = 640;
  const laneH = 34, H = 30 + T.chips.length * laneH + 26;
  const cx = (gw) => x0 + (x1 - x0) * (gw - 0.5) / slots;
  let g = '';
  for (let gw = 1; gw <= slots; gw++) {
    const gx = cx(gw);
    g += `<line x1="${gx}" y1="26" x2="${gx}" y2="${H - 24}" stroke="rgba(255,255,255,.06)"/>` +
      `<text x="${gx}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#b7a4da">GW${gw}${gw > T.lastGw ? ' ·' : ''}</text>`;
  }
  T.chips.forEach((c, i) => {
    const ly = 26 + i * laneH + laneH / 2;
    g += `<text x="${laneL}" y="${ly + 4}" text-anchor="end" font-size="11" font-weight="700" fill="#efeafd">${c.label}</text>` +
      `<line x1="${x0}" y1="${ly}" x2="${x1}" y2="${ly}" stroke="rgba(255,255,255,.14)"/>`;
    Object.entries(c.marks).forEach(([gw, cnt]) => {
      const r = 4.5 + 8 * (cnt / T.n);
      g += `<g><title>${cnt} of ${T.n} elites played ${c.label} in GW${gw}</title>` +
        `<circle cx="${cx(+gw).toFixed(1)}" cy="${ly}" r="${r.toFixed(1)}" fill="${COL[c.key]}" opacity=".9"/></g>` +
        `<text x="${cx(+gw).toFixed(1)}" y="${ly - r - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#efeafd">${cnt}</text>`;
    });
    g += `<text x="${holdX}" y="${ly + 4}" font-size="10.5" fill="#b7a4da"><tspan font-weight="700" fill="${c.hold > 0 ? '#00ff85' : '#b7a4da'}">${c.hold}</tspan>/${T.n} still hold</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><title>When the ${T.n} tracked elite managers played each chip, and how many are still holding.</title>` +
    `<text x="${x0}" y="14" font-size="10" fill="#b7a4da">circle size = how many of the ${T.n} tracked elites used the chip that week</text>${g}</svg>`;
}

// ---------- D. Bargain map: price vs model xP, with the fair-value curve ----------
function bargainLayout(players) {
  const pts = [];
  (players || []).forEach(p => {
    if (!p || !p.name || p.cost == null) return;
    let f = null;
    try { f = (typeof forecastOf === 'function') ? forecastOf(p) : null; } catch (e) { f = null; }
    if (!f || f.xp == null || !isFinite(f.xp)) return;
    if ((p.own == null || p.own < 2) && f.xp < 3.5) return;
    pts.push({ p, price: p.cost, xp: f.xp });
  });
  if (pts.length < 10) return { pts: [], curve: [], pmin: 3.5, pmax: 15, ymax: 8 };
  const pmin = Math.floor(Math.min.apply(null, pts.map(r => r.price)) * 2) / 2;
  const pmax = Math.ceil(Math.max.apply(null, pts.map(r => r.price)) * 2) / 2;
  const ymax = Math.max(8, Math.ceil(pts.map(r => r.xp).sort((a, b) => a - b)[Math.floor(pts.length * .97)] * 1.05));
  // fair value = median model xP per £0.5m bucket (needs >= 4 players in a bucket to be honest)
  const buckets = {};
  pts.forEach(r => { const b = Math.floor(r.price * 2) / 2; (buckets[b] = buckets[b] || []).push(r.xp); });
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const curve = Object.keys(buckets).map(Number).sort((a, b) => a - b)
    .filter(b => buckets[b].length >= 4).map(b => ({ price: b, med: med(buckets[b]), n: buckets[b].length }));
  pts.forEach(r => {
    const b = Math.floor(r.price * 2) / 2;
    const c = curve.find(cv => cv.price === b);
    r.bucketMed = c ? c.med : null;
    r.above = c ? r.xp > c.med : null;
  });
  return { pts, curve, pmin, pmax, ymax };
}

function bargainMapSVG(players) {
  const L = bargainLayout(players);
  if (!L.pts.length) return '<p class="hint">Not enough data for the bargain map yet.</p>';
  const W = 640, H = 380, x0 = 46, x1 = 626, y0 = 26, y1 = 336;
  const sx = (pr) => x0 + (pr - L.pmin) / (L.pmax - L.pmin || 1) * (x1 - x0);
  const sy = (xp) => y1 - Math.max(0, Math.min(L.ymax, xp)) / L.ymax * (y1 - y0);
  let g = '';
  const xstep = Math.max(1, Math.round((L.pmax - 3.5) / 12));
  for (let v = L.pmin; v <= L.pmax + 1e-9; v += xstep) {
    const gx = sx(v);
    g += `<line x1="${gx}" y1="${y0}" x2="${gx}" y2="${y1}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${gx}" y="${y1 + 16}" text-anchor="middle" font-size="10" fill="#b7a4da">£${v % 1 ? v.toFixed(1) : v}m</text>`;
  }
  const ystep = Math.max(2, Math.round(L.ymax / 5));
  for (let v = 0; v <= L.ymax; v += ystep) {
    const gy = sy(v);
    g += `<line x1="${x0}" y1="${gy}" x2="${x1}" y2="${gy}" stroke="rgba(255,255,255,.07)"/>` +
      `<text x="${x0 - 6}" y="${gy + 3}" text-anchor="end" font-size="10" fill="#b7a4da">${v}</text>`;
  }
  // fair-value curve (median model xP per price bucket)
  if (L.curve.length >= 2) {
    const path = L.curve.map(c => `${sx(c.price + 0.25).toFixed(1)},${sy(c.med).toFixed(1)}`).join(' ');
    g += `<polyline points="${path}" fill="none" stroke="#b18cff" stroke-width="2" stroke-dasharray="7 5" opacity=".9"/>`;
  }
  // dots
  const sorted = L.pts.slice().sort((a, b) => (b.bucketMed != null && a.bucketMed != null ? (b.xp - b.bucketMed) - (a.xp - a.bucketMed) : 0));
  L.pts.forEach(r => {
    const col = r.above == null ? '#b7a4da' : r.above ? '#00ff85' : '#ff5575';
    g += `<g><title>${r.p.name} (${r.p.pos}, ${esc(r.p.team)}) — £${r.price.toFixed(1)}m, model xP ${r.xp.toFixed(1)}${r.bucketMed != null ? ' vs £-typical ' + r.bucketMed.toFixed(1) : ''}</title>` +
      `<circle cx="${sx(r.price).toFixed(1)}" cy="${sy(r.xp).toFixed(1)}" r="3.5" fill="${col}" opacity="${r.above == null ? .3 : .75}"/></g>`;
  });
  // label the biggest bargains
  sorted.slice(0, 8).forEach((r, i) => {
    if (r.bucketMed == null || !r.above) return;
    const cx = sx(r.price), cy = sy(r.xp), up = i % 2 === 0;
    g += `<text x="${(cx + 7).toFixed(1)}" y="${(cy + (up ? -7 : 13)).toFixed(1)}" font-size="10" font-weight="700" fill="#efeafd" paint-order="stroke" stroke="rgba(18,10,40,.9)" stroke-width="3">${r.p.name.split(' ').slice(-1)[0]} +${(r.xp - r.bucketMed).toFixed(1)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><title>Bargain map: price vs model expected points. Dots above the curve are underpriced for what the model expects.</title>` +
    `<text x="${x0}" y="14" font-size="10" fill="#b7a4da">↑ model xP (next GW, estimate) · → price · <tspan fill="#00ff85">green = above the fair-value curve</tspan> · <tspan fill="#ff5575">red = priced above their model xP</tspan></text>${g}` +
    `<text x="${(x0 + x1) / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#8d7bb5">dashed violet curve = median model xP at each £0.5m price (only buckets with 4+ players) — ${L.pts.length} players, all model estimates</text></svg>`;
}

// ---------- renderer: fills the four containers if present ----------
function renderVisuals() {
  const mapHost = $('#mpMap');
  if (mapHost) { try { mapHost.innerHTML = crowdMapSVG(DATA.players); } catch (e) { mapHost.innerHTML = '<p class="hint">Market map unavailable.</p>'; } }
  const gapHost = $('#eliteGap');
  if (gapHost) { try { gapHost.innerHTML = eliteGapHtml(eliteGapData(DATA.elite, DATA.players, 10)); } catch (e) { gapHost.innerHTML = '<p class="hint">Elite gap unavailable.</p>'; } }
  const tlHost = $('#chipTimeline');
  if (tlHost) { try { tlHost.innerHTML = chipTimelineSVG(DATA.elite); } catch (e) { tlHost.innerHTML = '<p class="hint">Chip timeline unavailable.</p>'; } }
  const bmHost = $('#bargainMap');
  if (bmHost) { try { bmHost.innerHTML = bargainMapSVG(DATA.players); } catch (e) { bmHost.innerHTML = '<p class="hint">Bargain map unavailable.</p>'; } }
}

function renderLeague() {
  let html = `<tr><th>#</th><th>Team</th><th class="num">P</th><th class="num">GD</th><th class="num">Pts</th></tr>`;
  DATA.league.forEach((t, i) => {
    const zone = i < 4 ? 'border-left:3px solid var(--green)' : i >= 17 ? 'border-left:3px solid var(--red)' : '';
    html += `<tr style="${zone}"><td>${i+1}</td><td><b>${esc(t.team)}</b></td>
      <td class="num">${t.P}</td><td class="num ${t.GD>0?'up':t.GD<0?'down':''}">${t.GD>0?'+':''}${t.GD}</td>
      <td class="num"><b>${t.Pts}</b></td></tr>`;
  });
  $('#leagueTable').innerHTML = html;
}

function renderTopScorers() {
  let html = `<tr><th></th><th>Player</th><th class="num">Pts</th><th class="num">Own%</th><th class="num">£</th></tr>`;
  DATA.players.slice(0, 12).forEach((p, i) => {
    html += `<tr><td>${posBadge(p.pos)}</td><td><b>${esc(p.name)}</b> <span class="team-tag">${p.team}</span></td>
      <td class="num pts">${p.pts}</td><td class="num">${p.own}</td><td class="num">${p.cost}</td></tr>`;
  });
  $('#topScorers').innerHTML = html;
}

function renderResults() {
  $('#resultsGW').textContent = `(GW1–${DATA.meta.latest_gw}, xG shown)`;
  $('#resultsList').innerHTML = DATA.results.slice().reverse().map(r => `
    <div class="result-row">
      <span class="gw-tag">GW${r.gw}</span>
      <span>${r.home}</span><span class="score">${r.hs}–${r.as_}</span><span>${r.away}</span>
      ${r.hxg != null ? `<span class="xg">xG ${r.hxg}–${r.axg}</span>` : ''}
    </div>`).join('');
}

function sigCard(item, i, cls) {
  const p = item.p;
  return `<div class="sig-card ${cls}">
    <div class="rank">${i+1}</div>
    <div class="sig-info">
      <div class="sig-name">${esc(p.name)} ${posBadge(p.pos)} <span class="team-tag">${p.team} · £${p.cost}m · ${p.own}% owned</span></div>
      <div class="sig-reasons">${item.reasons.map(r => `<span class="reason">${esc(r)}</span>`).join('')}</div>
    </div>
    <div class="sig-pts"><div class="pts">${p.pts}</div><div class="sig-meta">pts</div></div>
  </div>`;
}

function renderRadar() {
  $('#buyList').innerHTML = DATA.radar.buys.map((b, i) => sigCard(b, i, '')).join('') || '<p class="hint">No strong signals yet.</p>';
  $('#sellList').innerHTML = DATA.radar.sells.map((s, i) => sigCard(s, i, 'sell')).join('') || '<p class="hint">No strong signals yet.</p>';

  const rows = (list) => `<tr><th></th><th>Player</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th><th class="num">£Δ</th></tr>` +
    list.map(p => `<tr><td>${posBadge(p.pos)}</td><td><b>${esc(p.name)}</b> <span class="team-tag">${p.team}</span></td>
      <td class="num up">${fmtK(p.t_in)}</td><td class="num down">${fmtK(p.t_out)}</td>
      <td class="num ${p.t_in-p.t_out>=0?'up':'down'}">${p.t_in-p.t_out>=0?'+':''}${fmtK(p.t_in-p.t_out)}</td>
      <td class="num ${p.price_chg>=0?'up':'down'}">${p.price_chg>0?'+':''}${p.price_chg}</td></tr>`).join('');
  $('#mostIn').innerHTML = rows(DATA.radar.most_in);
  $('#mostOut').innerHTML = rows(DATA.radar.most_out);
}

const PCOLS = [
  { k: 'name', l: 'Player' }, { k: 'pos', l: 'Pos' }, { k: 'team', l: 'Team' },
  { k: 'pts', l: 'Pts', n: 1 }, { k: 'ep', l: 'GW', n: 1 }, { k: 'mins', l: 'Min', n: 1 },
  { k: 'g', l: 'G', n: 1 }, { k: 'a', l: 'A', n: 1 }, { k: 'xg', l: 'xG', n: 1 },
  { k: 'xg_diff', l: 'G−xG', n: 1 }, { k: 'chances', l: 'Ch', n: 1 }, { k: 'cbit', l: 'CBIT', n: 1 },
  { k: 'own', l: 'Own%', n: 1 }, { k: 'cost', l: '£', n: 1 }, { k: 'form', l: 'Form', n: 1 }, { k: 'spark', l: 'Trend' },
];
let sortKey = 'pts', sortDir = -1, filterPos = '';

function renderPlayers() {
  const q = $('#search').value.trim().toLowerCase();
  const min90 = $('#min90').checked;
  let rows = DATA.players.filter(p =>
    (!filterPos || p.pos === filterPos) &&
    (!q || p.name.toLowerCase().includes(q)) &&
    (!min90 || p.mins >= 90));
  rows.sort((a, b) => sortDir * ((a[sortKey] ?? -1) > (b[sortKey] ?? -1) ? 1 : -1));
  rows = rows.slice(0, 250);
  $('#playerCount').textContent = `${rows.length} shown`;

  let html = '<tr>' + PCOLS.map(c =>
    `<th class="sortable ${c.n ? 'num' : ''}" data-k="${c.k}">${c.l}${sortKey === c.k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('') + '</tr>';
  rows.forEach(p => {
    const d = p.xg_diff;
    html += `<tr>
      <td><b>${esc(p.name)}</b>${p.status !== 'a' ? ' <span title="' + esc(p.news) + '">⚠️</span>' : ''}</td>
      <td>${posBadge(p.pos)}</td><td class="team-tag">${p.team}</td>
      <td class="num pts">${p.pts}</td><td class="num">${p.ep}</td><td class="num">${p.mins}</td>
      <td class="num">${p.g}</td><td class="num">${p.a}</td><td class="num">${p.xg}</td>
      <td class="num ${d > 0.3 ? 'up' : d < -0.3 ? 'down' : ''}">${d > 0 ? '+' : ''}${d.toFixed(1)}</td>
      <td class="num">${p.chances}</td><td class="num">${p.cbit}</td>
      <td class="num">${p.own}</td><td class="num">${p.cost}</td><td class="num">${p.form}</td><td>${sparkSVG(p.id, 90, 26)}</td></tr>`;
  });
  $('#playerTable').innerHTML = html;
  $$('#playerTable th.sortable').forEach(th => th.onclick = () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; }
    renderPlayers();
  });
}

