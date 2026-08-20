/* CoDevelop — public site, auth (Supabase or local), role portals, property submission */
(function () {
  const { CFG, auth, db, fmtN, esc } = window.CODEV;
  const app = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);

  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800); }
  function me() {
    const s = auth.session(); if (!s) return null;
    if (CFG.configured) { const p = s.profile || {}; return { name: p.name || (s.user && s.user.email) || 'You', email: p.email || (s.user && s.user.email), role: p.role || 'visitor', status: p.status || 'active' }; }
    return { name: s.name, email: s.email, role: s.role, status: 'active' };
  }

  function renderAuthArea() {
    const el = document.getElementById('authArea'); const u = me();
    if (!u) { el.innerHTML = `<button class="btn sm" onclick="CODEVAPP.openAuth('signin')">Sign in</button>
      <button class="btn primary sm" onclick="CODEVAPP.openAuth('signup')">Create account</button>`; return; }
    const home = u.role === 'developer' ? '#/developer' : u.role === 'investor' ? '#/investor' : '#/account';
    el.innerHTML = `<a class="btn sm" href="${home}">My portal</a>
      <span class="badge role">${esc((u.name || 'You').split(' ')[0])} · ${u.role}</span>
      <button class="btn ghost sm" onclick="CODEVAPP.logout()">Log out</button>`;
  }

  // ---- auth modal ----
  function openAuth(mode, then) { CODEVAPP._afterAuth = then || null; $('#authTitle').textContent = mode === 'signup' ? 'Create your account' : 'Sign in'; $('#authBody').innerHTML = mode === 'signup' ? signupForm() : signinForm(); $('#authModal').classList.add('show'); }
  function closeAuth() { $('#authModal').classList.remove('show'); }
  function signinForm() { return `<form onsubmit="return CODEVAPP.doSignin(event)">
    <div class="field"><label>Email</label><input name="email" type="email" required></div>
    <div class="field"><label>Password</label><input name="pass" type="password" required></div>
    <button class="btn primary" style="width:100%" id="siBtn">Sign in</button>
    <p class="small muted center" style="margin-top:12px">New here? <a href="#" onclick="CODEVAPP.openAuth('signup');return false">Create an account</a></p></form>`; }
  function signupForm() { return `<form onsubmit="return CODEVAPP.doSignup(event)">
    <div class="field"><label>Full name / company</label><input name="name" required></div>
    <div class="field"><label>Email</label><input name="email" type="email" required></div>
    <div class="field"><label>I am a…</label><select name="role">
      <option value="investor">Investor — co-develop verified property</option>
      <option value="developer">Developer — list &amp; raise co-development capital</option>
      <option value="visitor">Property owner — list my property</option></select></div>
    <div class="field"><label>Password</label><input name="pass" type="password" minlength="6" required></div>
    <button class="btn primary" style="width:100%" id="suBtn">Create account</button>
    <p class="tiny muted center" style="margin-top:12px">Sandbox mode — no real capital, KYC or escrow. ${CFG.configured ? 'Accounts are real &amp; shared across devices.' : 'Local demo mode.'}</p>
    <p class="small muted center">Have an account? <a href="#" onclick="CODEVAPP.openAuth('signin');return false">Sign in</a></p></form>`; }

  async function doSignin(e) { e.preventDefault(); const f = e.target; const btn = $('#siBtn'); btn.disabled = true; btn.textContent = 'Signing in…';
    try { const sess = await auth.signIn({ email: f.email.value.trim(), password: f.pass.value });
      const u = me();
      if (u && u.status === 'suspended') { await auth.signOut(); toast('Account suspended — contact admin'); btn.disabled = false; btn.textContent = 'Sign in'; return false; }
      if (u && u.role === 'admin') { toast('Admins use the Admin console'); location.href = 'admin.html'; return false; }
      if (CFG.configured) {
        if (!(sess.mfa && sess.mfa.enrolled)) { await startEnroll(); return false; }        // enforce 2FA enrolment
        if (!auth.mfaOk()) { await startChallenge(sess.mfa.factorId); return false; }        // require 2FA code
      }
      await afterAuth();
    } catch (err) { toast(err.message || 'Sign in failed'); btn.disabled = false; btn.textContent = 'Sign in'; } return false; }
  async function doSignup(e) { e.preventDefault(); const f = e.target; const btn = $('#suBtn'); btn.disabled = true; btn.textContent = 'Creating…';
    try { await auth.signUp({ name: f.name.value.trim(), email: f.email.value.trim(), role: f.role.value, password: f.pass.value });
      if (CFG.configured) { await startEnroll(); } else { toast('Welcome to CoDevelop!'); await afterAuth(); }   // 2FA required for every account
    } catch (err) { toast(err.message || 'Sign up failed'); btn.disabled = false; btn.textContent = 'Create account'; } return false; }

  // ---- 2FA (required for all accounts) ----
  async function startEnroll() {
    try { const d = await auth.enrollTOTP(); const factorId = d.id; const t = d.totp || {}; const qr = t.qr_code || ''; const secret = t.secret || '';
      const qrHtml = qr.indexOf('<svg') >= 0 ? `<div style="width:180px;margin:8px auto">${qr}</div>` : qr ? `<img src="${qr}" alt="2FA QR" width="180" height="180" style="display:block;margin:8px auto">` : '';
      $('#authTitle').textContent = 'Set up two-factor authentication';
      $('#authBody').innerHTML = `<p class="small muted">2FA is required for every account. Scan this with Google Authenticator, Authy or 1Password, then enter the 6-digit code.</p>
        ${qrHtml}<p class="tiny muted center" style="margin-top:4px">Can't scan? Enter this key manually:<br><code style="user-select:all;font-size:12px">${esc(secret)}</code></p>
        <form onsubmit="return CODEVAPP.confirmEnroll(event,'${factorId}')">
          <div class="field"><label>6-digit code</label><input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autofocus></div>
          <button class="btn primary" style="width:100%" id="enBtn">Verify &amp; enable 2FA</button></form>`;
      $('#authModal').classList.add('show');
    } catch (err) { toast(err.message || 'Could not start 2FA setup'); }
  }
  async function confirmEnroll(e, factorId) { e.preventDefault(); const code = e.target.code.value.trim(); const btn = $('#enBtn'); btn.disabled = true; btn.textContent = 'Verifying…';
    try { const ch = await auth.mfaChallenge(factorId); await auth.mfaVerify(factorId, ch.id, code); toast('Two-factor enabled'); await afterAuth(); }
    catch (err) { toast(err.message || 'Invalid code — try again'); btn.disabled = false; btn.textContent = 'Verify & enable 2FA'; } return false; }
  async function startChallenge(factorId) {
    try { const ch = await auth.mfaChallenge(factorId);
      $('#authTitle').textContent = 'Two-factor authentication';
      $('#authBody').innerHTML = `<p class="small muted">Enter the 6-digit code from your authenticator app to finish signing in.</p>
        <form onsubmit="return CODEVAPP.confirmChallenge(event,'${factorId}','${ch.id}')">
          <div class="field"><label>6-digit code</label><input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autofocus></div>
          <button class="btn primary" style="width:100%" id="chBtn">Verify</button></form>`;
      $('#authModal').classList.add('show');
    } catch (err) { toast(err.message || 'Could not start 2FA'); }
  }
  async function confirmChallenge(e, factorId, challengeId) { e.preventDefault(); const code = e.target.code.value.trim(); const btn = $('#chBtn'); btn.disabled = true; btn.textContent = 'Verifying…';
    try { await auth.mfaVerify(factorId, challengeId, code); await afterAuth(); }
    catch (err) { toast(err.message || 'Invalid code — try again'); btn.disabled = false; btn.textContent = 'Verify'; } return false; }
  function mfaGate() { // returns true if blocked (and shows modal)
    if (!CFG.configured || !me() || auth.mfaOk()) return false;
    const s = auth.session(); if (s && s.mfa && s.mfa.enrolled && s.mfa.factorId) startChallenge(s.mfa.factorId); else startEnroll();
    return true;
  }
  async function afterAuth() { closeAuth(); renderAuthArea(); const then = CODEVAPP._afterAuth; CODEVAPP._afterAuth = null;
    if (then) then(); else { const u = me(); location.hash = u.role === 'developer' ? '#/developer' : u.role === 'investor' ? '#/investor' : '#/account'; } route(); }
  async function logout() { await auth.signOut(); renderAuthArea(); toast('Logged out'); location.hash = '#/'; route(); }
  function requireLogin(then) { if (me()) return true; openAuth('signin', then); return false; }

  // ---- pieces ----
  function oppCard(p) { return `<div class="card opp-card">
    <div class="ph"><span class="vb badge verified">✓ Verified</span><span class="loc">📍 ${esc(p.location)}</span></div>
    <div style="padding:16px"><div class="small muted" style="font-weight:600">${esc(p.developer)}</div>
      <h3 style="margin:2px 0 6px;font-size:19px">${esc(p.title)}</h3>
      <p class="small muted" style="min-height:38px">${esc(p.summary)}</p>
      ${fundingBar(p)}
      <div class="spread" style="border-top:1px solid var(--line);padding-top:11px;margin-top:10px">
        <div><div class="tiny muted">Participation from</div><div class="serif" style="color:var(--bronze);font-size:17px">${fmtN(p.priceFrom)}</div></div>
        <span class="tiny" style="font-weight:700;color:var(--navy)">${esc(p.stage)}</span></div>
      <a class="btn sm" style="width:100%;justify-content:center;margin-top:12px" href="#/opp/${p.id}">View development →</a></div></div>`; }
  function funded(p) { return (p.milestones || []).filter(m => m.status === 'certified').reduce((n, m) => n + (Number(m.pct) || 0), 0); }
  function fundingBar(p) { const f = funded(p); return `<div style="margin-top:8px"><div class="tiny muted spread"><span>Funding released</span><span>${f}%</span></div>
    <div style="height:6px;background:var(--line2);border-radius:6px;overflow:hidden;margin-top:3px"><div style="height:100%;width:${f}%;background:var(--green)"></div></div></div>`; }

  // ---- views (return HTML strings; data passed in) ----
  const V = {
    home(opps, counts) { return `<section class="hero"><div class="wrap grid g2" style="padding:56px 22px;align-items:center">
      <div><span class="eyebrow">Nigeria · Ikoyi · VI · Lekki · Ikeja GRA</span>
        <h1 style="font-size:40px;line-height:1.08;margin:10px 0 14px">Co-develop verified property — before the developer's margin.</h1>
        <p class="muted" style="font-size:16px;max-width:46ch">List a property, get it verified, and co-develop with qualified capital on one governed platform. Every listing is reviewed and approved before it goes public.</p>
        <div class="row" style="margin-top:22px"><a class="btn primary" href="#/opportunities">Explore opportunities</a><a class="btn" href="#/list">List a property</a></div></div>
      <div class="grid" style="gap:14px">
        <div class="card pad"><div class="spread">
          <div><div class="serif" style="font-size:26px;color:var(--navy)">${counts.opps}</div><div class="tiny muted">Verified opportunities</div></div>
          <div><div class="serif" style="font-size:26px;color:var(--navy)">${counts.devs}</div><div class="tiny muted">Developers</div></div>
          <div><div class="serif" style="font-size:26px;color:var(--navy)">${counts.investors}</div><div class="tiny muted">Investors</div></div></div></div>
        <div class="card pad" style="background:var(--navy);color:#fff"><div class="eyebrow" style="color:var(--bronze2)">Trust before conversion</div>
          <p style="margin:8px 0 0;font-size:14px;color:#dbe4ec">Listings from developers <b style="color:#fff">and</b> property owners are verified by our admin team before appearing here.</p></div></div></div></section>
      <section class="wrap" style="padding:44px 22px"><div class="spread" style="margin-bottom:18px"><div><span class="eyebrow">Curated opportunities</span><h2 style="margin:4px 0 0;font-size:27px">Featured developments</h2></div><a class="btn sm" href="#/opportunities">View all →</a></div>
        <div class="grid g3">${opps.slice(0, 3).map(oppCard).join('') || empty('No verified opportunities yet.')}</div></section>`; },
    opportunities(opps) { return sec('All opportunities', 'Every listing here has been verified by our admin team.', `<div class="grid g3">${opps.map(oppCard).join('') || empty('No verified opportunities yet — check back soon.')}</div>`); },
    opp(p) { if (!p) return sec('Not available', '', empty('This development is not available.'));
      const ms = p.milestones || []; const pays = p.payments || [];
      return `<section class="wrap" style="padding:36px 22px"><a class="small muted" href="#/opportunities">← All opportunities</a>
        <div class="grid g2" style="margin-top:14px;align-items:start">
          <div class="card" style="overflow:hidden"><div class="ph" style="height:240px"></div>
            <div style="padding:18px"><h3 style="margin:0 0 10px;font-size:17px">Milestone schedule &amp; timeline</h3>
              ${fundingBar(p)}
              <table style="margin-top:10px;font-size:13px"><thead><tr><th>Milestone</th><th>%</th><th>Target</th><th>Status</th></tr></thead><tbody>
              ${ms.map(m => `<tr><td>${esc(m.name)}</td><td>${m.pct}%</td><td class="tiny muted">${esc(m.targetDate || '—')}</td><td><span class="badge ${m.status === 'certified' ? 'verified' : m.status === 'in-progress' ? 'pending' : 'role'}">${esc(m.status)}</span></td></tr>`).join('') || `<tr><td colspan="4" class="muted tiny">No milestones set.</td></tr>`}
              </tbody></table></div></div>
          <div><span class="badge verified">✓ Verified</span><h1 style="font-size:30px;margin:10px 0 4px">${esc(p.title)}</h1>
            <div class="muted">${esc(p.developer)} · 📍 ${esc(p.location)}</div><p style="margin:16px 0">${esc(p.summary)}</p>
            <div class="card pad grid g2" style="gap:12px"><div><div class="tiny muted">Participation from</div><div class="serif" style="font-size:22px;color:var(--bronze)">${fmtN(p.priceFrom)}</div></div>
              <div><div class="tiny muted">Current stage</div><div style="font-weight:700;color:var(--navy)">${esc(p.stage)}</div></div></div>
            ${pays.length ? `<div class="card pad" style="margin-top:14px"><h3 style="margin:0 0 8px;font-size:15px">Payments &amp; capital calls</h3>
              <table style="font-size:13px"><tbody>${pays.map(pay => `<tr><td>${esc(pay.label)}</td><td class="tiny muted">${esc(pay.dueDate || '')}</td><td style="text-align:right">${fmtN(pay.amount)}</td><td><span class="badge ${pay.status === 'paid' ? 'verified' : 'pending'}">${esc(pay.status)}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
            <button class="btn primary" style="margin-top:16px" onclick="CODEVAPP.express('${p.id}')">Express interest</button></div></div></section>`; },
    how() { const steps = [['List', 'A developer or property owner submits a development or plot.'], ['Verify', 'Admin reviews and verifies the listing before it goes public.'], ['Co-develop', 'Investors browse verified opportunities and express interest.'], ['Govern', 'Milestone-based structure with timelines & payments (sandbox — real escrow with partners).']];
      return sec('How it works', 'From listing to verification to co-development.', `<div class="grid g2">${steps.map((s, i) => `<div class="card pad row" style="gap:14px;align-items:flex-start"><span class="step-n">${i + 1}</span><div><h3 style="margin:0 0 4px;font-size:18px">${s[0]}</h3><p class="small muted" style="margin:0">${s[1]}</p></div></div>`).join('')}</div>`); },
    list(u, mine) { return sec('List a property', 'Developers and property owners can list here. Submissions are verified by admin before they go public.',
      `<div class="grid g2" style="align-items:start">
        <form class="card pad" onsubmit="return CODEVAPP.submitProperty(event)">
          <div class="field"><label>Property / development title</label><input name="title" required></div>
          <div class="field"><label>Developer / owner name</label><input name="developer" value="${esc(u.name)}" required></div>
          <div class="field"><label>Location</label><input name="location" placeholder="e.g. Lekki, Lagos" required></div>
          <div class="field"><label>Summary</label><textarea name="summary" rows="3" required></textarea></div>
          <div class="row" style="gap:12px"><div class="field" style="flex:1"><label>Participation from (₦)</label><input name="priceFrom" type="number" min="0" required></div>
            <div class="field" style="flex:1"><label>Stage</label><select name="stage">${CFG.STAGES.map(x => `<option>${x}</option>`).join('')}</select></div></div>
          <button class="btn primary" style="width:100%">Submit for verification</button>
          <p class="tiny muted center" style="margin-top:8px">A default milestone schedule is attached — admin can refine timelines &amp; payments.</p>
        </form>
        <div><h3 style="font-size:18px">Your submissions</h3><div id="mySubs">${listCards(mine)}</div></div></div>`); },
    investor(u, opps) { return portalHead('Investor portal', u) + sec('', '', `<div class="spread" style="margin-bottom:14px"><h3 style="margin:0;font-size:19px">Verified opportunities</h3><span class="small muted">${opps.length} available</span></div><div class="grid g3">${opps.map(oppCard).join('') || empty('No verified opportunities yet.')}</div>`); },
    developer(u, mine) { return portalHead('Developer portal', u) + sec('', '', `<div class="spread" style="margin-bottom:14px"><h3 style="margin:0;font-size:19px">Your listings</h3><a class="btn primary sm" href="#/list">+ List a property</a></div><div id="mySubs">${listCards(mine)}</div>`); },
    account(u, mine) { return portalHead('Your account', u) + sec('', '', `<div class="grid g2" style="align-items:start">
      <div class="card pad"><h3 style="margin:0 0 10px;font-size:17px">Profile</h3><p class="small"><b>${esc(u.name)}</b><br><span class="muted">${esc(u.email)}</span><br><span class="badge role" style="margin-top:6px">${u.role}</span></p><button class="btn danger sm" style="margin-top:10px" onclick="CODEVAPP.logout()">Log out</button></div>
      <div><div class="spread"><h3 style="font-size:17px">Your listings</h3><a class="btn sm" href="#/list">+ List</a></div><div id="mySubs">${listCards(mine)}</div></div></div>`); },
  };
  function listCards(mine) { if (!mine || !mine.length) return `<div class="card pad small muted">No submissions yet. <a href="#/list">List a property →</a></div>`;
    return `<div class="grid" style="gap:10px">${mine.map(p => `<div class="card pad spread"><div><b>${esc(p.title)}</b><div class="tiny muted">${esc(p.location)} · ${fmtN(p.priceFrom)} · funded ${funded(p)}%</div></div><span class="badge ${p.status}">${p.status}</span></div>`).join('')}</div>`; }
  function portalHead(t, u) { return `<section class="hero"><div class="wrap" style="padding:26px 22px"><span class="eyebrow">${u.role} · ${esc(u.email)}</span><h1 style="font-size:28px;margin:6px 0 0">${t}</h1></div></section>`; }
  function sec(t, sub, body) { return `<section class="wrap" style="padding:${t ? '40' : '24'}px 22px">${t ? `<span class="eyebrow">CoDevelop</span><h2 style="margin:4px 0 ${sub ? '4' : '18'}px;font-size:27px">${t}</h2>` : ''}${sub ? `<p class="muted" style="margin:0 0 22px;max-width:60ch">${sub}</p>` : ''}${body}</section>`; }
  const empty = (m) => `<div class="card pad center muted" style="grid-column:1/-1">${m}</div>`;
  const loading = () => `<section class="wrap" style="padding:60px 22px"><div class="card pad center muted">Loading…</div></section>`;

  // ---- actions ----
  async function submitProperty(e) { e.preventDefault(); const f = e.target; const u = me();
    try { await db.properties.add({ title: f.title.value.trim(), developer: f.developer.value.trim(), location: f.location.value.trim(), summary: f.summary.value.trim(), priceFrom: Number(f.priceFrom.value), stage: f.stage.value });
      toast('Submitted! Admin will verify it before it goes public.'); const mine = await db.properties.listMine(); const box = document.getElementById('mySubs'); if (box) box.innerHTML = listCards(mine); f.reset(); f.developer.value = u.name;
    } catch (err) { toast(err.message || 'Could not submit'); } return false; }
  function express(id) { if (!requireLogin(() => express(id))) return; toast('Interest registered — the team will be in touch (sandbox).'); }

  // ---- router (async) ----
  async function route() {
    const h = (location.hash || '#/').slice(2); const [path, arg] = h.split('/');
    const gated = ['list', 'investor', 'developer', 'account'];
    if (gated.includes(path) && !requireLogin(() => route())) { app.innerHTML = sec('Sign in required', 'Please sign in to continue.', ''); return; }
    if (gated.includes(path) && mfaGate()) { app.innerHTML = sec('Two-factor required', 'Complete two-factor authentication to continue.', ''); return; }
    app.innerHTML = loading();
    try {
      const u = me();
      if (path === '' || path === undefined) { const opps = await db.properties.listPublic(); let devs = 0, inv = 0; try { const accs = CFG.configured ? await db.profiles.listAll() : []; devs = accs.filter(a => a.role === 'developer').length; inv = accs.filter(a => a.role === 'investor').length; } catch {} app.innerHTML = V.home(opps, { opps: opps.length, devs: devs || '—', investors: inv || '—' }); }
      else if (path === 'opportunities') app.innerHTML = V.opportunities(await db.properties.listPublic());
      else if (path === 'opp') app.innerHTML = V.opp(await db.properties.byId(arg));
      else if (path === 'how') app.innerHTML = V.how();
      else if (path === 'list') app.innerHTML = V.list(u, await db.properties.listMine());
      else if (path === 'investor') app.innerHTML = V.investor(u, await db.properties.listPublic());
      else if (path === 'developer') app.innerHTML = V.developer(u, await db.properties.listMine());
      else if (path === 'account') app.innerHTML = V.account(u, await db.properties.listMine());
      else { const opps = await db.properties.listPublic(); app.innerHTML = V.home(opps, { opps: opps.length, devs: '—', investors: '—' }); }
    } catch (err) { app.innerHTML = sec('Something went wrong', err.message || 'Please try again.', ''); }
    window.scrollTo(0, 0);
  }

  window.CODEVAPP = { openAuth, closeAuth, doSignin, doSignup, logout, submitProperty, express, confirmEnroll, confirmChallenge, _afterAuth: null };
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => { renderAuthArea(); route(); });
  renderAuthArea(); route();
})();
