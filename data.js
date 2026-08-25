/* CoDevelop — data, auth & store layer.
 * Supabase-backed (real Auth + Postgres + RLS) when configured; localStorage fallback otherwise.
 * All store/auth methods are async (return Promises).
 */
window.CODEV = (function () {
  const RAW_URL = 'https://zfjwbdfaxgvdwepmkwce.supabase.co/rest/v1/';
  const KEY = 'sb_publishable_cCeODQr-6RbZQ98vQ1awnA_FK5wiljs';
  const BASE = RAW_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const configured = !!(BASE && KEY && KEY.indexOf('sb_') === 0);

  const CFG = {
    brand: 'CoDevelop', tagline: 'Property Co-Development', configured,
    ADMIN_EMAIL: 'admin@codevproperty.com',
    ROLES: ['investor', 'developer', 'visitor'],
    STAGES: ['Land / Commencement', 'Foundation', 'Structural Frame', 'Building Envelope',
             'Mechanical & Electrical', 'Finishing', 'Completion / Handover'],
    // Default milestone schedule (name + % of funding released). Admin can edit per development.
    MILESTONE_TEMPLATE: [
      { name: 'Commitment / SPV Entry', pct: 10 }, { name: 'Land / Commencement', pct: 15 },
      { name: 'Foundation', pct: 15 }, { name: 'Structural Frame', pct: 20 },
      { name: 'Building Envelope / Roofing', pct: 10 }, { name: 'Mechanical & Electrical', pct: 10 },
      { name: 'Finishing', pct: 15 }, { name: 'Completion / Handover', pct: 5 },
    ],
    MILESTONE_STATUS: ['pending', 'in-progress', 'certified'],
    PAYMENT_STATUS: ['due', 'paid'],
  };
  const defaultMilestones = () => CFG.MILESTONE_TEMPLATE.map(m => ({ name: m.name, pct: m.pct, status: 'pending', targetDate: '', releasedDate: '' }));

  const SKEY = 'codev_sb_session';
  const getSession = () => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } };
  const setSession = (s) => s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY);
  const token = () => { const s = getSession(); return s && s.access_token; };
  const nowISO = () => new Date().toISOString();

  // ---- low-level Supabase fetch ----
  async function sb(path, { method = 'GET', body, prefer, anon = false } = {}) {
    const isAuth = path.indexOf('/auth/') === 0;          // GoTrue endpoints
    const tk = anon ? null : token();                     // real user JWT, if any
    const headers = { apikey: KEY };
    if (tk) headers.Authorization = 'Bearer ' + tk;       // authenticated request
    else if (!isAuth) headers.Authorization = 'Bearer ' + KEY; // anon REST (publishable ok as bearer); auth endpoints get none
    if (body) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const txt = await res.text(); let data; try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
    if (!res.ok) throw new Error((data && (data.message || data.error_description || data.msg || data.error)) || ('Request failed (' + res.status + ')'));
    return data;
  }

  // ---- mappers (snake_case DB <-> camelCase app) ----
  const toProp = (r) => ({ id: r.id, title: r.title, developer: r.developer, location: r.location,
    summary: r.summary, priceFrom: r.price_from, stage: r.stage, status: r.status,
    submittedBy: r.submitted_by_email, submittedByRole: r.submitted_by_role, createdAt: r.created_at, verifiedAt: r.verified_at,
    milestones: Array.isArray(r.milestones) ? r.milestones : [], payments: Array.isArray(r.payments) ? r.payments : [],
    images: Array.isArray(r.images) ? r.images : [] });
  const toAcc = (r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, createdAt: r.created_at });

  // ================= SUPABASE MODE =================
  async function fetchProfile(id) { const r = await sb('/rest/v1/profiles?id=eq.' + id + '&select=*'); return r && r[0] ? toAcc(r[0]) : null; }

  const sbAuth = {
    session: getSession,
    profile: () => { const s = getSession(); return s && s.profile; },
    async signUp({ name, email, password, role }) {
      const d = await sb('/auth/v1/signup', { method: 'POST', anon: true, body: { email, password, data: { name, role } } });
      if (d.access_token) await hydrate(d);
      else if (d.user && !d.access_token) throw new Error('Check your email to confirm, then sign in.');
      return d;
    },
    async signIn({ email, password }) { // password-only (used by the admin console)
      const d = await sb('/auth/v1/token?grant_type=password', { method: 'POST', anon: true, body: { email, password } });
      const sess = await hydrate(d); sess.mfa = { verified: true }; setSession(sess); return sess;
    },
    // Public site = two-step: verify the password (no session persisted), then an emailed code.
    async passwordCheck({ email, password }) { await sb('/auth/v1/token?grant_type=password', { method: 'POST', anon: true, body: { email, password } }); return true; },
    async startSignup({ name, email, password, role }) { return sb('/auth/v1/signup', { method: 'POST', anon: true, body: { email, password, data: { name, role } } }); },
    async sendEmailCode(email) { return sb('/auth/v1/otp', { method: 'POST', anon: true, body: { email, should_create_user: false } }); },
    // Finish account-opening from the signup response when the verification email can't be sent
    // (mailer outage). The account is already created & auto-confirmed by Supabase, so we complete
    // the session rather than stranding the client. Normal email 2FA resumes once mail is restored.
    async completeSignup(d) { if (!d || !d.access_token) return null; const s = await hydrate(d); s.mfa = { method: 'signup', verified: true }; setSession(s); return s; },
    async verifyEmailCode({ email, code }) { const d = await sb('/auth/v1/verify', { method: 'POST', anon: true, body: { email, token: String(code), type: 'email' } }); const s = await hydrate(d); s.mfa = { method: 'email', verified: true }; setSession(s); return s; },
    // Send the role-based welcome email once, after the user completes 2FA (idempotent server-side).
    async welcome() { try { await sb('/rest/v1/rpc/send_welcome_if_needed', { method: 'POST', body: {} }); } catch {} },
    // Password reset via emailed 6-digit code.
    async sendRecovery(email) { return sb('/auth/v1/recover', { method: 'POST', anon: true, body: { email } }); },
    async resetPassword({ email, code, password }) {
      const d = await sb('/auth/v1/verify', { method: 'POST', anon: true, body: { email, token: String(code), type: 'recovery' } });
      const s = await hydrate(d); s.mfa = { method: 'recovery', verified: true }; setSession(s);
      await sb('/auth/v1/user', { method: 'PUT', body: { password } });   // uses the recovery session bearer
      return s;
    },
    async signOut() { try { await sb('/auth/v1/logout', { method: 'POST' }); } catch {} setSession(null); },
    async refreshProfile() { const s = getSession(); if (!s) return null; const p = await fetchProfile(s.user.id); if (p) { s.profile = p; setSession(s); } return p; },
    mfaOk() { const s = getSession(); return !!(s && s.mfa && s.mfa.verified); },
  };
  function aalOf(tok) { try { const p = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.aal || 'aal1'; } catch { return 'aal1'; } }
  async function hydrate(d) {
    const user = d.user || {}; const sess = { access_token: d.access_token, refresh_token: d.refresh_token, user: { id: user.id, email: user.email }, mfa: { enrolled: false, aal: aalOf(d.access_token || '') } };
    setSession(sess);
    let p = null; for (let i = 0; i < 4 && !p; i++) { try { p = await fetchProfile(user.id); } catch {} if (!p) await new Promise(r => setTimeout(r, 450)); }
    sess.profile = p; setSession(sess); return sess;
  }

  const sbDB = {
    properties: {
      async listPublic() { return (await sb('/rest/v1/properties?status=eq.verified&order=created_at.desc&select=*', { anon: true })).map(toProp); },
      async listMine() { const s = getSession(); if (!s) return []; return (await sb('/rest/v1/properties?submitted_by=eq.' + s.user.id + '&order=created_at.desc&select=*')).map(toProp); },
      async listAll() { return (await sb('/rest/v1/properties?order=created_at.desc&select=*')).map(toProp); },
      async byId(id) { const r = await sb('/rest/v1/properties?id=eq.' + id + '&select=*', { anon: true }); return r && r[0] ? toProp(r[0]) : null; },
      async add(p) { const s = getSession();
        const row = { title: p.title, developer: p.developer, location: p.location, summary: p.summary, price_from: p.priceFrom, stage: p.stage,
          milestones: p.milestones || defaultMilestones(), payments: p.payments || [],
          submitted_by: s.user.id, submitted_by_email: s.user.email, submitted_by_role: (s.profile && s.profile.role) || p.submittedByRole };
        const withImages = Object.assign({}, row, { images: p.images || [] });
        try { return await sb('/rest/v1/properties', { method: 'POST', body: withImages, prefer: 'return=representation' }); }
        catch (e) { // If the DB has no `images` column yet, still save the listing (photos dropped) and flag it.
          if (/images/i.test((e && e.message) || '')) { CFG.imagesUnavailable = true; return sb('/rest/v1/properties', { method: 'POST', body: row, prefer: 'return=representation' }); }
          throw e; } },
      async update(id, patch) { const row = {};
        if ('title' in patch) row.title = patch.title; if ('developer' in patch) row.developer = patch.developer;
        if ('location' in patch) row.location = patch.location; if ('summary' in patch) row.summary = patch.summary;
        if ('priceFrom' in patch) row.price_from = patch.priceFrom; if ('stage' in patch) row.stage = patch.stage;
        if ('status' in patch) row.status = patch.status; if ('verifiedAt' in patch) row.verified_at = patch.verifiedAt;
        if ('milestones' in patch) row.milestones = patch.milestones; if ('payments' in patch) row.payments = patch.payments;
        if ('images' in patch) row.images = patch.images;
        return sb('/rest/v1/properties?id=eq.' + id, { method: 'PATCH', body: row, prefer: 'return=representation' }); },
      async setStatus(id, status) { return sbDB.properties.update(id, { status, verifiedAt: status === 'verified' ? nowISO() : null }); },
      async remove(id) { return sb('/rest/v1/properties?id=eq.' + id, { method: 'DELETE' }); },
    },
    profiles: {
      async listAll() { return (await sb('/rest/v1/profiles?order=created_at.desc&select=*')).map(toAcc); },
      async byId(id) { return fetchProfile(id); },
      async add({ name, email, role, password }) {
        // Admin creates a real account via signup (does not change the admin's own session).
        return sb('/auth/v1/signup', { method: 'POST', anon: true, body: { email, password, data: { name, role } } });
      },
      async update(id, patch) { return sb('/rest/v1/profiles?id=eq.' + id, { method: 'PATCH', body: patch, prefer: 'return=representation' }); },
      async remove(id) { return sb('/rest/v1/profiles?id=eq.' + id, { method: 'DELETE' }); },
    },
  };

  // ================= LOCAL FALLBACK MODE (no keys) =================
  const L = { acc: 'codev_accounts', prop: 'codev_properties', sess: 'codev_session', seed: 'codev_seeded_v1' };
  const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const wr = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const H = (s) => btoa(unescape(encodeURIComponent(s || '')));
  function localSeed() {
    if (rd(L.seed, false)) return;
    wr(L.acc, [{ id: uid(), name: 'Platform Admin', email: 'admin@codevproperty.com', pass: H('admin2026'), role: 'admin', status: 'active', createdAt: nowISO() }]);
    wr(L.prop, [{ id: uid(), title: 'Ivory Residences', developer: 'Meridian Developments', location: 'Ikoyi, Lagos', summary: '24 curated waterfront-adjacent residences.', priceFrom: 45000000, stage: 'Foundation', status: 'verified', submittedByRole: 'developer', submittedBy: 'dev@meridian.example', createdAt: nowISO() }]);
    wr(L.seed, true);
  }
  const localAuth = {
    session: () => rd(L.sess, null), profile: () => rd(L.sess, null),
    async signUp({ name, email, password, role }) { const list = rd(L.acc, []);
      if (list.some(a => a.email.toLowerCase() === email.toLowerCase())) throw new Error('Email already registered');
      const a = { id: uid(), name, email, role, status: 'active', pass: H(password), createdAt: nowISO() }; list.push(a); wr(L.acc, list);
      wr(L.sess, { id: a.id, name, email, role }); return a; },
    async signIn({ email, password }) { const a = rd(L.acc, []).find(x => x.email.toLowerCase() === email.toLowerCase() && x.pass === H(password));
      if (!a) throw new Error('Invalid email or password'); wr(L.sess, { id: a.id, name: a.name, email: a.email, role: a.role }); return a; },
    async signOut() { localStorage.removeItem(L.sess); },
    async refreshProfile() { return rd(L.sess, null); },
    mfaOk() { return true; }, async listFactors() { return []; }, async welcome() {},
    async sendRecovery() {}, async resetPassword() { throw new Error('Password reset needs the live backend'); },
  };
  const localDB = {
    properties: {
      async listPublic() { return rd(L.prop, []).filter(p => p.status === 'verified'); },
      async listMine() { const s = rd(L.sess, null); return s ? rd(L.prop, []).filter(p => (p.submittedBy || '').toLowerCase() === s.email.toLowerCase()) : []; },
      async listAll() { return rd(L.prop, []); },
      async byId(id) { return rd(L.prop, []).find(p => p.id === id); },
      async add(p) { const s = rd(L.sess, null); const list = rd(L.prop, []); const rec = { id: uid(), status: 'pending', createdAt: nowISO(), submittedBy: s && s.email, submittedByRole: s && s.role, milestones: defaultMilestones(), payments: [], ...p }; list.unshift(rec); wr(L.prop, list); return rec; },
      async update(id, patch) { const list = rd(L.prop, []); const i = list.findIndex(p => p.id === id); if (i < 0) return; list[i] = { ...list[i], ...patch }; wr(L.prop, list); return list[i]; },
      async setStatus(id, status) { return localDB.properties.update(id, { status, verifiedAt: status === 'verified' ? nowISO() : undefined }); },
      async remove(id) { wr(L.prop, rd(L.prop, []).filter(p => p.id !== id)); },
    },
    profiles: {
      async listAll() { return rd(L.acc, []); },
      async byId(id) { return rd(L.acc, []).find(a => a.id === id); },
      async add({ name, email, role, password }) { const list = rd(L.acc, []); if (list.some(a => a.email.toLowerCase() === email.toLowerCase())) throw new Error('Email exists'); const a = { id: uid(), name, email, role, status: 'active', pass: H(password || 'changeme'), createdAt: nowISO() }; list.push(a); wr(L.acc, list); return a; },
      async update(id, patch) { const list = rd(L.acc, []); const i = list.findIndex(a => a.id === id); if (i < 0) return; list[i] = { ...list[i], ...patch }; wr(L.acc, list); return list[i]; },
      async remove(id) { wr(L.acc, rd(L.acc, []).filter(a => a.id !== id)); },
    },
  };

  if (!configured) localSeed();
  const auth = configured ? sbAuth : localAuth;
  const db = configured ? sbDB : localDB;

  const fmtN = (n) => '₦' + (Number(n) || 0).toLocaleString();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return { CFG, auth, db, fmtN, esc, now: nowISO };
})();
