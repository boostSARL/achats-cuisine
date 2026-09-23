'use strict';

const CUR = 'DH';
let ME = null;
let PRODUITS = [];
let HIST = null;
const CACHE = {};   // achats déjà chargés, par id
const charts = {};

// ---------- Utilitaires ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = n => fmt(n) + ' ' + CUR;
const qty = n => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const frDate = s => (s ? s.split('-').reverse().join('/') : '');
const catBadge = c => `<span class="badge ${c === 'Fruit' ? 'bg-warning text-dark' : 'bg-success'}">${c === 'Fruit' ? '🍎' : '🥕'} ${esc(c)}</span>`;
const emptyRow = (n, msg) => `<tr><td colspan="${n}" class="text-center text-muted py-3">${msg}</td></tr>`;
const prod = id => PRODUITS.find(p => p.id == id);
const isAdmin = () => ME.role === 'admin';
const canEdit = a => isAdmin() || a.user_id === ME.id;
const modal = id => bootstrap.Modal.getOrCreateInstance(document.getElementById(id));

function toast(msg, type = 'success') {
  const $t = $(`<div class="toast align-items-center text-bg-${type} border-0" role="alert">
    <div class="d-flex"><div class="toast-body">${esc(msg)}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>`);
  $('#toasts').append($t);
  new bootstrap.Toast($t[0], { delay: 3000 }).show();
  $t.on('hidden.bs.toast', () => $t.remove());
}

// Appel AJAX JSON vers l'API
function api(method, url, data) {
  return $.ajax({
    url: '/api/' + url,
    method,
    dataType: 'json',
    contentType: method === 'GET' ? undefined : 'application/json',
    data: method === 'GET' ? data : (data ? JSON.stringify(data) : undefined),
  }).then(r => r, xhr => {
    if (xhr.status === 401) { location.href = '/'; }
    const msg = xhr.responseJSON?.error || 'Erreur de connexion au serveur';
    toast(msg, 'danger');
    return $.Deferred().reject(msg).promise();
  });
}

function confirmBox(msg) {
  return new Promise(resolve => {
    $('#confirm-msg').text(msg);
    $('#btn-confirm-ok').off('click').on('click', () => { modal('m-confirm').hide(); resolve(); });
    modal('m-confirm').show();
  });
}

// ---------- Navigation ----------
const loaders = {
  dashboard: loadDashboard, achat: initAchat, historique: loadHistorique,
  stock: loadStock, sortie: initSortie, produits: loadProduits, users: loadUsers,
};

function route() {
  let sec = location.hash.slice(1) || 'dashboard';
  if (!loaders[sec] || (sec === 'users' && !isAdmin())) sec = 'dashboard';
  $('.section').addClass('d-none');
  $('#sec-' + sec).removeClass('d-none');
  $('.nav-sec').removeClass('active').filter(`[data-sec=${sec}]`).addClass('active');
  bootstrap.Collapse.getInstance('#nav')?.hide();
  loaders[sec]();
}

// ---------- Produits (partagé) ----------
function fetchProduits() {
  return api('GET', 'produits').then(r => {
    PRODUITS = r.produits;
    const v = $('#f-produit').val();
    $('#f-produit').html('<option value="">Tous</option>' + productOptions(v));
    $('#lines .l-prod').each(function () {
      const cur = $(this).val();
      if (!cur || prod(cur)) $(this).html('<option value="">— Choisir —</option>' + productOptions(cur));
    });
    renderQuick();
    return PRODUITS;
  });
}

function productOptions(selected) {
  const groups = { 'Légume': [], 'Fruit': [] };
  PRODUITS.forEach(p => (groups[p.categorie] ||= []).push(p));
  return Object.entries(groups).filter(([, ps]) => ps.length).map(([g, ps]) =>
    `<optgroup label="${g === 'Fruit' ? '🍎 Fruits' : '🥕 Légumes'}">` +
    ps.map(p => `<option value="${p.id}" ${p.id == selected ? 'selected' : ''}>${esc(p.nom)}</option>`).join('') +
    '</optgroup>').join('');
}

// ---------- Tableau de bord ----------
function drawChart(key, cfg) {
  charts[key]?.destroy();
  charts[key] = new Chart(document.getElementById('ch-' + key), cfg);
}

