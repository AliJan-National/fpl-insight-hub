// ============ 🧭 CHANNEL MODEL (v2.0 Phase 5a) — pitch-zone intelligence ============
// Real shot locations from the data repo (api/channels.json): every team's
// attack/defence lateral profile + every player's lateral position, from real
// GW shots in attacking-view coordinates (y 0-100; validated: Mbeumo avg y
// 62.8 = right wing, Haaland 47.7 = centre). Channels: L = y<40, C = 40-60,
// R = >60. Team shares are xG-weighted, shrunk to the league profile.
// ⚠️ BESIDE PRODUCTION: analysis, cards and assistant answers only. It joins
// the xP spine ONLY after the Phase 8 A/B gate proves it beats the channel-
// blind baseline on frozen snapshots. No exceptions to the audit rule.
const CH_MEMO = {};
function chanLeague() {
  const c = (typeof DATA !== 'undefined' && DATA.channels) || null;
  return c ? c.league : null;
}
function chanTeam(short) {
  const c = (typeof DATA !== 'undefined' && DATA.channels) || null;
  if (!c || !c.teams || !short) return null;
  if (CH_MEMO['t|' + short] !== undefined) return CH_MEMO['t|' + short];
  const t = c.teams[short] || null;
  CH_MEMO['t|' + short] = t;
  return t;
}
function chanPlayer(p) {
  const c = (typeof DATA !== 'undefined' && DATA.channels) || null;
  if (!c || !c.players || !p) return { side: 'C', n: 0, conf: 0, known: false };
  const r = c.players[String(p.id)];
  if (!r) return { side: 'C', n: 0, conf: 0, known: false };
  return { side: r.side, n: r.n, conf: r.conf, y: r.y, sd: r.sd, known: true };
}
// The mismatch: an attacker playing down a channel the opponent concedes from
// at an unusual rate. Returns null for central / low-confidence / no-fixture
// players (central is the default — its ratio sits near 1 by construction).
function channelEdge(p, i) {
  try {
    if (!p || (p.pos !== 'MID' && p.pos !== 'FWD')) return null;
    const cp = chanPlayer(p);
    if (!cp.known || cp.conf < 0.4 || cp.side === 'C') return null;
    const f = (p.next3 || [])[i == null ? 0 : i];
    if (!f || !f.opp) return null;
    const opp = chanTeam(f.opp);
    const lg = chanLeague();
    if (!opp || !lg) return null;
    const idx = cp.side === 'L' ? 0 : 2;
    const share = opp.def.share[idx], base = lg.def[idx];
    if (!base) return null;
    const ratio = share / base;
    const mult = Math.max(0.92, Math.min(1.10, 1 + 0.12 * (ratio - 1)));  // suggested magnitude, pending the Phase 8 backtest
    return {
      side: cp.side, opp: f.opp, gw: f.gw, ratio: Math.round(ratio * 100) / 100,
      share: Math.round(share * 1000) / 1000, base: Math.round(base * 1000) / 1000,
      mult: Math.round(mult * 1000) / 1000, n: cp.n, y: cp.y,
      boost: ratio >= 1.2, damp: ratio <= 0.8,
    };
  } catch (e) { return null; }
}
// scout-card line (shown only when the mismatch is material — no noise)
function chanLine(p, i) {
  const e = channelEdge(p, i == null ? 0 : i);
  if (!e || (!e.boost && !e.damp)) return '';
  const dir = e.boost
    ? '✅ plays down the ' + (e.side === 'L' ? 'LEFT' : 'RIGHT') + ' — ' + esc(e.opp) + ' concede ' + e.ratio.toFixed(2) + '× the league rate from that channel (' + Math.round(100 * e.share) + '% of their xG vs ' + Math.round(100 * e.base) + '% league)'
    : '⚠️ his ' + (e.side === 'L' ? 'left' : 'right') + '-channel route meets ' + esc(e.opp) + '’s stingiest zone (' + e.ratio.toFixed(2) + '× league rate)';
  return '<div style="display:flex;justify-content:space-between"><span class="muted" title="Phase 5a channel model: real shot locations, xG-weighted, shrunk">🧭 flank matchup</span><b style="color:' + (e.boost ? 'var(--green)' : 'var(--amber)') + '">' + dir + '</b></div>';
}
// the biggest flank mismatches of the next GW (assistant + card headline)
function chanTopEdges(i, limit) {
  const out = [];
  (DATA.players || []).forEach(p => {
    const e = channelEdge(p, i == null ? 0 : i);
    if (!e || !e.boost) return;
    let xp = 0; try { xp = Math.max(0, projP(p, i == null ? 0 : i)); } catch (err) { return; }
    if (xp < 3) return;
    out.push({ p, xp: Math.round(xp * 10) / 10, e });
  });
  out.sort((a, b) => (b.e.ratio * b.xp) - (a.e.ratio * a.xp));
  return out.slice(0, limit || 6);
}
function channelCardHtml() {
  const c = (typeof DATA !== 'undefined' && DATA.channels) || null;
  if (!c || !c.teams) return '';
  const lg = c.league.def;
  const short2name = {};
  (DATA.teams || []).forEach(t => { short2name[t.short] = t.name; });
  const bar = (share, max, color, label) => {
    const h = Math.max(4, Math.round(34 * share / (max || 1)));
    return '<div style="display:inline-block;width:34px;vertical-align:bottom;text-align:center;margin:0 2px" title="' + esc(label) + '">'
      + '<div style="height:34px;display:flex;align-items:flex-end;justify-content:center"><div style="width:22px;height:' + h + 'px;background:' + color + ';border-radius:3px 3px 0 0;opacity:.9"></div></div>'
      + '<div style="font-size:9px;color:var(--muted)">' + Math.round(100 * share) + '%</div></div>';
  };
  const rows = Object.keys(c.teams).sort().map(short => {
    const t = c.teams[short];
    const amax = Math.max(t.att.share[0], t.att.share[1], t.att.share[2]);
    const dmax = Math.max(t.def.share[0], t.def.share[1], t.def.share[2]);
    const dL = t.def.share[0] / lg[0], dC = t.def.share[1] / lg[1], dR = t.def.share[2] / lg[2];
    const hot = [dL, dC, dR].map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r)[0];
    const hotTxt = ['left', 'centre', 'right'][hot.i];
    return '<div class="mrow" style="margin:4px 0;padding:6px 10px;background:rgba(255,255,255,.03);border-radius:8px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center"><b>' + esc(short) + '</b>'
      + '<span class="muted" style="font-size:10px">leakiest: ' + hotTxt + ' (' + hot.r.toFixed(2) + '× league)</span></div>'
      + '<div style="margin-top:4px"><span class="muted" style="font-size:10px">attack xG share</span> '
      + bar(t.att.share[0], amax, 'var(--green)', 'left channel: ' + Math.round(100 * t.att.share[0]) + '% of xG')
      + bar(t.att.share[1], amax, 'var(--green)', 'central: ' + Math.round(100 * t.att.share[1]) + '%')
      + bar(t.att.share[2], amax, 'var(--green)', 'right channel: ' + Math.round(100 * t.att.share[2]) + '%')
      + ' <span class="muted" style="font-size:10px;margin-left:8px">defence xG faced</span> '
      + bar(t.def.share[0], dmax, dL >= 1.2 ? 'var(--red)' : 'var(--amber)', 'concede left: ' + Math.round(100 * t.def.share[0]) + '% ('
        + dL.toFixed(2) + '× league)')
      + bar(t.def.share[1], dmax, dC >= 1.2 ? 'var(--red)' : 'var(--amber)', 'concede centre: ' + Math.round(100 * t.def.share[1]) + '% (' + dC.toFixed(2) + '× league)')
      + bar(t.def.share[2], dmax, dR >= 1.2 ? 'var(--red)' : 'var(--amber)', 'concede right: ' + Math.round(100 * t.def.share[2]) + '% (' + dR.toFixed(2) + '× league)')
      + '</div></div>';
  }).join('');
  const top = chanTopEdges(0, 5);
  const topTxt = top.length
    ? top.map(x => '<b>' + esc(x.p.name) + '</b> (' + x.p.team + ', ' + x.e.side + '-sided) vs ' + esc(x.e.opp) + ' — ' + x.e.ratio.toFixed(2) + '× league rate from his channel, ' + x.xp + ' xP').join('<br>')
    : 'No material flank mismatches in the next GW yet.';
  return '<div class="card" style="grid-column:1/-1;margin-top:16px"><h2>🧭 Channel model <span class="muted">— where every team creates and concedes (real shot locations, GW1-' + ((DATA.fplmeta && DATA.fplmeta.current_gw) || 0) + ')</span></h2>'
    + '<p class="muted" style="margin:0 0 8px">Attack bars: share of the team’s own xG by channel (left/centre/right, attacking view). Defence bars: share of xG <b>conceded</b> by channel — red means they leak there at ≥1.2× the league rate. Suggested read for transfers: a <b>left-sided attacker</b> targets a team leaking its <b>left-channel</b> (that is the defence’s right side).</p>'
    + '<div style="max-height:520px;overflow-y:auto">' + rows + '</div>'
    + '<h3 style="margin:10px 0 4px">Biggest flank mismatches next GW</h3><p style="margin:0">' + topTxt + '</p>'
    + '<p class="muted" style="margin:8px 0 0">Phase 5a — analysis only, <b>not yet in the xP spine</b>: this joins the model only after the Phase 8 backtest proves it beats the channel-blind baseline. ' + c.meta.shots + ' real shots, shrunk to the league profile (K=' + c.meta.k + ').</p></div>';
}
