/* Tickets CB — Atelier AOR Architecture — application interne */
'use strict';

const CATS = {
  essence:     { label: 'Essence',     ico: '⛽' },
  restaurant:  { label: 'Restaurant',  ico: '🍽️' },
  fournitures: { label: 'Fournitures', ico: '📦' },
  peage:       { label: 'Péage',       ico: '🛣️' },
  autre:       { label: 'Autre',       ico: '🧾' },
};
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const ANALYSE_MAX = 1568;    // taille max envoyée pour la lecture

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const euro = n => (n == null || isNaN(n)) ? '—' : n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : Math.round(n * 100) / 100; };
const fmtNum = n => (n == null) ? '' : n.toFixed(2).replace('.', ',');
const frDate = iso => iso ? iso.split('-').reverse().join('/') : '';
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------------- Stockage (IndexedDB) ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('aor-tickets', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('tickets', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction('tickets', mode); const st = t.objectStore('tickets');
      const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', s => s.getAll()); },
  put(t) { return this.tx('readwrite', s => s.put(t)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};

const settings = {
  get key() { return localStorage.getItem('aor_key') || ''; },
  get model() { return localStorage.getItem('aor_model') || DEFAULT_MODEL; },
  get mail() { return localStorage.getItem('aor_mail') || ''; },
};

/* ---------------- Navigation ---------------- */
let history_ = [];
function show(id, push = true) {
  const cur = $('.screen.active');
  if (push && cur && cur.id !== id) history_.push(cur.id);
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}
function back() { show(history_.pop() || 'scrHome', false); if ($('#scrHome').classList.contains('active')) renderList(); }
$$('[data-back]').forEach(b => b.onclick = back);

/* ---------------- Accueil : liste ---------------- */
let tickets = [];
let filter = 'tous';

// ancien format (une seule photo) → liste de pièces
const normalize = t => t.photos ? t : { ...t, photos: [{ blob: t.photo, w: t.pw, h: t.ph, largeur: t.largeur || 80 }] };
async function load() { tickets = (await DB.all()).map(normalize); renderList(); }

function renderChips() {
  const opts = [['tous', 'Tous'], ...Object.entries(CATS).map(([k, v]) => [k, v.label])];
  $('#chips').innerHTML = opts.map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('');
  $$('#chips .chip').forEach(c => c.onclick = () => { filter = c.dataset.k; renderList(); });
}

function renderList() {
  renderChips();
  const list = tickets.filter(t => filter === 'tous' || t.cat === filter)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  if (!list.length) {
    $('#list').innerHTML = `<div class="empty">${tickets.length ? 'Aucun ticket dans cette catégorie.' : 'Aucun ticket pour l\'instant.<br>Appuie sur « Nouveau ticket » pour photographier ton premier ticket.'}</div>`;
    return;
  }
  const groups = {};
  list.forEach(t => (groups[t.date.slice(0, 7)] ||= []).push(t));
  $('#list').innerHTML = Object.entries(groups).map(([m, arr]) => {
    const [y, mo] = m.split('-');
    const name = new Date(+y, +mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const tot = arr.reduce((s, t) => s + (t.ttc || 0), 0);
    return `<section class="month"><div class="month-head"><span>${name}</span><b>${euro(tot)}</b></div>` +
      arr.map(t => `<div class="item" data-id="${t.id}">
        <div class="ico">${CATS[t.cat]?.ico || '🧾'}</div>
        <div class="mid"><div class="f">${esc(t.fournisseur)}</div><div class="d">${frDate(t.date)} · ${CATS[t.cat]?.label || ''}</div></div>
        <div class="m">${euro(t.ttc)}</div></div>`).join('') + '</section>';
  }).join('');
  $$('#list .item').forEach(el => el.onclick = () => openTicket(el.dataset.id));
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/* ---------------- Prise de photo ---------------- */
// Un ticket = une ou plusieurs « pièces » (pages d'une facture, ou ticket + facturette CB du même achat).
// Une photo peut contenir plusieurs tickets : ils sont découpés automatiquement et vérifiés l'un après l'autre.
$('#btnNew').onclick = () => {
  if (!settings.key) { toast('Renseigne d\'abord la clé API dans les réglages ⚙', 3500); show('scrSettings'); return; }
  pickPhoto('new');
};
$('#btnRetake').onclick = () => pickPhoto('new');
$('#btnAddPage').onclick = () => pickPhoto('page');
let pickMode = 'new';
function pickPhoto(mode) { pickMode = mode; $('#fileInput').value = ''; $('#fileInput').click(); }
$('#fileInput').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (pickMode === 'page') addPage(f); else startReview(f);
};

let cur = null;   // { mode:'new'|'edit', queue:[draft], qi, id }
// draft = { pages:[{img|blob, crop, largeur, w, h}], pi, data, ai, err, touched }
const draft = () => cur && cur.queue[cur.qi];
const page = () => draft() && draft().pages[draft().pi];

async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image(); img.src = url; await img.decode();   // Chrome applique l'orientation EXIF
  return img;
}
function imgToJpeg(img, maxSide, quality, crop) {
  const c = crop || { x0: 0, y0: 0, x1: 1, y1: 1 };
  const sx = c.x0 * img.naturalWidth, sy = c.y0 * img.naturalHeight;
  const sw = (c.x1 - c.x0) * img.naturalWidth, sh = (c.y1 - c.y0) * img.naturalHeight;
  let scale = typeof maxSide === 'object' ? Math.min(1, maxSide.w / sw) : Math.min(1, maxSide / Math.max(sw, sh));
  const cv = document.createElement('canvas');
  cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  return new Promise(r => cv.toBlob(b => r({ blob: b, w: cv.width, h: cv.height }), 'image/jpeg', quality));
}
const blobToB64 = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); });
const FULL = { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 };

