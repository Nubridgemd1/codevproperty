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
    PROPERTY_TYPES: ['Apartment / Flat', 'Studio Apartment', 'Penthouse', 'Maisonette',
             'Terraced House', 'Townhouse', 'Semi-Detached House', 'Detached House', 'Bungalow',
             'Residential Land', 'Commercial Land', 'Mixed-Use Land',
             'Office', 'Shop / Retail Unit', 'Warehouse', 'Industrial Property',
             'Hotel / Hospitality Property', 'Mixed-Use Development', 'Other'],
    // Property types that are residential dwellings — the Bedrooms field shows only for these.
    RESIDENTIAL_TYPES: ['Apartment / Flat', 'Studio Apartment', 'Penthouse', 'Maisonette',
             'Terraced House', 'Townhouse', 'Semi-Detached House', 'Detached House', 'Bungalow'],
    LAND_TYPES: ['Residential Land', 'Commercial Land', 'Mixed-Use Land'],
    BEDROOMS: ['Studio', '1 Bedroom', '2 Bedrooms', '3 Bedrooms', '4 Bedrooms', '5 Bedrooms', '6+ Bedrooms'],
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
    // Display labels for milestone (payment-release) status; keys above stay stable in the DB.
    MILESTONE_STATUS_LABELS: { 'pending': 'Payment Pending', 'in-progress': 'Payment in-Progress', 'certified': 'Payment Completed' },
    // Currency is Naira (₦) only across the platform.
    CURRENCIES: ['NGN'],
    CURRENCY_SYMBOLS: { NGN: '₦' },
    FX_DEFAULT: { NGN: 1 },
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
    address: r.address || '', propertyType: r.property_type || '', bedrooms: r.bedrooms || '',
    price: (r.price === 0 || r.price) ? r.price : '',
    items: Array.isArray(r.property_items) ? r.property_items : [],
    units: (r.units === 0 || r.units) ? r.units : '', deliveryDate: r.delivery_date || '',
    summary: r.summary, priceFrom: r.price_from, stage: r.stage, status: r.status,
    legalStatus: r.legal_status || 'not_submitted', legalReviewedAt: r.legal_reviewed_at || null,
    submittedBy: r.submitted_by_email, submittedByRole: r.submitted_by_role, createdAt: r.created_at, verifiedAt: r.verified_at,
    assignedTo: r.assigned_to_email || '', assignedToId: r.assigned_to || '', assignedBy: r.assigned_by || '', assignedAt: r.assigned_at || null,
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
  const toQuery = (r) => ({ id: r.id, propertyId: r.property_id, authorId: r.author_id, authorEmail: r.author_email, authorKind: r.author_kind, body: r.body, status: r.status, createdAt: r.created_at });
  const toReport = (r) => ({ id: r.id, propertyId: r.property_id, version: r.version, scope: r.scope || '', disposition: r.disposition, summary: r.summary || '', conditions: r.conditions || '', issuedAt: r.issued_at, issuedBy: r.issued_by });
  const toTx = (r) => ({ id: r.id, propertyId: r.property_id, userId: r.user_id, userEmail: r.user_email, userName: r.user_name, txType: r.tx_type, status: r.status, amount: r.amount, currency: r.currency, documents: Array.isArray(r.documents) ? r.documents : [], fundingEvidence: r.funding_evidence || '', fundingNote: r.funding_note || '', completionRef: r.completion_ref || '', completionNote: r.completion_note || '', completedAt: r.completed_at, createdAt: r.created_at, unitRef: r.unit_ref || '', payments: Array.isArray(r.payments) ? r.payments : [] });
  const toAcc = (r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, createdAt: r.created_at,
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
    about: r.about || '', website: r.website || '', phone: r.phone || '', brochure: r.brochure || '',
    regNumber: r.reg_number || '', yearEstablished: r.year_established || '', hqAddress: r.hq_address || '',
    companyProfileDoc: r.company_profile_doc || '', cacDoc: r.cac_doc || '', referencesDoc: r.references_doc || '',
    devExtras: Array.isArray(r.dev_extras) ? r.dev_extras : [] });

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
        // When an admin creates a listing ON BEHALF OF a developer (p.assignTo = {id,email}),
        // attribute ownership to that developer so it shows in their portal (listMine filters on
        // submitted_by) and record the assignment so the developer gets auto-notified.
        const assignTo = (p.assignTo && p.assignTo.id) ? p.assignTo : null;
        const ownerId = assignTo ? assignTo.id : s.user.id;
        const ownerEmail = assignTo ? assignTo.email : s.user.email;
        const ownerRole = assignTo ? 'developer' : ((s.profile && s.profile.role) || p.submittedByRole);
        const row = { title: p.title, developer: p.developer, location: p.location, summary: p.summary, price_from: p.priceFrom, stage: p.stage,
          milestones: p.milestones || defaultMilestones(), payments: p.payments || [],
          submitted_by: ownerId, submitted_by_email: ownerEmail, submitted_by_role: ownerRole };
        const extra = { address: p.address || null, property_type: p.propertyType || null,
          bedrooms: p.bedrooms || null, price: (p.price === '' || p.price == null) ? null : Number(p.price),
          property_items: Array.isArray(p.items) ? p.items : [],
          units: (p.units === '' || p.units == null) ? null : Number(p.units), delivery_date: p.deliveryDate || null,
          ref: p.ref || makeListingRef() }; // unique reference assigned at submission (before admin verification)
        if (assignTo) { extra.assigned_to = assignTo.id; extra.assigned_to_email = assignTo.email;
          extra.assigned_by = (s.user && s.user.email) || null; extra.assigned_at = nowISO(); }
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
        if ('bedrooms' in patch) { row.bedrooms = patch.bedrooms || null; newKeys.push('bedrooms'); }
        if ('price' in patch) { row.price = (patch.price === '' || patch.price == null) ? null : Number(patch.price); newKeys.push('price'); }
        if ('items' in patch) { row.property_items = Array.isArray(patch.items) ? patch.items : []; newKeys.push('property_items'); }
        if ('units' in patch) { row.units = (patch.units === '' || patch.units == null) ? null : Number(patch.units); newKeys.push('units'); }
        if ('deliveryDate' in patch) { row.delivery_date = patch.deliveryDate || null; newKeys.push('delivery_date'); }
        if ('legalStatus' in patch) { row.legal_status = patch.legalStatus; row.legal_reviewed_at = ['cleared','conditionally_cleared'].indexOf(patch.legalStatus)>=0 ? nowISO() : null; }
        // Admin (re)assigns a listing to a developer: move ownership so it appears in the developer's
        // portal, and stamp the assignment so the notify-developer trigger fires.
        if ('assignTo' in patch && patch.assignTo && patch.assignTo.id) { const s2 = getSession();
          row.submitted_by = patch.assignTo.id; row.submitted_by_email = patch.assignTo.email; row.submitted_by_role = 'developer';
          row.assigned_to = patch.assignTo.id; row.assigned_to_email = patch.assignTo.email;
          row.assigned_by = (s2 && s2.user && s2.user.email) || null; row.assigned_at = nowISO();
          newKeys.push('assigned_to','assigned_to_email','assigned_by','assigned_at'); }
        try { return await sb('/rest/v1/properties?id=eq.' + id, { method: 'PATCH', body: row, prefer: 'return=representation' }); }
        catch (e) { // If newer columns aren't migrated yet, save the rest and flag it rather than losing the edit.
          const msg = (e && e.message) || ''; if (!newKeys.length || !/address|property_type|units|delivery_date|column|schema cache/i.test(msg)) throw e;
          CFG.listingFieldsUnavailable = true; newKeys.forEach(k => delete row[k]);
          return sb('/rest/v1/properties?id=eq.' + id, { method: 'PATCH', body: row, prefer: 'return=representation' }); } },
      async setStatus(id, status) { return sbDB.properties.update(id, { status, verifiedAt: status === 'verified' ? nowISO() : null }); },
      // Developer self-service: updates ONLY pricing on a listing they own (via SECURITY DEFINER fn).
      async updatePricing(id, { items, priceFrom }) { return sb('/rest/v1/rpc/dev_update_listing_pricing', { method: 'POST', body: { p_id: id, p_items: Array.isArray(items) ? items : [], p_price_from: (priceFrom === '' || priceFrom == null) ? null : Number(priceFrom) } }); },
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
        const LEGACY = ['name', 'about', 'website', 'phone', 'brochure'];
        const EXTRA = ['reg_number', 'year_established', 'hq_address', 'company_profile_doc', 'cac_doc', 'references_doc', 'dev_extras'];
        const pick = (keys) => { const o = {}; keys.forEach(k => { if (k in patch) o[k] = patch[k]; }); return o; };
        const patchTo = (body) => sb('/rest/v1/profiles?id=eq.' + s.user.id, { method: 'PATCH', body, prefer: 'return=representation' });
        let r;
        try { r = await patchTo(pick(LEGACY.concat(EXTRA))); CFG.devAboutUnavailable = false; }
        catch (err) {
          // No disruption: if the "About developer" columns aren't in the DB yet (PROFILE-ABOUT.sql
          // not run), retry with only the long-standing fields so the profile still saves.
          const m = (err && err.message) || '';
          const hasExtra = Object.keys(pick(EXTRA)).length > 0;
          if (hasExtra && /column|schema cache|reg_number|year_established|hq_address|company_profile_doc|cac_doc|references_doc|dev_extras|PGRST|\b40\d\b/i.test(m)) {
            CFG.devAboutUnavailable = true; r = await patchTo(pick(LEGACY));
          } else throw err;
        }
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
    // ---- Legal queries thread (see TRANSACTIONS.sql) ----
    legalQueries: {
      async list(pid) { return (await sb('/rest/v1/legal_queries?property_id=eq.' + pid + '&order=created_at.asc&select=*')).map(toQuery); },
      async add(pid, body, kind) { const s = getSession(); const row = { property_id: pid, author_id: s.user.id, author_email: s.user.email, author_kind: kind, body, status: 'open' };
        return (await sb('/rest/v1/legal_queries', { method: 'POST', body: row, prefer: 'return=representation' })).map(toQuery)[0]; },
      async resolve(id, resolved) { return sb('/rest/v1/legal_queries?id=eq.' + id, { method: 'PATCH', body: { status: resolved ? 'resolved' : 'open' }, prefer: 'return=representation' }); },
    },
    // ---- Versioned counsel report ----
    legalReports: {
      async list(pid) { return (await sb('/rest/v1/legal_reports?property_id=eq.' + pid + '&order=version.desc&select=*')).map(toReport); },
      async latest(pid) { const r = await sb('/rest/v1/legal_reports?property_id=eq.' + pid + '&order=version.desc&limit=1&select=*'); return (r && r[0]) ? toReport(r[0]) : null; },
      async issue(pid, rep) { const s = getSession(); const latest = await this.latest(pid); const version = (latest ? latest.version : 0) + 1;
        const row = { property_id: pid, version, scope: rep.scope || null, disposition: rep.disposition, summary: rep.summary || null, conditions: rep.conditions || null, issued_by: s.user.id, issued_at: nowISO() };
        return (await sb('/rest/v1/legal_reports', { method: 'POST', body: row, prefer: 'return=representation' })).map(toReport)[0]; },
    },
    // ---- Transactions & completion ----
    transactions: {
      async listAll() { return (await sb('/rest/v1/transactions?order=created_at.desc&select=*')).map(toTx); },
      async listForProperty(pid) { return (await sb('/rest/v1/transactions?property_id=eq.' + pid + '&order=created_at.desc&select=*')).map(toTx); },
      async listMine() { const s = getSession(); if (!s) return []; return (await sb('/rest/v1/transactions?user_id=eq.' + s.user.id + '&order=created_at.desc&select=*')).map(toTx); },
      async listMineForProperty(pid) { const s = getSession(); if (!s) return []; return (await sb('/rest/v1/transactions?property_id=eq.' + pid + '&user_id=eq.' + s.user.id + '&order=created_at.desc&select=*')).map(toTx); },
      async create(tx) { const s = getSession(); const row = { property_id: tx.propertyId, user_id: tx.userId, user_email: tx.userEmail || null, user_name: tx.userName || null,
          tx_type: tx.txType, status: 'initiated', amount: (tx.amount === '' || tx.amount == null) ? null : Number(tx.amount), currency: tx.currency || 'NGN', unit_ref: tx.unitRef || null, created_by: s.user.id };
        return (await sb('/rest/v1/transactions', { method: 'POST', body: row, prefer: 'return=representation' })).map(toTx)[0]; },
      async update(id, patch) { const row = { updated_at: nowISO() };
        if ('status' in patch) row.status = patch.status;
        if ('unitRef' in patch) row.unit_ref = patch.unitRef || null;
        if ('payments' in patch) row.payments = Array.isArray(patch.payments) ? patch.payments : [];
        if ('amount' in patch) row.amount = (patch.amount === '' || patch.amount == null) ? null : Number(patch.amount);
        if ('currency' in patch) row.currency = patch.currency;
        if ('documents' in patch) row.documents = patch.documents;
        if ('fundingEvidence' in patch) row.funding_evidence = patch.fundingEvidence;
        if ('fundingNote' in patch) row.funding_note = patch.fundingNote;
        if ('completionRef' in patch) row.completion_ref = patch.completionRef;
        if ('completionNote' in patch) row.completion_note = patch.completionNote;
        if ('completedAt' in patch) row.completed_at = patch.completedAt;
        return (await sb('/rest/v1/transactions?id=eq.' + id, { method: 'PATCH', body: row, prefer: 'return=representation' })).map(toTx)[0]; },
    },
  };

  // ================= LOCAL FALLBACK MODE (no keys) =================
  const L = { acc: 'codev_accounts', prop: 'codev_properties', sess: 'codev_session', seed: 'codev_seeded_v1', docs: 'codev_docs', dra: 'codev_dra', dre: 'codev_dre', lq: 'codev_lq', lr: 'codev_lr', tx: 'codev_tx' };
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
      async updatePricing(id, { items, priceFrom }) { return localDB.properties.update(id, { items: Array.isArray(items) ? items : [], priceFrom: (priceFrom === '' || priceFrom == null) ? undefined : Number(priceFrom) }); },
      async remove(id) { wr(L.prop, rd(L.prop, []).filter(p => p.id !== id)); },
    },
    profiles: {
      async listAll() { return rd(L.acc, []); },
      async byId(id) { return rd(L.acc, []).find(a => a.id === id); },
      async add({ name, email, role, password }) { const list = rd(L.acc, []); if (list.some(a => a.email.toLowerCase() === email.toLowerCase())) throw new Error('Email exists'); const a = { id: uid(), name, email, role, status: 'active', pass: H(password || 'changeme'), createdAt: nowISO() }; list.push(a); wr(L.acc, list); return a; },
      async update(id, patch) { const list = rd(L.acc, []); const i = list.findIndex(a => a.id === id); if (i < 0) return; list[i] = { ...list[i], ...patch }; wr(L.acc, list); return list[i]; },
      async updateMine(patch) { const s = rd(L.sess, null); if (!s) throw new Error('Not signed in'); const safe = {}; ['name', 'about', 'website', 'phone', 'brochure', 'reg_number', 'year_established', 'hq_address', 'company_profile_doc', 'cac_doc', 'references_doc', 'dev_extras'].forEach(k => { if (k in patch) safe[k] = patch[k]; }); const list = rd(L.acc, []); const i = list.findIndex(a => a.id === s.id); if (i >= 0) { list[i] = { ...list[i], ...safe }; wr(L.acc, list); } if (safe.name) { s.name = safe.name; wr(L.sess, s); } return list[i]; },
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
    legalQueries: {
      async list(pid) { return rd(L.lq, []).filter(q => q.propertyId === pid).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))); },
      async add(pid, body, kind) { const s = rd(L.sess, null); const list = rd(L.lq, []); const rec = { id: uid(), propertyId: pid, authorId: s && s.id, authorEmail: s && s.email, authorKind: kind, body, status: 'open', createdAt: nowISO() }; list.push(rec); wr(L.lq, list); return rec; },
      async resolve(id, resolved) { const list = rd(L.lq, []); const i = list.findIndex(q => q.id === id); if (i < 0) return; list[i] = { ...list[i], status: resolved ? 'resolved' : 'open' }; wr(L.lq, list); return list[i]; },
    },
    legalReports: {
      async list(pid) { return rd(L.lr, []).filter(r => r.propertyId === pid).sort((a, b) => b.version - a.version); },
      async latest(pid) { const l = (await this.list(pid)); return l[0] || null; },
      async issue(pid, rep) { const s = rd(L.sess, null); const list = rd(L.lr, []); const latest = list.filter(r => r.propertyId === pid).sort((a, b) => b.version - a.version)[0];
        const rec = { id: uid(), propertyId: pid, version: (latest ? latest.version : 0) + 1, scope: rep.scope || '', disposition: rep.disposition, summary: rep.summary || '', conditions: rep.conditions || '', issuedBy: s && s.id, issuedAt: nowISO() };
        list.unshift(rec); wr(L.lr, list); return rec; },
    },
    transactions: {
      async listAll() { return rd(L.tx, []); },
      async listForProperty(pid) { return rd(L.tx, []).filter(t => t.propertyId === pid); },
      async listMine() { const s = rd(L.sess, null); return s ? rd(L.tx, []).filter(t => t.userId === s.id) : []; },
      async listMineForProperty(pid) { const s = rd(L.sess, null); return s ? rd(L.tx, []).filter(t => t.propertyId === pid && t.userId === s.id) : []; },
      async create(tx) { const s = rd(L.sess, null); const list = rd(L.tx, []); const rec = { id: uid(), propertyId: tx.propertyId, userId: tx.userId, userEmail: tx.userEmail || '', userName: tx.userName || '', txType: tx.txType, status: 'initiated', amount: (tx.amount === '' || tx.amount == null) ? null : Number(tx.amount), currency: tx.currency || 'NGN', documents: [], fundingEvidence: '', fundingNote: '', completionRef: '', completionNote: '', completedAt: null, createdBy: s && s.id, createdAt: nowISO() }; list.unshift(rec); wr(L.tx, list); return rec; },
      async update(id, patch) { const list = rd(L.tx, []); const i = list.findIndex(t => t.id === id); if (i < 0) return; list[i] = { ...list[i], ...patch, updatedAt: nowISO() }; wr(L.tx, list); return list[i]; },
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

  // Bedrooms only apply to residential dwellings; land size only to land types.
  const isResidential = (type) => (CFG.RESIDENTIAL_TYPES || []).indexOf(type) >= 0;
  const isLand = (type) => (CFG.LAND_TYPES || []).indexOf(type) >= 0;
  // Combined listing-type label, e.g. "3 Bedroom Maisonette", "Studio Apartment / Flat", or just the type.
  const propTypeLabel = (p) => {
    const type = (p && p.propertyType) || '';
    const bed = (p && p.bedrooms) || '';
    if (type && bed && isResidential(type)) return bed.replace(/Bedrooms/i, 'Bedroom') + ' ' + type;
    return type;
  };
  // Label for one property item (residential → bedrooms; land → size; else the type).
  const itemLabel = (it) => {
    const t = (it && it.type) || '';
    const u = Number(it && it.units); const us = (u > 0) ? ' · ' + u + ' unit' + (u === 1 ? '' : 's') : '';
    if (isResidential(t) && it.bedrooms) return it.bedrooms.replace(/Bedrooms/i, 'Bedroom') + ' ' + t + us;
    if (isLand(t)) { const parts = []; if (it.landSqm) parts.push(it.landSqm + ' sqm'); if (it.landSqft) parts.push(it.landSqft + ' sqft'); return t + (parts.length ? ' — ' + parts.join(' / ') : '') + us; }
    return t + us;
  };
  // Min/max price across a listing's property items (numbers only).
  const priceRange = (items) => {
    const nums = (items || []).map(i => Number(i && i.price)).filter(n => n > 0);
    if (!nums.length) return null;
    return { min: Math.min.apply(null, nums), max: Math.max.apply(null, nums) };
  };

  // Parse a coordinate string into decimal-degrees {lat,lng} (WGS84). Accepts
  // "6.4281, 3.4219", "6.4281 3.4219", a Google Maps "@6.4281,3.4219,15z" or
  // "?q=6.4281,3.4219" URL, and N/S/E/W suffixes (e.g. "6.4281N, 3.4219E").
  const parseCoords = (raw) => {
    if (!raw) return null;
    let s = String(raw).trim();
    const at = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || s.match(/[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    let lat, lng;
    if (at) { lat = parseFloat(at[1]); lng = parseFloat(at[2]); }
    else {
      const parts = s.replace(/[;|]/g, ',').split(/[\s,]+/).filter(Boolean);
      if (parts.length < 2) return null;
      const num = (p) => { const m = String(p).match(/^(-?\d+(?:\.\d+)?)\s*([NSEWnsew])?$/); if (!m) return null; let v = parseFloat(m[1]); const h = (m[2] || '').toUpperCase(); if (h === 'S' || h === 'W') v = -v; return { v, h }; };
      const a = num(parts[0]), b = num(parts[1]); if (!a || !b) return null;
      // honour hemispheres if given; otherwise assume "lat, lng" order
      if (a.h === 'E' || a.h === 'W' || b.h === 'N' || b.h === 'S') { lat = b.v; lng = a.v; } else { lat = a.v; lng = b.v; }
    }
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  };
  const coordsLabel = (raw) => { const c = parseCoords(raw); return c ? c.lat + ', ' + c.lng : ''; };
  const mapUrl = (raw) => { const c = parseCoords(raw); return c ? 'https://www.google.com/maps?q=' + c.lat + ',' + c.lng : ''; };

  return { CFG, auth, db, fmtN, esc, now: nowISO, makeListingRef, unitIds, isResidential, isLand, propTypeLabel, itemLabel, priceRange, parseCoords, coordsLabel, mapUrl };
})();
