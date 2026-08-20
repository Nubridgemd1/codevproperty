/* CoDevelop — data & store layer.
 * Works standalone on localStorage (per-browser demo of the real flows).
 * "Real when configured": set SUPABASE_URL + SUPABASE_KEY below and the same store API
 * can be pointed at Supabase tables (accounts, properties) for real, multi-user, cross-device data.
 */
window.CODEV = (function () {
  const CFG = {
    brand: 'CoDevelop',
    tagline: 'Property Co-Development',
    // Leave blank for local mode. When set, wire the async adapter (see README) for shared data.
    SUPABASE_URL: '',
    SUPABASE_KEY: '',
    ADMIN_PASSCODE: 'admin2026',
    ROLES: ['investor', 'developer', 'visitor'], // admin is separate
    STAGES: ['Land / Commencement', 'Foundation', 'Structural Frame', 'Building Envelope',
             'Mechanical & Electrical', 'Finishing', 'Completion / Handover'],
  };

  const K = { acc: 'codev_accounts', prop: 'codev_properties', sess: 'codev_session', seed: 'codev_seeded_v1' };
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const hash = (s) => btoa(unescape(encodeURIComponent(s || ''))); // demo only — not real hashing

  // ---- seed on first load ----
  function seed() {
    if (read(K.seed, false)) return;
    const accounts = [
      { id: uid(), name: 'Platform Admin', email: 'admin@codevproperty.com', pass: hash('admin2026'), role: 'admin', status: 'active', createdAt: now() },
      { id: uid(), name: 'Meridian Developments', email: 'dev@meridian.example', pass: hash('demo1234'), role: 'developer', status: 'active', createdAt: now() },
      { id: uid(), name: 'Adaeze Okafor', email: 'investor@example.com', pass: hash('demo1234'), role: 'investor', status: 'active', createdAt: now() },
    ];
    const properties = [
      { id: uid(), title: 'Ivory Residences', developer: 'Meridian Developments', location: 'Ikoyi, Lagos',
        summary: '24 curated waterfront-adjacent residences in the heart of Ikoyi.', priceFrom: 45000000,
        stage: 'Foundation', status: 'verified', submittedByRole: 'developer', submittedBy: 'dev@meridian.example', createdAt: now(), verifiedAt: now() },
      { id: uid(), title: 'Marina Heights', developer: 'Atlas Urban', location: 'Victoria Island, Lagos',
        summary: 'A landmark mixed-use tower — residences, offices and retail on VI.', priceFrom: 38000000,
        stage: 'Structural Frame', status: 'verified', submittedByRole: 'developer', submittedBy: 'atlas@example.com', createdAt: now(), verifiedAt: now() },
      { id: uid(), title: 'Lekki Palms Estate', developer: 'Coastline Projects', location: 'Lekki, Lagos',
        summary: 'A 120-home gated estate with parks, retail and 24/7 security.', priceFrom: 22000000,
        stage: 'Land / Commencement', status: 'verified', submittedByRole: 'developer', submittedBy: 'coast@example.com', createdAt: now(), verifiedAt: now() },
      { id: uid(), title: 'Ikeja GRA Duplex Plot', developer: 'Private lister', location: 'Ikeja GRA, Lagos',
        summary: 'Owner-listed plot with approved building plan — seeking co-development partners.', priceFrom: 15000000,
        stage: 'Land / Commencement', status: 'pending', submittedByRole: 'visitor', submittedBy: 'visitor@example.com', createdAt: now() },
    ];
    write(K.acc, accounts); write(K.prop, properties); write(K.seed, true);
  }
  seed();

  // ---- store API (sync/local; mirror these signatures for a Supabase adapter) ----
  const store = {
    accounts: {
      list: () => read(K.acc, []),
      byId: (id) => read(K.acc, []).find(a => a.id === id),
      byEmail: (e) => read(K.acc, []).find(a => (a.email || '').toLowerCase() === (e || '').toLowerCase()),
      add(a) {
        const list = read(K.acc, []);
        if (list.some(x => (x.email || '').toLowerCase() === (a.email || '').toLowerCase()))
          throw new Error('An account with that email already exists');
        const rec = { id: uid(), status: 'active', createdAt: now(), ...a, pass: hash(a.pass || 'changeme') };
        list.push(rec); write(K.acc, list); return rec;
      },
      update(id, patch) {
        const list = read(K.acc, []); const i = list.findIndex(a => a.id === id);
        if (i < 0) return null; if (patch.pass) patch.pass = hash(patch.pass);
        list[i] = { ...list[i], ...patch }; write(K.acc, list); return list[i];
      },
      remove(id) { write(K.acc, read(K.acc, []).filter(a => a.id !== id)); },
      verifyPass(email, pass) { const a = store.accounts.byEmail(email); return a && a.pass === hash(pass) ? a : null; },
    },
    properties: {
      list: () => read(K.prop, []),
      byId: (id) => read(K.prop, []).find(p => p.id === id),
      listPublic: () => read(K.prop, []).filter(p => p.status === 'verified'),
      listBy: (email) => read(K.prop, []).filter(p => (p.submittedBy || '').toLowerCase() === (email || '').toLowerCase()),
      add(p) {
        const list = read(K.prop, []);
        const rec = { id: uid(), status: 'pending', createdAt: now(), ...p };
        list.unshift(rec); write(K.prop, list); return rec;
      },
      update(id, patch) {
        const list = read(K.prop, []); const i = list.findIndex(p => p.id === id);
        if (i < 0) return null; list[i] = { ...list[i], ...patch }; write(K.prop, list); return list[i];
      },
      setStatus(id, status) {
        const patch = { status }; if (status === 'verified') patch.verifiedAt = now();
        return store.properties.update(id, patch);
      },
      remove(id) { write(K.prop, read(K.prop, []).filter(p => p.id !== id)); },
    },
    session: {
      get: () => read(K.sess, null),
      set: (acc) => write(K.sess, acc ? { id: acc.id, name: acc.name, email: acc.email, role: acc.role } : null),
      clear: () => localStorage.removeItem(K.sess),
    },
  };

  const fmtN = (n) => '₦' + (Number(n) || 0).toLocaleString();
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return { CFG, store, fmtN, esc, uid, now };
})();