function spinner(on, txt = 'Lecture du ticket…') {
  $('#analysing').hidden = !on; $('#reviewBody').hidden = on; $('#analysingTxt').textContent = txt;
}

function dataFromAI(t) {
  return { cat: CATS[t.categorie] ? t.categorie : 'autre', date: t.date || '', fournisseur: t.fournisseur || '',
    ht: num(t.ht), tva: num(t.tva), ttc: num(t.ttc) };
}

async function startReview(file) {
  show('scrReview', !$('#scrReview').classList.contains('active'));
  $('#btnDelete').hidden = true;
  spinner(true);
  try {
    const img = await loadImage(file);
    let ai = null, err = null;
    try { ai = await analyse([img], 'photo'); } catch (e) { err = e.message; }
    const list = (ai && Array.isArray(ai.tickets)) ? ai.tickets : [];
    let queue;
    if (list.length) {
      queue = list.map(t => {
        const zones = (Array.isArray(t.cadres) && t.cadres.length) ? t.cadres : [{ ...FULL, largeur_mm: t.largeur_papier_mm }];
        return { pages: zones.map(z => ({ img, crop: sanitizeCrop(z), largeur: nearestWidth(z.largeur_mm || t.largeur_papier_mm) })),
          pi: 0, data: dataFromAI(t), ai: { lisible: t.lisible !== false && ai.lisible !== false, probleme: t.probleme || ai.probleme }, err: null };
      });
    } else {
      queue = [{ pages: [{ img, crop: { ...FULL }, largeur: 80 }], pi: 0,
        data: { cat: 'autre', date: todayISO(), fournisseur: '', ht: null, tva: null, ttc: null },
        ai: ai ? { lisible: false, probleme: ai.probleme || 'aucun ticket reconnu sur la photo' } : null, err }];
    }
    cur = { mode: 'new', queue, qi: 0 };
    if (queue.length > 1) toast(`${queue.length} tickets reconnus sur la photo`, 3000);
    showDraft();
  } catch (e) {
    toast('Impossible d\'ouvrir la photo : ' + e.message, 4000); back();
  }
}

