/* Mes Finances — logique de l'application (HTML/CSS/JS pur, sans dépendance) */

var DEMO = !!window.MF_DEMO; // true uniquement dans la maquette : données d'exemple, rien n'est sauvegardé
var KEYS = { tx: 'mes-finances-transactions', goal: 'mes-finances-goal', /* anciennes clés : uniquement pour l'import */ theme: 'mes-finances-theme', profile: 'mes-finances-profile', pin: 'mes-finances-pin' };

var ACCOUNTS = ["Orange Money", "Wave", "Yas Money", "Espèces"];
var ACC_COLORS = {
  "Orange Money": ["--orange-bg", "--orange-text"],
  "Wave": ["--wave-bg", "--wave-text"],
  "Yas Money": ["--yas-bg", "--yas-text"],
  "Espèces": ["--cash-bg", "--cash-text"]
};
var CATEGORIES = ["Alimentation", "Transport", "Logement", "Santé", "Loisirs", "Facture", "Salaire", "Épargne", "Autre"];
var CAT_ICON = { "Alimentation": "cart", "Transport": "bus", "Logement": "home", "Santé": "heart", "Loisirs": "game", "Facture": "zap", "Salaire": "cash", "Épargne": "wallet", "Autre": "dots" };
var PALETTE = ["var(--primary)", "#F4A229", "#E1483F", "#1660A8", "#8B6FD6", "#C2577A", "#2BA3B8", "#7A8B2E", "#8A8F94"];

/* ---------- Données ---------- */

function read(key, fallback) {
  if (DEMO) return fallback;
  try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
}
function write(key, value) {
  if (DEMO) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error(e); }
}

function demoData() {
  var now = new Date(), out = [], id = 1;
  function add(k, day, type, amount, account, category, label) {
    var d = new Date(now.getFullYear(), now.getMonth() - k, 1, 12);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last, k === 0 ? now.getDate() : 31));
    out.push({ id: id++, type: type, amount: amount, account: account, category: category, label: label, date: d });
  }
  var alim = [18200, 17500, 19800, 16400, 20100, 12300], trans = [9500, 10200, 8800, 11000, 9700, 6400];
  var fact = [12000, 12000, 13500, 12000, 14200, 12000], loi = [6000, 3500, 9000, 4500, 7800, 5200], san = [0, 5000, 0, 3500, 0, 2500];
  for (var i = 0; i < 6; i++) {
    var k = 5 - i;
    add(k, 1, "income", 35000, "Wave", "Salaire", "Salaire");
    add(k, 3, "income", 30000, "Orange Money", "Salaire", "Revenus annexes");
    add(k, 5, "income", 15000, "Yas Money", "Salaire", "Mission freelance");
    add(k, 8, "expense", alim[i], "Orange Money", "Alimentation", "Marché et courses");
    add(k, 12, "expense", trans[i], "Wave", "Transport", "Transport");
    add(k, 18, "expense", fact[i], "Yas Money", "Facture", "Électricité et internet");
    add(k, 22, "expense", loi[i], "Orange Money", "Loisirs", "Sorties");
    if (san[i]) add(k, 25, "expense", san[i], "Wave", "Santé", "Pharmacie");
  }
  return out;
}

var transactions = [];                         // chargées depuis le compte après la connexion
var goal = { target: 100000, saved: 0 };
var selType = "expense", selAccount = ACCOUNTS[0], selCategory = CATEGORIES[0], period = "month";

/* ---------- Utilitaires ---------- */

function $(id) { return document.getElementById(id); }
function fmt(n) { return Math.round(n).toLocaleString("fr-FR") + " F"; }
function short(n) { var a = Math.abs(n); var s = a >= 1000 ? (Math.round(a / 100) / 10) + "k" : String(Math.round(a)); return (n < 0 ? "-" : "") + s; }
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function csvCell(v) { var s = String(v == null ? '' : v).replace(/[\r\n;]+/g, ' '); return /^[=+\-@\t]/.test(s) ? "'" + s : s; }
function ico(name) { return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
function sameMonth(d, ref) { return d.getMonth() === ref.getMonth() && d.getFullYear() === ref.getFullYear(); }

function lastMonths(n) {
  var out = [], now = new Date();
  for (var i = n - 1; i >= 0; i--) {
    var start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    var m = { label: start.toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""), inc: 0, exp: 0, bal: 0 };
    transactions.forEach(function (t) {
      var s = t.type === "expense" ? -1 : 1;
      if (t.date < end) m.bal += s * t.amount;
      if (t.date >= start && t.date < end) { if (t.type === "expense") m.exp += t.amount; else m.inc += t.amount; }
    });
    out.push(m);
  }
  return out;
}

/* ---------- Graphiques SVG ---------- */

function donutSVG(items, total, f, label) {
  f = f || fmt;
  var R = 62, C = 2 * Math.PI * R, acc = 0;
  var s = '<svg viewBox="0 0 180 180" role="img" aria-label="' + (label || 'Répartition des dépenses par catégorie') + '"><circle cx="90" cy="90" r="' + R + '" fill="none" stroke="var(--border)" stroke-width="24"/>';
  items.forEach(function (it, i) {
    var len = it.amt / total * C;
    s += '<circle cx="90" cy="90" r="' + R + '" fill="none" stroke="' + PALETTE[i % PALETTE.length] + '" stroke-width="24" stroke-dasharray="' + Math.max(len - 2, 0.5) + ' ' + C + '" stroke-dashoffset="' + (-acc) + '" transform="rotate(-90 90 90)"><title>' + esc(it.cat) + ' : ' + f(it.amt) + '</title></circle>';
    acc += len;
  });
  return s + '<text x="90" y="86" text-anchor="middle" class="d-sub">Total</text><text x="90" y="106" text-anchor="middle" class="d-val">' + f(total) + '</text></svg>';
}

function barsSVG(ms) {
  var x0 = 34, y0 = 14, y1 = 160, max = 1;
  ms.forEach(function (m) { max = Math.max(max, m.inc, m.exp); });
  var gw = (360 - x0 - 6) / ms.length, bw = 15;
  var s = '<svg class="chart" viewBox="0 0 360 190" role="img" aria-label="Recettes et dépenses des 6 derniers mois">';
  [0, 0.5, 1].forEach(function (f) {
    var y = y1 - f * (y1 - y0);
    s += '<line x1="' + x0 + '" x2="354" y1="' + y + '" y2="' + y + '" stroke="var(--border)"/><text class="ax" x="' + (x0 - 5) + '" y="' + (y + 3) + '" text-anchor="end">' + short(max * f) + '</text>';
  });
  ms.forEach(function (m, i) {
    var xc = x0 + gw * i + gw / 2, hi = m.inc / max * (y1 - y0), he = m.exp / max * (y1 - y0);
    s += '<rect x="' + (xc - bw - 1.5) + '" y="' + (y1 - hi) + '" width="' + bw + '" height="' + hi + '" rx="3" fill="var(--primary)"><title>' + m.label + ' — recettes : ' + fmt(m.inc) + '</title></rect>';
    s += '<rect x="' + (xc + 1.5) + '" y="' + (y1 - he) + '" width="' + bw + '" height="' + he + '" rx="3" fill="var(--danger)"><title>' + m.label + ' — dépenses : ' + fmt(m.exp) + '</title></rect>';
    s += '<text class="ax" x="' + xc + '" y="178" text-anchor="middle">' + m.label + '</text>';
  });
  return s + '</svg>';
}

