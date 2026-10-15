import { GitHubAPI } from './api.js';
import {
  state, save, uid, activeBoard, prMeta, setPrMeta, isSnoozed,
  exportConfig, importConfig, resetConfig,
} from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
};

let api = null;
let me = null;
let refreshTimer = null;
const results = new Map(); // id colonne → { items, total, error, loading }

/* ---------- Utilitaires ---------- */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setStatus(msg) { $('#statusText').textContent = msg; }

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(iso) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return 'à l’instant';
}

function labelStyle(hex) {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
  return `background:#${hex};color:${light ? '#1f2328' : '#fff'}`;
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = t;
}

function updateRate() {
  if (!api) return;
  const { core, search } = api.rate;
  const parts = [];
  if (core) parts.push(`API ${core.remaining}/${core.limit}`);
  if (search) parts.push(`Recherche ${search.remaining}/${search.limit}`);
  $('#rateText').textContent = parts.join(' · ');
}

/* ---------- Authentification ---------- */

async function login(token) {
  const client = new GitHubAPI(token);
  me = await client.getUser();
  api = client;
  state.token = token;
  save();
  const av = $('#avatar');
  av.src = me.avatar_url;
  av.title = `Connecté : ${me.login}`;
  av.classList.remove('hidden');
  $('#login').classList.add('hidden');
  $('#board').classList.remove('hidden');
  renderTabs();
  await refreshAll();
  scheduleRefresh();
}

function logout() {
  state.token = '';
  save();
  api = null; me = null;
  clearInterval(refreshTimer);
  $('#avatar').classList.add('hidden');
  $('#board').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#boardTabs').replaceChildren();
  setStatus('Déconnecté');
  $('#rateText').textContent = '';
}

/* ---------- Données ---------- */

async function loadColumn(col) {
  results.set(col.id, { ...(results.get(col.id) || {}), loading: true, error: null });
  try {
    const { items, total } = await api.searchPRs(col.query, { sort: col.sort, limit: col.limit });
    results.set(col.id, { items, total, error: null, loading: false });
    detectNew(col, items);
  } catch (err) {
    results.set(col.id, { items: [], total: 0, error: err.message, loading: false });
  }
  updateRate();
}

function detectNew(col, items) {
  const prev = state.seen[col.id];
  const keys = items.map((i) => i.key);
  const fresh = prev ? items.filter((i) => !prev.includes(i.key)) : [];
  for (const i of items) i.isNew = fresh.includes(i);
  state.seen[col.id] = keys;
  save();
  if (col.notify && fresh.length && 'Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(`${col.name} : ${fresh.length} nouvelle(s) PR`, {
      body: fresh.slice(0, 3).map((i) => `${i.repo}#${i.number} ${i.title}`).join('\n'),
      tag: col.id,
    });
    n.onclick = () => { window.focus(); if (fresh.length === 1) window.open(fresh[0].url, '_blank'); };
  }
}

async function refreshAll() {
  if (!api) return;
  const board = activeBoard();
  const btn = $('#refreshBtn');
  btn.classList.add('spinning');
  setStatus('Chargement…');
  renderBoard();
  await Promise.all(board.columns.map(loadColumn));
  btn.classList.remove('spinning');
  renderBoard();
  setStatus(`Mis à jour ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`);
  if (state.settings.details) loadDetails();
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  const s = Number(state.settings.refresh);
  if (s > 0) refreshTimer = setInterval(() => { if (!document.hidden) refreshAll(); }, s * 1000);
}

