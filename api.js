/* Mes Finances — accès au compte utilisateur et aux données.
   Client minimal pour Supabase (Auth + PostgREST), sans bibliothèque externe :
   rien d'autre que ce fichier n'est exécuté, ce qui permet une politique de sécurité (CSP) stricte.
   La clé "anon" de config.js est publique par conception : la protection des données repose sur les
   règles RLS de la base (voir supabase/schema.sql), pas sur le secret de cette clé. */
(function (global) {
  'use strict';

  var cfg = global.MF_CONFIG || {};
  var SESSION_KEY = 'mes-finances-session';
  var listeners = [];
  var session = null;
  var refreshing = null;

  /* ---------- Utilitaires ---------- */

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function now() { return Math.floor(Date.now() / 1000); }
  function isUuid(s) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s)); }

  function userMessage(status, code) {
    if (status === 0) return 'Connexion impossible. Vérifiez votre réseau puis réessayez.';
    if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'Trop de tentatives. Patientez quelques minutes avant de réessayer.';
    switch (code) {
      case 'invalid_credentials': return 'E-mail ou mot de passe incorrect.';
      case 'email_not_confirmed': return "Confirmez d'abord votre adresse e-mail (lien reçu par e-mail).";
      case 'weak_password': return 'Mot de passe trop faible : choisissez-en un plus long et moins courant.';
      case 'user_already_exists': case 'email_exists': return "Impossible de créer ce compte. Essayez de vous connecter ou de réinitialiser votre mot de passe.";
      case 'user_banned': return "Ce compte est suspendu. Contactez l'administrateur.";
      case 'signup_disabled': return 'Les inscriptions sont fermées pour le moment.';
      case 'same_password': return "Le nouveau mot de passe doit être différent de l'ancien.";
      case 'session_not_found': case 'refresh_token_not_found': case 'refresh_token_already_used': return 'Votre session a expiré. Reconnectez-vous.';
      case 'validation_failed': case 'bad_json': return 'Adresse e-mail invalide.';
    }
    if (status === 401 || status === 403) return 'Session expirée ou accès refusé. Reconnectez-vous.';
    if (status >= 500) return 'Le service est momentanément indisponible. Réessayez plus tard.';
    return 'Une erreur est survenue. Réessayez.';
  }
  var SERVER_MESSAGES = {
    forbidden: 'Accès réservé aux administrateurs.',
    cannot_target_self: 'Vous ne pouvez pas appliquer cette action à votre propre compte.',
    cannot_target_admin: 'Cette action ne peut pas viser un administrateur.',
    not_found: 'Compte introuvable (déjà supprimé ?).'
  };
  function makeError(status, code, message) {
    var e = new Error(code || 'error');
    e.status = status; e.code = code || 'error'; e.serverMessage = message || '';
    e.userMessage = SERVER_MESSAGES[message] || userMessage(status, code);
    return e;
  }

  function jwtPayload(tok) {
    try {
      var p = String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var bytes = Uint8Array.from(atob(p), function (c) { return c.charCodeAt(0); });
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { return {}; }
  }

  /* ---------- Session (jamais écrite dans la console) ---------- */

  function readSession() {
    try {
      var raw = global.localStorage.getItem(SESSION_KEY) || global.sessionStorage.getItem(SESSION_KEY);
      var s = raw ? JSON.parse(raw) : null;
      return s && s.access_token && s.refresh_token && s.user ? s : null;
    } catch (e) { return null; }
  }
  function writeSession(s) {
    try {
      global.localStorage.removeItem(SESSION_KEY); global.sessionStorage.removeItem(SESSION_KEY);
      if (s) (s.remember ? global.localStorage : global.sessionStorage).setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) { /* stockage indisponible : la session reste en mémoire */ }
  }
  function setSession(s, reason) {
    session = s; writeSession(s);
    listeners.forEach(function (fn) { try { fn(s ? s.user : null, reason || null); } catch (e) {} });
  }
  function sessionFrom(data, remember) {
    var p = jwtPayload(data.access_token), u = data.user || {};
    return {
      access_token: data.access_token, refresh_token: data.refresh_token,
      expires_at: data.expires_at || (now() + (data.expires_in || 3600)),
      user: { id: u.id || p.sub, email: u.email || p.email || '' }, remember: remember !== false
    };
  }

  /* ---------- Requêtes ---------- */

  var base = String(cfg.SUPABASE_URL || '').replace(/\/+$/, '');
  var anonKey = String(cfg.SUPABASE_ANON_KEY || '');

  async function http(method, path, opts) {
    opts = opts || {};
    var headers = { apikey: anonKey, 'Content-Type': 'application/json' };
    headers.Authorization = 'Bearer ' + ((!opts.anon && session && session.access_token) || anonKey);
    if (opts.prefer) headers.Prefer = opts.prefer;
    var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, 15000), res;
    try {
      res = await fetch(base + path, {
        method: method, headers: headers, signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) { throw makeError(0, 'network'); } finally { clearTimeout(timer); }
    var text = await res.text(), data = null;
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (res.status === 401 && !opts.anon && !opts.retried && session) {
      await refresh();
      return http(method, path, Object.assign({}, opts, { retried: true }));
    }
    if (!res.ok) throw makeError(res.status, data && (data.error_code || data.code) || 'error', data && (data.message || data.msg));
    return data;
  }

  function refresh() {
    if (refreshing) return refreshing;
    var rt = session && session.refresh_token, remember = session ? session.remember : true;
    refreshing = http('POST', '/auth/v1/token?grant_type=refresh_token', { anon: true, retried: true, body: { refresh_token: rt } })
      .then(function (d) { setSession(sessionFrom(d, remember), 'refreshed'); })
      .catch(function (e) { if (e.status !== 0) setSession(null, 'expired'); throw e; })
      .then(function (v) { refreshing = null; return v; }, function (e) { refreshing = null; throw e; });
    return refreshing;
  }
  async function fresh() { if (session && session.expires_at - now() < 60) await refresh(); }

  function redirectUrl() { return cfg.APP_URL || (global.location.origin + global.location.pathname); }

  /* ---------- Authentification ---------- */

  var remoteAuth = {
    /* Au démarrage : traite un lien reçu par e-mail (confirmation / mot de passe oublié) puis restaure la session. */
    init: async function () {
      var out = { type: null, error: null };
      var h = global.location.hash || '';
      if (h.length > 1) {
        var p = new URLSearchParams(h.slice(1));
        if (p.get('error') || p.get('error_code')) {
          out.error = 'Ce lien est invalide ou a expiré. Recommencez la procédure.';
          global.history.replaceState(null, '', global.location.pathname + global.location.search);
        } else if (p.get('access_token') && p.get('refresh_token')) {
          setSession(sessionFrom({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: Number(p.get('expires_in')) || 3600 }, true), 'link');
          out.type = p.get('type') || 'signup';
          global.history.replaceState(null, '', global.location.pathname + global.location.search);
          return out;
        }
      }
      var s = readSession();
      if (s) {
        session = s;
        try { await fresh(); } catch (e) { if (e.status !== 0) session = null; }
      }
      return out;
    },
    user: function () { return session ? session.user : null; },
    onChange: function (fn) { listeners.push(fn); },
    signUp: async function (email, password, meta, remember) {
      var d = await http('POST', '/auth/v1/signup?redirect_to=' + encodeURIComponent(redirectUrl()), { anon: true, body: { email: email, password: password, data: meta || {} } });
      if (d && d.access_token) { setSession(sessionFrom(d, remember), 'signup'); return { needsConfirm: false }; }
      return { needsConfirm: true };
    },
    signIn: async function (email, password, remember) {
      var d = await http('POST', '/auth/v1/token?grant_type=password', { anon: true, body: { email: email, password: password } });
      setSession(sessionFrom(d, remember), 'signin');
    },
    signOut: async function () {
      var had = session;
      if (had) { try { await http('POST', '/auth/v1/logout?scope=local', { retried: true }); } catch (e) { /* on se déconnecte localement quoi qu'il arrive */ } }
      setSession(null, 'signout');
    },
    recover: async function (email) {
      await http('POST', '/auth/v1/recover?redirect_to=' + encodeURIComponent(redirectUrl()), { anon: true, body: { email: email } });
    },
    updatePassword: async function (password) { await fresh(); await http('PUT', '/auth/v1/user', { body: { password: password } }); }
  };

  /* ---------- Données ---------- */

  function rowToTx(r) { return { id: r.id, type: r.type, amount: Number(r.amount), account: r.account, category: r.category, label: r.label || '', date: new Date(r.date) }; }
  function txToRow(t) {
    return { type: t.type, amount: t.amount, account: t.account, category: t.category, label: String(t.label || '').slice(0, 80), date: (t.date instanceof Date ? t.date : new Date(t.date)).toISOString() };
  }
  function rowToProfile(r) {
    return { first: r.first_name || '', last: r.last_name || '', school: r.school || 'default', schoolName: r.school_name || '', classe: r.classe || '',
             year: r.school_year || '', photo: r.photo || '', useCharter: r.use_charter !== false, custom: r.custom || null };
  }
  function profileToRow(p, id) {
    return { id: id, first_name: String(p.first || '').slice(0, 30) || null, last_name: String(p.last || '').slice(0, 30) || null, school: p.school || 'default',
             school_name: String(p.schoolName || '').slice(0, 60) || null, classe: String(p.classe || '').slice(0, 20) || null,
             school_year: String(p.year || '').slice(0, 9) || null, photo: p.photo || null, use_charter: !!p.useCharter, custom: p.custom || null };
  }

  var remoteData = {
    loadAll: async function () {
      await fresh();
      var r = await Promise.all([
        http('GET', '/rest/v1/transactions?select=id,type,amount,account,category,label,date&order=date.desc&limit=5000'),
        http('GET', '/rest/v1/goals?select=target,saved&limit=1'),
        http('GET', '/rest/v1/profiles?select=*&limit=1')
      ]);
      return {
        transactions: (r[0] || []).map(rowToTx),
        goal: r[1] && r[1][0] ? { target: Number(r[1][0].target), saved: Number(r[1][0].saved) } : null,
        profile: r[2] && r[2][0] ? rowToProfile(r[2][0]) : null
      };
    },
    addTransaction: async function (t) {
      await fresh();
      var d = await http('POST', '/rest/v1/transactions', { prefer: 'return=representation', body: txToRow(t) });
      return rowToTx(d[0]);
    },
    deleteTransaction: async function (id) {
      if (!isUuid(id)) throw makeError(400, 'bad_id');
      await fresh(); await http('DELETE', '/rest/v1/transactions?id=eq.' + id);
    },
    importTransactions: async function (list) {
      await fresh();
      for (var i = 0; i < list.length; i += 500) await http('POST', '/rest/v1/transactions', { prefer: 'return=minimal', body: list.slice(i, i + 500).map(txToRow) });
    },
    saveGoal: async function (g) {
      await fresh();
      await http('POST', '/rest/v1/goals?on_conflict=user_id', { prefer: 'resolution=merge-duplicates,return=minimal', body: { user_id: session.user.id, target: g.target, saved: g.saved } });
    },
    saveProfile: async function (p) {
      await fresh();
      await http('POST', '/rest/v1/profiles?on_conflict=id', { prefer: 'resolution=merge-duplicates,return=minimal', body: profileToRow(p, session.user.id) });
    },
    deleteAccount: async function () {
      await fresh(); await http('POST', '/rest/v1/rpc/delete_my_account', { body: {} });
      setSession(null, 'deleted');
    }
  };

  /* ---------- Version mémoire (maquette et démonstration uniquement : rien n'est envoyé ni conservé) ---------- */

  var mem = { users: {}, sessionEmail: null };
  function memUserData() { return mem.users[mem.sessionEmail].data; }
  var memoryAuth = {
    init: async function () { return { type: null, error: null }; },
    user: function () { return mem.sessionEmail ? { id: 'demo-' + mem.sessionEmail, email: mem.sessionEmail } : null; },
    onChange: function (fn) { listeners.push(fn); },
    signUp: async function (email, password) {
      await delay(250);
      if (mem.users[email]) throw makeError(422, 'user_already_exists');
      mem.users[email] = { password: password, data: { transactions: [], goal: null, profile: null } };
      mem.sessionEmail = email; listeners.forEach(function (fn) { fn(memoryAuth.user(), 'signup'); });
      return { needsConfirm: false };
    },
    signIn: async function (email, password) {
      await delay(250);
      if (!mem.users[email] || mem.users[email].password !== password) throw makeError(400, 'invalid_credentials');
      mem.sessionEmail = email; listeners.forEach(function (fn) { fn(memoryAuth.user(), 'signin'); });
    },
    signOut: async function () { mem.sessionEmail = null; listeners.forEach(function (fn) { fn(null, 'signout'); }); },
    recover: async function () { await delay(250); },
    updatePassword: async function (pw) { await delay(200); mem.users[mem.sessionEmail].password = pw; },
    reset: async function () { mem.users = {}; mem.sessionEmail = null; listeners.forEach(function (fn) { fn(null, 'signout'); }); },
    signInDemo: async function (seed) {
      var email = 'demo@mesfinances.sn';
      if (!mem.users[email]) mem.users[email] = { password: 'demo-demo-demo', data: seed };
      mem.sessionEmail = email; listeners.forEach(function (fn) { fn(memoryAuth.user(), 'signin'); });
    }
  };
  var memoryData = {
    loadAll: async function () { await delay(200); var d = memUserData(); return { transactions: d.transactions.slice(), goal: d.goal, profile: d.profile }; },
    addTransaction: async function (t) { await delay(150); var row = Object.assign({}, t, { id: 'm' + Date.now() + Math.random().toString(36).slice(2, 6) }); memUserData().transactions.unshift(row); return row; },
    deleteTransaction: async function (id) { var d = memUserData(); d.transactions = d.transactions.filter(function (t) { return t.id !== id; }); },
    importTransactions: async function (list) { var d = memUserData(); list.forEach(function (t) { d.transactions.push(Object.assign({}, t, { id: 'i' + Math.random().toString(36).slice(2) })); }); },
    saveGoal: async function (g) { memUserData().goal = g; },
    saveProfile: async function (p) { memUserData().profile = JSON.parse(JSON.stringify(p)); },
    deleteAccount: async function () { delete mem.users[mem.sessionEmail]; mem.sessionEmail = null; listeners.forEach(function (fn) { fn(null, 'deleted'); }); }
  };


  /* ---------- Espace administrateur : appels aux fonctions SQL réservées aux administrateurs ---------- */
  /* Le droit d'administrateur est vérifié par la base à chaque appel : même si quelqu'un affiche cet espace dans son
     navigateur, la base répond « forbidden ». Aucun montant ni aucune note de transaction n'est jamais demandé. */
  function rpc(name, args) { return fresh().then(function () { return http('POST', '/rest/v1/rpc/' + name, { body: args || {} }); }); }
  var remoteAdmin = {
    isAdmin: function () { return rpc('is_admin').then(function (v) { return v === true; }, function () { return false; }); },
    stats: function () { return rpc('admin_stats'); },
    series: function (days) { return rpc('admin_series', { p_days: days || 14 }).then(function (r) { return (r || []).map(function (x) { return { day: x.out_day, signups: Number(x.out_signups), tx: Number(x.out_tx) }; }); }); },
    schools: function () { return rpc('admin_schools').then(function (r) { return (r || []).map(function (x) { return { key: x.out_school, n: Number(x.out_n) }; }); }); },
    users: function (search, limit, offset) {
      return rpc('admin_list_users', { p_search: String(search || '').slice(0, 80), p_limit: limit || 20, p_offset: offset || 0 }).then(function (r) {
        return (r || []).map(function (x) {
          return { id: x.out_id, email: x.out_email, created: new Date(x.out_created), lastLogin: x.out_last_login ? new Date(x.out_last_login) : null, confirmed: !!x.out_confirmed,
                   banned: !!x.out_banned, admin: !!x.out_admin, first: x.out_first || '', school: x.out_school || '', schoolName: x.out_school_name || '', classe: x.out_classe || '', tx: Number(x.out_tx), total: Number(x.out_total) };
        });
      });
    },
    setBanned: function (id, banned) { if (!isUuid(id)) return Promise.reject(makeError(400, 'bad_id')); return rpc('admin_set_banned', { p_target: id, p_banned: !!banned }); },
    deleteUser: function (id) { if (!isUuid(id)) return Promise.reject(makeError(400, 'bad_id')); return rpc('admin_delete_user', { p_target: id }); },
    audit: function () { return rpc('admin_audit_list', { p_limit: 50 }).then(function (r) { return (r || []).map(function (x) { return { at: new Date(x.out_at), admin: x.out_admin || '', action: x.out_action, target: x.out_target || '' }; }); }); }
  };

  /* Version mémoire pour la maquette : comptes fictifs, rien n'est réel */
  var fake = null, fakeAudit = [];
  function seedFake() {
    if (fake) return fake;
    var firsts = ['Awa', 'Moussa', 'Fatou', 'Ibrahima', 'Aminata', 'Cheikh', 'Mariama', 'Ousmane', 'Khady', 'Abdoulaye', 'Seynabou', 'Mamadou', 'Ndeye', 'Pape', 'Sokhna'];
    var schools = ['galandou-diouf', 'galandou-diouf', 'custom', 'default', 'custom'], names = ['Lycée Blaise Diagne', 'Lycée Lamine Guèye'], classes = ['Seconde', 'Première', 'Terminale', '3ème'];
    fake = [];
    for (var i = 0; i < 38; i++) {
      var created = Date.now() - (i * 1.7 + 0.3) * 86400000, sch = schools[i % 5];
      fake.push({ id: 'f' + i, email: firsts[i % 15].toLowerCase() + (i + 3) + '@exemple.sn', created: new Date(created), lastLogin: (i % 11 === 5) ? null : new Date(Math.min(Date.now(), created + ((i * 37) % 50) * 3600000 * 7)),
                  confirmed: i % 11 !== 5, banned: i === 9, admin: false, first: firsts[i % 15], school: sch, schoolName: sch === 'custom' ? names[i % 2] : '', classe: classes[i % 4], tx: (i * 7) % 41 });
    }
    return fake;
  }
  function dayKey(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  var memoryAdmin = {
    isAdmin: async function () { return mem.sessionEmail === 'demo@mesfinances.sn'; },
    stats: async function () {
      await delay(150); var u = seedFake(), n = Date.now(), d = function (days) { return n - days * 86400000; };
      return { users_total: u.length, users_confirmed: u.filter(function (x) { return x.confirmed; }).length, users_banned: u.filter(function (x) { return x.banned; }).length,
               new_7d: u.filter(function (x) { return x.created > d(7); }).length, new_30d: u.filter(function (x) { return x.created > d(30); }).length,
               active_7d: u.filter(function (x) { return x.lastLogin && x.lastLogin > d(7); }).length, active_30d: u.filter(function (x) { return x.lastLogin && x.lastLogin > d(30); }).length,
               tx_total: u.reduce(function (a, x) { return a + x.tx; }, 0), tx_7d: 118 };
    },
    series: async function (days) {
      await delay(120); var u = seedFake(), out = [];
      for (var i = (days || 14) - 1; i >= 0; i--) {
        var day = new Date(Date.now() - i * 86400000), k = dayKey(day);
        out.push({ day: k, signups: u.filter(function (x) { return dayKey(x.created) === k; }).length, tx: 8 + ((i * 13 + 5) % 17) });
      }
      return out;
    },
    schools: async function () {
      await delay(100); var c = {}; seedFake().forEach(function (x) { var k = x.school === 'custom' ? (x.schoolName || 'Autre établissement') : x.school === 'default' ? '' : x.school; c[k] = (c[k] || 0) + 1; });
      return Object.keys(c).map(function (k) { return { key: k || null, n: c[k] }; }).sort(function (a, b) { return b.n - a.n; });
    },
    users: async function (search, limit, offset) {
      await delay(150); var s = String(search || '').toLowerCase(), list = seedFake().filter(function (x) { return !s || x.email.indexOf(s) >= 0; });
      return list.slice(offset || 0, (offset || 0) + (limit || 20)).map(function (x) { return Object.assign({}, x, { total: list.length }); });
    },
    setBanned: async function (id, banned) {
      await delay(150); var x = seedFake().filter(function (u) { return u.id === id; })[0]; if (!x) throw makeError(400, 'P0001', 'not_found');
      x.banned = !!banned; fakeAudit.unshift({ at: new Date(), admin: 'demo@mesfinances.sn', action: banned ? 'ban' : 'unban', target: x.email });
    },
    deleteUser: async function (id) {
      await delay(200); var u = seedFake(), i = u.map(function (x) { return x.id; }).indexOf(id); if (i < 0) throw makeError(400, 'P0001', 'not_found');
      fakeAudit.unshift({ at: new Date(), admin: 'demo@mesfinances.sn', action: 'delete_user', target: u[i].email }); u.splice(i, 1);
    },
    audit: async function () {
      await delay(100);
      return fakeAudit.concat([{ at: new Date(Date.now() - 3 * 86400000), admin: 'demo@mesfinances.sn', action: 'ban', target: 'ousmane12@exemple.sn' }]);
    }
  };

  /* ---------- Choix du mode ---------- */

  var configured = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(base) && anonKey.length > 20;
  var allowLocal = !!global.MF_ALLOW_INSECURE_LOCAL && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base) && anonKey.length > 20; // tests uniquement
  var mode = global.MF_DEMO ? 'memory' : (configured || allowLocal) ? 'remote' : 'unconfigured';

  global.MF = {
    mode: mode,
    auth: mode === 'memory' ? memoryAuth : remoteAuth,
    data: mode === 'memory' ? memoryData : remoteData,
    admin: mode === 'memory' ? memoryAdmin : remoteAdmin
  };
})(window);
