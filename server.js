process.env.TZ = process.env.TZ || 'Africa/Casablanca';

const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Stockage JSON ----------
function load(name) {
  const f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) || []; } catch { return []; }
}

function save(name, data) {
  const f = path.join(DATA_DIR, name + '.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(f + '.tmp', f); // écriture atomique
}

const nextId = list => (list.length ? Math.max(...list.map(x => x.id)) + 1 : 1);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const num = v => parseFloat(String(v ?? '').replace(',', '.'));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = () => { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;

function initData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
    save('users', [{
      id: 1, username: 'admin', nom: 'Administrateur', role: 'admin',
      password: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
    }, {
      id: 2, username: 'cuisine', nom: 'Cuisine', role: 'user',
      password: bcrypt.hashSync(process.env.USER_PASSWORD || 'cuisine123', 10),
    }]);
  }
  if (!fs.existsSync(path.join(DATA_DIR, 'produits.json'))) {
    const seed = [
      ['Tomate', 'Légume', 'kg', 6], ['Pomme de terre', 'Légume', 'kg', 5], ['Oignon', 'Légume', 'kg', 4],
      ['Carotte', 'Légume', 'kg', 4], ['Courgette', 'Légume', 'kg', 5], ['Poivron', 'Légume', 'kg', 8],
      ['Aubergine', 'Légume', 'kg', 5], ['Concombre', 'Légume', 'kg', 4], ['Ail', 'Légume', 'kg', 30],
      ['Laitue', 'Légume', 'pièce', 3], ['Persil', 'Légume', 'botte', 2], ['Coriandre', 'Légume', 'botte', 2],
      ['Pomme', 'Fruit', 'kg', 12], ['Banane', 'Fruit', 'kg', 14], ['Orange', 'Fruit', 'kg', 5],
      ['Citron', 'Fruit', 'kg', 8], ['Fraise', 'Fruit', 'kg', 15], ['Raisin', 'Fruit', 'kg', 16],
      ['Pastèque', 'Fruit', 'pièce', 25], ['Melon', 'Fruit', 'pièce', 15],
    ];
    save('produits', seed.map(([nom, categorie, unite, prix], i) => ({ id: i + 1, nom, categorie, unite, prix })));
  }
  if (!fs.existsSync(path.join(DATA_DIR, 'achats.json'))) save('achats', []);
}
initData();

// ---------- App ----------
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieSession({
  name: 'achats_sess',
  keys: [process.env.SESSION_SECRET || 'dev-secret-a-changer'],
  maxAge: 12 * 3600 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

const fail = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

// Protection CSRF simple : les requêtes qui modifient doivent venir de notre AJAX
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'XMLHttpRequest') return fail(res, 'Requête invalide', 403);
  next();
});

// ---------- Pages ----------
app.get('/', (req, res) => (req.session.user ? res.redirect('/app') : res.sendFile(path.join(PUBLIC_DIR, 'login.html'))));
app.get('/app', (req, res) => (req.session.user ? res.sendFile(path.join(PUBLIC_DIR, 'app.html')) : res.redirect('/')));
app.use(express.static(PUBLIC_DIR, { index: false }));

// ---------- Authentification ----------
app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const user = load('users').find(u => u.username.toLowerCase() === username);
  if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password)) {
    return setTimeout(() => fail(res, 'Identifiant ou mot de passe incorrect', 401), 400);
  }
  req.session.user = { id: user.id, username: user.username, nom: user.nom, role: user.role };
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

// Toutes les routes suivantes exigent une connexion
app.use('/api', (req, res, next) => {
  const s = req.session.user;
  const user = s && load('users').find(u => u.id === s.id);
  if (!user) { req.session = null; return fail(res, 'Session expirée, reconnectez-vous', 401); }
  req.user = { id: user.id, username: user.username, nom: user.nom, role: user.role };
  next();
});
const adminOnly = (req, res, next) => (req.user.role === 'admin' ? next() : fail(res, "Réservé à l'administrateur", 403));

app.get('/api/me', (req, res) => res.json({ ok: true, user: req.user }));

app.post('/api/password', (req, res) => {
  const users = load('users');
  const u = users.find(x => x.id === req.user.id);
  const { ancien = '', nouveau = '' } = req.body;
  if (!bcrypt.compareSync(String(ancien), u.password)) return fail(res, 'Ancien mot de passe incorrect');
  if (String(nouveau).length < 4) return fail(res, 'Le nouveau mot de passe doit contenir au moins 4 caractères');
  u.password = bcrypt.hashSync(String(nouveau), 10);
  save('users', users);
  res.json({ ok: true, message: 'Mot de passe modifié' });
});

// ---------- Produits ----------
app.get('/api/produits', (req, res) => {
  const last = {};
  [...load('achats')].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .forEach(a => a.lignes.forEach(l => { last[l.produit_id] = l.prix; }));
  const produits = load('produits')
    .map(p => ({ ...p, dernier_prix: last[p.id] ?? p.prix }))
    .sort((a, b) => b.categorie.localeCompare(a.categorie) || a.nom.localeCompare(b.nom, 'fr'));
  res.json({ ok: true, produits });
});

