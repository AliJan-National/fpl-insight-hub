// ============ 📏 xP MEASUREMENT (audit M3 · v31) ============
// projP was never backtested against official FPL ep_next, because a retro test
// leaks (no historical ep snapshots). Fix: a FORECAST LEDGER records, once per
// gameweek, the model xP AND the official ep for every player for the open GW.
// When that GW's real results land, fxBench() scores both against actual points
// (MAE + correlation) with no leakage. Deterministic + local.
const FL_KEY = 'fxledger_v1';
function flGet() { try { return JSON.parse(localStorage.getItem(FL_KEY)) || {}; } catch (e) { return {}; } }
function flSet(o) { try { localStorage.setItem(FL_KEY, JSON.stringify(o)); } catch (e) { } }
function flOpenGw() { return ((DATA.fplmeta && DATA.fplmeta.current_gw) || 3) + 1; }
function fxLedgerRecord() {
  try {
    if (!DATA.players || !DATA.players.length) return;
    const g = flOpenGw();
    const led = flGet();
    if (led[g]) return;
    const snap = {};
    for (const p of DATA.players) {
      const f = (typeof forecastOf === 'function') ? forecastOf(p) : null;
      if (!f) continue;
      snap[p.id] = { xp: f.xp, ep: Math.round((p.ep_next || 0) * 10) / 10, p6: f.p6 };
    }
    led[g] = { n: Object.keys(snap).length, snap };
    Object.keys(led).forEach(k => { if (Number(k) < g - 5) delete led[k]; });
    flSet(led);
  } catch (e) { console.error('[fxLedger]', e); }
}
function fxBench() {
  const led = flGet();
  const cur = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
  const hist = DATA.history || {};
  const act = {};
  for (const idStr of Object.keys(hist)) for (const r of hist[idStr] || []) {
    if (r[0] === cur) act[idStr] = (act[idStr] || 0) + (r[1] || 0);
  }
  if (!led[cur] || !Object.keys(act).length) return { g: cur, n: 0 };
  const M = [], O = [];
  const snap = led[cur].snap || {};
  for (const idStr of Object.keys(act)) {
    const f = snap[idStr]; if (!f) continue;
    const y = act[idStr];
    M.push([f.xp, y]); O.push([f.ep, y]);
  }
  const n = M.length;
  const stat = arr => {
    if (n < 2) return { n, mae: null, r: null, mP: null, mA: null };
    const mP = arr.reduce((a, x) => a + x[0], 0) / n, mA = arr.reduce((a, x) => a + x[1], 0) / n;
    let cov = 0, vP = 0, vA = 0, mae = 0;
    arr.forEach(x => { cov += (x[0] - mP) * (x[1] - mA); vP += (x[0] - mP) ** 2; vA += (x[1] - mA) ** 2; mae += Math.abs(x[0] - x[1]); });
    return { n, mae: Math.round(mae / n * 100) / 100, r: vP > 0 && vA > 0 ? Math.round(cov / Math.sqrt(vP * vA) * 1000) / 1000 : null, mP: Math.round(mP * 100) / 100, mA: Math.round(mA * 100) / 100 };
  };
  return { g: cur, n, model: stat(M), ep: stat(O), ledN: (led[cur] && led[cur].n) || 0 };
}
function btXpCard() {
  const g = flOpenGw();
  const b = fxBench();
  if (!b.n) {
    const prev = flGet()[flOpenGw() - 1];
    const rec = prev && prev.n;
    return `<div class="card" style="grid-column:1/-1"><h2>📏 xP vs official — forecast ledger</h2>
      <p class="hint">The core xP model is never backtested retroactively (that would leak — no historical ep snapshots exist). So since v31 every open GW's <b>model xP and official FPL ep</b> are recorded for every player, once. The first measurement publishes itself here as soon as GW${g} has real results.</p>
      <p class="muted">Ledger armed${rec ? ' — GW' + (g - 1) + ': ' + rec + ' players recorded, awaiting GW' + g + ' results' : ' (first snapshot happens now)'}. Same honesty loop as the decision ledger: record, then measure, then publish.</p></div>`;
  }
  const model = b.model, ep = b.ep;
  const better = (model.mae != null && ep.mae != null) ? (model.mae < ep.mae ? 'model <b>leads</b>' : ep.mae < model.mae ? 'official ep <b>leads</b>' : 'level') : 'n/a';
  return `<div class="card" style="grid-column:1/-1"><h2>📏 xP vs official — GW${b.g} measured</h2>
    <table style="width:100%;border-collapse:collapse"><tr><th>predictor</th><th class="num">MAE</th><th class="num">corr r</th></tr>
    <tr><td><b>our model xP</b></td><td class="num">${model.mae == null ? 'n/a' : model.mae}</td><td class="num">${model.r == null ? 'n/a' : model.r}</td></tr>
    <tr><td>official FPL ep</td><td class="num">${ep.mae == null ? 'n/a' : ep.mae}</td><td class="num">${ep.r == null ? 'n/a' : ep.r}</td></tr></table>
    <p class="muted">n=${model.n} starters · mean predicted ${model.mP} vs actual ${model.mA} · ${better}${model.n < 120 ? ' <span class="xb" style="--c:var(--amber)">pilot — not yet significant</span>' : ''}. Honest rule: if the model can't beat official ep, we simplify it.</p></div>`;
}

