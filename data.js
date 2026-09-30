/* CoDev — data, auth & store layer.
 * Supabase-backed (real Auth + Postgres + RLS) when configured; localStorage fallback otherwise.
 * All store/auth methods are async (return Promises).
 */
window.CODEV = (function () {
  const RAW_URL = 'https://zfjwbdfaxgvdwepmkwce.supabase.co/rest/v1/';
  const KEY = 'sb_publishable_cCeODQr-6RbZQ98vQ1awnA_FK5wiljs';
  const BASE = RAW_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const configured = !!(BASE && KEY && KEY.indexOf('sb_') === 0);

  const CFG = {
    brand: 'CoDev', tagline: 'Property Co-Development', configured,
    ADMIN_EMAIL: 'admin@codevproperty.com',
    ROLES: ['investor', 'developer', 'visitor'],
    // Suggested locations for the List-a-property form (developers can type any location too).
    // The public "filter by location" dropdown is built from the actual listings, so it grows
    // automatically as new cities/areas are uploaded.
    LOCATIONS: ['Lagos - Ikoyi', 'Lagos - Victoria Island', 'Lagos - Lekki', 'Lagos - Lekki Phase 1',
                'Lagos - Ajah', 'Lagos - Ikeja GRA', 'Lagos - Ikeja', 'Lagos - Yaba', 'Lagos - Magodo',
                'Lagos - Ogudu', 'Lagos - Gbagada', 'Lagos - Surulere', 'Lagos - Epe', 'Lagos - Ibeju-Lekki',
                'Abuja - Maitama', 'Abuja - Asokoro', 'Abuja - Wuse 2', 'Abuja - Jabi', 'Abuja - Gwarinpa',
                'Port Harcourt', 'Ibadan', 'Enugu', 'Abeokuta', 'Kano'],
    STAGES: ['Land / Commencement', 'Foundation', 'Structural Frame', 'Building Envelope',
             'Mechanical & Electrical', 'Finishing', 'Completion / Handover'],
    // Property types for the listing entry (admin + developer submission).
    PROPERTY_TYPES: ['Residential — apartments', 'Residential — detached / terraced homes',
             'Mixed-use', 'Commercial', 'Retail', 'Office', 'Industrial / warehousing',
             'Serviced plots / land', 'Hospitality', 'Other'],
    // Assurance & verification: key documents a developer submits per listing. Extensible —
    // add rows here (key must be stable & unique). The legal partner reviews each on their
    // dashboard; buyers see the verification status (not the files).
    REQUIRED_DOCS: [
      { key: 'title_co',        label: 'Title Ownership / C of O' },
      { key: 'title_reg',       label: 'Title Registration / Perfection' },
      { key: 'survey_reg',      label: 'Approved Survey Registration' },
      { key: 'site_layout',     label: 'Site Layout' },
      { key: 'approvals',       label: 'Approvals and Consents' },
      { key: 'spv_jv',          label: 'SPV / JV Agreements' },
    ],
    // Document review lifecycle. 'awaiting' = not yet submitted by the developer.
    DOC_STATUSES: [
      ['awaiting',     'Awaiting submission'],
      ['under_review', 'Under review'],
      ['cleared',      'Verified / cleared'],
      ['rejected',     'Action required'],
    ],
    // Default milestone schedule (name + % of funding released). Admin can edit per development.
    MILESTONE_TEMPLATE: [
      { name: 'Commitment / SPV Entry', pct: 10 }, { name: 'Land / Commencement', pct: 15 },
      { name: 'Foundation', pct: 15 }, { name: 'Structural Frame', pct: 20 },
      { name: 'Building Envelope / Roofing', pct: 10 }, { name: 'Mechanical & Electrical', pct: 10 },
      { name: 'Finishing', pct: 15 }, { name: 'Completion / Handover', pct: 5 },
    ],
    MILESTONE_STATUS: ['pending', 'in-progress', 'certified'],
    // Investor amount bands are anchored in USD; these rates convert them for display.
    // A super admin can edit them (persisted in platform_settings — see PLATFORM-SETTINGS.sql).
    CURRENCIES: ['USD', 'NGN', 'GBP'],
    CURRENCY_SYMBOLS: { USD: '$', NGN: '₦', GBP: '£' },
    FX_DEFAULT: { USD: 1, NGN: 1600, GBP: 0.79 },
    PAYMENT_STATUS: ['due', 'paid'],
    // Admin role-based access control. An admin's `permissions` array grants specific rights.
    PERMISSIONS: [
      ['manage_admins',   'Manage admins & rights', 'Create admins and set what they can do'],
      ['verify_accounts', 'Verify accounts',        'Approve, reject or suspend member accounts'],
      ['manage_listings', 'Manage developments',    'Verify, edit, reject & delete developments and milestones'],
      ['manage_accounts', 'Manage member accounts', 'Add members, change roles, delete accounts'],
      ['legal_review',    'Legal review & due diligence', 'Review listing documents and set verification status'],
    ],
    ADMIN_PRESETS: {
      'Super admin':      ['manage_admins', 'verify_accounts', 'manage_listings', 'manage_accounts', 'legal_review'],
      'Verifier':         ['verify_accounts'],
      'Listings manager': ['manage_listings'],
      'Accounts manager': ['verify_accounts', 'manage_accounts'],
      'Legal partner':    ['legal_review'],
    },
  };
  CFG.ALL_PERMISSIONS = CFG.PERMISSIONS.map(p => p[0]);
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
    if (!res.ok) {
      const emsg = (data && (data.message || data.error_description || data.msg || data.error)) || ('Request failed (' + res.status + ')');
      // Session timeout: an authenticated user request rejected with 401 (expired/invalid JWT).
      // Clear the stale session and signal the app to prompt a fresh sign-in — no raw "JWT expired".
      if (res.status === 401 && tk && !isAuth) {
        setSession(null);
        try { window.dispatchEvent(new CustomEvent('codev:session-expired')); } catch (e) {}
        throw new Error('Your session has expired. Please sign in again.');
      }
      throw new Error(emsg);
    }
    return data;
  }

  // ---- mappers (snake_case DB <-> camelCase app) ----
  const toProp = (r) => ({ id: r.id, ref: r.ref || '', title: r.title, developer: r.developer, location: r.location,
    address: r.address || '', propertyType: r.property_type || '',
    units: (r.units === 0 || r.units) ? r.units : '', deliveryDate: r.delivery_date || '',
    summary: r.summary, priceFrom: r.price_from, stage: r.stage, status: r.status,
    legalStatus: r.legal_status || 'not_submitted', legalReviewedAt: r.legal_reviewed_at || null,
    submittedBy: r.submitted_by_email, submittedByRole: r.submitted_by_role, createdAt: r.created_at, verifiedAt: r.verified_at,
    milestones: Array.isArray(r.milestones) ? r.milestones : [], payments: Array.isArray(r.payments) ? r.payments : [],
    images: Array.isArray(r.images) ? r.images : [] });

  const toDoc = (r) => ({ id: r.id, propertyId: r.property_id, key: r.doc_key, label: r.doc_label,
    fileData: r.file_data || '', fileName: r.file_name || '', fileType: r.file_type || '',
    status: r.status || 'awaiting', note: r.note || '',
    submittedAt: r.submitted_at || null, reviewedAt: r.reviewed_at || null, reviewedBy: r.reviewed_by || null });

  const toAccess = (r) => ({ id: r.id, propertyId: r.property_id, userId: r.user_id, userEmail: r.user_email, userName: r.user_name,
    status: r.status || 'active', ndaVersion: r.nda_version || '', acknowledgedAt: r.acknowledged_at || null,
    grantedAt: r.granted_at || null, expiresAt: r.expires_at || null, revokedAt: r.revoked_at || null, createdAt: r.created_at || null });
  const toEvent = (r) => ({ id: r.id, propertyId: r.property_id, userId: r.user_id, userEmail: r.user_email, event: r.event, docKey: r.doc_key || '', createdAt: r.created_at || null });
  const toAcc = (r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, createdAt: r.created_at,
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
    about: r.about || '', website: r.website || '', phone: r.phone || '', brochure: r.brochure || '' });

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
        const extra = { address: p.address || null, property_type: p.propertyType || null,
          units: (p.units === '' || p.units == null) ? null : Number(p.units), delivery_date: p.deliveryDate || null,
          ref: p.ref || makeListingRef() }; // unique reference assigned at submission (before admin verification)
        const withAll = Object.assign({}, row, extra, { images: p.images || [] });
        try { return await sb('/rest/v1/properties', { method: 'POST', body: withAll, prefer: 'return=representation' }); }
        catch (e) { // Degrade gracefully if the DB is missing newer columns (images / address / property_type / units / delivery_date).
          const msg = (e && e.message) || ''; if (!/images|address|property_type|units|delivery_date|column|schema cache/i.test(msg)) throw e;
          const body = Object.assign({}, row);
          if (/images/i.test(msg)) CFG.imagesUnavailable = true; else body.images = p.images || [];
          if (/address|property_type|units|delivery_date|column|schema cache/i.test(msg)) CFG.listingFieldsUnavailable = true; else Object.assign(body, extra);
          return sb('/rest/v1/properties', { method: 'POST', body: body, prefer: 'return=representation' }); } },
      async update(id, patch) { const row = {};
        if ('title' in patch) row.title = patch.title; if ('developer' in patch) row.developer = patch.developer;
        if ('location' in patch) row.location = patch.location; if ('summary' in patch) row.summary = patch.summary;
        if ('priceFrom' in patch) row.price_from = patch.priceFrom; if ('stage' in patch) row.stage = patch.stage;
        if ('status' in patch) row.status = patch.status; if ('verifiedAt' in patch) row.verified_at = patch.verifiedAt;
        if ('milestones' in patch) row.milestones = patch.milestones; if ('payments' in patch) row.payments = patch.payments;
        if ('images' in patch) row.images = patch.images;
        const newKeys = [];
        if ('ref' in patch) { row.ref = patch.ref || null; newKeys.push('ref'); }
        if ('address' in patch) { row.address = patch.address || null; newKeys.push('address'); }
        if ('propertyType' in patch) { row.property_type = patch.propertyType || null; newKeys.push('property_type'); }
        if ('units' in patch) { row.units = (patch.units === '' || patch.units == null) ? null : Number(patch.units); newKeys.push('units'); }
        if ('deliveryDate' in patch) { row.delivery_date = patch.deliveryDate || null; newKeys.push('delivery_date'); }
        if ('legalStatus' in patch) { row.legal_status = patch.legalStatus; row.legal_reviewed_at = ['cleared','conditionally_cleared'].indexOf(patch.legalStatus)>=0 ? nowISO() : null; }
        try { return await sb('/rest/v1/properties?id=eq.' + id, { method: 'PATCH', body: row, prefer: 'return=representation' }); }
        catch (e) { // If newer columns aren't migrated yet, save the rest and flag it rather than losing the edit.
          const msg = (e && e.message) || ''; if (!newKeys.length || !/address|property_type|units|delivery_date|column|schema cache/i.test(msg)) throw e;
          CFG.listingFieldsUnavailable = true; newKeys.forEach(k => delete row[k]);
          return sb('/rest/v1/properties?id=eq.' + id, { method: 'PATCH', body: row, prefer: 'return=representation' }); } },
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
      // Signed-in user edits their OWN profile (developer profile & brochure). A DB guard trigger
      // stops non-admins from changing role/status/permissions, so only safe fields take effect.
      async updateMine(patch) { const s = getSession(); if (!s) throw new Error('Not signed in');
        const row = {}; ['name', 'about', 'website', 'phone', 'brochure'].forEach(k => { if (k in patch) row[k] = patch[k]; });
        const r = await sb('/rest/v1/profiles?id=eq.' + s.user.id, { method: 'PATCH', body: row, prefer: 'return=representation' });
        try { const p = await fetchProfile(s.user.id); if (p) { s.profile = p; setSession(s); } } catch {}
        return r; },
      async remove(id) { return sb('/rest/v1/profiles?id=eq.' + id, { method: 'DELETE' }); },
    },
    interests: {
      // A signed-in member registers interest in a verified development. RLS lets a user insert
      // their own interest; a trigger emails admin (+ developer) — see EXPRESS-INTEREST.sql.
      async add({ propertyId, propertyTitle, developer, message }) { const s = getSession();
        const row = { property_id: propertyId, property_title: propertyTitle || null, developer: developer || null,
          message: message || null, user_id: s.user.id, user_email: s.user.email,
          user_name: (s.profile && s.profile.name) || s.user.email };
        return sb('/rest/v1/interests', { method: 'POST', body: row, prefer: 'return=representation' }); },
      async listAll() { return sb('/rest/v1/interests?order=created_at.desc&select=*'); },
    },
    // Investor / buyer qualification records (Express Interest → qualification → CoDev verification).
    qualifications: {
      async add(q) { const s = getSession();
        const row = { property_id: q.propertyId, property_title: q.propertyTitle || null, developer: q.developer || null,
          user_id: s.user.id, user_email: s.user.email, user_name: (s.profile && s.profile.name) || s.user.email,
          investor_type: q.investorType, unit_type: q.unitType || null, amount_band: q.amountBand, currency: q.currency,
          objective: q.objective, readiness: q.readiness, funding_method: q.fundingMethod, capacity_range: q.capacityRange,
          mortgage_required: !!q.mortgageRequired, source_of_funds: q.sourceOfFunds, declaration: !!q.declaration,
          status: 'qualification_in_progress' };
        return sb('/rest/v1/qualifications', { method: 'POST', body: row, prefer: 'return=representation' }); },
      async listMine() { const s = getSession(); if (!s) return []; return sb('/rest/v1/qualifications?user_id=eq.' + s.user.id + '&order=created_at.desc&select=*'); },
      async listAll() { return sb('/rest/v1/qualifications?order=created_at.desc&select=*'); },
      async update(id, patch) { return sb('/rest/v1/qualifications?id=eq.' + id, { method: 'PATCH', body: patch, prefer: 'return=representation' }); },
    },
    // Platform settings (super-admin editable). FX rates convert investor amount bands from USD.
    settings: {
      async getFx() { try { const r = await sb('/rest/v1/platform_settings?key=eq.fx&select=value', { anon: true });
        const v = r && r[0] && r[0].value; return (v && typeof v === 'object') ? Object.assign({}, CFG.FX_DEFAULT, v) : Object.assign({}, CFG.FX_DEFAULT); }
        catch (e) { return Object.assign({}, CFG.FX_DEFAULT); } },
      async setFx(rates) { const body = { key: 'fx', value: rates, updated_at: nowISO() };
        return sb('/rest/v1/platform_settings?on_conflict=key', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=representation' }); },
    },
    // ---- Assurance & verification documents (see DOCUMENTS.sql) ----
    // Files live in listing_documents (RLS: owner + legal/admin only; anon denied → files
    // never leak). Buyers read the file-free status via the listing_document_status view.
    documents: {
      // Full documents (incl. file_data) — owner / legal / admin, RLS-gated.
      async listForProperty(propertyId) {
        return (await sb('/rest/v1/listing_documents?property_id=eq.' + propertyId + '&order=doc_key&select=*')).map(toDoc); },
      // Every listing's documents, for the legal-partner dashboard.
      async listAll() { return (await sb('/rest/v1/listing_documents?order=property_id&select=*')).map(toDoc); },
      // Public, file-free status checklist (security-definer view; anon-readable).
      async statusForProperty(propertyId) {
        try { return await sb('/rest/v1/listing_document_status?property_id=eq.' + propertyId + '&order=doc_key&select=*', { anon: true }); }
        catch { return []; } },
      // Developer submits / replaces a document (upsert on property_id + doc_key → under_review).
      async submit(propertyId, doc) { const s = getSession();
        const row = { property_id: propertyId, doc_key: doc.key, doc_label: doc.label,
          file_data: doc.fileData || null, file_name: doc.fileName || null, file_type: doc.fileType || null,
          status: 'under_review', note: null, submitted_by: s.user.id, submitted_at: nowISO(),
          reviewed_by: null, reviewed_at: null };
        return sb('/rest/v1/listing_documents?on_conflict=property_id,doc_key', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' }); },
      // Legal / admin sets a review decision.
      async review(id, { status, note }) { const s = getSession();
        const row = { status, note: note || null, reviewed_by: s.user.id, reviewed_at: nowISO() };
        return sb('/rest/v1/listing_documents?id=eq.' + id, { method: 'PATCH', body: row, prefer: 'return=representation' }); },
      async remove(id) { return sb('/rest/v1/listing_documents?id=eq.' + id, { method: 'DELETE' }); },
    },
    // ---- Deal Room (verified-buyer document access; see DEALROOM.sql) ----
    dealroom: {
      async isVerifiedBuyer(propertyId) { const s = getSession(); if (!s) return false;
        try { const r = await sb('/rest/v1/qualifications?property_id=eq.' + propertyId + '&user_id=eq.' + s.user.id + '&status=eq.codev_verified&select=id&limit=1'); return !!(r && r.length); } catch { return false; } },
      async myAccess(propertyId) { const s = getSession(); if (!s) return null;
        const r = await sb('/rest/v1/deal_room_access?property_id=eq.' + propertyId + '&user_id=eq.' + s.user.id + '&select=*&limit=1'); return (r && r[0]) ? toAccess(r[0]) : null; },
      async acknowledge(propertyId, ndaVersion) { const s = getSession();
        const row = { property_id: propertyId, user_id: s.user.id, user_email: s.user.email, user_name: (s.profile && s.profile.name) || s.user.email,
          status: 'active', nda_version: ndaVersion || 'v1', acknowledged_at: nowISO(), granted_at: nowISO() };
        const r = await sb('/rest/v1/deal_room_access?on_conflict=property_id,user_id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' });
        try { await sbDB.dealroom.log(propertyId, 'acknowledged', null); } catch {}
        return (r && r[0]) ? toAccess(r[0]) : null; },
      async clearedDocs(propertyId) { return (await sb('/rest/v1/listing_documents?property_id=eq.' + propertyId + '&status=eq.cleared&order=doc_key&select=*')).map(toDoc); },
      async log(propertyId, event, docKey) { const s = getSession(); if (!s) return;
        try { return await sb('/rest/v1/deal_room_events', { method: 'POST', body: { property_id: propertyId, user_id: s.user.id, user_email: s.user.email, event, doc_key: docKey || null } }); } catch {} },
      async listAccess() { return (await sb('/rest/v1/deal_room_access?order=created_at.desc&select=*')).map(toAccess); },
      async listEvents(propertyId) { return (await sb('/rest/v1/deal_room_events?property_id=eq.' + propertyId + '&order=created_at.desc&select=*')).map(toEvent); },
      async revoke(id) { const s = getSession(); return sb('/rest/v1/deal_room_access?id=eq.' + id, { method: 'PATCH', body: { status: 'revoked', revoked_at: nowISO(), revoked_by: s.user.id }, prefer: 'return=representation' }); },
      async reinstate(id) { return sb('/rest/v1/deal_room_access?id=eq.' + id, { method: 'PATCH', body: { status: 'active', revoked_at: null }, prefer: 'return=representation' }); },
    },
  };

  // ================= LOCAL FALLBACK MODE (no keys) =================
  const L = { acc: 'codev_accounts', prop: 'codev_properties', sess: 'codev_session', seed: 'codev_seeded_v1', docs: 'codev_docs', dra: 'codev_dra', dre: 'codev_dre' };
  const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const wr = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const H = (s) => btoa(unescape(encodeURIComponent(s || '')));
  function localSeed() {
    if (rd(L.seed, false)) return;
    wr(L.acc, [{ id: uid(), name: 'Platform Admin', email: 'admin@codevproperty.com', pass: H('admin2026'), role: 'admin', status: 'active', createdAt: nowISO(), permissions: ['manage_admins', 'verify_accounts', 'manage_listings', 'manage_accounts'] }]);
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
      async add(p) { const s = rd(L.sess, null); const list = rd(L.prop, []); const rec = { id: uid(), ref: (p && p.ref) || makeListingRef(), status: 'pending', createdAt: nowISO(), submittedBy: s && s.email, submittedByRole: s && s.role, milestones: defaultMilestones(), payments: [], ...p }; if (!rec.ref) rec.ref = makeListingRef(); list.unshift(rec); wr(L.prop, list); return rec; },
      async update(id, patch) { const list = rd(L.prop, []); const i = list.findIndex(p => p.id === id); if (i < 0) return; list[i] = { ...list[i], ...patch }; wr(L.prop, list); return list[i]; },
      async setStatus(id, status) { return localDB.properties.update(id, { status, verifiedAt: status === 'verified' ? nowISO() : undefined }); },
      async remove(id) { wr(L.prop, rd(L.prop, []).filter(p => p.id !== id)); },
    },
    profiles: {
      async listAll() { return rd(L.acc, []); },
      async byId(id) { return rd(L.acc, []).find(a => a.id === id); },
      async add({ name, email, role, password }) { const list = rd(L.acc, []); if (list.some(a => a.email.toLowerCase() === email.toLowerCase())) throw new Error('Email exists'); const a = { id: uid(), name, email, role, status: 'active', pass: H(password || 'changeme'), createdAt: nowISO() }; list.push(a); wr(L.acc, list); return a; },
      async update(id, patch) { const list = rd(L.acc, []); const i = list.findIndex(a => a.id === id); if (i < 0) return; list[i] = { ...list[i], ...patch }; wr(L.acc, list); return list[i]; },
      async updateMine(patch) { const s = rd(L.sess, null); if (!s) throw new Error('Not signed in'); const safe = {}; ['name', 'about', 'website', 'phone', 'brochure'].forEach(k => { if (k in patch) safe[k] = patch[k]; }); const list = rd(L.acc, []); const i = list.findIndex(a => a.id === s.id); if (i >= 0) { list[i] = { ...list[i], ...safe }; wr(L.acc, list); } if (safe.name) { s.name = safe.name; wr(L.sess, s); } return list[i]; },
      async remove(id) { wr(L.acc, rd(L.acc, []).filter(a => a.id !== id)); },
    },
    interests: {
      async add(rec) { const list = rd('codev_interests', []); const s = rd(L.sess, null); const r = { id: uid(), createdAt: nowISO(), user_email: s && s.email, user_name: s && s.name, ...rec }; list.unshift(r); wr('codev_interests', list); return r; },
      async listAll() { return rd('codev_interests', []); },
    },
    qualifications: {
      async add(q) { const list = rd('codev_qualifications', []); const s = rd(L.sess, null);
        const r = { id: uid(), created_at: nowISO(), status: 'qualification_in_progress', user_id: s && s.id, user_email: s && s.email, user_name: s && s.name,
          property_id: q.propertyId, property_title: q.propertyTitle, developer: q.developer, investor_type: q.investorType, unit_type: q.unitType,
          amount_band: q.amountBand, currency: q.currency, objective: q.objective, readiness: q.readiness, funding_method: q.fundingMethod,
          capacity_range: q.capacityRange, mortgage_required: !!q.mortgageRequired, source_of_funds: q.sourceOfFunds, declaration: !!q.declaration };
        list.unshift(r); wr('codev_qualifications', list); return r; },
      async listMine() { const s = rd(L.sess, null); return s ? rd('codev_qualifications', []).filter(q => q.user_id === s.id) : []; },
      async listAll() { return rd('codev_qualifications', []); },
      async update(id, patch) { const list = rd('codev_qualifications', []); const i = list.findIndex(q => q.id === id); if (i < 0) return; list[i] = { ...list[i], ...patch }; wr('codev_qualifications', list); return list[i]; },
    },
    settings: {
      async getFx() { return Object.assign({}, CFG.FX_DEFAULT, rd('codev_fx', {})); },
      async setFx(rates) { wr('codev_fx', rates); return rates; },
    },
    documents: {
      async listForProperty(pid) { return rd(L.docs, []).filter(d => d.propertyId === pid); },
      async listAll() { return rd(L.docs, []); },
      async statusForProperty(pid) { return rd(L.docs, []).filter(d => d.propertyId === pid)
        .map(d => ({ property_id: d.propertyId, doc_key: d.key, doc_label: d.label, status: d.status, reviewed_at: d.reviewedAt })); },
      async submit(pid, doc) { const s = rd(L.sess, null); const list = rd(L.docs, []); const i = list.findIndex(d => d.propertyId === pid && d.key === doc.key);
        const rec = { id: (i >= 0 ? list[i].id : uid()), propertyId: pid, key: doc.key, label: doc.label,
          fileData: doc.fileData || '', fileName: doc.fileName || '', fileType: doc.fileType || '',
          status: 'under_review', note: '', submittedBy: s && s.id, submittedAt: nowISO(), reviewedAt: null, reviewedBy: null };
        if (i >= 0) list[i] = rec; else list.unshift(rec); wr(L.docs, list); return rec; },
      async review(id, { status, note }) { const list = rd(L.docs, []); const i = list.findIndex(d => d.id === id); if (i < 0) return;
        list[i] = { ...list[i], status, note: note || '', reviewedAt: nowISO(), reviewedBy: (rd(L.sess, null) || {}).id }; wr(L.docs, list); return list[i]; },
      async remove(id) { wr(L.docs, rd(L.docs, []).filter(d => d.id !== id)); },
    },
    dealroom: {
      async isVerifiedBuyer(pid) { const s = rd(L.sess, null); if (!s) return false; return rd('codev_qualifications', []).some(q => q.property_id === pid && q.user_id === s.id && q.status === 'codev_verified'); },
      async myAccess(pid) { const s = rd(L.sess, null); if (!s) return null; return rd(L.dra, []).find(a => a.propertyId === pid && a.userId === s.id) || null; },
      async acknowledge(pid, ndaVersion) { const s = rd(L.sess, null); const list = rd(L.dra, []); const i = list.findIndex(a => a.propertyId === pid && a.userId === (s && s.id));
        if (i >= 0 && list[i].status !== 'active') return list[i]; // revoked/expired can't self-reactivate
        const rec = { id: (i >= 0 ? list[i].id : uid()), propertyId: pid, userId: s && s.id, userEmail: s && s.email, userName: s && s.name,
          status: 'active', ndaVersion: ndaVersion || 'v1', acknowledgedAt: nowISO(), grantedAt: (i >= 0 ? list[i].grantedAt : nowISO()), createdAt: (i >= 0 ? list[i].createdAt : nowISO()) };
        if (i >= 0) list[i] = rec; else list.unshift(rec); wr(L.dra, list); await this.log(pid, 'acknowledged', null); return rec; },
      async clearedDocs(pid) { const acc = await this.myAccess(pid); if (!acc || acc.status !== 'active' || !acc.acknowledgedAt) return []; if (!await this.isVerifiedBuyer(pid)) return []; return rd(L.docs, []).filter(d => d.propertyId === pid && d.status === 'cleared'); },
      async log(pid, event, docKey) { const s = rd(L.sess, null); const list = rd(L.dre, []); list.unshift({ id: uid(), propertyId: pid, userId: s && s.id, userEmail: s && s.email, event, docKey: docKey || '', createdAt: nowISO() }); wr(L.dre, list); },
      async listAccess() { return rd(L.dra, []); },
      async listEvents(pid) { return rd(L.dre, []).filter(e => e.propertyId === pid); },
      async revoke(id) { const list = rd(L.dra, []); const i = list.findIndex(a => a.id === id); if (i < 0) return; list[i] = { ...list[i], status: 'revoked', revokedAt: nowISO() }; wr(L.dra, list); return list[i]; },
      async reinstate(id) { const list = rd(L.dra, []); const i = list.findIndex(a => a.id === id); if (i < 0) return; list[i] = { ...list[i], status: 'active', revokedAt: null }; wr(L.dra, list); return list[i]; },
    },
  };

  if (!configured) localSeed();
  const auth = configured ? sbAuth : localAuth;
  const db = configured ? sbDB : localDB;

  const fmtN = (n) => '₦' + (Number(n) || 0).toLocaleString();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Unique, human-readable listing reference — generated once a listing is complete
  // (published/verified) and then kept for the life of the listing. Format: CDV-XXXXXX
  // (unambiguous alphabet, no 0/O/1/I). Each unit is tagged REF-U001, REF-U002, …
  const makeListingRef = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = '';
    const rnd = (window.crypto && crypto.getRandomValues) ? crypto.getRandomValues(new Uint32Array(6)) : null;
    for (let i = 0; i < 6; i++) { const r = rnd ? rnd[i] : Math.floor(Math.random() * 1e9); s += A[r % A.length]; }
    return 'CDV-' + s;
  };
  const unitIds = (ref, count) => {
    const n = Math.max(0, parseInt(count, 10) || 0); const out = [];
    if (!ref) return out;
    for (let i = 1; i <= n; i++) out.push(ref + '-U' + String(i).padStart(3, '0'));
    return out;
  };

  return { CFG, auth, db, fmtN, esc, now: nowISO, makeListingRef, unitIds };
})();