function lineSVG(ms) {
  var x0 = 34, y0 = 14, y1 = 160, xe = 346;
  var vals = ms.map(function (m) { return m.bal; });
  var min = Math.min.apply(null, vals.concat(0)), max = Math.max.apply(null, vals.concat(0));
  if (max === min) max = min + 1;
  function Y(v) { return y1 - (v - min) / (max - min) * (y1 - y0); }
  function X(i) { return x0 + (xe - x0) * i / (ms.length - 1); }
  var pts = ms.map(function (m, i) { return X(i) + "," + Y(m.bal); }).join(" ");
  var s = '<svg class="chart" viewBox="0 0 360 190" role="img" aria-label="Évolution du solde sur 6 mois">';
  [max, min].forEach(function (v) { s += '<text class="ax" x="' + (x0 - 5) + '" y="' + (Y(v) + 3) + '" text-anchor="end">' + short(v) + '</text>'; });
  s += '<line x1="' + x0 + '" x2="354" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--border)" stroke-dasharray="4 3"/>';
  s += '<polygon points="' + X(0) + "," + Y(0) + " " + pts + " " + X(ms.length - 1) + "," + Y(0) + '" fill="var(--primary)" opacity=".14"/>';
  s += '<polyline points="' + pts + '" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
  ms.forEach(function (m, i) {
    s += '<circle cx="' + X(i) + '" cy="' + Y(m.bal) + '" r="4" fill="var(--surface)" stroke="var(--primary)" stroke-width="2"><title>' + m.label + ' : ' + fmt(m.bal) + '</title></circle>';
    s += '<text class="ax" x="' + X(i) + '" y="178" text-anchor="middle">' + m.label + '</text>';
  });
  return s + '</svg>';
}

function renderStats() {
  var now = new Date(), ms = lastMonths(6), cur = ms[ms.length - 1];
  $("kpis").innerHTML =
    '<div class="kpi"><p>Dépenses du mois</p><b style="color:var(--danger)">' + fmt(cur.exp) + '</b></div>' +
    '<div class="kpi"><p>Recettes du mois</p><b style="color:var(--primary)">' + fmt(cur.inc) + '</b></div>' +
    '<div class="kpi"><p>Reste du mois</p><b>' + fmt(cur.inc - cur.exp) + '</b></div>';

  var from = new Date(now.getFullYear(), now.getMonth() - 5, 1), totals = {}, total = 0;
  transactions.forEach(function (t) {
    if (t.type !== "expense") return;
    var ok = period === "month" ? sameMonth(t.date, now) : t.date >= from;
    if (ok) { totals[t.category] = (totals[t.category] || 0) + t.amount; total += t.amount; }
  });
  var items = Object.keys(totals).map(function (c) { return { cat: c, amt: totals[c] }; }).sort(function (a, b) { return b.amt - a.amt; });
  if (total > 0) {
    $("donut").innerHTML = donutSVG(items, total);
    $("legend").innerHTML = items.map(function (it, i) {
      return '<li><i style="background:' + PALETTE[i % PALETTE.length] + '"></i>' + it.cat + '<em>' + Math.round(it.amt / total * 100) + '% · ' + short(it.amt) + '</em></li>';
    }).join("");
  } else {
    $("donut").innerHTML = '<p class="empty">Aucune dépense sur cette période.</p>';
    $("legend").innerHTML = "";
  }
  $("bars").innerHTML = barsSVG(ms);
  $("line").innerHTML = lineSVG(ms);
  $("per-month").classList.toggle("on", period === "month");
  $("per-6m").classList.toggle("on", period === "6m");
}

function setPeriod(p) { period = p; renderStats(); }

/* ---------- Profil élève et charte graphique de l'établissement ---------- */

// Charte = couleur principale (foncée), secondaire (claire) et texte (noir). Les valeurs ci-dessous sont des
// approximations : choisissez "Autre établissement" pour régler vous-même les couleurs exactes.
var SCHOOLS = [
  { id: 'default', name: 'Thème Mes Finances (par défaut)', colors: null },
  { id: 'galandou-diouf', name: 'Lycée Galandou Diouf', colors: { dark: '#0B2E6B', light: '#5BB5F0', ink: '#111111' } },
  { id: 'custom', name: 'Autre établissement…', colors: null }
];
var CLASSES = ['', '6ème', '5ème', '4ème', '3ème', 'Seconde', 'Première', 'Terminale', 'Université / Autre'];

function defaultProfile() {
  return { first: '', last: '', school: 'default', schoolName: '', classe: '', year: '', photo: '', useCharter: true,
           custom: { dark: '#0B2E6B', light: '#5BB5F0', ink: '#111111' } };
}
function demoProfile() {
  var p = defaultProfile();
  p.first = 'Awa'; p.last = 'Diop'; p.school = 'galandou-diouf'; p.classe = 'Terminale'; p.year = '2026-2027';
  return p;
}
function safeHex(v, fallback) { return /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback; }
function normalizeProfile(raw) {
  var p = Object.assign(defaultProfile(), raw || {}), c = p.custom || {};
  p.custom = { dark: safeHex(c.dark, '#0B2E6B'), light: safeHex(c.light, '#5BB5F0'), ink: safeHex(c.ink, '#111111') };
  if (p.photo && String(p.photo).indexOf('data:image/') !== 0) p.photo = '';
  ['first', 'last', 'schoolName', 'classe', 'year'].forEach(function (k) { p[k] = String(p[k] || '').slice(0, 60); });
  if (!schoolById(p.school)) p.school = 'default';
  p.useCharter = p.useCharter !== false;
  return p;
}
var profile = defaultProfile();
var saveTimer = null, pendingProfile = false;
function saveProfile() {
  if (!MF.auth.user()) return;
  pendingProfile = true; clearTimeout(saveTimer); saveTimer = setTimeout(flushProfile, 700);
}
function flushProfile() {
  clearTimeout(saveTimer);
  if (!pendingProfile || !MF.auth.user()) return Promise.resolve();
  pendingProfile = false;
  return MF.data.saveProfile(profile).catch(function (e) { pendingProfile = true; toast((e && e.userMessage) || "Le profil n'a pas pu être enregistré.", 'error'); });
}