/** Charge CI / reviews / diff pour les cartes visibles, 4 requêtes en parallèle max. */
async function loadDetails() {
  const cards = [...document.querySelectorAll('.card[data-key]')];
  const seen = new Set();
  const queue = [];
  for (const card of cards) {
    const pr = card._pr;
    if (!pr || seen.has(pr.key) || pr.state !== 'open') continue;
    seen.add(pr.key);
    queue.push(pr);
  }
  const worker = async () => {
    while (queue.length) {
      const pr = queue.shift();
      try {
        const d = await api.getDetails(pr);
        document.querySelectorAll(`.card[data-key="${CSS.escape(pr.key)}"] .details`).forEach((n) => n.replaceWith(detailsNode(d)));
      } catch { /* non bloquant */ }
      updateRate();
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

/* ---------- Rendu ---------- */

function renderTabs() {
  const nav = $('#boardTabs');
  nav.replaceChildren(...state.boards.map((b) =>
    el('button', {
      class: b.id === state.activeBoard ? 'active' : '',
      onclick: () => { state.activeBoard = b.id; save(); renderTabs(); refreshAll(); },
    }, b.name),
  ));
}

function matchesFilter(pr, meta, filter) {
  if (!filter) return true;
  return filter.split(/\s+/).every((term) => {
    if (term.startsWith('#') && term.length > 1) {
      const t = term.slice(1);
      return (meta.tags || []).some((x) => x.toLowerCase().includes(t)) || pr.labels.some((l) => l.name.toLowerCase().includes(t));
    }
    const hay = `${pr.title} ${pr.owner}/${pr.repo} ${pr.author?.login || ''} ${pr.labels.map((l) => l.name).join(' ')} ${(meta.tags || []).join(' ')} ${meta.note || ''}`.toLowerCase();
    return hay.includes(term);
  });
}

const PRIO = { high: 0, medium: 1, low: 2 };

function renderBoard() {
  const board = activeBoard();
  const root = $('#board');
  root.classList.toggle('compact', !!state.settings.compact);
  const filter = $('#filterInput').value.trim().toLowerCase();
  const showHidden = $('#showHidden').checked;

  const columns = board.columns.map((col) => {
    const res = results.get(col.id) || { items: [], loading: true };
    let items = res.items
      .map((pr, idx) => ({ pr, meta: prMeta(pr.key), idx }))
      .filter(({ pr, meta }) => matchesFilter(pr, meta, filter))
      .filter(({ meta }) => showHidden || (!meta.hidden && !isSnoozed(meta)));
    items.sort((a, b) =>
      (b.meta.pinned ? 1 : 0) - (a.meta.pinned ? 1 : 0)
      || (PRIO[a.meta.priority] ?? 3) - (PRIO[b.meta.priority] ?? 3)
      || a.idx - b.idx);

    let body;
    if (res.error) body = el('div', { class: 'column-error' }, res.error);
    else if (res.loading && !res.items.length) body = el('div', { class: 'column-empty' }, 'Chargement…');
    else if (!items.length) body = el('div', { class: 'column-empty' }, res.items.length ? 'Tout est filtré ou masqué' : 'Aucune PR 🎉');
    else body = items.map(({ pr, meta }) => cardNode(pr, meta));

    const hiddenCount = res.items.length - items.length;
    return el('section', {
      class: 'column', style: `--col:${col.color}`, dataset: { id: col.id },
      ondragover: (e) => { if (dragCol) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('drag-over'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); moveColumn(dragCol, col.id); },
    },
    el('div', {
      class: 'column-head', draggable: 'true', title: col.query,
      ondragstart: () => { dragCol = col.id; },
      ondragend: () => { dragCol = null; },
    },
    el('h3', {}, col.name),
    el('span', { class: 'count', title: hiddenCount > 0 ? `${hiddenCount} filtrée(s)/masquée(s)` : '' },
      res.total > res.items.length ? `${items.length}/${res.total}` : String(items.length)),
    el('button', { class: 'btn icon', title: 'Ouvrir la recherche sur GitHub', onclick: () => window.open(`https://github.com/pulls?q=${encodeURIComponent(/\bis:pr\b/.test(col.query) ? col.query : 'is:pr ' + col.query)}`, '_blank') }, '↗'),
    el('button', { class: 'btn icon', title: 'Modifier la colonne', onclick: () => editColumn(col) }, '✎'),
    ),
    el('div', { class: 'column-body' }, body),
    );
  });

  columns.push(el('button', { class: 'add-column', onclick: () => editColumn(null) }, '+ Ajouter une colonne'));
  root.replaceChildren(...columns);
}

let dragCol = null;
function moveColumn(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const cols = activeBoard().columns;
  const from = cols.findIndex((c) => c.id === fromId);
  const [moved] = cols.splice(from, 1);
  cols.splice(cols.findIndex((c) => c.id === toId), 0, moved);
  save();
  renderBoard();
  if (state.settings.details) loadDetails();
}

function cardNode(pr, meta) {
  const snoozed = isSnoozed(meta);
  const classes = ['card'];
  if (meta.pinned) classes.push('pinned');
  if (meta.priority) classes.push(`prio-${meta.priority}`);
  if (meta.hidden || snoozed) classes.push('dimmed');
  if (pr.isNew) classes.push('is-new');

  const cached = api.detailsCache.get(`${pr.key}@${pr.updatedAt}`);
  const details = el('div', { class: 'card-meta details' });

  const node = el('article', { class: classes.join(' '), dataset: { key: pr.key } },
    el('div', { class: 'card-top' },
      el('span', { class: 'repo' }, `${pr.owner}/${pr.repo} #${pr.number}`),
      el('div', { class: 'card-actions' },
        el('button', { class: 'btn icon', title: meta.pinned ? 'Désépingler' : 'Épingler', onclick: () => { setPrMeta(pr.key, { pinned: !meta.pinned }); renderAndDetails(); } }, meta.pinned ? '★' : '☆'),
        el('button', { class: 'btn icon', title: 'Notes, tags, priorité, snooze', onclick: () => editPr(pr) }, '✎'),
        el('button', { class: 'btn icon', title: meta.hidden ? 'Réafficher' : 'Masquer', onclick: () => { setPrMeta(pr.key, { hidden: !meta.hidden }); renderAndDetails(); toast(meta.hidden ? 'PR réaffichée' : 'PR masquée'); } }, meta.hidden ? '◉' : '⊘'),
      ),
    ),
    el('a', { class: 'card-title', href: pr.url, target: '_blank', rel: 'noopener' }, pr.title),
    el('div', { class: 'card-meta' },
      pr.author && el('span', {}, el('img', { src: pr.author.avatar + '&s=32', alt: '', loading: 'lazy' }), ' ', pr.author.login),
      el('span', { title: new Date(pr.updatedAt).toLocaleString('fr-FR') }, ago(pr.updatedAt)),
      pr.comments ? el('span', { title: 'Commentaires' }, `💬 ${pr.comments}`) : null,
      pr.draft && el('span', { class: 'badge draft' }, 'Brouillon'),
      pr.state === 'merged' && el('span', { class: 'badge ok' }, 'Mergée'),
      pr.state === 'closed' && el('span', { class: 'badge ko' }, 'Fermée'),
      snoozed && el('span', { class: 'badge wait', title: 'Snooze' }, `⏰ ${new Date(meta.snoozeUntil).toLocaleDateString('fr-FR')}`),
    ),
    (pr.labels.length || meta.tags?.length) && el('div', { class: 'labels' },
      pr.labels.map((l) => el('span', { class: 'label', style: labelStyle(l.color) }, l.name)),
      (meta.tags || []).map((t) => el('span', { class: 'tag' }, `#${t}`)),
    ),
    meta.note && el('div', { class: 'note' }, meta.note),
    state.settings.details && pr.state === 'open' ? details : null,
  );
  node._pr = pr;
  if (cached) cached.then((d) => node.querySelector('.details')?.replaceWith(detailsNode(d))).catch(() => {});
  return node;
}

function detailsNode(d) {
  const ci = { success: ['ok', '✓ CI'], failure: ['ko', '✗ CI'], pending: ['wait', '● CI'], none: [null, null] }[d.ci];
  const rv = { approved: ['ok', '✓ Approuvée'], changes: ['ko', '✗ Changements demandés'], pending: ['wait', 'Review en attente'] }[d.review];
  return el('div', { class: 'card-meta details' },
    ci[1] && el('span', { class: `badge ${ci[0]}` }, ci[1]),
    el('span', { class: `badge ${rv[0]}` }, rv[1]),
    d.mergeableState === 'dirty' && el('span', { class: 'badge ko', title: 'Conflits avec la branche cible' }, 'Conflits'),
    el('span', { class: 'diff', title: `${d.changedFiles} fichier(s)` },
      el('span', { class: 'add' }, `+${d.additions}`), ' ', el('span', { class: 'del' }, `−${d.deletions}`)),
    d.requestedReviewers.length ? el('span', { title: 'Relecteurs demandés' }, `👀 ${d.requestedReviewers.join(', ')}`) : null,
  );
}

function renderAndDetails() {
  renderBoard();
  if (state.settings.details) loadDetails();
}

/* ---------- Dialogues ---------- */

function editColumn(col) {
  const dlg = $('#columnDialog');
  const f = dlg.querySelector('form');
  $('#columnDialogTitle').textContent = col ? 'Modifier la colonne' : 'Nouvelle colonne';
  f.name.value = col?.name || '';
  f.query.value = col?.query || 'is:open ';
  f.color.value = col?.color || '#8957e5';
  f.sort.value = col?.sort || 'updated';
  f.limit.value = col?.limit || 30;
  f.notify.checked = !!col?.notify;
  $('#columnDelete').classList.toggle('hidden', !col);
  $('#columnDelete').onclick = () => {
    if (!confirmAction(`Supprimer la colonne « ${col.name} » ?`)) return;
    const b = activeBoard();
    b.columns = b.columns.filter((c) => c.id !== col.id);
    delete state.seen[col.id];
    save();
    dlg.close('deleted');
    renderBoard();
  };
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    const data = {
      name: f.name.value.trim(),
      query: f.query.value.trim(),
      color: f.color.value,
      sort: f.sort.value,
      limit: Math.min(100, Math.max(5, Number(f.limit.value) || 30)),
      notify: f.notify.checked,
    };
    if (data.notify && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    let target = col;
    if (col) Object.assign(col, data);
    else { target = { id: uid(), ...data }; activeBoard().columns.push(target); }
    save();
    renderBoard();
    await loadColumn(target);
    renderAndDetails();
  };
  dlg.returnValue = '';
  dlg.showModal();
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function editPr(pr) {
  const dlg = $('#prDialog');
  const f = dlg.querySelector('form');
  const meta = prMeta(pr.key);
  $('#prDialogTitle').textContent = pr.title;
  $('#prDialogSub').textContent = `${pr.owner}/${pr.repo} #${pr.number}`;
  f.tags.value = (meta.tags || []).join(', ');
  f.priority.value = meta.priority || '';
  f.note.value = meta.note || '';
  f.snooze.value = isSnoozed(meta) ? toLocalInput(meta.snoozeUntil) : '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    setPrMeta(pr.key, {
      tags: f.tags.value.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
      priority: f.priority.value,
      note: f.note.value.trim(),
      snoozeUntil: f.snooze.value ? new Date(f.snooze.value).toISOString() : '',
    });
    renderAndDetails();
  };
  dlg.returnValue = '';
  dlg.showModal();
}

function confirmAction(msg) {
  return window.confirm(msg);
}

function openSettings() {
  const dlg = $('#settingsDialog');
  const f = dlg.querySelector('form');
  f.refresh.value = String(state.settings.refresh);
  f.theme.value = state.settings.theme;
  f.details.checked = !!state.settings.details;
  f.compact.checked = !!state.settings.compact;
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    state.settings = {
      ...state.settings,
      refresh: Number(f.refresh.value),
      theme: f.theme.value,
      details: f.details.checked,
      compact: f.compact.checked,
    };
    save();
    applyTheme();
    scheduleRefresh();
    renderAndDetails();
  };
  dlg.returnValue = '';
  dlg.showModal();
}

