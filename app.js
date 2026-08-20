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
    <p class="tiny muted center" style="margin-top:12px">Sandbox — no real capital/KYC/escrow. ${CFG.configured ? 'A 6-digit code is emailed to verify each sign-in (2FA).' : 'Local demo mode.'}</p>
    <p class="small muted center">Have an account? <a href="#" onclick="CODEVAPP.openAuth('signin');return false">Sign in</a></p></form>`; }

  async function doSignin(e) { e.preventDefault(); const f = e.target; const email = f.email.value.trim(); const btn = $('#siBtn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      if (CFG.configured) {
        await auth.passwordCheck({ email, password: f.pass.value });          // factor 1: password (no session yet)
        btn.textContent = 'Emailing code…'; await startEmailCode(email); return false;   // factor 2: emailed code
      }
      await auth.signIn({ email, password: f.pass.value }); await afterAuth();
    } catch (err) { toast(err.message || 'Invalid email or password'); btn.disabled = false; btn.textContent = 'Sign in'; } return false; }
  async function doSignup(e) { e.preventDefault(); const f = e.target; const email = f.email.value.trim(); const btn = $('#suBtn'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      if (CFG.configured) {
        await auth.startSignup({ name: f.name.value.trim(), email, role: f.role.value, password: f.pass.value });
        btn.textContent = 'Emailing code…'; await startEmailCode(email); return false;   // verify via emailed code
      }
      await auth.signUp({ name: f.name.value.trim(), email, role: f.role.value, password: f.pass.value }); toast('Welcome to CoDevelop!'); await afterAuth();
    } catch (err) { toast(err.message || 'Sign up failed'); btn.disabled = false; btn.textContent = 'Create account'; } return false; }

  // ---- 2FA via emailed code (required for all public accounts) ----
  async function startEmailCode(email) {
    try { await auth.sendEmailCode(email);
      $('#authTitle').textContent = 'Check your email';
      $('#authBody').innerHTML = `<p class="small muted">We emailed a 6-digit verification code to <b>${esc(email)}</b>. Enter it to finish signing in.</p>
        <form onsubmit="return CODEVAPP.confirmCode(event,'${esc(email)}')">
          <div class="field"><label>6-digit code</label><input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autofocus></div>
          <button class="btn primary" style="width:100%" id="ecBtn">Verify &amp; continue</button></form>
        <p class="tiny muted center" style="margin-top:10px">Didn't get it? <a href="#" onclick="CODEVAPP.resendCode('${esc(email)}');return false">Resend code</a> · also check spam.</p>`;
      $('#authModal').classList.add('show');
    } catch (err) { toast(err.message || 'Could not send code'); }
  }
  async function confirmCode(e, email) { e.preventDefault(); const code = e.target.code.value.trim(); const btn = $('#ecBtn'); btn.disabled = true; btn.textContent = 'Verifying…';
    try { await auth.verifyEmailCode({ email, code }); await afterAuth(); }
    catch (err) { toast(err.message || 'Invalid or expired code'); btn.disabled = false; btn.textContent = 'Verify & continue'; } return false; }
  async function resendCode(email) { try { await auth.sendEmailCode(email); toast('New code sent'); } catch (err) { toast(err.message || 'Could not resend'); } }
  function mfaGate() { if (!CFG.configured || !me() || auth.mfaOk()) return false; startEmailCode(me().email); return true; }
  async function afterAuth() {
    const u = me();
    if (u && u.status === 'suspended') { await auth.signOut(); renderAuthArea(); closeAuth(); toast('Account suspended — contact admin'); location.hash = '#/'; route(); return; }
    if (u && u.role === 'admin') { closeAuth(); toast('Admins use the Admin console'); location.href = 'admin.html'; return; }
    closeAuth(); renderAuthArea(); const then = CODEVAPP._afterAuth; CODEVAPP._afterAuth = null;
    if (then) then(); else { location.hash = u.role === 'developer' ? '#/developer' : u.role === 'investor' ? '#/investor' : '#/account'; } route();
  }
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

  // ---- co-developer marketing sections (ported from the demo, exact copy) ----
  function flowStrip() { return `<div class="flowstrip">${['Discover', 'Qualify', 'Verify', 'Deal Room', 'Commit', 'Fund', 'Build', 'Monitor', 'Own / Exit'].map(s => `<span>${s}</span>`).join('<i>›</i>')}</div>`; }
  function modelSection() { return `<section style="background:var(--soft);border-top:1px solid var(--line)"><div class="wrap" style="padding:48px 22px">
    <div class="center" style="margin-bottom:22px"><span class="eyebrow">The Model</span><h2 style="margin:6px 0 0;font-size:28px">A transparent path from discovery to ownership</h2></div>
    <div class="grid g4">${[['🔎', 'Discover & Qualify', 'Browse curated developments, then qualify privately — professional and selective, not a generic lead form.'], ['🛡️', 'Verify & Deal Room', 'Pass KYC, sign the NDA and enter a secure deal room with title, legal, QS and developer due-diligence.'], ['🏗️', 'Commit & Fund', 'Commit to a unit or SPV participation, e-sign the structure and fund on milestones through escrow.'], ['📈', 'Monitor & Own', 'Track certified construction evidence, payments and escrow releases to completion, title or exit.']].map(s => `<div class="card pad"><div style="font-size:26px;margin-bottom:8px">${s[0]}</div><h3 style="font-size:17px;margin:0 0 6px">${s[1]}</h3><p class="small muted" style="margin:0">${s[2]}</p></div>`).join('')}</div>
  </div></section>`; }
  function trustSection() { return `<section class="wrap" style="padding:48px 22px"><div class="grid g2" style="align-items:center;gap:30px">
    <div><span class="eyebrow">Trust as a product</span><h2 style="font-size:28px;margin:8px 0 12px">Professional governance at every step</h2>
      <p class="muted" style="margin-bottom:16px">Verified developers, a development approval committee, independent QS certification, and bank/escrow-controlled milestone releases — with a complete, immutable audit trail. Legal, banking and assurance are explicit participants, not afterthoughts.</p>
      <div class="row" style="gap:8px">${['Verified developers', 'Legal & title review', 'Bank / escrow control', 'Independent QS assurance', 'Immutable audit trail'].map(x => `<span class="badge verified">✓ ${x}</span>`).join('')}</div></div>
    <div class="card pad" style="background:var(--navy);color:#fff"><span class="eyebrow" style="color:var(--bronze2)">Milestone funding</span>
      <h3 style="color:#fff;font-size:19px;margin:6px 0 14px">You fund progress, not promises</h3>
      ${CFG.MILESTONE_TEMPLATE.map(m => `<div class="spread" style="font-size:13px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.1)"><span style="color:#c6d2de">${m.name}</span><b style="color:var(--bronze2)">${m.pct}%</b></div>`).join('')}
      <p class="tiny" style="color:#9fb0c0;margin-top:12px">Illustrative schedule — each development sets its own certified milestones.</p></div>
  </div></section>`; }
  function ctaSection() { return `<section style="background:var(--soft);border-top:1px solid var(--line)"><div class="wrap center" style="padding:48px 22px">
    <span class="eyebrow">Ready to explore?</span><h2 style="font-size:32px;margin:8px 0 8px">Qualify as a co-developer</h2>
    <p class="muted" style="max-width:560px;margin:0 auto 20px">Preview the full experience — enter the platform as an investor, developer, legal partner or administrator.</p>
    <a class="btn primary" href="#/investor">Enter the platform ↗</a>
  </div></section>`; }

  // ---- views (return HTML strings; data passed in) ----
  const V = {
    home(opps, counts) { const devCount = new Set(opps.map(o => o.developer).filter(Boolean)).size; return `<section class="hero"><div class="wrap" style="padding:54px 22px;text-align:center">
      <span class="eyebrow">🏛️ Nigeria MVP · Ikoyi · Victoria Island · Lekki · Ikeja GRA</span>
      <h1 style="font-size:42px;line-height:1.06;margin:12px auto 14px;max-width:15ch">Co-develop premium property — <em style="font-style:italic;color:var(--bronze)">before</em> the developer's margin.</h1>
      <p class="muted" style="font-size:16px;max-width:62ch;margin:0 auto 22px">Discover verified developments, qualify privately, structure through professional legal, fund on milestones and monitor construction to ownership — all in one governed digital journey.</p>
      <div class="row" style="justify-content:center;gap:10px"><a class="btn primary" href="#/opportunities">Explore opportunities</a><a class="btn" href="#/how">How co-development works</a></div>
      <div style="display:flex;justify-content:center">${flowStrip()}</div>
      <div class="hero-stats">
        <div><div class="n">4</div><div class="l">Prime Lagos markets</div></div>
        <div><div class="n">${opps.length}</div><div class="l">Curated opportunities</div></div>
        <div><div class="n">${devCount}</div><div class="l">Verified developers</div></div>
        <div><div class="n">Milestone</div><div class="l">Escrow-governed funding</div></div>
      </div></div></section>
      <section class="wrap" style="padding:44px 22px"><div class="center" style="max-width:640px;margin:0 auto 22px">
        <span class="eyebrow">Curated Opportunities</span><h2 style="margin:4px 0 6px;font-size:28px">Featured developments</h2>
        <p class="muted" style="margin:0">Every opportunity is verified and approved before it reaches the marketplace — trust before conversion.</p></div>
        <div class="grid g3">${opps.slice(0, 3).map(oppCard).join('') || empty('No verified opportunities yet.')}</div>
        <div class="center" style="margin-top:24px"><a class="btn" href="#/opportunities">View all opportunities →</a></div></section>
      ${modelSection()}${trustSection()}${ctaSection()}`; },
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

  window.CODEVAPP = { openAuth, closeAuth, doSignin, doSignup, logout, submitProperty, express, confirmCode, resendCode, _afterAuth: null };
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => { renderAuthArea(); route(); });
  renderAuthArea(); route();
})();