/* Calcul des couleurs : on part de la charte puis on ajuste chaque couleur pour que le texte reste lisible (WCAG AA). */
function hex2rgb(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
function rgb2hex(a) { return '#' + a.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join(''); }
function lum(h) {
  var c = hex2rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function mix(a, b, t) { var x = hex2rgb(a), y = hex2rgb(b); return rgb2hex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); }
function ensure(color, against, min, toward) {
  var c = color, t = 0;
  while (contrast(c, against) < min && t < 1) { t += 0.05; c = mix(color, toward, t); }
  return c;
}
function schoolById(id) { return SCHOOLS.filter(function (s) { return s.id === id; })[0]; }
function charterFor(p) { if (p.school === 'custom') return p.custom; var s = schoolById(p.school); return s ? s.colors : null; }
function currentCharter() { return profile.useCharter ? charterFor(profile) : null; }

function charterCSS(c) {
  var heroA = ensure(c.dark, '#FFFFFF', 7, '#000000');
  var heroB = ensure(mix(c.dark, c.light, 0.45), '#FFFFFF', 5.5, c.dark);
  var ink = ensure(c.ink, '#F6F4EE', 10, '#000000');
  var sbl = mix(c.light, '#FFFFFF', 0.88);
  var lp = ensure(c.dark, sbl, 4.5, '#000000');
  var sbd = mix(c.dark, '#0E1210', 0.55);
  var dp = ensure(ensure(c.light, '#1E2521', 4.5, '#FFFFFF'), sbd, 4.5, '#FFFFFF');
  var onDark = contrast('#FFFFFF', dp) >= contrast('#0B0F14', dp) ? '#FFFFFF' : '#0B0F14';
  var shared = '--hero-1:' + heroA + ';--hero-2:' + heroB + ';--on-hero:#FFFFFF;--accent:' + c.light + ';';
  var lightV = '--primary:' + lp + ';--primary-2:' + heroB + ';--on-primary:#FFFFFF;--text-primary:' + ink + ';--success-bg:' + sbl + ';--ink:' + ink + ';';
  var darkV = '--primary:' + dp + ';--primary-2:' + dp + ';--on-primary:' + onDark + ';--success-bg:' + sbd + ';--ink:#F2F1EC;';
  return ':root{' + shared + lightV + '}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + darkV + '}}:root[data-theme="dark"]{' + darkV + '}';
}
function applyCharter() {
  var c = currentCharter(), st = $('charter-style');
  if (!st) { st = document.createElement('style'); st.id = 'charter-style'; document.head.appendChild(st); }
  st.textContent = c ? charterCSS(c) : '';
  var meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', c ? ensure(c.dark, '#FFFFFF', 7, '#000000') : '#0E7C66');
}

function schoolLabel(p) {
  if (p.school === 'default') return '';
  if (p.school === 'custom') return (p.schoolName || '').trim() || 'Mon établissement';
  var s = schoolById(p.school); return s ? s.name : '';
}
function initials() {
  var s = ((profile.first || '').trim().charAt(0) + (profile.last || '').trim().charAt(0)).toUpperCase();
  return s || '?';
}
function renderProfile() {
  document.querySelectorAll('[data-av]').forEach(function (el) {
    el.textContent = '';
    if (profile.photo) { var im = new Image(); im.alt = ''; im.src = profile.photo; el.appendChild(im); } else { el.textContent = initials(); }
  });
  var name = (profile.first || '').trim();
  var full = [profile.first, profile.last].map(function (s) { return (s || '').trim(); }).filter(Boolean).join(' ');
  var school = schoolLabel(profile), sub = [profile.classe, school].filter(Boolean).join(' · ');
  $('greet').hidden = !name;
  $('greetHi').textContent = 'Bonjour ' + name;
  $('greetSub').textContent = sub;
  $('npName').textContent = name || 'Mon profil';
  $('npSchool').textContent = school || 'Personnaliser';
  $('idSchool').textContent = school || 'Mes Finances';
  $('idYear').textContent = profile.year || '';
  $('idName').textContent = full || 'Votre prénom';
  $('idClass').textContent = profile.classe || 'Classe non renseignée';
  var c = charterFor(profile);
  $('swatches').innerHTML = c ? [['Principale', c.dark], ['Secondaire', c.light], ['Texte', c.ink], ['Fond', '#FFFFFF']].map(function (x) {
    return '<div class="sw"><i style="background:' + safeHex(x[1], '#FFFFFF') + '"></i>' + x[0] + '</div>';
  }).join('') : '<p class="empty">Thème par défaut de Mes Finances.</p>';
}
function fillProfileForm() {
  var sel = $('pSchool'), cl = $('pClass');
  if (!sel.options.length) SCHOOLS.forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sel.appendChild(o); });
  if (!cl.options.length) CLASSES.forEach(function (c, i) { var o = document.createElement('option'); o.value = c; o.textContent = i ? c : 'Choisir…'; cl.appendChild(o); });
  $('pFirst').value = profile.first; $('pLast').value = profile.last; sel.value = profile.school; cl.value = profile.classe;
  $('pYear').value = profile.year; $('pSchoolName').value = profile.schoolName;
  $('cDark').value = profile.custom.dark; $('cLight').value = profile.custom.light; $('cInk').value = profile.custom.ink;
  $('customBox').hidden = profile.school !== 'custom';
  $('pUse').checked = profile.useCharter; $('pUse').disabled = profile.school === 'default';
}
function touchProfile() { saveProfile(); applyCharter(); renderProfile(); }
function setField(key, value) { profile[key] = String(value).slice(0, 60); saveProfile(); renderProfile(); }
function setSchool(id) { profile.school = id; if (id !== 'default') profile.useCharter = true; touchProfile(); fillProfileForm(); }
function setColor(key, value) { profile.custom[key] = safeHex(value, profile.custom[key]); touchProfile(); }
function setUseCharter(on) { profile.useCharter = !!on; touchProfile(); }
function removePhoto() { profile.photo = ''; saveProfile(); renderProfile(); }
function resetProfile() { profile = defaultProfile(); touchProfile(); fillProfileForm(); }
function pickPhoto(input) {
  var f = input.files && input.files[0];
  if (!f) return;
  if (!/^image\//.test(f.type)) { alert("Choisissez un fichier image."); return; }
  var r = new FileReader();
  r.onload = function () {
    var im = new Image();
    im.onload = function () {
      var s = Math.min(im.width, im.height), cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      cv.getContext("2d").drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256);
      profile.photo = cv.toDataURL("image/jpeg", 0.82);
      saveProfile(); renderProfile(); input.value = "";
    };
    im.onerror = function () { alert("Image illisible."); };
    im.src = r.result;
  };
  r.readAsDataURL(f);
}

/* ---------- Écran de chargement et verrouillage par code ---------- */

var pinData = DEMO ? null : read(KEYS.pin, null);   // { salt, hash } : jamais le code lui-même
var lockBuf = '', fails = 0, lockUntil = 0, hiddenAt = 0, splashTimer = null;