// Facture de plusieurs pages : on ajoute la page, puis on relit l'ensemble (le total est souvent sur la dernière page)
async function addPage(file) {
  const d = draft(); if (!d) return;
  spinner(true, `Lecture des ${d.pages.length + 1} pages…`);
  try {
    const img = await loadImage(file);
    d.pages.push({ img, crop: { ...FULL }, largeur: d.pages[0].largeur });
    d.pi = d.pages.length - 1;
    try {
      const ai = await analyse(d.pages.map(p => p.img), 'pages');
      d.data = dataFromAI(ai); d.ai = { lisible: ai.lisible !== false, probleme: ai.probleme }; d.err = null; d.touched = false;
      (ai.cadres || []).forEach((z, i) => { if (d.pages[i]) { d.pages[i].crop = sanitizeCrop(z); if (z.largeur_mm) d.pages[i].largeur = nearestWidth(z.largeur_mm); } });
    } catch (e) { d.err = e.message; d.data = readForm(); }
  } catch (e) { toast('Impossible d\'ouvrir la photo : ' + e.message, 4000); }
  showDraft();
}

function showDraft() {
  const d = draft(), n = cur.queue.length, isNew = cur.mode === 'new';
  $('#reviewTitle').textContent = isNew ? (n > 1 ? `Ticket ${cur.qi + 1} / ${n}` : 'Nouveau ticket') : 'Ticket';
  $('#btnRetake').hidden = !isNew || cur.qi > 0;
  $('#btnSkip').hidden = !(isNew && n > 1);
  $('#btnAddPage').hidden = !(isNew && n === 1);
  fillForm(d.data);
  renderPages(); showPage();
}
function renderPages() {
  const d = draft(), many = d.pages.length > 1;
  $('#pages').hidden = !many;
  $('#pages').innerHTML = many ? d.pages.map((p, i) => `<button class="pg ${i === d.pi ? 'on' : ''}" data-i="${i}">Page ${i + 1}</button>`).join('') : '';
  $$('#pages .pg').forEach(b => b.onclick = () => { savePageWidth(); d.pi = +b.dataset.i; renderPages(); showPage(); });
}
function showPage() {
  const p = page(), editable = cur.mode === 'new';
  $('#fLarg').value = String(p.largeur || 80);
  const src = p.img ? p.img.src : (p._url ||= URL.createObjectURL(p.blob));
  showPhoto(src, editable);
}
function savePageWidth() { const p = page(); if (p) p.largeur = +$('#fLarg').value; }
$('#fLarg').addEventListener('change', savePageWidth);

function nearestWidth(mm) {
  const opts = [57, 80, 110, 148, 210]; mm = Number(mm) || 80;
  return opts.reduce((a, b) => Math.abs(b - mm) < Math.abs(a - mm) ? b : a);
}
function sanitizeCrop(c) {
  const cl = v => Math.min(1, Math.max(0, Number(v)));
  if (!c) return { ...FULL };
  let x0 = cl(c.x0), y0 = cl(c.y0), x1 = cl(c.x1), y1 = cl(c.y1);
  if (!(x1 - x0 > 0.03 && y1 - y0 > 0.03)) return { ...FULL };
  // petite marge de sécurité pour ne rien couper
  return { x0: Math.max(0, x0 - 0.01), y0: Math.max(0, y0 - 0.008), x1: Math.min(1, x1 + 0.01), y1: Math.min(1, y1 + 0.008) };
}