function renderBacktest() {
  const el = $('#btOut'); if (!el) return;
  try {
    const res = btOOF({ K: 2 });
    const rolls = [];
    const maxG = (DATA.fplmeta && DATA.fplmeta.current_gw) || 3;
    for (let g = 2; g <= maxG; g++) rolls.push(btRoll(g));
    const rollCards = rolls.map(ro => {
      if (!ro.n) return '';
      const honest = ro.n < 120 ? ' <span class="xb" style="--c:var(--amber)">pilot — not yet significant</span>' : '';
      return `<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:8px 10px">
        <b>GW${ro.g}</b> (trained on GW1–${ro.g - 1})<br><span class="muted">correlation r = </span><b>${ro.r == null ? 'n/a' : ro.r}</b>${honest}<br><span class="muted">MAE ${ro.mae == null ? 'n/a' : ro.mae} pts · n=${ro.n} starters</span></div>`;
    }).join('');
    const multi = maxG >= 4 ? `<p class="muted">Rolling backtest active: ${maxG - 1} test GWs now.</p>` : '';
    el.innerHTML = `<div class="card" style="grid-column:1/-1"><h2>🧪 Backtest Lab <span class="muted">— does the model actually predict?</span></h2>
      <p class="hint">Every number here is out-of-sample: a GW${maxG} prediction was built without seeing GW${maxG}. The lab is honest by design — it will happily tell you the model is <b>not</b> yet proven. GW1–3 is a pilot; after each deadline it grows into a real rolling backtest.</p></div>
      ${btCalibTable(res)}
      <div class="card" style="grid-column:1/-1"><h2>⏱️ (B) Rolling GW test <span class="muted">— predict GW g from GWs &lt; g only</span></h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">${rollCards || '<p class="muted">—</p>'}</div>
      ${multi}
            ${btXpCard()}
      <p class="muted" style="margin-top:4px">Caveat: a single GW of "form" is a weak predictor of the next GW (soccer is noisy). A correlation near 0 at this stage is the <b>expected honest result</b>, not a bug — the lab exists to measure it, and each week adds power.</p></div>`;
  } catch (e) { console.error('[backtest]', e); el.innerHTML = ''; }
}

const CMP_COLORS = ['#00ff85', '#4dc3ff', '#c792ea'];