function loadDashboard() {
  api('GET', 'stats').then(s => {
    $('#st-today').text(money(s.today));
    $('#st-week').text(money(s.week));
    $('#st-month').text(money(s.month));
    $('#st-month-nb').text(s.nb_month + ' achat(s)');
    $('#st-year').text(money(s.year));
    $('#st-stock').text(money(s.stock_valeur));
    $('#st-sorties').text(money(s.sorties_month));
    setAlertBadge(s.alertes.length);
    $('#dash-alertes').toggleClass('d-none', !s.alertes.length).html(
      `<i class="bi bi-exclamation-triangle-fill"></i> <b>Stock bas :</b> ` +
      s.alertes.map(a => `${esc(a.nom)} (${qty(a.stock)} ${esc(a.unite)})`).join(', ') +
      ` — <a href="#stock" class="alert-link">voir le stock</a>`);

    const labels = s.mois.map(m => {
      const [y, mo] = m.mois.split('-');
      return new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    });
    drawChart('mois', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Dépenses', data: s.mois.map(m => m.total), backgroundColor: '#198754', borderRadius: 4 }] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money(c.parsed.y) } } },
        scales: { y: { beginAtZero: true } },
      },
    });
    const lg = s.categories['Légume'] || 0, fr = s.categories['Fruit'] || 0;
    drawChart('cat', {
      type: 'doughnut',
      data: { labels: ['Légumes', 'Fruits'], datasets: [{ data: lg + fr ? [lg, fr] : [], backgroundColor: ['#198754', '#ffc107'] }] },
      options: { maintainAspectRatio: false, plugins: { tooltip: { callbacks: { label: c => c.label + ' : ' + money(c.parsed) } } } },
    });

    $('#top-rows').html(s.top.length ? s.top.map(t => `<tr>
      <td>${t.categorie === 'Fruit' ? '🍎' : '🥕'} ${esc(t.produit)}</td>
      <td class="text-end">${qty(t.quantite)} ${esc(t.unite)}</td>
      <td class="text-end fw-semibold">${money(t.montant)}</td></tr>`).join('') : emptyRow(3, 'Aucun achat ce mois'));

    s.recents.forEach(a => { CACHE[a.id] = a; });
    $('#recent-rows').html(s.recents.length ? s.recents.map(a => `<tr class="clickable" data-id="${a.id}">
      <td>${frDate(a.date)}</td><td>${esc(a.fournisseur || '—')}</td>
      <td class="text-end fw-semibold">${money(a.total)}</td></tr>`).join('') : emptyRow(3, 'Aucun achat pour le moment'));
  });
}
$('#recent-rows').on('click', 'tr[data-id]', function () { showDetail($(this).data('id')); });

// ---------- Saisie d'un achat ----------
let achatReady = false;

function initAchat() {
  fetchProduits().then(() => {
    if (!achatReady) { resetAchat(); achatReady = true; }
  });
  api('GET', 'fournisseurs').then(r => $('#dl-four').html(r.fournisseurs.map(f => `<option value="${esc(f)}">`).join('')));
}

function addLine(l = {}) {
  const missing = l.produit_id && !prod(l.produit_id)
    ? `<option value="${l.produit_id}" selected>${esc(l.produit)} (supprimé)</option>` : '';
  const $tr = $(`<tr>
    <td><select class="form-select form-select-sm l-prod"><option value="">— Choisir —</option>${productOptions(l.produit_id)}${missing}</select></td>
    <td class="l-unite text-muted small">${esc(l.unite || '')}</td>
    <td><input type="number" step="any" min="0" class="form-control form-control-sm l-qte" value="${l.quantite ?? ''}"></td>
    <td><input type="number" step="any" min="0" class="form-control form-control-sm l-prix" value="${l.prix ?? ''}"></td>
    <td class="text-end fw-semibold l-mont text-nowrap">0,00</td>
    <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger l-del" title="Retirer"><i class="bi bi-x-lg"></i></button></td>
  </tr>`);
  $('#lines').append($tr);
  recalc();
  return $tr;
}

function recalc() {
  let total = 0, nb = 0;
  $('#lines tr').each(function () {
    const q = parseFloat($(this).find('.l-qte').val()) || 0;
    const p = parseFloat($(this).find('.l-prix').val()) || 0;
    const m = Math.round(q * p * 100) / 100;
    $(this).find('.l-mont').text(fmt(m));
    total += m;
    if ($(this).find('.l-prod').val()) nb++;
  });
  $('#a-total').text(money(total));
  $('#a-nb').text(nb);
}

function resetAchat() {
  $('#a-id').val('');
  $('#a-date').val(ymd(new Date()));
  $('#a-four, #a-note').val('');
  $('#lines').empty();
  addLine();
  $('#achat-title').text('Nouvel achat');
  $('#btn-cancel-edit').addClass('d-none');
}

function editAchat(id) {
  const a = CACHE[id];
  if (!a) return;
  bootstrap.Modal.getInstance(document.getElementById('m-detail'))?.hide();
  const fill = () => {
    achatReady = true;
    $('#a-id').val(a.id);
    $('#a-date').val(a.date);
    $('#a-four').val(a.fournisseur);
    $('#a-note').val(a.note);
    $('#lines').empty();
    a.lignes.forEach(l => addLine(l));
    $('#achat-title').text(`Modifier l'achat N° ${a.id}`);
    $('#btn-cancel-edit').removeClass('d-none');
    location.hash = 'achat';
  };
  PRODUITS.length ? fill() : fetchProduits().then(fill);
}