app.post('/api/produits', adminOnly, (req, res) => {
  const id = +req.body.id || 0;
  const nom = String(req.body.nom || '').trim();
  const categorie = req.body.categorie;
  const unite = String(req.body.unite || '').trim();
  const prix = round(num(req.body.prix));
  if (!nom) return fail(res, 'Le nom est obligatoire');
  if (!['Légume', 'Fruit'].includes(categorie)) return fail(res, 'Catégorie invalide');
  if (!unite) return fail(res, "L'unité est obligatoire");
  if (!(prix >= 0)) return fail(res, 'Prix invalide');

  const produits = load('produits');
  if (produits.some(p => p.id !== id && p.nom.toLowerCase() === nom.toLowerCase())) return fail(res, 'Ce produit existe déjà');
  if (id) {
    const p = produits.find(x => x.id === id);
    if (!p) return fail(res, 'Produit introuvable', 404);
    Object.assign(p, { nom, categorie, unite, prix });
  } else {
    produits.push({ id: nextId(produits), nom, categorie, unite, prix });
  }
  save('produits', produits);
  res.json({ ok: true, message: id ? 'Produit modifié' : 'Produit ajouté' });
});

app.delete('/api/produits/:id', adminOnly, (req, res) => {
  const produits = load('produits');
  const rest = produits.filter(p => p.id !== +req.params.id);
  if (rest.length === produits.length) return fail(res, 'Produit introuvable', 404);
  save('produits', rest);
  res.json({ ok: true, message: 'Produit supprimé' });
});