function cmpChartSVG(ps, H) {
  const gw0 = DATA.fplmeta.current_gw + 1;
  const series = ps.map(p => { const v = []; for (let i = 0; i < H; i++) v.push(projP(p, i)); return v; });
  const rawMax = Math.max(...series.flat(), 1);
  const p10 = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const nn = rawMax / p10;
  const ymax = (nn <= 1 ? 1 : nn <= 2 ? 2 : nn <= 2.5 ? 2.5 : nn <= 5 ? 5 : 10) * p10;
  const W = 760, Hpx = 300, PL = 46, PR = 14, PT = 16, PB = 66;
  const X = i => PL + (W - PL - PR) * (H === 1 ? 0.5 : i / (H - 1));
  const Y = v => PT + (Hpx - PT - PB) * (1 - v / ymax);
  let g = '';
  for (let t = 0; t <= 4; t++) {
    const v = ymax * t / 4, y = Y(v);
    g += `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,${t === 0 ? 0.25 : 0.08})" stroke-width="1"/>`;
    g += `<text x="${PL - 7}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#8a93a6">${v.toFixed(1)}</text>`;
  }
  for (let i = 0; i < H; i++) {
    const x = X(i);
    g += `<line x1="${x.toFixed(1)}" y1="${PT}" x2="${x.toFixed(1)}" y2="${Hpx - PB}" stroke="rgba(255,255,255,0.05)"/>`;
    g += `<text x="${x.toFixed(1)}" y="${Hpx - PB + 18}" text-anchor="middle" font-size="12" font-weight="700" fill="#e8ecf4">GW${gw0 + i}</text>`;
    ps.forEach((p, k) => {
      const f = (p.next3 || [])[i];
      g += `<text x="${x.toFixed(1)}" y="${Hpx - PB + 32 + k * 12}" text-anchor="middle" font-size="10.5" fill="${CMP_COLORS[k]}">${f ? `${f.opp}(${f.ha}) ·${f.afdr ?? f.fdr}` : '—'}</text>`;
    });
  }
  const win = [];
  for (let i = 0; i < H; i++) { let bi = 0; series.forEach((s, k) => { if (s[i] > series[bi][i]) bi = k; }); win.push(bi); }
  series.forEach((s, k) => {
    const pts = s.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
    const c = CMP_COLORS[k];
    g += `<polygon points="${PL},${Y(0).toFixed(1)} ${pts} ${X(H - 1).toFixed(1)},${Y(0).toFixed(1)}" fill="${c}" opacity="0.10"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    s.forEach((v, i) => {
      const best = win[i] === k;
      g += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${best ? 5 : 3.5}" fill="#0d1117" stroke="${best ? '#ffd166' : c}" stroke-width="${best ? 3 : 2.5}"><title>${esc(ps[k].name)} GW${gw0 + i}: ${v.toFixed(1)} pts${best ? ' ★ best' : ''}</title></circle>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${Hpx}" style="width:100%;height:auto;display:block;background:rgba(255,255,255,.02);border-radius:10px" role="img"><title>Projected points per gameweek</title>${g}</svg>`;
}

// P2/P3 polish: full next-GW outcome-spread comparison chart (probability, not a point)
function distCompareCard(ps) {
  const bands = [['≤0', '#5a6a85'], ['1–2', '#7a8bb0'], ['3–5', '#e6a23c'], ['6–9', '#4cd964'], ['10+', '#2dd4a7']];
  const rows = ps.map(p => {
    const D = distOf(p);
    const bar = D.prob.map((x, i) =>
      `<div style="flex:${Math.max(1, Math.round(x * 1000))};background:${bands[i][1]};min-width:${x > 0.04 ? 16 : 2}px;height:15px" title="${bands[i][0]}: ${Math.round(x * 100)}%"></div>`).join('');
    const pct = D.prob.map((x, i) =>
      `<span class="tk-opp" style="min-width:58px">${bands[i][0]} <b>${Math.round(x * 100)}%</b></span>`).join('');
    return `<div style="margin:10px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(p.name)}</b>
      <span class="muted">mid ≈ ${D.mean.toFixed(1)} · haul ${Math.round(D.prob[4] * 100)}% · blank ${Math.round(D.prob[0] * 100)}%</span></div>
      <div style="display:flex;gap:2px;height:15px;border-radius:3px;overflow:hidden;margin:5px 0;background:rgba(255,255,255,.06)">${bar}</div>
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap">${pct}</div></div>`;
  }).join('');
  const legend = bands.map(b => `<span style="margin-right:12px"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${b[1]};margin-right:4px;vertical-align:middle"></span>${b[0]} pts</span>`).join('');
  return `<div class="card" style="grid-column:1/-1"><h2>🎲 Next-GW outcome spread <span class="muted">— the probability shape, not a single number</span></h2>
    <div class="muted" style="margin:2px 0 4px">${legend}</div>${rows}
    <p class="muted" style="margin:4px 0 0">Bars always total 100% and the 6–9 + 10+ tails equal P(≥6)/P(≥10). "Mid" = probability-weighted expectation from real GW1-${(DATA.fplmeta && DATA.fplmeta.current_gw) || 3} results. Compare <b>shapes</b>: right-shifted = steady returns + real hauls; squat &amp; low = frequent blanks. Model estimate — not a promise.</p></div>`;
}

function renderCompare() {
  const pick = id => findPlayer(($('#' + id).value || '').toLowerCase());
  const ps = [pick('cmpA'), pick('cmpB'), pick('cmpC')].filter(Boolean);
  const uniq = [...new Map(ps.map(p => [p.id, p])).values()];
  if (uniq.length < 2) { $('#cmpOut').innerHTML = '<p class="hint">Type two player names (autocomplete helps) and hit Compare.</p>'; return; }
  const H = 5, gw0 = DATA.fplmeta.current_gw + 1;
  const totals = uniq.map(p => { let s = 0; for (let i = 0; i < H; i++) s += projP(p, i); return s; });
  const order = uniq.map((p, k) => k).sort((a, b) => totals[b] - totals[a]);
  const wins = uniq.map(() => 0);
  for (let i = 0; i < H; i++) { let bi = 0; uniq.forEach((p, k) => { if (projP(p, i) > projP(uniq[bi], i)) bi = k; }); wins[bi]++; }
  const fdrChip = f => f ? `<span class="fdr f${f.afdr ?? f.fdr}">${f.afdr ?? f.fdr}</span>` : '';
  const heads = uniq.map((p, k) => `
    <div class="ml-rival" style="border-top:3px solid ${CMP_COLORS[k]};min-width:220px">
      <h4><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CMP_COLORS[k]};margin-right:6px"></span>${esc(p.name)} ${posBadge(p.pos)}</h4>
      <div class="gapline">${p.team} · £${p.cost}m · ${p.own}% owned · team form #${formRank(p)}</div>
      <div class="gapline">${p.pts} pts · ${p.g}G ${p.a}A · xG ${p.xg} xA ${p.xa} · ${p.mins}&prime;</div>
      <div class="gapline">Reliability <b>${Math.round(reliab(p) * 100)}%</b> · next-5 <b style="color:${CMP_COLORS[k]}">${totals[k].toFixed(1)}</b> · GW wins <b>${wins[k]}/5</b></div>
      <div class="gapline">🎲 P(≥6) <b style="color:${playerProb(p).p6 >= 40 ? 'var(--green)' : playerProb(p).p6 >= 20 ? 'var(--amber)' : 'var(--red)'}">${playerProb(p).p6}%</b> · P(≥10) <b>${playerProb(p).p10}%</b> · swing ±${playerProb(p).sd.toFixed(1)}/GW <span class="tk-opp">(chance ≠ xPts)</span></div>
      <div style="margin-top:6px">${sparkSVG(p.id, 220, 36)}</div>
    </div>`).join('');
  const gwRows = Array.from({ length: H }, (_, i) => {
    let bi = 0; uniq.forEach((p, k) => { if (projP(p, i) > projP(uniq[bi], i)) bi = k; });
    return `<tr><td><b>GW${gw0 + i}</b></td>` + uniq.map((p, k) => {
      const f = (p.next3 || [])[i];
      return `<td class="num" style="${k === bi ? 'background:rgba(255,209,102,.12);font-weight:700' : ''}">${projP(p, i).toFixed(1)}${k === bi ? ' ★' : ''}<br><span class="tk-opp">${f ? `${f.opp}(${f.ha})` : '—'} ${fdrChip(f)}</span></td>`;
    }).join('') + '</tr>';
  }).join('');
  const METRICS = [
    ['Form', p => p.form || 0, 1, ''], ['ep next', p => p.ep_next || 0, 1, ''],
    ['Season pts', p => p.pts || 0, 0, ''], ['xG + xA', p => (p.xg || 0) + (p.xa || 0), 2, ''],
    ['Minutes', p => p.mins || 0, 0, ''], ['Own %', p => p.own || 0, 1, '%'],
    ['Price', p => p.cost || 0, 1, 'm'], ['Reliability', p => reliab(p) * 100, 0, '%'],
  ];
  const bars = METRICS.map(([label, fn, dec, unit]) => {
    const vals = uniq.map(fn), mx = Math.max(...vals, 0.0001);
    return `<div class="cmp-metric"><div class="cmp-mlabel">${label}</div>` + uniq.map((p, k) => `
      <div class="cmp-mrow"><span class="cmp-mname" style="color:${CMP_COLORS[k]}">${esc(p.name)}</span>
      <div class="cmp-mtrack"><div class="cmp-mfill" style="width:${(100 * vals[k] / mx).toFixed(1)}%;background:${CMP_COLORS[k]}"></div></div>
      <span class="cmp-mval">${vals[k].toFixed(dec)}${unit}</span></div>`).join('') + '</div>';
  }).join('');
  const a = uniq[order[0]], b = uniq[order[1]], edge = totals[order[0]] - totals[order[1]];
  $('#cmpOut').innerHTML = `<div class="ml-grid" style="grid-column:1/-1">${heads}</div>
    <div class="card" style="grid-column:1/-1"><h2>📈 Projected points — next 5 gameweeks</h2>
    <div class="cmp-legend">${uniq.map((p, k) => `<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${CMP_COLORS[k]};margin-right:5px"></span><b>${esc(p.name)}</b> <span class="muted">${totals[k].toFixed(1)} pts</span></span>`).join('')}</div>
    ${cmpChartSVG(uniq, H)}
    <p class="muted" style="margin:6px 0 0">Fixture under each GW (number = difficulty) · gold ring = model's best that week · hover dots for values.</p></div>
    ${distCompareCard(uniq)}
    <div class="card" style="grid-column:1/-1"><h2>📆 Gameweek breakdown <span class="muted">— ★ = model's pick each week</span></h2>
    <div style="overflow-x:auto"><table class="data"><tr><th></th>${uniq.map((p, k) => `<th class="num"><span style="color:${CMP_COLORS[k]}">●</span> ${esc(p.name)}</th>`).join('')}</tr>
    ${gwRows}<tr><td><b>Total</b></td>${uniq.map((p, k) => `<td class="num"><b style="color:${CMP_COLORS[k]}">${totals[k].toFixed(1)}</b></td>`).join('')}</tr></table></div></div>
    <div class="card" style="grid-column:1/-1"><h2>📊 Head-to-head numbers</h2><div class="cmp-metrics">${bars}</div></div>
    <div class="card" style="grid-column:1/-1"><h2>🤖 Verdict</h2>
    <p><b style="color:${CMP_COLORS[order[0]]}">${esc(a.name)}</b> by <b>+${edge.toFixed(1)}</b> projected pts over the next 5 (${totals[order[0]].toFixed(1)} vs ${totals[order[1]].toFixed(1)}), winning <b>${wins[order[0]]}/5</b> gameweeks on fixtures × form × reliability.</p>
    <p class="muted">${reliab(a) >= reliab(b) ? `${esc(a.name)}'s returns are also more reliable (${Math.round(reliab(a) * 100)}% vs ${Math.round(reliab(b) * 100)}%) — underlying xGI backs the output.` : `Note: ${esc(b.name)} is the more reliable pick (${Math.round(reliab(b) * 100)}% vs ${Math.round(reliab(a) * 100)}%) — ${esc(a.name)}'s edge leans on fixtures; weigh floor vs ceiling.`}${ML.ready ? ` Mini-league: ${ML.ownCount(a)}/${ML.n} rivals own ${esc(a.name)} vs ${ML.ownCount(b)}/${ML.n} for ${esc(b.name)}.` : ''}</p>
    <p class="muted">P(≥6) / P(≥10) chips answer "how likely is a return/haul?" — calibrated from real GW1-${DATA.fplmeta ? DATA.fplmeta.current_gw : 3} results (league base rate by position blended with each player's own record). A probability is not a point prediction.</p></div>`;
}


