// ============ 🧩 CROSS-SURFACE RECONCILIATION (v47) ============
// One model, two questions: the Wildcard builds a 3/5-GW squad inside a £100m
// budget (price efficiency + horizon matter); the Free Hit maximizes ONE week
// at full budget (single-GW ceiling is everything). The same player can be
// right for one and wrong for the other — Ødegaard was the case that made a
// user ask. This module computes EVERY conflict between the two surfaces and
// writes its reason in plain words, so the app explains itself instead of
// looking contradictory. Deterministic: same data, same reasons, every time.
function recFxIndex(p, gw) {
  const n = p.next3 || [];
  for (let i = 0; i < n.length; i++) if (n[i] && n[i].gw === gw) return i;
  return -1;
}
function recPosRank(p, gw) {
  const i = recFxIndex(p, gw); if (i < 0) return null;
  const xp = Math.max(0, projP(p, i));
  let rank = 1;
  (DATA.players || []).forEach(q => {
    if (q.pos !== p.pos || q.id === p.id) return;
    if (q.status === 'i' || q.status === 's') return;
    const j = recFxIndex(q, gw); if (j < 0) return;
    if (Math.max(0, projP(q, j)) > xp) rank++;
  });
  return { rank, xp: Math.round(xp * 100) / 100, i };
}
// The full conflict set between the Wildcard 15 and the Free Hit squads.
function reconcileSet() {
  try {
    if (typeof WC === 'undefined' || !WC) buildWildcard();
    if (!WC) return null;
    const P = (typeof freeHitPlan === 'function') ? freeHitPlan() : null;
    if (!P || !P.gws) return null;
    const gwks = P.gws.filter(g => !g.error && g.squad);
    if (!gwks.length) return null;
    const wc15 = Object.values(WC.pick).flat();
    const wcOnly = [], fhOnly = [];
    let both = 0;

    // ---- Wildcard picks the Free Hit does not want (per week, with reasons) ----
    wc15.forEach(p => {
      const inSquads = gwks.filter(g => g.squad.some(r => r.p.id === p.id));
      if (inSquads.length) { both++; return; }
      // his best FH week = where he ranks highest at his position
      let best = null;
      gwks.forEach(g => {
        const r = recPosRank(p, g.gw);
        if (r && (!best || r.rank < best.rank || (r.rank === best.rank && r.xp > best.xp))) best = Object.assign({ gw: g.gw }, r);
      });
      if (!best) return;
      const g = gwks.find(x => x.gw === best.gw);
      const ahead = g.starters.filter(r => r.p.pos === p.pos)
        .map(r => ({ name: r.p.name, xp: Math.round(r.xp * 100) / 100 })).sort((a, b) => b.xp - a.xp);
      const clubCount = g.squad.filter(r => r.p.team === p.team).length;
      const ps = (typeof pScore === 'function') ? Math.round(pScore(p) * 10) / 10 : null;
      wcOnly.push({
        name: p.name, pos: p.pos, team: p.team, price: p.cost, pScore: ps,
        bestGw: best.gw, xp: best.xp, rank: best.rank, ahead, clubBlock: clubCount >= 3, clubCount,
      });
    });
    wcOnly.sort((a, b) => a.rank - b.rank || b.xp - a.xp);

    // ---- Free Hit starters (best GW) the Wildcard skips ----
    const bestGw = gwks.find(g => g.gw === P.best.gw) || gwks[0];
    const wcIds = new Set(wc15.map(p => p.id));
    bestGw.starters.forEach(r => {
      if (wcIds.has(r.p.id)) return;
      const ps = (typeof pScore === 'function') ? Math.round(pScore(r.p) * 10) / 10 : null;
      const wcPos = (WC.pick[r.p.pos] || []).map(p => p.name + ' £' + p.cost + 'm').join(', ');
      fhOnly.push({
        name: r.p.name, pos: r.p.pos, team: r.p.team, price: r.p.cost, pScore: ps,
        gw: bestGw.gw, xp: Math.round(r.xp * 100) / 100, wcPos,
      });
    });
    fhOnly.sort((a, b) => b.xp - a.xp);

    return { wcOnly, fhOnly, both, bestGw: bestGw.gw, horizon: (typeof WC_H !== 'undefined' ? WC_H : 3), wcSpent: WC.spent };
  } catch (e) {
    console.error('[RECONCILE]', e);
    return null;
  }
}
function renderReconcile(targetId) {
  const el = (typeof $ === 'function') ? $('#' + String(targetId).replace(/^#/, '')) : null;
  if (!el) return;
  const R = reconcileSet();
  if (!R) { el.innerHTML = '<div class="card"><h2>🧩 Wildcard vs Free Hit — cross-check</h2><p class="hint">The comparison needs both engines to finish computing — refresh the tab.</p></div>'; return; }
  const wcOnlyHtml = R.wcOnly.map(r => {
    const aheadTxt = r.ahead.length ? 'that week the Free Hit starts ' + r.ahead.map(a => esc(a.name) + ' (' + a.xp + ')').join(', ') : '';
    return '<div class="mrow" style="margin:6px 0;padding:6px 10px;background:rgba(255,255,255,.03);border-radius:8px">'
      + '<b>' + esc(r.name) + '</b> <span class="team-tag">' + r.pos + ' · ' + r.team + ' · £' + r.price + 'm</span> — '
      + 'his best Free Hit week is <b>GW' + r.bestGw + '</b>: ' + r.xp + ' xP, <b>#' + r.rank + ' ' + r.pos + '</b>. ' + aheadTxt
      + (r.clubBlock ? ' Club quota full in that squad.' : '')
      + '<br><span class="muted">Why the Wildcard still wants him: ' + r.pScore + ' pScore over ' + R.horizon + ' GWs at £' + r.price + 'm — horizon + price efficiency, the two things a one-week squad never pays for.</span></div>';
  }).join('');
  const fhOnlyHtml = R.fhOnly.map(r => '<div class="mrow" style="margin:6px 0;padding:6px 10px;background:rgba(255,255,255,.03);border-radius:8px">'
    + '<b>' + esc(r.name) + '</b> <span class="team-tag">' + r.pos + ' · ' + r.team + ' · £' + r.price + 'm</span> — '
    + 'GW' + r.gw + ' alone: ' + r.xp + ' xP, the one-week ceiling the Free Hit pays up for.'
    + '<br><span class="muted">Why the Wildcard skips him: ' + r.pScore + ' pScore over ' + R.horizon + ' GWs at £' + r.price + 'm lost the budget race — the Wildcard’s ' + r.pos + 's are ' + esc(r.wcPos) + ' to fit £' + (R.wcSpent || 0).toFixed(1) + 'm of £100m.</span></div>').join('');
  el.innerHTML = '<div class="card"><h2>🧩 Wildcard vs Free Hit — why they disagree</h2>'
    + '<p class="hint">Same model, two questions: the Free Hit maximizes <b>one week</b> (GW' + R.bestGw + ' is its best week), the Wildcard builds a <b>' + R.horizon + '-GW squad inside £100m</b>. They share ' + R.both + ' of the Wildcard’s 15 — the disagreements below are the point, not a bug. Every reason is computed live.</p>'
    + (R.wcOnly.length ? '<h3 style="margin:10px 0 4px">In the Wildcard, not in any Free Hit squad</h3>' + wcOnlyHtml : '<p class="hint">No Wildcard-only players this window — the two surfaces fully agree.</p>')
    + (R.fhOnly.length ? '<h3 style="margin:12px 0 4px">In the Free Hit XI, skipped by the Wildcard</h3>' + fhOnlyHtml : '')
    + '</div>';
}