function hashPin(pin, salt) {
  var text = salt + ':' + pin;
  if (window.crypto && crypto.subtle && window.TextEncoder) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  var h = 5381; for (var i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return Promise.resolve('f' + (h >>> 0).toString(16));
}

function playSplash(ms) {
  var s = $('splash'), n = (profile.first || '').trim();
  $('splashSub').textContent = n ? 'Bonjour ' + n : 'Vos dépenses, recettes et épargne';
  s.hidden = false; s.classList.remove('out', 'run'); void s.offsetWidth; s.classList.add('run');
  clearTimeout(splashTimer); splashTimer = setTimeout(endSplash, ms || 1600);
}
function endSplash() {
  var s = $('splash'); clearTimeout(splashTimer); s.classList.add('out');
  setTimeout(function () { s.hidden = true; }, 400);
}

function buildKeypad() {
  var pad = $('keypad'); if (pad.children.length) return;
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].forEach(function (k) {
    var b = document.createElement(k === '' ? 'span' : 'button');
    if (k !== '') {
      b.type = 'button';
      if (k === 'del') { b.setAttribute('aria-label', 'Effacer'); b.innerHTML = ico('delete'); } else { b.textContent = k; }
      b.onclick = function () { pressKey(k); };
    }
    pad.appendChild(b);
  });
}
function renderDots() { Array.prototype.forEach.call($('lockDots').children, function (d, i) { d.classList.toggle('on', i < lockBuf.length); }); }
function setInert() {
  var on = !$('lock').hidden || !$('auth').hidden;
  [$('content'), document.querySelector('.nav'), document.querySelector('.topbar')].forEach(function (e) { if (e) { if (on) e.setAttribute('inert', ''); else e.removeAttribute('inert'); } });
}
function lockNow() {
  if (!pinData) return;
  var n = (profile.first || '').trim();
  lockBuf = ''; renderDots(); $('lockErr').textContent = ''; $('forgotBox').hidden = true;
  $('wipeBtn').textContent = 'Me déconnecter et supprimer le code';
  $('lockHi').textContent = n ? 'Bonjour ' + n : 'Bienvenue';
  $('lock').hidden = false;
  $('lock').setAttribute('tabindex', '-1'); setInert(); $('lock').focus();
}
function pressKey(k) {
  if ($('lock').hidden) return;
  if (Date.now() < lockUntil) { $('lockErr').textContent = 'Trop d\'essais. Réessayez dans quelques secondes.'; return; }
  if (k === 'del') lockBuf = lockBuf.slice(0, -1); else if (lockBuf.length < 4) lockBuf += k;
  $('lockErr').textContent = ''; renderDots();
  if (lockBuf.length === 4) checkPin();
}
function checkPin() {
  var code = lockBuf;
  hashPin(code, pinData.salt).then(function (h) {
    if (h === pinData.hash) { fails = 0; lockBuf = ''; $('lock').hidden = true; setInert(false); return; }
    fails++; lockBuf = '';
    var d = $('lockDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
    if (fails >= 5) { fails = 0; lockUntil = Date.now() + 30000; $('lockErr').textContent = 'Trop d\'essais. Réessayez dans 30 secondes.'; }
    else { $('lockErr').textContent = 'Code incorrect.'; }
    renderDots();
  });
}
function toggleForgot() { $('forgotBox').hidden = !$('forgotBox').hidden; }
async function wipeAll() {
  var b = $('wipeBtn');
  if (b.textContent.indexOf('Confirmer') !== 0) { b.textContent = 'Confirmer : me déconnecter'; return; }
  pinData = null; write(KEYS.pin, null); try { localStorage.removeItem(KEYS.pin); } catch (e) {}
  $('lock').hidden = true; setInert(); updateSecurityUI();
  await flushProfile(); await MF.auth.signOut();
}
function updateSecurityUI() {
  $('pinOff').hidden = !!pinData; $('pinOn').hidden = !pinData;
  $('pinStatus').textContent = pinData ? 'Activé' : 'Désactivé';
}
function pinMsg(t) { $('pinMsg').textContent = t; }
function enablePin() {
  var a = $('pinNew').value, b = $('pinConfirm').value;
  if (!/^\d{4}$/.test(a)) { pinMsg('Le code doit contenir exactement 4 chiffres.'); return; }
  if (a !== b) { pinMsg('Les deux codes ne sont pas identiques.'); return; }
  var salt = Math.random().toString(36).slice(2);
  hashPin(a, salt).then(function (h) {
    pinData = { salt: salt, hash: h }; write(KEYS.pin, pinData);
    $('pinNew').value = ''; $('pinConfirm').value = ''; updateSecurityUI();
    pinMsg('Code activé. Il sera demandé à la prochaine ouverture.');
  });
}
function disablePin() {
  var c = $('pinCurrent').value;
  hashPin(c, pinData.salt).then(function (h) {
    if (h !== pinData.hash) { pinMsg('Code actuel incorrect.'); return; }
    pinData = null; write(KEYS.pin, null); $('pinCurrent').value = ''; updateSecurityUI(); pinMsg('Code désactivé.');
  });
}
document.addEventListener('keydown', function (e) {
  if ($('lock').hidden) return;
  if (/^\d$/.test(e.key)) pressKey(e.key); else if (e.key === 'Backspace') pressKey('del');
});
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { hiddenAt = Date.now(); flushProfile(); }
  else if (pinData && hiddenAt && Date.now() - hiddenAt > 60000) lockNow();
});
$('splash').addEventListener('click', endSplash);

/* ---------- Rendu général ---------- */

function render() {
  var balances = {}, total = 0, exp = 0, inc = 0, now = new Date();
  ACCOUNTS.forEach(function (a) { balances[a] = 0; });
  transactions.forEach(function (t) {
    var s = t.type === "expense" ? -1 : 1;
    balances[t.account] = (balances[t.account] || 0) + s * t.amount;
    total += s * t.amount;
    if (sameMonth(t.date, now)) { if (t.type === "expense") exp += t.amount; else inc += t.amount; }
  });
  $("totalBalance").textContent = fmt(total);
  $("monthExp").textContent = fmt(exp);
  $("monthInc").textContent = fmt(inc);

  $("accountsRow").innerHTML = ACCOUNTS.slice(0, 3).map(function (a) {
    var c = ACC_COLORS[a];
    return '<div class="account-card" style="background:var(' + c[0] + ');color:var(' + c[1] + ')"><p>' + a + '</p><b>' + fmt(balances[a]) + '</b></div>';
  }).join("");

  var pct = goal.target > 0 ? Math.min(100, Math.round(goal.saved / goal.target * 100)) : 0;
  $("goalSub").textContent = fmt(goal.saved) + " / " + fmt(goal.target);
  $("goalFill").style.width = pct + "%";
  $("goalFillBig").style.width = pct + "%";
  $("goalPercentBig").textContent = pct + "%";
  $("goalSubBig").textContent = fmt(goal.saved) + " sur " + fmt(goal.target);
  $("goalTargetInput").value = goal.target;
  $("goalSavedInput").value = goal.saved;

  var recent = transactions.slice().sort(function (a, b) { return b.date - a.date; }).slice(0, 7);
  $("txList").innerHTML = recent.map(function (t) {
    var c = ACC_COLORS[t.account], days = Math.floor((now - t.date) / 86400000);
    var when = days < 1 ? "Aujourd'hui" : days === 1 ? "Hier" : t.date.toLocaleDateString("fr-FR");
    var color = t.type === "expense" ? "--danger" : "--primary";
    return '<div class="tx"><div class="tx-ic" style="background:var(' + c[0] + ');color:var(' + c[1] + ')">' + ico(CAT_ICON[t.category] || "dots") + '</div><div>' + esc(t.label || t.category) + '<small>' + t.account + ' · ' + when + '</small></div><b style="color:var(' + color + ')">' + (t.type === "expense" ? "-" : "+") + fmt(t.amount) + '</b><button type="button" class="tx-del' + (pendingDelete === t.id ? ' sure' : '') + '" data-click="askDelete|' + esc(t.id) + '" aria-label="Supprimer cette transaction">' + (pendingDelete === t.id ? 'Supprimer ?' : ico('trash')) + '</button></div>';
  }).join("") || '<p class="empty">Aucune transaction pour l\'instant. Ajoutez la première !</p>';

  $("accountChips").innerHTML = ACCOUNTS.map(function (a) {
    return '<button type="button" aria-pressed="' + (a === selAccount) + '" class="chip' + (a === selAccount ? " sel" : "") + '" data-click="setAccount|' + a + '">' + a + '</button>';
  }).join("");
  $("categoryChips").innerHTML = CATEGORIES.map(function (c) {
    return '<button type="button" aria-pressed="' + (c === selCategory) + '" class="chip' + (c === selCategory ? " sel" : "") + '" data-click="setCategory|' + c + '">' + c + '</button>';
  }).join("");

  renderStats();
  renderProfile();
}