/* ---------------- Lecture par l'IA ---------------- */
const CHAMPS = `- "categorie" : essence = carburant/station-service ; restaurant = restaurant, café, boulangerie, repas ; fournitures = papeterie, bricolage, matériaux, quincaillerie, informatique, magasin de fournitures ; peage = autoroute, péage ; autre = tout le reste (parking, transport, etc.).
- "fournisseur" : nom de l'enseigne ou du commerçant, suivi de la ville si elle figure (ex. "TotalEnergies — Créteil").
- Montants en euros, nombres avec un point décimal. "tva" = total de la TVA (somme de tous les taux), "ht" = total hors taxes. Si le HT n'est pas indiqué, ht = ttc - tva. Si la TVA n'est pas indiquée mais le taux l'est, calcule-la. Si rien sur la TVA n'est indiqué, tva et ht = null.
- "date" : date de l'achat (AAAA-MM-JJ).
- "lisible" : false si le document est flou, coupé, trop sombre, ou si le TTC ou la date ne peuvent pas être lus avec certitude ; explique alors brièvement dans "probleme" (en français).
- Coordonnées des cadres en fractions de la largeur et de la hauteur de l'image (0 = bord gauche/haut, 1 = bord droit/bas), englobant tout le papier, sans déborder sur les papiers voisins.
- "largeur_mm" : largeur réelle estimée du papier (57 pour une facturette de carte bancaire, 80 pour un ticket de caisse standard, 148 pour un A5, 210 pour un A4).`;

const PROMPT_PHOTO = `Tu analyses une photo prise par un architecte, sur laquelle il peut y avoir UN ou PLUSIEURS tickets de caisse / facturettes / factures français (payés avec la carte bancaire de son cabinet), posés côte à côte.
Repère chaque achat distinct. Si une facturette de carte bancaire correspond au même achat qu'un ticket de caisse présent sur la photo (même commerçant ou même montant), ne crée pas d'achat séparé : ajoute simplement son cadre à cet achat.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"lisible": true, "probleme": "", "tickets": [{"lisible": true, "probleme": "", "categorie": "essence|restaurant|fournitures|peage|autre", "date": "AAAA-MM-JJ", "fournisseur": "", "ht": 0.00, "tva": 0.00, "ttc": 0.00, "cadres": [{"x0":0,"y0":0,"x1":1,"y1":1,"largeur_mm":80}]}]}
Ordonne les tickets de gauche à droite puis de haut en bas. Si aucun ticket n'est visible, renvoie "tickets": [] avec "lisible": false et la raison.
Règles :
${CHAMPS}`;

const promptPages = n => `Ces ${n} photos sont les pages successives d'UNE SEULE facture (ou d'un même ticket long photographié en plusieurs fois), payée avec la carte bancaire d'un cabinet d'architecture. Lis l'ensemble : le total est généralement sur la dernière page.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"lisible": true, "probleme": "", "categorie": "essence|restaurant|fournitures|peage|autre", "date": "AAAA-MM-JJ", "fournisseur": "", "ht": 0.00, "tva": 0.00, "ttc": 0.00, "cadres": [{"x0":0,"y0":0,"x1":1,"y1":1,"largeur_mm":210}]}
"cadres" contient exactement ${n} éléments : le cadre du document sur chaque photo, dans l'ordre des photos.
Règles :
${CHAMPS}`;

async function analyse(imgs, mode) {
  if (!navigator.onLine) throw new Error('Pas de connexion : saisis le ticket à la main.');
  const content = [];
  for (let i = 0; i < imgs.length; i++) {
    const { blob } = await imgToJpeg(imgs[i], ANALYSE_MAX, 0.85);
    if (imgs.length > 1) content.push({ type: 'text', text: `Photo ${i + 1} :` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToB64(blob) } });
  }
  content.push({ type: 'text', text: mode === 'pages' ? promptPages(imgs.length) : PROMPT_PHOTO });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': settings.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: settings.model, max_tokens: 2000, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) {
    let m = ''; try { m = (await r.json()).error?.message || ''; } catch (_) {}
    if (r.status === 401) throw new Error('Clé API refusée : vérifie-la dans les réglages.');
    if (r.status === 400 && /credit/i.test(m)) throw new Error('Crédit API épuisé : recharge ton compte.');
    throw new Error('Erreur de lecture (' + r.status + ') ' + m);
  }
  const j = await r.json();
  const txt = (j.content || []).map(c => c.text || '').join('');
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Réponse illisible.');
  return JSON.parse(m[0]);
}