$('#lines')
  .on('change', '.l-prod', function () {
    const p = prod(this.value);
    const $tr = $(this).closest('tr');
    $tr.find('.l-unite').text(p ? p.unite : '');
    if (p) {
      $tr.find('.l-prix').val(p.dernier_prix);   // pré-remplit avec le dernier prix payé
      $tr.find('.l-qte').trigger('focus');
    }
    recalc();
  })
  .on('input', '.l-qte, .l-prix', recalc)
  .on('click', '.l-del', function () {
    $(this).closest('tr').remove();
    if (!$('#lines tr').length) addLine();
    recalc();
  })
  .on('keydown', '.l-qte', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $(this).closest('tr').find('.l-prix').trigger('focus').trigger('select'); }
  })
  .on('keydown', '.l-prix', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const $tr = $(this).closest('tr');
    ($tr.is(':last-child') ? addLine() : $tr.next()).find('.l-prod').trigger('focus');
  });

// Empêche Entrée d'envoyer le formulaire par accident
$('#form-achat').on('keydown', 'input', e => { if (e.key === 'Enter') e.preventDefault(); });

$('#btn-add-line').on('click', () => addLine().find('.l-prod').trigger('focus'));
$('#btn-reset').on('click', resetAchat);
$('#btn-cancel-edit').on('click', () => { resetAchat(); location.hash = 'historique'; });

// Ajout rapide par clic
function renderQuick() {
  const q = ($('#quick-search').val() || '').toLowerCase();
  const list = PRODUITS.filter(p => p.nom.toLowerCase().includes(q));
  $('#quick-list').html(list.length ? list.map(p => `
    <button type="button" class="btn btn-sm ${p.categorie === 'Fruit' ? 'btn-outline-warning text-dark' : 'btn-outline-success'} quick-p" data-id="${p.id}">
      ${esc(p.nom)} <small class="opacity-75">${fmt(p.dernier_prix)}</small></button>`).join('')
    : '<span class="text-muted small">Aucun produit</span>');
}
$('#quick-search').on('input', renderQuick);
$('#quick-list').on('click', '.quick-p', function () {
  const id = String($(this).data('id'));
  // Si le produit est déjà dans la liste, on se place simplement sur sa quantité
  const $exist = $('#lines tr').filter((i, tr) => $(tr).find('.l-prod').val() === id).first();
  if ($exist.length) return $exist.find('.l-qte').trigger('focus').trigger('select');
  let $tr = $('#lines tr').filter((i, tr) => !$(tr).find('.l-prod').val()).first();
  if (!$tr.length) $tr = addLine();
  $tr.find('.l-prod').val(id).trigger('change');
});

$('#form-achat').on('submit', function (e) {
  e.preventDefault();
  const lignes = [];
  let err = null;
  $('#lines tr').each(function () {
    const pid = $(this).find('.l-prod').val();
    const q = $(this).find('.l-qte').val();
    const p = $(this).find('.l-prix').val();
    const nom = $(this).find('.l-prod option:selected').text();
    if (!pid && !q) return; // ligne vide ignorée
    if (!pid) err = err || 'Choisissez un produit pour chaque ligne';
    else if (!(parseFloat(q) > 0)) err = err || 'Quantité manquante pour ' + nom;
    else if (p === '' || parseFloat(p) < 0) err = err || 'Prix manquant pour ' + nom;
    lignes.push({ produit_id: +pid, quantite: q, prix: p });
  });
  if (err) return toast(err, 'warning');
  if (!lignes.length) return toast('Ajoutez au moins un produit', 'warning');

  const wasEdit = !!$('#a-id').val();
  const $btn = $(this).find('[type=submit]').prop('disabled', true);
  api('POST', 'achats', {
    id: +$('#a-id').val() || 0,
    date: $('#a-date').val(),
    fournisseur: $('#a-four').val(),
    note: $('#a-note').val(),
    lignes,
  }).then(r => {
    toast(r.message);
    resetAchat();
    fetchProduits();
    initAchat();
    if (wasEdit) location.hash = 'historique';
  }).always(() => $btn.prop('disabled', false));
});

// ---------- Historique ----------
function periodDates(p) {
  const n = new Date();
  const y = n.getFullYear(), m = n.getMonth();
  switch (p) {
    case 'today': return [ymd(n), ymd(n)];
    case 'week': {
      const d = new Date(n); d.setDate(n.getDate() - ((n.getDay() + 6) % 7));
      const e = new Date(d); e.setDate(d.getDate() + 6);
      return [ymd(d), ymd(e)];
    }
    case 'month': return [ymd(new Date(y, m, 1)), ymd(new Date(y, m + 1, 0))];
    case 'lastmonth': return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    case 'year': return [`${y}-01-01`, `${y}-12-31`];
    default: return ['', ''];
  }
}
function setPeriod(p) {
  const [du, au] = periodDates(p);
  $('#f-du').val(du);
  $('#f-au').val(au);
}

function filters() {
  return {
    du: $('#f-du').val(), au: $('#f-au').val(), fournisseur: $('#f-four').val(),
    categorie: $('#f-cat').val(), produit_id: $('#f-produit').val(), q: $('#f-q').val(),
  };
}