/* ---------- Navigation et actions ---------- */

function showScreen(name) {
  if (name === 'admin' && !isAdminUser) name = 'home';
  document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
  $("screen-" + name).classList.add("active");
  var tab = (name === "privacy" || name === "terms" || name === "security" || name === "account") ? "settings" : name;
  document.querySelectorAll(".nav button").forEach(function (b) { var on = b.getAttribute("data-s") === tab; b.classList.toggle("on", on); if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  if (name === "profile") fillProfileForm();
  if (name === "admin") adminTab(adminTabName);
  if (name === "security") updateSecurityUI();
  $("content").scrollTop = 0;
}

function selectType(type) {
  selType = type;
  $("type-expense").className = "type-btn" + (type === "expense" ? " sel-exp" : "");
  $("type-income").className = "type-btn" + (type === "income" ? " sel-inc" : "");
  $("type-expense").setAttribute("aria-pressed", type === "expense"); $("type-income").setAttribute("aria-pressed", type === "income");
}

function setAccount(a) { selAccount = a; render(); }
function setCategory(c) { selCategory = c; render(); }

async function submitTransaction() {
  var v = Math.round(parseFloat($("amountInput").value) * 100) / 100;
  if (!v || v <= 0 || v >= 1e12) { toast("Entrez un montant valide.", "error"); return; }
  var tx = { id: 'tmp' + Date.now(), type: selType, amount: v, account: selAccount, category: selCategory, label: $("noteInput").value.trim().slice(0, 80), date: new Date() };
  transactions.push(tx);
  $("amountInput").value = ""; $("noteInput").value = "";
  render(); showScreen("home");
  try { var saved = await MF.data.addTransaction(tx); tx.id = saved.id; tx.date = saved.date; render(); }
  catch (e) { transactions = transactions.filter(function (x) { return x !== tx; }); render(); toast(e.userMessage || "La transaction n'a pas pu être enregistrée.", "error"); }
}

async function updateGoal() {
  var tg = parseFloat($("goalTargetInput").value), s = parseFloat($("goalSavedInput").value);
  if (!tg || tg <= 0 || isNaN(s) || s < 0 || tg >= 1e12 || s >= 1e12) { toast("Valeurs invalides.", "error"); return; }
  var before = goal; goal = { target: tg, saved: s }; render();
  try { await MF.data.saveGoal(goal); toast("Objectif enregistré."); }
  catch (e) { goal = before; render(); toast(e.userMessage || "L'objectif n'a pas pu être enregistré.", "error"); }
}

async function askDelete(id) {
  if (String(id).indexOf('tmp') === 0) { toast("Enregistrement en cours, réessayez dans un instant."); return; }
  if (pendingDelete !== id) {
    pendingDelete = id; clearTimeout(deleteTimer);
    deleteTimer = setTimeout(function () { pendingDelete = null; render(); }, 4000); render(); return;
  }
  pendingDelete = null; clearTimeout(deleteTimer);
  var tx = transactions.filter(function (x) { return x.id === id; })[0]; if (!tx) return;
  transactions = transactions.filter(function (x) { return x.id !== id; }); render();
  try { await MF.data.deleteTransaction(id); }
  catch (e) { transactions.push(tx); render(); toast(e.userMessage || "La suppression a échoué.", "error"); }
}

function exportCSV() {
  if (DEMO) { alert("L'export CSV fonctionne dans la version en ligne."); return; }
  if (!transactions.length) { alert("Aucune transaction à exporter."); return; }
  var rows = transactions.slice().sort(function (a, b) { return a.date - b.date; }).map(function (t) {
    return [t.date.toLocaleDateString("fr-FR"), t.type === "expense" ? "Depense" : "Recette", t.account, t.category, csvCell(t.label), t.amount].join(";");
  });
  var blob = new Blob(["Date;Type;Compte;Categorie;Note;Montant\n" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "mes_finances_export.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/* ---------- Thème et mise en page ---------- */

function selectAppearance(mode) {
  ["system", "light", "dark"].forEach(function (k) { $("chk-" + k).classList.toggle("shown", k === mode); });
  var root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", mode);
  if (!DEMO) { try { if (mode === "system") localStorage.removeItem(KEYS.theme); else localStorage.setItem(KEYS.theme, mode); } catch (e) {} }
}

function setLayout(desk) {
  $("app").classList.toggle("desk", desk);
  $("app").classList.toggle("mob", !desk);
}

/* ---------- Compte utilisateur : connexion, inscription, session ---------- */

var POLICY_VERSION = '2026-11';
var authMode = 'login', authBusy = false, authFails = 0, authLockUntil = 0, sentText = '', pendingDelete = null, deleteTimer = null, installEvent = null;
var AUTH_TITLES = { login: 'Connexion', signup: 'Créer un compte', forgot: 'Mot de passe oublié', reset: 'Nouveau mot de passe', sent: 'Vérifiez votre boîte mail', config: 'Configuration manquante' };
var AUTH_SUBS = { login: 'Retrouvez vos données sur tous vos appareils.', signup: 'Un compte protège vos données et les rend disponibles partout.',
                  forgot: 'Entrez votre e-mail : nous vous envoyons un lien pour choisir un nouveau mot de passe.', reset: "Choisissez un mot de passe d'au moins 10 caractères.", sent: '', config: '' };
var COMMON_PW = ['1234567890', 'password12', 'motdepasse', '0123456789', 'azertyuiop', 'qwertyuiop', 'passw0rd123', 'mesfinances'];

function toast(msg, kind) {
  var el = $('toast'); el.textContent = msg; el.className = 'toast' + (kind === 'error' ? ' error' : ''); el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(function () { el.hidden = true; }, kind === 'error' ? 6000 : 3500);
}
function setBanner(text) { $('banner').hidden = !text; $('bannerText').textContent = text || ''; }
function setAuthMsg(text, kind) { var m = $('authMsg'); m.textContent = text || ''; m.className = 'auth-msg' + (kind === 'info' ? ' info' : ''); }
function renderAuth() {
  var m = authMode;
  $('authTitle').textContent = AUTH_TITLES[m]; $('authSub').textContent = AUTH_SUBS[m];
  document.querySelectorAll('#auth [data-am]').forEach(function (el) { el.hidden = el.getAttribute('data-am').split(' ').indexOf(m) < 0; });
  document.querySelector('#auth [data-demo]').hidden = !(MF.mode === 'memory' && m === 'login');
  $('aPass').setAttribute('autocomplete', (m === 'signup' || m === 'reset') ? 'new-password' : 'current-password');
  $('aPassLabel').textContent = m === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe';
  $('authSubmit').textContent = { login: 'Se connecter', signup: 'Créer mon compte', forgot: 'Envoyer le lien', reset: 'Enregistrer le mot de passe' }[m] || '';
  $('authForm').hidden = (m === 'sent' || m === 'config');
  $('sentText').textContent = sentText;
}
function showAuth(mode, info) { authMode = mode; $('auth').hidden = false; renderAuth(); setAuthMsg(info || '', 'info'); setInert(); }
function hideAuth() { $('auth').hidden = true; $('aPass').value = ''; setAuthMsg(''); setInert(); }
function setAuthMode(mode) { authMode = mode; setAuthMsg(''); renderAuth(); }
function togglePw() {
  var i = $('aPass'), show = i.type === 'password'; i.type = show ? 'text' : 'password';
  $('pwToggle').textContent = show ? 'Masquer' : 'Afficher'; $('pwToggle').setAttribute('aria-pressed', show);
}
function cancelReset() { if (MF.auth.user()) hideAuth(); else setAuthMode('login'); }
function validEmail(e) { return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }
function checkPassword(pw, email) {
  if (pw.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (pw.length > 72) return 'Le mot de passe est trop long (72 caractères maximum).';
  if (/^\d+$/.test(pw)) return 'Le mot de passe ne peut pas être composé uniquement de chiffres.';
  var local = (email || '').split('@')[0];
  if (local.length >= 4 && pw.toLowerCase().indexOf(local.toLowerCase()) >= 0) return 'Le mot de passe ne doit pas contenir votre adresse e-mail.';
  if (COMMON_PW.indexOf(pw.toLowerCase()) >= 0 || /^(.)\1+$/.test(pw)) return 'Ce mot de passe est trop courant. Choisissez-en un autre.';
  return '';
}
async function submitAuth(ev) {
  ev.preventDefault();
  if (authBusy) return;
  var m = authMode, email = $('aEmail').value.trim().toLowerCase(), pw = $('aPass').value, remember = $('aRemember').checked;
  setAuthMsg('');
  if (Date.now() < authLockUntil) { setAuthMsg('Trop d\'essais. Patientez quelques secondes avant de réessayer.'); return; }
  if (m !== 'reset' && !validEmail(email)) { setAuthMsg('Entrez une adresse e-mail valide.'); return; }
  if (m === 'login' && !pw) { setAuthMsg('Entrez votre mot de passe.'); return; }
  if (m === 'signup' || m === 'reset') { var pe = checkPassword(pw, email); if (pe) { setAuthMsg(pe); return; } }
  if (m === 'signup' && !($('aTerms').checked && $('aAge').checked)) { setAuthMsg('Cochez les deux cases pour créer votre compte.'); return; }
  authBusy = true; $('authSubmit').disabled = true;
  try {
    if (m === 'login') { await MF.auth.signIn(email, pw, remember); authFails = 0; }
    else if (m === 'signup') {
      var meta = { consent_at: new Date().toISOString(), consent_version: POLICY_VERSION, adult_or_guardian_ok: true };
      var first = $('aFirst').value.trim().slice(0, 30); if (first) meta.first_name = first;
      var r = await MF.auth.signUp(email, pw, meta, remember);
      if (r.needsConfirm) { sentText = "Si l'adresse est valide, un e-mail de confirmation vient d'être envoyé. Cliquez sur le lien qu'il contient, puis connectez-vous."; setAuthMode('sent'); }
    } else if (m === 'forgot') {
      await MF.auth.recover(email);
      sentText = "Si un compte existe pour cette adresse, un e-mail contenant un lien vient d'être envoyé."; setAuthMode('sent');
    } else if (m === 'reset') { await MF.auth.updatePassword(pw); hideAuth(); toast('Mot de passe modifié.'); }
  } catch (err) {
    if (m === 'login') { authFails++; if (authFails >= 5) { authFails = 0; authLockUntil = Date.now() + 30000; } }
    setAuthMsg(err.userMessage || 'Une erreur est survenue. Réessayez.');
  } finally { authBusy = false; $('authSubmit').disabled = false; }
}

async function loadAllData() {
  try {
    var d = await MF.data.loadAll();
    transactions = d.transactions; goal = d.goal || { target: 100000, saved: 0 }; profile = d.profile ? normalizeProfile(d.profile) : defaultProfile();
    setBanner('');
  } catch (e) { setBanner(e.userMessage || 'Impossible de charger vos données.'); }
  applyCharter(); render(); fillProfileForm(); updateAccountUI(); checkAdmin();
}
function retryLoad() { loadAllData(); }
function updateAccountUI() {
  var u = MF.auth.user();
  $('acctEmail').textContent = u ? u.email : 'Mon compte'; $('acctEmail2').textContent = u ? u.email : '';
}
function onAuthChange(user, reason) {
  if (reason === 'refreshed' || reason === 'link') return;
  if (user) onSignedIn(reason); else onSignedOut(reason);
}
async function onSignedIn(reason) {
  hideAuth(); $('lock').hidden = true; setInert();
  await loadAllData(); showScreen('home'); checkLegacy();
  if (reason === 'signup') toast('Bienvenue ! Votre compte est créé.');
}
function onSignedOut(reason) {
  transactions = []; goal = { target: 100000, saved: 0 }; profile = defaultProfile(); pendingProfile = false; clearTimeout(saveTimer);
  $('lock').hidden = true; isAdminUser = false; updateAdminUI(); applyCharter(); render(); updateAccountUI(); showScreen('home');
  showAuth('login', reason === 'expired' ? 'Votre session a expiré. Reconnectez-vous.' : reason === 'deleted' ? 'Votre compte et vos données ont été supprimés.' : '');
}
async function signOutNow() { await flushProfile(); await MF.auth.signOut(); }
function startPasswordChange() { showAuth('reset'); }
function enterDemo() { MF.auth.signInDemo({ transactions: demoData(), goal: { target: 150000, saved: 60000 }, profile: demoProfile() }); }
function delCheck(v) { $('delBtn').disabled = String(v).trim() !== 'SUPPRIMER'; }
async function deleteAccount() {
  if ($('delBtn').disabled) return;
  try { await MF.data.deleteAccount(); $('delConfirm').value = ''; $('delBtn').disabled = true; }
  catch (e) { toast(e.userMessage || 'La suppression a échoué.', 'error'); }
}

/* Données enregistrées sur cet appareil avant l'arrivée des comptes : import facultatif */
function legacyData() {
  try {
    var arr = JSON.parse(localStorage.getItem(KEYS.tx) || '[]');
    if (!Array.isArray(arr)) return [];
    return arr.map(function (x) {
      var d = new Date(x.date), a = Number(x.amount);
      if ((x.type !== 'expense' && x.type !== 'income') || !(a > 0 && a < 1e12) || ACCOUNTS.indexOf(x.account) < 0 || CATEGORIES.indexOf(x.category) < 0 || isNaN(d)) return null;
      return { type: x.type, amount: Math.round(a * 100) / 100, account: x.account, category: x.category, label: String(x.label || '').slice(0, 80), date: d };
    }).filter(Boolean);
  } catch (e) { return []; }
}
function checkLegacy() {
  if (MF.mode !== 'remote') { $('importBox').hidden = true; return; }
  var n = legacyData().length; $('importBox').hidden = n === 0;
  if (n) $('importText').textContent = 'Cet appareil contient ' + n + ' transaction(s) enregistrée(s) avant la création des comptes. Vous pouvez les importer dans votre compte.';
}
function clearLegacy() { try { localStorage.removeItem(KEYS.tx); localStorage.removeItem(KEYS.goal); localStorage.removeItem(KEYS.profile); } catch (e) {} }
async function importLocal() {
  var list = legacyData(); if (!list.length) return;
  try { await MF.data.importTransactions(list); clearLegacy(); await loadAllData(); checkLegacy(); toast(list.length + ' transaction(s) importée(s).'); }
  catch (e) { toast(e.userMessage || "L'import a échoué.", 'error'); }
}
function discardLocal() { clearLegacy(); checkLegacy(); toast('Données de cet appareil effacées.'); }
function installApp() { if (installEvent) { installEvent.prompt(); installEvent = null; $('installBox').hidden = true; } }

/* ---------- Espace administrateur ---------- */
/* L'interface n'affiche cet espace qu'aux administrateurs, mais la vraie protection est dans la base de données :
   chaque appel est refusé (« forbidden ») si le compte n'est pas administrateur. */
var isAdminUser = false, adminTabName = 'dash', adminUsers = [], adminTotal = 0, adminOpen = null, adminConfirm = null, adminSearchTimer = null, adminBusy = false;
function checkAdmin() { MF.admin.isAdmin().then(function (v) { isAdminUser = !!v; updateAdminUI(); }); }
function updateAdminUI() {
  $('navAdmin').hidden = !isAdminUser; $('adminGroup').hidden = !isAdminUser;
  if (!isAdminUser && $('screen-admin').classList.contains('active')) showScreen('home');
}
function adminError(e) {
  if (e && e.status === 403 && e.serverMessage === 'forbidden') { isAdminUser = false; updateAdminUI(); }
  toast((e && e.userMessage) || 'Une erreur est survenue.', 'error');
}
function adminTab(name) {
  adminTabName = name;
  ['dash', 'users', 'log'].forEach(function (k) {
    $('admin-' + k).hidden = k !== name; $('atab-' + k).classList.toggle('on', k === name); $('atab-' + k).setAttribute('aria-selected', k === name);
  });
  if (name === 'dash') loadAdminDash(); else if (name === 'users') loadAdminUsers(true); else loadAdminLog();
}
function schoolDisplay(key) { if (!key) return 'Sans établissement'; var s = schoolById(key); return s ? s.name : key; }
function dayLabel(d) { var p = String(d).split('-'); return p[2] + '/' + p[1]; }
function miniBars(values, labels, color) {
  var max = Math.max.apply(null, values.concat(1)), x0 = 30, y0 = 12, y1 = 130, gw = (354 - x0) / values.length, bw = Math.min(16, gw - 4);
  var s = '<svg class="chart" viewBox="0 0 360 160" role="img" aria-label="Évolution sur ' + values.length + ' jours">';
  [0, 1].forEach(function (f) { var y = y1 - f * (y1 - y0); s += '<line x1="' + x0 + '" x2="354" y1="' + y + '" y2="' + y + '" stroke="var(--border)"/><text class="ax" x="' + (x0 - 5) + '" y="' + (y + 3) + '" text-anchor="end">' + Math.round(max * f) + '</text>'; });
  values.forEach(function (v, i) {
    var h = v / max * (y1 - y0), xc = x0 + gw * i + gw / 2;
    s += '<rect x="' + (xc - bw / 2) + '" y="' + (y1 - h) + '" width="' + bw + '" height="' + h + '" rx="3" fill="' + color + '"><title>' + esc(labels[i]) + ' : ' + v + '</title></rect>';
    if (i % 3 === 0) s += '<text class="ax" x="' + xc + '" y="148" text-anchor="middle">' + esc(labels[i]) + '</text>';
  });
  return s + '</svg>';
}
async function loadAdminDash() {
  try {
    var r = await Promise.all([MF.admin.stats(), MF.admin.series(14), MF.admin.schools()]), s = r[0];
    var tiles = [['Comptes', s.users_total], ['Confirmés', s.users_confirmed], ['Nouveaux (7 j)', s.new_7d], ['Nouveaux (30 j)', s.new_30d], ['Actifs (7 j)', s.active_7d], ['Actifs (30 j)', s.active_30d], ['Transactions', s.tx_total], ['Suspendus', s.users_banned]];
    $('adminKpis').innerHTML = tiles.map(function (x) { return '<div class="kpi"><p>' + x[0] + '</p><b>' + Number(x[1]).toLocaleString('fr-FR') + '</b></div>'; }).join('');
    var labels = r[1].map(function (v) { return dayLabel(v.day); });
    $('adminSignups').innerHTML = miniBars(r[1].map(function (v) { return v.signups; }), labels, 'var(--primary)');
    $('adminTx').innerHTML = miniBars(r[1].map(function (v) { return v.tx; }), labels, '#4F86E8');
    var items = r[2].map(function (x) { return { cat: schoolDisplay(x.key), amt: x.n }; }), total = items.reduce(function (a, x) { return a + x.amt; }, 0);
    if (total > 0) {
      $('adminDonut').innerHTML = donutSVG(items, total, String, 'Comptes par établissement');
      $('adminLegend').innerHTML = items.map(function (it, i) { return '<li><i style="background:' + PALETTE[i % PALETTE.length] + '"></i>' + esc(it.cat) + '<em>' + it.amt + ' · ' + Math.round(it.amt / total * 100) + '%</em></li>'; }).join('');
    } else { $('adminDonut').innerHTML = '<p class="empty">Aucun compte.</p>'; $('adminLegend').innerHTML = ''; }
  } catch (e) { adminError(e); }
}
async function loadAdminUsers(reset) {
  if (reset) { adminUsers = []; adminTotal = 0; adminOpen = null; adminConfirm = null; }
  try {
    var list = await MF.admin.users($('adminSearch').value.trim(), 20, adminUsers.length);
    adminUsers = adminUsers.concat(list); if (list.length) adminTotal = list[0].total;
  } catch (e) { adminError(e); return; }
  renderAdminUsers();
}
function adminSearch() { clearTimeout(adminSearchTimer); adminSearchTimer = setTimeout(function () { loadAdminUsers(true); }, 350); }
function adminMore() { loadAdminUsers(false); }
function fmtDay(d) { return d ? d.toLocaleDateString('fr-FR') : '—'; }
function renderAdminUsers() {
  $('adminCount').textContent = adminTotal + (adminTotal > 1 ? ' comptes' : ' compte') + ($('adminSearch').value.trim() ? ' trouvé(s)' : '');
  $('adminMore').hidden = adminUsers.length >= adminTotal;
  $('adminUsers').innerHTML = adminUsers.map(function (u) {
    var open = adminOpen === u.id, school = u.school === 'custom' ? u.schoolName : (u.school && u.school !== 'default' ? schoolDisplay(u.school) : '');
    var sub = [u.first, u.classe, school].filter(Boolean).map(esc).join(' · ') || 'Profil non renseigné';
    var badges = (u.admin ? '<span class="badge ok">Administrateur</span>' : '') + (u.confirmed ? '<span class="badge ok">E-mail confirmé</span>' : '<span class="badge">E-mail non confirmé</span>') + (u.banned ? '<span class="badge warn">Suspendu</span>' : '');
    var actions = '';
    if (open) {
      if (u.admin) actions = '<p class="hint">Compte administrateur : suspension et suppression impossibles ici.</p>';
      else if (adminConfirm && adminConfirm.id === u.id) actions = '<p class="confirm-line">Supprimer définitivement ' + esc(u.email) + ' et toutes ses données ?</p><button type="button" class="btn-sm danger" data-click="adminDelete|' + esc(u.id) + '">Confirmer la suppression</button><button type="button" class="btn-sm" data-click="adminCancel">Annuler</button>';
      else actions = '<button type="button" class="btn-sm" data-click="adminBan|' + esc(u.id) + '|' + (u.banned ? '0' : '1') + '">' + (u.banned ? 'Réactiver le compte' : 'Suspendre le compte') + '</button><button type="button" class="btn-sm danger" data-click="adminAskDelete|' + esc(u.id) + '">Supprimer le compte</button>';
      actions = '<div class="urow-actions">' + actions + '</div>';
    }
    return '<div class="urow"><button type="button" class="urow-head" aria-expanded="' + open + '" data-click="adminToggle|' + esc(u.id) + '"><span class="av">' + esc((u.email || '?').charAt(0).toUpperCase()) + '</span><span class="urow-main"><span class="urow-email" style="display:block">' + esc(u.email) + '</span><span class="urow-sub" style="display:block">' + sub + '</span><span class="urow-meta" style="display:block">Inscrit le ' + fmtDay(u.created) + ' · Dernière connexion ' + fmtDay(u.lastLogin) + ' · ' + u.tx + ' transaction(s)</span><span class="badges">' + badges + '</span></span></button>' + actions + '</div>';
  }).join('') || '<p class="empty">Aucun compte ne correspond.</p>';
}
function adminToggle(id) { adminOpen = adminOpen === id ? null : id; adminConfirm = null; renderAdminUsers(); }
function adminAskDelete(id) { adminConfirm = { id: id }; renderAdminUsers(); }
function adminCancel() { adminConfirm = null; renderAdminUsers(); }
async function adminBan(id, flag) {
  if (adminBusy) return; adminBusy = true;
  try { await MF.admin.setBanned(id, flag === '1'); var u = adminUsers.filter(function (x) { return x.id === id; })[0]; if (u) u.banned = flag === '1'; toast(flag === '1' ? 'Compte suspendu.' : 'Compte réactivé.'); }
  catch (e) { adminError(e); }
  adminBusy = false; renderAdminUsers();
}
async function adminDelete(id) {
  if (adminBusy) return; adminBusy = true;
  try { await MF.admin.deleteUser(id); adminUsers = adminUsers.filter(function (x) { return x.id !== id; }); adminTotal = Math.max(0, adminTotal - 1); adminOpen = null; adminConfirm = null; toast('Compte supprimé.'); }
  catch (e) { adminError(e); }
  adminBusy = false; renderAdminUsers();
}
async function loadAdminLog() {
  try {
    var rows = await MF.admin.audit(), lab = { ban: 'Compte suspendu', unban: 'Compte réactivé', delete_user: 'Compte supprimé' };
    $('adminLog').innerHTML = rows.map(function (r) { return '<div class="logrow">' + esc(lab[r.action] || r.action) + ' : ' + esc(r.target) + '<small>Par ' + esc(r.admin) + ' · ' + r.at.toLocaleString('fr-FR') + '</small></div>'; }).join('') || '<p class="empty">Aucune action enregistrée pour le moment.</p>';
  } catch (e) { adminError(e); }
}

/* ---------- Actions déclenchées par les attributs data-click / data-input / data-change ---------- */
/* (aucun gestionnaire en ligne dans le HTML : la politique de sécurité n'autorise que les scripts de l'application) */
var ACTIONS = {
  disablePin: disablePin, enablePin: enablePin, exportCSV: exportCSV, lockNow: lockNow, pickPhoto: pickPhoto, removePhoto: removePhoto, resetProfile: resetProfile,
  selectAppearance: selectAppearance, selectType: selectType, setColor: setColor, setField: setField, setPeriod: setPeriod, setSchool: setSchool, setUseCharter: setUseCharter,
  showScreen: showScreen, submitTransaction: submitTransaction, toggleForgot: toggleForgot, updateGoal: updateGoal, wipeAll: wipeAll,
  setAccount: setAccount, setCategory: setCategory, authMode: setAuthMode, togglePw: togglePw, cancelReset: cancelReset, enterDemo: enterDemo,
  startPasswordChange: startPasswordChange, signOutNow: signOutNow, deleteAccount: deleteAccount, delCheck: delCheck, importLocal: importLocal,
  discardLocal: discardLocal, retryLoad: retryLoad, askDelete: askDelete, installApp: installApp,
  adminTab: adminTab, adminSearch: adminSearch, adminMore: adminMore, adminToggle: adminToggle, adminAskDelete: adminAskDelete, adminCancel: adminCancel, adminBan: adminBan, adminDelete: adminDelete
};
['click', 'input', 'change'].forEach(function (type) {
  document.addEventListener(type, function (e) {
    var el = e.target.closest ? e.target.closest('[data-' + type + ']') : null; if (!el) return;
    var parts = el.getAttribute('data-' + type).split('|'), fn = ACTIONS[parts[0]]; if (!fn) return;
    var args = parts.slice(1);
    if (type !== 'click') args.push(el.type === 'checkbox' ? el.checked : el.type === 'file' ? el : el.value);
    fn.apply(null, args);
  });
});

/* ---------- Démarrage ---------- */

async function boot() {
  var t0 = Date.now();
  playSplash(30000);
  if (MF.mode === 'unconfigured') { sentText = "L'application n'est pas encore reliée à sa base de données. Renseignez config.js (voir le README)."; showAuth('config'); setTimeout(endSplash, 900); return; }
  var res = { type: null, error: null };
  try { res = await MF.auth.init(); } catch (e) {}
  if (MF.auth.user()) {
    await loadAllData();
    if (res.type === 'recovery') showAuth('reset'); else if (pinData) lockNow();
    if (res.type === 'signup') toast('Adresse e-mail confirmée. Bienvenue !');
    checkLegacy();
  } else { showAuth('login', res.error || ''); }
  setTimeout(endSplash, Math.max(0, 1300 - (Date.now() - t0)));
}

(function init() {
  var saved = null;
  if (!DEMO) { try { saved = localStorage.getItem(KEYS.theme); } catch (e) {} }
  selectAppearance(saved === "light" || saved === "dark" ? saved : "system");
  if (!window.MF_MOCK) { // site réel : bascule automatique mobile / bureau selon la largeur de la fenêtre
    var mq = window.matchMedia("(min-width: 860px)");
    setLayout(mq.matches);
    mq.addEventListener("change", function (e) { setLayout(e.matches); });
  }
  applyCharter();
  render();
  selectType(selType); buildKeypad(); updateSecurityUI();
  $('authForm').addEventListener('submit', submitAuth);
  MF.auth.onChange(onAuthChange);
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvent = e; $('installBox').hidden = false; });
  window.addEventListener('pagehide', flushProfile);
  if (!DEMO && 'serviceWorker' in navigator && (location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) navigator.serviceWorker.register('sw.js').catch(function () {});
  boot();
})();