function bindSettingsButtons() {
  $('#addBoardBtn').onclick = () => {
    const name = prompt('Nom du nouveau tableau ?');
    if (!name?.trim()) return;
    const b = { id: uid(), name: name.trim(), columns: [] };
    state.boards.push(b);
    state.activeBoard = b.id;
    save();
    $('#settingsDialog').close();
    renderTabs();
    refreshAll();
  };
  $('#renameBoardBtn').onclick = () => {
    const b = activeBoard();
    const name = prompt('Nouveau nom du tableau ?', b.name);
    if (!name?.trim()) return;
    b.name = name.trim();
    save();
    renderTabs();
  };
  $('#deleteBoardBtn').onclick = () => {
    if (state.boards.length <= 1) return toast('Il faut garder au moins un tableau.');
    const b = activeBoard();
    if (!confirmAction(`Supprimer le tableau « ${b.name} » et ses colonnes ?`)) return;
    state.boards = state.boards.filter((x) => x.id !== b.id);
    state.activeBoard = state.boards[0].id;
    save();
    $('#settingsDialog').close();
    renderTabs();
    refreshAll();
  };
  $('#exportBtn').onclick = () => {
    const blob = new Blob([exportConfig()], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'github-board-config.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      importConfig(await file.text());
      applyTheme();
      $('#settingsDialog').close();
      renderTabs();
      refreshAll();
      toast('Configuration importée');
    } catch (err) {
      toast(`Import impossible : ${err.message}`);
    }
    e.target.value = '';
  };
  $('#resetBtn').onclick = () => {
    if (!confirmAction('Réinitialiser tableaux, colonnes et notes ?')) return;
    resetConfig();
    applyTheme();
    $('#settingsDialog').close();
    renderTabs();
    refreshAll();
  };
  $('#logoutBtn').onclick = () => {
    $('#settingsDialog').close();
    logout();
  };
}

/* ---------- Démarrage ---------- */

function init() {
  applyTheme();
  bindSettingsButtons();

  $('#loginBtn').onclick = async () => {
    const token = $('#tokenInput').value.trim();
    $('#loginError').textContent = '';
    if (!token) return;
    try {
      await login(token);
      $('#tokenInput').value = '';
    } catch (err) {
      $('#loginError').textContent = `Échec de connexion : ${err.message}`;
    }
  };
  $('#tokenInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#loginBtn').click(); });
  $('#refreshBtn').onclick = () => (api ? refreshAll() : null);
  $('#settingsBtn').onclick = openSettings;
  $('#filterInput').addEventListener('input', () => api && renderAndDetails());
  $('#showHidden').addEventListener('change', () => api && renderAndDetails());

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, dialog')) return;
    if (e.key === '/') { e.preventDefault(); $('#filterInput').focus(); }
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey) refreshAll();
  });

  if (state.token) {
    setStatus('Connexion…');
    login(state.token).catch((err) => {
      logout();
      $('#loginError').textContent = `Session expirée : ${err.message}`;
    });
  } else {
    $('#login').classList.remove('hidden');
    setStatus('Non connecté');
  }
}

init();