// ---------- Achats ----------
app.get('/api/achats', (req, res) => {
  const { du = '', au = '', categorie = '' } = req.query;
  const four = String(req.query.fournisseur || '').trim().toLowerCase();
  const q = String(req.query.q || '').trim().toLowerCase();
  const pid = +req.query.produit_id || 0;

  let total = 0;
  const agg = {};
  const list = [];
  for (const a of load('achats')) {
    if (du && a.date < du) continue;
    if (au && a.date > au) continue;
    if (four && !a.fournisseur.toLowerCase().includes(four)) continue;
    if (q) {
      const hay = [a.fournisseur, a.note, ...a.lignes.map(l => l.produit)].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    const match = a.lignes.filter(l => (!pid || l.produit_id === pid) && (!categorie || l.categorie === categorie));
    if (!match.length) continue;
    for (const l of match) {
      total += l.montant;
      const g = agg[l.produit_id] ||= {
        produit: l.produit, categorie: l.categorie, unite: l.unite,
        quantite: 0, montant: 0, nb: 0, prix_min: Infinity, prix_max: 0,
      };
      g.quantite += l.quantite; g.montant += l.montant; g.nb++;
      g.prix_min = Math.min(g.prix_min, l.prix); g.prix_max = Math.max(g.prix_max, l.prix);
    }
    list.push(a);
  }
  list.sort(byDateDesc);
  const par_produit = Object.values(agg)
    .map(g => ({ ...g, quantite: round(g.quantite, 3), montant: round(g.montant), prix_moyen: g.quantite ? round(g.montant / g.quantite) : 0 }))
    .sort((a, b) => b.montant - a.montant);
  res.json({ ok: true, achats: list, count: list.length, total: round(total), par_produit });
});

app.post('/api/achats', (req, res) => {
  const id = +req.body.id || 0;
  const date = String(req.body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 'Date invalide');
  const fournisseur = String(req.body.fournisseur || '').trim();
  const note = String(req.body.note || '').trim();

  const achats = load('achats');
  const old = id ? achats.find(a => a.id === id) : null;
  if (id && !old) return fail(res, 'Achat introuvable', 404);
  if (old && req.user.role !== 'admin' && old.user_id !== req.user.id) return fail(res, 'Vous ne pouvez modifier que vos achats', 403);

  const produits = Object.fromEntries(load('produits').map(p => [p.id, p]));
  const lignes = [];
  let total = 0;
  for (const l of Array.isArray(req.body.lignes) ? req.body.lignes : []) {
    const pid = +l.produit_id;
    // produit actuel, ou copie d'origine si le produit a été supprimé depuis
    const oldLine = old && old.lignes.find(x => x.produit_id === pid);
    const p = produits[pid] || (oldLine && { nom: oldLine.produit, categorie: oldLine.categorie, unite: oldLine.unite });
    if (!p) return fail(res, 'Produit invalide');
    const quantite = round(num(l.quantite), 3);
    const prix = round(num(l.prix));
    if (!(quantite > 0)) return fail(res, `Quantité invalide pour ${p.nom}`);
    if (!(prix >= 0)) return fail(res, `Prix invalide pour ${p.nom}`);
    const montant = round(quantite * prix);
    total += montant;
    lignes.push({ produit_id: pid, produit: p.nom, categorie: p.categorie, unite: p.unite, quantite, prix, montant });
  }
  if (!lignes.length) return fail(res, 'Ajoutez au moins un produit');

  const data = { date, fournisseur, note, lignes, total: round(total) };
  if (old) {
    Object.assign(old, data, { updated_at: now(), updated_by: req.user.nom });
  } else {
    achats.push({ id: nextId(achats), ...data, user_id: req.user.id, user: req.user.nom, created_at: now() });
  }
  save('achats', achats);
  res.json({ ok: true, message: old ? 'Achat modifié' : `Achat enregistré (${round(total).toFixed(2)} DH)` });
});

app.delete('/api/achats/:id', adminOnly, (req, res) => {
  const achats = load('achats');
  const rest = achats.filter(a => a.id !== +req.params.id);
  if (rest.length === achats.length) return fail(res, 'Achat introuvable', 404);
  save('achats', rest);
  res.json({ ok: true, message: 'Achat supprimé' });
});

app.get('/api/fournisseurs', (req, res) => {
  const set = new Set(load('achats').map(a => a.fournisseur).filter(Boolean));
  res.json({ ok: true, fournisseurs: [...set].sort((a, b) => a.localeCompare(b, 'fr')) });
});

// ---------- Statistiques ----------
app.get('/api/stats', (req, res) => {
  const d = new Date();
  const today = ymd(d);
  const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const wFrom = ymd(monday), wTo = ymd(sunday), month = today.slice(0, 7), year = today.slice(0, 4);

  const mois = {};
  for (let i = 11; i >= 0; i--) mois[ymd(new Date(d.getFullYear(), d.getMonth() - i, 1)).slice(0, 7)] = 0;

  const s = { today: 0, week: 0, month: 0, year: 0, nb_month: 0 };
  const categories = { 'Légume': 0, 'Fruit': 0 };
  const top = {};
  const achats = load('achats');
  for (const a of achats) {
    const mk = a.date.slice(0, 7);
    if (a.date === today) s.today += a.total;
    if (a.date >= wFrom && a.date <= wTo) s.week += a.total;
    if (a.date.startsWith(year)) s.year += a.total;
    if (mk in mois) mois[mk] += a.total;
    if (mk === month) {
      s.month += a.total; s.nb_month++;
      for (const l of a.lignes) {
        categories[l.categorie] = (categories[l.categorie] || 0) + l.montant;
        const t = top[l.produit_id] ||= { produit: l.produit, categorie: l.categorie, unite: l.unite, quantite: 0, montant: 0 };
        t.quantite += l.quantite; t.montant += l.montant;
      }
    }
  }
  for (const k of ['today', 'week', 'month', 'year']) s[k] = round(s[k]);
  for (const k in categories) categories[k] = round(categories[k]);
  res.json({
    ok: true, ...s, categories,
    mois: Object.entries(mois).map(([m, total]) => ({ mois: m, total: round(total) })),
    top: Object.values(top).map(t => ({ ...t, quantite: round(t.quantite, 3), montant: round(t.montant) }))
      .sort((a, b) => b.montant - a.montant).slice(0, 6),
    recents: [...achats].sort(byDateDesc).slice(0, 6),
  });
});

// ---------- Utilisateurs (admin) ----------
const publicUser = ({ password, ...u }) => u;

app.get('/api/users', adminOnly, (req, res) => res.json({ ok: true, users: load('users').map(publicUser) }));

app.post('/api/users', adminOnly, (req, res) => {
  const id = +req.body.id || 0;
  const username = String(req.body.username || '').trim();
  const nom = String(req.body.nom || '').trim() || username;
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  const password = String(req.body.password || '');
  if (!/^[\w.-]{3,30}$/.test(username)) return fail(res, "Identifiant invalide (3 à 30 caractères, lettres/chiffres)");
  if ((!id || password) && password.length < 4) return fail(res, 'Mot de passe : au moins 4 caractères');

  const users = load('users');
  if (users.some(u => u.id !== id && u.username.toLowerCase() === username.toLowerCase())) return fail(res, 'Cet identifiant existe déjà');
  if (id) {
    const u = users.find(x => x.id === id);
    if (!u) return fail(res, 'Utilisateur introuvable', 404);
    if (id === req.user.id && role !== 'admin') return fail(res, 'Vous ne pouvez pas retirer votre propre rôle admin');
    Object.assign(u, { username, nom, role });
    if (password) u.password = bcrypt.hashSync(password, 10);
  } else {
    users.push({ id: nextId(users), username, nom, role, password: bcrypt.hashSync(password, 10) });
  }
  save('users', users);
  res.json({ ok: true, message: id ? 'Utilisateur modifié' : 'Utilisateur ajouté' });
});

app.delete('/api/users/:id', adminOnly, (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return fail(res, 'Vous ne pouvez pas supprimer votre propre compte');
  const users = load('users');
  const rest = users.filter(u => u.id !== id);
  if (rest.length === users.length) return fail(res, 'Utilisateur introuvable', 404);
  save('users', rest);
  res.json({ ok: true, message: 'Utilisateur supprimé' });
});

app.use('/api', (req, res) => fail(res, 'Route inconnue', 404));

app.listen(PORT, () => console.log(`Serveur démarré : http://localhost:${PORT}  (données : ${DATA_DIR})`));