/* ---------------- Formulaire + vérifications ---------------- */
function fillForm(d) {
  $('#fCat').value = d.cat; $('#fDate').value = d.date; $('#fFour').value = d.fournisseur;
  $('#fHT').value = fmtNum(d.ht); $('#fTVA').value = fmtNum(d.tva); $('#fTTC').value = fmtNum(d.ttc);
  spinner(false);
  runChecks();
}
function readForm() {
  return { cat: $('#fCat').value, date: $('#fDate').value, fournisseur: $('#fFour').value.trim(),
    ht: num($('#fHT').value), tva: num($('#fTVA').value), ttc: num($('#fTTC').value) };
}
['#fCat', '#fDate', '#fFour', '#fHT', '#fTVA', '#fTTC'].forEach(s => $(s).addEventListener('input', runChecks));
$('#fTVA').addEventListener('change', autoHT); $('#fTTC').addEventListener('change', autoHT);
function autoHT() { const d = readForm(); if (d.ttc != null && d.tva != null && $('#fHT').value === '') { $('#fHT').value = fmtNum(Math.round((d.ttc - d.tva) * 100) / 100); runChecks(); } }
$('#form').addEventListener('input', () => { const d = draft(); if (d) { d.touched = true; d.data = readForm(); } });

function runChecks() {
  const dr = draft(); if (!dr) return;
  const d = readForm(); const out = []; let ok = true;
  const add = (cls, txt) => { out.push(`<div class="check ${cls}">${cls === 'ok' ? '✔' : cls === 'ko' ? '✖' : '!'} <span>${txt}</span></div>`); if (cls === 'ko') ok = false; };

  const isNew = cur.mode === 'new';
  if (isNew) {
    if (dr.err) add('ko', esc(dr.err));
    else if (dr.ai && dr.ai.lisible === false) add('ko', 'Ticket peu lisible : ' + esc(dr.ai.probleme || 'reprends la photo') + '. Reprends la photo, ou corrige les informations à la main.');
    else if (dr.ai) add('ok', dr.pages.length > 1 ? `Lisible, ${dr.pages.length} pages rattachées à ce ticket.` : 'Ticket lisible, informations reconnues.');
  }
  if (!d.date) add('ko', 'Date manquante.');
  else if (d.date > todayISO()) add('ko', 'La date est dans le futur.');
  else add('ok', 'Date : ' + frDate(d.date));
  if (!d.fournisseur) add('ko', 'Fournisseur manquant.');
  if (d.ttc == null || d.ttc <= 0) add('ko', 'Montant TTC manquant.');
  if (d.ttc != null && d.ht != null && d.tva != null) {
    if (Math.abs(d.ht + d.tva - d.ttc) > 0.02) add('ko', `HT + TVA (${euro(d.ht + d.tva)}) ≠ TTC (${euro(d.ttc)}).`);
    else add('ok', 'Montants cohérents (HT + TVA = TTC).');
  } else if (d.ttc != null) add('warn', 'TVA non indiquée sur le ticket : laisse HT et TVA vides si c\'est le cas.');
  const dup = tickets.find(t => t.id !== cur.id && t.date === d.date && t.ttc === d.ttc && d.ttc != null);
  if (dup) add('warn', `Un ticket du même jour et du même montant existe déjà (${esc(dup.fournisseur)}). Vérifie que ce n'est pas un doublon.`);

  // ticket jugé illisible : le bouton reste bloqué tant que tu n'as pas corrigé à la main
  if (isNew && (dr.err || dr.ai?.lisible === false)) ok = ok && dr.touched === true;
  $('#checks').innerHTML = out.join('');
  const b = $('#btnAdd'); b.disabled = !ok;
  const n = cur.queue.length;
  b.textContent = !isNew ? '✔ Enregistrer' : n > 1 ? `✔ Ajouter ce ticket (${cur.qi + 1}/${n})` : '✔ Ajouter le ticket';
}

