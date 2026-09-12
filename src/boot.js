$$('.tab').forEach(t => t.onclick = () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.panel').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('#' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'wildcard') renderWildcard();
  if (t.dataset.tab === 'freehit') renderFreeHit();
  if (t.dataset.tab === 'xint') renderElite();
  if (t.dataset.tab === 'planner') renderBacktest();
});
$('#search').oninput = renderPlayers;
$('#min90').onchange = renderPlayers;
$('#loadTeam').onclick = loadMyTeam;
$('#teamId').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadMyTeam(); });
// proxy URL (saved in browser localStorage)
const savedProxy = localStorage.getItem('fplProxy') || '';
if (savedProxy) $('#proxyUrl').value = savedProxy;
$('#saveProxy').onclick = () => {
  const v = $('#proxyUrl').value.trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//.test(v)) { $('#proxyStatus').textContent = 'URL must start with https://'; return; }
  if (v) localStorage.setItem('fplProxy', v); else localStorage.removeItem('fplProxy');
  $('#proxyStatus').textContent = v ? 'Saved ✓ — now try Load My Team' : 'Cleared';
};
$$('#posChips .chip').forEach(c => c.onclick = () => {
  $$('#posChips .chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  filterPos = c.dataset.pos;
  renderPlayers();
});

load();


// Elite desk (natural language)
function eliteAnswer(q) {
  const out = $('#xintOut');
  try {
    const ans = (typeof eliteAsk === 'function' && DATA.elite && (DATA.elite.elites || []).length) ? eliteAsk(q) : null;
    if (ans) { out.innerHTML = ans; out.classList.add('show'); }
    else { out.innerHTML = 'That needs the ⚖️ Compare / My Team tools or a player name. I answer from real elite data: buying/selling, captaincy, differentials, the template, my team vs elites, risks and top signals.'; out.classList.add('show'); }
  } catch (e) { out.innerHTML = '⚠️ ' + esc(e.message || e); out.classList.add('show'); }
}
(function wireElite() {
  const q = $('#xintQ'), btn = $('#xintAsk');
  if (!q || !btn) return;
  const ask = () => { const v = q.value.trim(); if (v) { eliteAnswer(v); q.value = ''; } };
  btn.onclick = ask;
  q.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
  document.querySelectorAll('#xintQs .chip').forEach(c => { c.onclick = () => eliteAnswer(c.textContent); });
})();