const articles = a => {
  const n = a.lignes.map(l => esc(l.produit));
  return n.slice(0, 4).join(', ') + (n.length > 4 ? ` <span class="text-muted">+${n.length - 4}</span>` : '');
};
const actionBtns = a =>
  `<button class="btn btn-sm btn-outline-primary act-view" title="Détails"><i class="bi bi-eye"></i></button>` +
  (canEdit(a) ? ` <button class="btn btn-sm btn-outline-secondary act-edit" title="Modifier"><i class="bi bi-pencil"></i></button>` : '') +
  (isAdmin() ? ` <button class="btn btn-sm btn-outline-danger act-del" title="Supprimer"><i class="bi bi-trash"></i></button>` : '');

function loadHistorique() {
  if (!PRODUITS.length) fetchProduits();
  api('GET', 'achats', filters()).then(r => {
    HIST = r;
    r.achats.forEach(a => { CACHE[a.id] = a; });
    const partial = $('#f-cat').val() || $('#f-produit').val();
    $('#h-count').text(r.count);
    $('#h-total').text(money(r.total));
    $('#h-total-label').text(partial ? 'Montant (produits filtrés)' : 'Montant total');
    $('#h-avg').text(money(r.count ? r.total / r.count : 0));

    $('#h-rows').html(r.achats.length ? r.achats.map(a => `<tr class="clickable" data-id="${a.id}">
      <td class="text-muted">#${a.id}</td>
      <td class="text-nowrap">${frDate(a.date)}</td>
      <td>${esc(a.fournisseur || '—')}</td>
      <td class="small">${articles(a)}</td>
      <td class="text-end fw-semibold text-nowrap">${money(a.total)}</td>
      <td class="small text-muted">${esc(a.user)}</td>
      <td class="text-end text-nowrap no-print">${actionBtns(a)}</td></tr>`).join('') : emptyRow(7, 'Aucun achat trouvé'));

    $('#h-recap').html(r.par_produit.length ? r.par_produit.map(g => `<tr>
      <td class="fw-semibold">${esc(g.produit)}</td><td>${catBadge(g.categorie)}</td>
      <td class="text-end">${qty(g.quantite)} ${esc(g.unite)}</td>
      <td class="text-end">${money(g.prix_moyen)}</td>
      <td class="text-end small text-muted">${fmt(g.prix_min)} / ${fmt(g.prix_max)}</td>
      <td class="text-end fw-semibold">${money(g.montant)}</td></tr>`).join('') +
      `<tr class="table-light"><th colspan="5" class="text-end">Total</th><th class="text-end text-success">${money(r.total)}</th></tr>`
      : emptyRow(6, '—'));
  });
}

$('#h-rows').on('click', 'tr[data-id]', function (e) {
  const id = $(this).data('id');
  if ($(e.target).closest('.act-edit').length) return editAchat(id);
  if ($(e.target).closest('.act-del').length) return delAchat(id);
  showDetail(id);
});

let debounce;
$('#form-filtre').on('submit', e => { e.preventDefault(); loadHistorique(); });
$('#f-du, #f-au, #f-cat, #f-produit').on('change', loadHistorique);
$('#f-four, #f-q').on('input', () => { clearTimeout(debounce); debounce = setTimeout(loadHistorique, 300); });
$('.period').on('click', function () { setPeriod($(this).data('p')); loadHistorique(); });
$('#btn-f-reset').on('click', () => { $('#form-filtre')[0].reset(); setPeriod('month'); loadHistorique(); });