/* ---------------- Cadre de recadrage ---------------- */
function showPhoto(src, editable) {
  const img = $('#reviewImg');
  $('#cropBox').hidden = !editable; $('#cropHint').hidden = !editable;
  img.onload = placeCrop; img.src = src; if (img.complete) placeCrop();
}
function imgRect() {
  const img = $('#reviewImg'), wrap = $('#photoWrap');
  const W = img.clientWidth, H = img.clientHeight, r = img.naturalWidth / img.naturalHeight;
  let w = W, h = W / r; if (h > H) { h = H; w = H * r; }
  return { left: (W - w) / 2 + img.offsetLeft, top: (H - h) / 2 + img.offsetTop, w, h, wrap };
}
function placeCrop() {
  if (!cur || cur.mode !== 'new') return;
  const R = imgRect(), c = page().crop, b = $('#cropBox');
  b.style.left = R.left + c.x0 * R.w + 'px'; b.style.top = R.top + c.y0 * R.h + 'px';
  b.style.width = (c.x1 - c.x0) * R.w + 'px'; b.style.height = (c.y1 - c.y0) * R.h + 'px';
}
window.addEventListener('resize', placeCrop);
(function cropDrag() {
  let drag = null;
  $('#photoWrap').addEventListener('pointerdown', e => {
    if (!cur || cur.mode !== 'new') return;
    const R = imgRect(), rect = R.wrap.getBoundingClientRect();
    const px = (e.clientX - rect.left - R.left) / R.w, py = (e.clientY - rect.top - R.top) / R.h;
    const c = page().crop; const corners = { tl: [c.x0, c.y0], tr: [c.x1, c.y0], bl: [c.x0, c.y1], br: [c.x1, c.y1] };
    let best = null, bd = 1e9;
    for (const [k, [x, y]] of Object.entries(corners)) { const d = Math.hypot((x - px) * R.w, (y - py) * R.h); if (d < bd) { bd = d; best = k; } }
    if (bd > 60) return;
    drag = best; R.wrap.setPointerCapture(e.pointerId); e.preventDefault();
  });
  $('#photoWrap').addEventListener('pointermove', e => {
    if (!drag) return;
    const R = imgRect(), rect = R.wrap.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left - R.left) / R.w));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top - R.top) / R.h));
    const c = page().crop, m = 0.03;
    if (drag[1] === 'l') c.x0 = Math.min(px, c.x1 - m); else c.x1 = Math.max(px, c.x0 + m);
    if (drag[0] === 't') c.y0 = Math.min(py, c.y1 - m); else c.y1 = Math.max(py, c.y0 + m);
    placeCrop();
  });
  const end = () => { drag = null; };
  $('#photoWrap').addEventListener('pointerup', end); $('#photoWrap').addEventListener('pointercancel', end);
})();

/* ---------------- Ajout / modification / suppression ---------------- */
// résolution conservée : ≈ 300 dpi à taille réelle, plafonnée
const storedWidth = mm => Math.min(2480, Math.max(900, Math.round(mm / 25.4 * 300)));

$('#btnAdd').onclick = async () => {
  savePageWidth();
  const d = readForm(), b = $('#btnAdd'); b.disabled = true;
  try {
    if (cur.mode === 'new') {
      const dr = draft(), photos = [];
      for (const p of dr.pages) {
        const { blob, w, h } = await imgToJpeg(p.img, { w: storedWidth(p.largeur) }, 0.92, p.crop);
        photos.push({ blob, w, h, largeur: p.largeur });
      }
      await DB.put({ id: 't' + Date.now() + Math.random().toString(36).slice(2, 6), createdAt: Date.now(), ...d, photos });
      await load();
      if (cur.qi < cur.queue.length - 1) { cur.qi++; toast(`Ticket ${cur.qi} ajouté ✔`); showDraft(); return; }
      toast(cur.queue.length > 1 ? `${cur.queue.length} tickets traités ✔` : 'Ticket ajouté ✔');
    } else {
      const t = tickets.find(x => x.id === cur.id);
      const photos = t.photos.map((p, i) => ({ ...p, largeur: draft().pages[i].largeur }));
      await DB.put({ ...t, ...d, photos }); await load();
      toast('Ticket modifié ✔');
    }
    cur = null; history_ = []; show('scrHome', false); renderList();
  } catch (e) { toast('Erreur d\'enregistrement : ' + e.message, 4000); b.disabled = false; }
};
$('#btnSkip').onclick = () => {
  if (cur.qi < cur.queue.length - 1) { cur.qi++; showDraft(); }
  else { cur = null; history_ = []; show('scrHome', false); renderList(); }
};
$('#btnReviewBack').onclick = () => { cur = null; back(); };

function openTicket(id) {
  const t = tickets.find(x => x.id === id); if (!t) return;
  cur = { mode: 'edit', id, qi: 0,
    queue: [{ pages: t.photos.map(p => ({ blob: p.blob, w: p.w, h: p.h, largeur: p.largeur })), pi: 0,
      data: { cat: t.cat, date: t.date, fournisseur: t.fournisseur, ht: t.ht, tva: t.tva, ttc: t.ttc } }] };
  show('scrReview');
  $('#btnDelete').hidden = false;
  showDraft();
}
$('#btnDelete').onclick = async () => {
  if (!cur || cur.mode !== 'edit') return;
  if (!confirm('Supprimer définitivement ce ticket ?')) return;
  await DB.del(cur.id); cur = null; await load(); toast('Ticket supprimé'); history_ = []; show('scrHome', false);
};

/* ---------------- Réglages ---------------- */
$('#btnSettings').onclick = () => {
  $('#sKey').value = settings.key; $('#sModel').value = settings.model; $('#sMail').value = settings.mail;
  show('scrSettings'); storageInfo();
};
$('#btnSaveSettings').onclick = () => {
  localStorage.setItem('aor_key', $('#sKey').value.trim());
  localStorage.setItem('aor_model', $('#sModel').value.trim() || DEFAULT_MODEL);
  localStorage.setItem('aor_mail', $('#sMail').value.trim());
  toast('Réglages enregistrés ✔'); back();
};
async function storageInfo() {
  let s = `${tickets.length} ticket(s) enregistré(s).`;
  if (navigator.storage?.persisted) s += (await navigator.storage.persisted()) ? ' Stockage protégé.' : ' Stockage non protégé : fais des sauvegardes.';
  $('#storageInfo').textContent = s;
}
$('#btnBackup').onclick = async () => {
  const all = (await DB.all()).map(normalize);
  const data = await Promise.all(all.map(async t => {
    const { photo, pw, ph, ...rest } = t;
    return { ...rest, photos: await Promise.all(t.photos.map(async p => ({ ...p, blob: await blobToB64(p.blob) }))) };
  }));
  const file = new File([JSON.stringify({ app: 'aor-tickets', version: 1, date: new Date().toISOString(), tickets: data })],
    `Sauvegarde_tickets_AOR_${todayISO()}.json`, { type: 'application/json' });
  await shareOrDownload([file], 'Sauvegarde tickets AOR');
};
$('#btnRestore').onclick = () => $('#restoreInput').click();
$('#restoreInput').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); let n = 0;
    for (const t of j.tickets || []) {
      const toBlob = b64 => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      const photos = t.photos ? t.photos.map(p => ({ ...p, blob: toBlob(p.blob) }))
        : [{ blob: toBlob(t.photo), w: t.pw, h: t.ph, largeur: t.largeur || 80 }];
      const { photo, pw, ph, ...rest } = t;
      await DB.put({ ...rest, photos }); n++;
    }
    await load(); storageInfo(); toast(n + ' ticket(s) restauré(s) ✔');
  } catch (err) { toast('Fichier de sauvegarde invalide.', 4000); }
};

async function shareOrDownload(files, title, text = '') {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title, text }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  for (const f of files) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  return true;
}

/* ---------------- Démarrage ---------------- */
(async () => {
  await DB.open();
  if (navigator.storage?.persist) navigator.storage.persist();
  await load();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
})();