function showDetail(id) {
  const a = CACHE[id];
  if (!a) return;
  $('#d-title').text(`Achat N° ${a.id} — ${frDate(a.date)}`);
  $('#d-body').html(`
    <div class="row small mb-3">
      <div class="col-sm-6"><b>Fournisseur :</b> ${esc(a.fournisseur || '—')}</div>
      <div class="col-sm-6"><b>Saisi par :</b> ${esc(a.user)} le ${esc(a.created_at)}</div>
      ${a.updated_at ? `<div class="col-12 text-muted">Modifié par ${esc(a.updated_by)} le ${esc(a.updated_at)}</div>` : ''}
      ${a.note ? `<div class="col-12 mt-1"><b>Note :</b> ${esc(a.note)}</div>` : ''}
    </div>
    <div class="table-responsive"><table class="table table-sm">
      <thead><tr><th>Produit</th><th class="text-end">Quantité</th><th class="text-end">Prix unit.</th><th class="text-end">Montant</th></tr></thead>
      <tbody>${a.lignes.map(l => `<tr>
        <td>${l.categorie === 'Fruit' ? '🍎' : '🥕'} ${esc(l.produit)}</td>
        <td class="text-end">${qty(l.quantite)} ${esc(l.unite)}</td>
        <td class="text-end">${money(l.prix)}</td>
        <td class="text-end">${money(l.montant)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="3" class="text-end">Total</th><th class="text-end text-success fs-5">${money(a.total)}</th></tr></tfoot>
    </table></div>`);
  $('#d-edit').toggleClass('d-none', !canEdit(a)).off('click').on('click', () => editAchat(a.id));
  modal('m-detail').show();
}

function delAchat(id) {
  confirmBox(`Supprimer définitivement l'achat N° ${id} ?`).then(() =>
    api('DELETE', 'achats/' + id).then(r => { toast(r.message); delete CACHE[id]; loadHistorique(); }));
}

$('#btn-print').on('click', () => window.print());

$('#btn-csv').on('click', () => {
  if (!HIST || !HIST.achats.length) return toast('Rien à exporter', 'warning');
  const dec = n => String(n).replace('.', ',');
  const rows = [['N°', 'Date', 'Fournisseur', 'Produit', 'Catégorie', 'Quantité', 'Unité', 'Prix unitaire', 'Montant', 'Saisi par']];
  HIST.achats.forEach(a => a.lignes.forEach(l => rows.push([
    a.id, frDate(a.date), a.fournisseur, l.produit, l.categorie, dec(l.quantite), l.unite, dec(l.prix), dec(l.montant), a.user,
  ])));
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  $('<a>').attr({ href: url, download: `achats_${ymd(new Date())}.csv` })[0].click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---------- Stock ----------
let STOCK = [];
let MOTIFS = [];
const stk = id => STOCK.find(s => s.id == id);
const setAlertBadge = n => $('#nav-alertes').text(n).toggleClass('d-none', !n);

function fetchStock() {
  return api('GET', 'stock').then(r => {
    STOCK = r.stock;
    MOTIFS = r.motifs;
    setAlertBadge(r.alertes);
    return r;
  });
}

function loadStock() {
  fetchStock().then(r => {
    $('#sk-valeur').text(money(r.valeur));
    $('#sk-alertes').text(r.alertes);
    renderStock();
  });
}

function stockState(s) {
  if (s.stock <= 0) return '<span class="badge bg-danger">Épuisé</span>';
  if (s.alerte) return '<span class="badge bg-warning text-dark">Stock bas</span>';
  return '<span class="badge bg-success">OK</span>';
}

function renderStock() {
  const q = ($('#sk-search').val() || '').toLowerCase();
  const c = $('#sk-cat').val();
  const only = $('#sk-only').is(':checked');
  const list = STOCK.filter(s => (!c || s.categorie === c) && s.nom.toLowerCase().includes(q) && (!only || s.alerte || s.stock <= 0));
  $('#sk-rows').html(list.length ? list.map(s => `<tr class="${s.stock <= 0 ? 'text-muted' : ''}">
    <td class="fw-semibold">${s.categorie === 'Fruit' ? '🍎' : '🥕'} ${esc(s.nom)}</td>
    <td class="text-end">${qty(s.achete)}</td>
    <td class="text-end">${qty(s.sorti)}</td>
    <td class="text-end fw-bold ${s.alerte || s.stock <= 0 ? 'text-danger' : ''}">${qty(s.stock)} ${esc(s.unite)}</td>
    <td class="text-end small">${s.stock_min ? qty(s.stock_min) : '—'}</td>
    <td class="text-end small">${money(s.cmp)}</td>
    <td class="text-end">${money(s.valeur)}</td>
    <td>${stockState(s)}</td>
    <td class="text-end">${s.stock > 0 ? `<button class="btn btn-sm btn-outline-primary sk-take" data-id="${s.id}"><i class="bi bi-box-arrow-up"></i> Prendre</button>` : ''}</td>
  </tr>`).join('') : emptyRow(9, 'Aucun produit'));
}
$('#sk-search').on('input', renderStock);
$('#sk-cat, #sk-only').on('change', renderStock);
$('#sk-rows').on('click', '.sk-take', function () { pendingTake = $(this).data('id'); location.hash = 'sortie'; });

// ---------- Sortie de stock ----------
let sortieReady = false;
let pendingTake = null;

function defaultMotif() {
  const h = new Date().getHours();
  return h < 10 ? 'Petit-déjeuner' : h < 16 ? 'Déjeuner' : 'Dîner';
}

function initSortie() {
  fetchStock().then(() => {
    if (!$('#s-motifs').children().length) {
      $('#s-motifs').html(MOTIFS.map((m, i) => `
        <input type="radio" class="btn-check" name="s-motif" id="sm-${i}" value="${esc(m)}">
        <label class="btn btn-outline-primary btn-sm" for="sm-${i}">${esc(m)}</label>`).join(''));
      $('#sf-motif').append(MOTIFS.map(m => `<option>${esc(m)}</option>`).join(''));
      const [du, au] = periodDates('month');
      $('#sf-du').val(du);
      $('#sf-au').val(au);
    }
    if (!sortieReady) { resetSortie(); sortieReady = true; }
    $('#s-lines .s-prod').each(function () {
      const v = $(this).val();
      $(this).html('<option value="">— Choisir —</option>' + stockOptions(v));
    });
    recalcS();
    renderSQuick();
    if (pendingTake) { takeProduct(pendingTake); pendingTake = null; }
    loadSorties();
  });
}

function stockOptions(selected) {
  const groups = { 'Légume': [], 'Fruit': [] };
  STOCK.forEach(s => (groups[s.categorie] ||= []).push(s));
  return Object.entries(groups).filter(([, ss]) => ss.length).map(([g, ss]) =>
    `<optgroup label="${g === 'Fruit' ? '🍎 Fruits' : '🥕 Légumes'}">` +
    ss.map(s => `<option value="${s.id}" ${s.id == selected ? 'selected' : ''} ${s.stock <= 0 && s.id != selected ? 'disabled' : ''}>
      ${esc(s.nom)} (${qty(s.stock)} ${esc(s.unite)})</option>`).join('') +
    '</optgroup>').join('');
}

function addSLine() {
  const $tr = $(`<tr>
    <td><select class="form-select form-select-sm s-prod"><option value="">— Choisir —</option>${stockOptions()}</select></td>
    <td class="text-end small text-muted s-dispo"></td>
    <td><input type="number" step="any" min="0" class="form-control form-control-sm s-qte"></td>
    <td class="text-end fw-semibold s-val text-nowrap">0,00</td>
    <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger s-del" title="Retirer"><i class="bi bi-x-lg"></i></button></td>
  </tr>`);
  $('#s-lines').append($tr);
  return $tr;
}

function recalcS() {
  let total = 0, nb = 0;
  $('#s-lines tr').each(function () {
    const s = stk($(this).find('.s-prod').val());
    const q = parseFloat($(this).find('.s-qte').val()) || 0;
    $(this).find('.s-dispo').text(s ? `${qty(s.stock)} ${s.unite}` : '');
    $(this).find('.s-qte').toggleClass('is-invalid', !!s && q > s.stock);
    const v = s ? Math.round(q * s.cmp * 100) / 100 : 0;
    $(this).find('.s-val').text(fmt(v));
    total += v;
    if (s) nb++;
  });
  $('#s-total').text(money(total));
  $('#s-nb').text(nb);
}

function resetSortie() {
  $('#s-date').val(ymd(new Date()));
  $(`#s-motifs input[value="${defaultMotif()}"]`).prop('checked', true);
  $('#s-lines').empty();
  addSLine();
  recalcS();
}

function takeProduct(id) {
  id = String(id);
  const $exist = $('#s-lines tr').filter((i, tr) => $(tr).find('.s-prod').val() === id).first();
  if ($exist.length) return $exist.find('.s-qte').trigger('focus').trigger('select');
  let $tr = $('#s-lines tr').filter((i, tr) => !$(tr).find('.s-prod').val()).first();
  if (!$tr.length) $tr = addSLine();
  $tr.find('.s-prod').val(id);
  recalcS();
  $tr.find('.s-qte').trigger('focus');
}

function renderSQuick() {
  const q = ($('#s-quick-search').val() || '').toLowerCase();
  const list = STOCK.filter(s => s.stock > 0 && s.nom.toLowerCase().includes(q));
  $('#s-quick-list').html(list.length ? list.map(s => `
    <button type="button" class="btn btn-sm ${s.alerte ? 'btn-outline-danger' : 'btn-outline-primary'} s-quick" data-id="${s.id}">
      ${esc(s.nom)} <small class="opacity-75">${qty(s.stock)} ${esc(s.unite)}</small></button>`).join('')
    : '<span class="text-muted small">Aucun produit en stock. Enregistrez d\'abord un achat.</span>');
}
$('#s-quick-search').on('input', renderSQuick);
$('#s-quick-list').on('click', '.s-quick', function () { takeProduct($(this).data('id')); });

$('#s-lines')
  .on('change', '.s-prod', function () { recalcS(); $(this).closest('tr').find('.s-qte').trigger('focus'); })
  .on('input', '.s-qte', recalcS)
  .on('click', '.s-del', function () {
    $(this).closest('tr').remove();
    if (!$('#s-lines tr').length) addSLine();
    recalcS();
  })
  .on('keydown', '.s-qte', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const $tr = $(this).closest('tr');
    ($tr.is(':last-child') ? addSLine() : $tr.next()).find('.s-prod').trigger('focus');
  });
$('#form-sortie').on('keydown', 'input', e => { if (e.key === 'Enter') e.preventDefault(); });
$('#btn-s-add').on('click', () => addSLine().find('.s-prod').trigger('focus'));
$('#btn-s-reset').on('click', resetSortie);

$('#form-sortie').on('submit', function (e) {
  e.preventDefault();
  const lignes = [];
  let err = null;
  $('#s-lines tr').each(function () {
    const s = stk($(this).find('.s-prod').val());
    const q = $(this).find('.s-qte').val();
    if (!s && !q) return;
    if (!s) err = err || 'Choisissez un produit pour chaque ligne';
    else if (!(parseFloat(q) > 0)) err = err || 'Quantité manquante pour ' + s.nom;
    else if (parseFloat(q) > s.stock) err = err || `Stock insuffisant pour ${s.nom} (reste ${qty(s.stock)} ${s.unite})`;
    if (s) lignes.push({ produit_id: s.id, quantite: q });
  });
  const motif = $('#s-motifs input:checked').val();
  if (err) return toast(err, 'warning');
  if (!lignes.length) return toast('Ajoutez au moins un produit', 'warning');
  if (!motif) return toast('Choisissez un motif', 'warning');

  const $btn = $(this).find('[type=submit]').prop('disabled', true);
  api('POST', 'sorties', { date: $('#s-date').val(), motif, lignes })
    .then(r => { toast(r.message); sortieReady = false; initSortie(); })
    .always(() => $btn.prop('disabled', false));
});

// Historique des sorties
const SCACHE = {};
function loadSorties() {
  api('GET', 'sorties', { du: $('#sf-du').val(), au: $('#sf-au').val(), motif: $('#sf-motif').val() }).then(r => {
    r.sorties.forEach(x => { SCACHE[x.id] = x; });
    $('#sf-recap').html(
      `<span class="badge bg-primary fs-6">${r.count} sortie(s) — ${money(r.total)}</span>` +
      Object.entries(r.par_motif).map(([m, t]) => `<span class="badge bg-light text-dark border">${esc(m)} : ${money(t)}</span>`).join(''));
    $('#sf-rows').html(r.sorties.length ? r.sorties.map(x => `<tr class="clickable" data-id="${x.id}">
      <td class="text-muted">#${x.id}</td>
      <td class="text-nowrap">${frDate(x.date)}</td>
      <td><span class="badge bg-info text-dark">${esc(x.motif)}</span></td>
      <td class="small">${x.lignes.map(l => `${esc(l.produit)} ${qty(l.quantite)} ${esc(l.unite)}`).join(', ')}</td>
      <td class="text-end fw-semibold text-nowrap">${money(x.total)}</td>
      <td class="small text-muted">${esc(x.user)}</td>
      <td class="text-end">${isAdmin() ? '<button class="btn btn-sm btn-outline-danger sf-del" title="Annuler la sortie"><i class="bi bi-trash"></i></button>' : ''}</td>
    </tr>`).join('') : emptyRow(7, 'Aucune sortie sur cette période'));
  });
}
$('#sf-du, #sf-au, #sf-motif').on('change', loadSorties);
$('#sf-rows').on('click', 'tr[data-id]', function (e) {
  const x = SCACHE[$(this).data('id')];
  if ($(e.target).closest('.sf-del').length) {
    return confirmBox(`Annuler la sortie N° ${x.id} ? Les produits seront remis en stock.`).then(() =>
      api('DELETE', 'sorties/' + x.id).then(r => { toast(r.message); initSortie(); }));
  }
  showSortie(x);
});

function showSortie(x) {
  $('#d-title').text(`Sortie N° ${x.id} — ${frDate(x.date)}`);
  $('#d-body').html(`
    <div class="row small mb-3">
      <div class="col-sm-6"><b>Motif :</b> ${esc(x.motif)}</div>
      <div class="col-sm-6"><b>Par :</b> ${esc(x.user)} le ${esc(x.created_at)}</div>
    </div>
    <table class="table table-sm">
      <thead><tr><th>Produit</th><th class="text-end">Quantité</th><th class="text-end">Coût moyen</th><th class="text-end">Valeur</th></tr></thead>
      <tbody>${x.lignes.map(l => `<tr><td>${esc(l.produit)}</td><td class="text-end">${qty(l.quantite)} ${esc(l.unite)}</td>
        <td class="text-end">${money(l.prix)}</td><td class="text-end">${money(l.montant)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="3" class="text-end">Total</th><th class="text-end text-primary">${money(x.total)}</th></tr></tfoot>
    </table>`);
  $('#d-edit').addClass('d-none');
  modal('m-detail').show();
}

// ---------- Gestion des produits ----------
function loadProduits() { fetchProduits().then(renderProduits); }

function renderProduits() {
  const q = ($('#p-search').val() || '').toLowerCase();
  const c = $('#p-cat').val();
  const list = PRODUITS.filter(p => (!c || p.categorie === c) && p.nom.toLowerCase().includes(q));
  const trend = p => p.dernier_prix > p.prix ? '<i class="bi bi-arrow-up-short text-danger" title="Plus cher que la référence"></i>'
    : p.dernier_prix < p.prix ? '<i class="bi bi-arrow-down-short text-success" title="Moins cher que la référence"></i>' : '';
  $('#p-rows').html(list.length ? list.map(p => `<tr data-id="${p.id}">
    <td class="fw-semibold">${esc(p.nom)}</td><td>${catBadge(p.categorie)}</td><td>${esc(p.unite)}</td>
    <td class="text-end">${money(p.prix)}</td>
    <td class="text-end">${money(p.dernier_prix)} ${trend(p)}</td>
    ${isAdmin() ? `<td class="text-end text-nowrap">
      <button class="btn btn-sm btn-outline-secondary p-edit"><i class="bi bi-pencil"></i></button>
      <button class="btn btn-sm btn-outline-danger p-del"><i class="bi bi-trash"></i></button></td>` : ''}
  </tr>`).join('') : emptyRow(6, 'Aucun produit'));
  $('#p-count').text(list.length);
}
$('#p-search').on('input', renderProduits);
$('#p-cat').on('change', renderProduits);

function openProduit(p = {}) {
  $('#mp-title').text(p.id ? 'Modifier le produit' : 'Nouveau produit');
  $('#mp-id').val(p.id || '');
  $('#mp-nom').val(p.nom || '');
  $('#mp-cat').val(p.categorie || 'Légume');
  $('#mp-unite').val(p.unite || 'kg');
  $('#mp-prix').val(p.prix ?? '');
  $('#mp-min').val(p.stock_min || '');
  modal('m-produit').show();
}
$('#btn-p-add').on('click', () => openProduit());
$('#p-rows')
  .on('click', '.p-edit', function () { openProduit(prod($(this).closest('tr').data('id'))); })
  .on('click', '.p-del', function () {
    const p = prod($(this).closest('tr').data('id'));
    confirmBox(`Supprimer le produit « ${p.nom} » ? (l'historique des achats est conservé)`).then(() =>
      api('DELETE', 'produits/' + p.id).then(r => { toast(r.message); loadProduits(); }));
  });
$('#form-produit').on('submit', function (e) {
  e.preventDefault();
  api('POST', 'produits', {
    id: +$('#mp-id').val() || 0, nom: $('#mp-nom').val(), categorie: $('#mp-cat').val(),
    unite: $('#mp-unite').val(), prix: $('#mp-prix').val(), stock_min: $('#mp-min').val(),
  }).then(r => { toast(r.message); modal('m-produit').hide(); loadProduits(); });
});

// ---------- Utilisateurs ----------
let USERS = [];
function loadUsers() {
  api('GET', 'users').then(r => {
    USERS = r.users;
    $('#u-rows').html(USERS.map(u => `<tr data-id="${u.id}">
      <td class="fw-semibold">${esc(u.username)}</td><td>${esc(u.nom)}</td>
      <td>${u.role === 'admin' ? '<span class="badge bg-danger">Admin</span>' : '<span class="badge bg-secondary">Utilisateur</span>'}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-secondary u-edit"><i class="bi bi-pencil"></i></button>
        ${u.id !== ME.id ? '<button class="btn btn-sm btn-outline-danger u-del"><i class="bi bi-trash"></i></button>' : ''}
      </td></tr>`).join(''));
  });
}
function openUser(u = {}) {
  $('#mu-title').text(u.id ? "Modifier l'utilisateur" : 'Nouvel utilisateur');
  $('#mu-id').val(u.id || '');
  $('#mu-username').val(u.username || '');
  $('#mu-nom').val(u.nom || '');
  $('#mu-role').val(u.role || 'user');
  $('#mu-password').val('').attr('placeholder', u.id ? 'Laisser vide pour ne pas changer' : 'Au moins 4 caractères');
  modal('m-user').show();
}
$('#btn-u-add').on('click', () => openUser());
$('#u-rows')
  .on('click', '.u-edit', function () { openUser(USERS.find(u => u.id === $(this).closest('tr').data('id'))); })
  .on('click', '.u-del', function () {
    const u = USERS.find(x => x.id === $(this).closest('tr').data('id'));
    confirmBox(`Supprimer l'utilisateur « ${u.username} » ?`).then(() =>
      api('DELETE', 'users/' + u.id).then(r => { toast(r.message); loadUsers(); }));
  });
$('#form-user').on('submit', function (e) {
  e.preventDefault();
  api('POST', 'users', {
    id: +$('#mu-id').val() || 0, username: $('#mu-username').val(), nom: $('#mu-nom').val(),
    role: $('#mu-role').val(), password: $('#mu-password').val(),
  }).then(r => { toast(r.message); modal('m-user').hide(); loadUsers(); });
});

// ---------- Compte ----------
$('#btn-pwd').on('click', e => { e.preventDefault(); $('#form-pwd')[0].reset(); modal('m-pwd').show(); });
$('#form-pwd').on('submit', function (e) {
  e.preventDefault();
  if ($('#pw-new').val() !== $('#pw-new2').val()) return toast('Les mots de passe ne correspondent pas', 'warning');
  api('POST', 'password', { ancien: $('#pw-old').val(), nouveau: $('#pw-new').val() })
    .then(r => { toast(r.message); modal('m-pwd').hide(); });
});
$('#btn-logout').on('click', e => {
  e.preventDefault();
  api('POST', 'logout').always(() => { location.href = '/'; });
});

// ---------- Démarrage ----------
$(function () {
  api('GET', 'me').then(r => {
    ME = r.user;
    $('#me-nom').text(ME.nom);
    if (!isAdmin()) $('.admin-only').remove();
    setPeriod('month');
    $(window).on('hashchange', route);
    route();
  });
});
