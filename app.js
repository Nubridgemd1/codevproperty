/* CoDev — public site, auth (Supabase or local), role portals, property submission */
(function () {
  const { CFG, auth, db, fmtN, esc, unitIds } = window.CODEV;
  const fmtDate = (d) => { if (!d) return ''; const t = Date.parse(d); if (isNaN(t)) return d; return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

  // ---- Assurance & verification documents ----
  const DOC_STATUS_LABEL = { awaiting: 'Awaiting submission', under_review: 'Under review', cleared: 'Verified', rejected: 'Action required' };
  const docStatusBadge = (st) => { const c = st === 'cleared' ? 'verified' : st === 'under_review' ? 'pending' : st === 'rejected' ? 'rejected' : 'role'; return `<span class="badge ${c}">${esc(DOC_STATUS_LABEL[st] || 'Awaiting submission')}</span>`; };
  // Merge the required-doc template with whatever exists (by key), keeping any extra docs too.
  function mergeReqDocs(list, kf) {
    const m = {}; (list || []).forEach(d => { m[d[kf]] = d; });
    const rows = (CFG.REQUIRED_DOCS || []).map(t => ({ key: t.key, label: t.label, doc: m[t.key] || null }));
    (list || []).forEach(d => { if (!(CFG.REQUIRED_DOCS || []).some(t => t.key === d[kf])) rows.push({ key: d[kf], label: d.doc_label || d.label || d[kf], doc: d }); });
    return rows;
  }
  function fileToDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read file')); r.readAsDataURL(file); }); }
  // Listing card type/price summary (items-aware, with legacy single-field fallback).
  function cardTypeHtml(p) { const items = p.items || [];
    if (items.length) { const first = window.CODEV.itemLabel(items[0]); const more = items.length > 1 ? ` +${items.length - 1} more` : '';
      const r = window.CODEV.priceRange(items); const priceTxt = r ? (r.min === r.max ? fmtN(r.min) : 'from ' + fmtN(r.min)) : '';
      return `<div class="tiny muted" style="margin:0 0 5px">${esc(first + more)}</div>${priceTxt ? `<div class="tiny" style="margin:0 0 6px;font-weight:700;color:var(--navy)">${esc(priceTxt)}</div>` : ''}`; }
    const t = window.CODEV.propTypeLabel(p); const u = (p.units === 0 || p.units) ? (p.units + ' units') : ''; const s = [t, u].filter(Boolean).join(' · ');
    return `${s ? `<div class="tiny muted" style="margin:0 0 5px">${esc(s)}</div>` : ''}${(p.price === 0 || p.price) ? `<div class="tiny" style="margin:0 0 6px;font-weight:700;color:var(--navy)">Price ${fmtN(p.price)}</div>` : ''}`; }
  // Listing-detail properties table (each item with its price).
  function listingItemsHtml(p) { const items = p.items || []; if (!items.length) return '';
    const totUnits = items.reduce((s, it) => s + (Number(it && it.units) || 0), 0);
    const typeCount = items.filter(it => it && it.type).length;
    const totalLine = totUnits > 0
      ? `<div class="tiny muted" style="margin-top:8px;text-align:right">Total: <b style="color:var(--navy)">${totUnits} unit${totUnits === 1 ? '' : 's'}</b> across ${typeCount} propert${typeCount === 1 ? 'y type' : 'y types'}</div>`
      : '';
    return `<div class="card pad" style="margin-top:14px"><h3 style="margin:0 0 8px;font-size:15px">Properties in this development</h3>
      <table style="font-size:13px;width:100%"><tbody>${items.map(it => `<tr><td>${esc(window.CODEV.itemLabel(it))}</td><td style="text-align:right;white-space:nowrap;font-weight:700;color:var(--bronze)">${(it.price === 0 || it.price) ? fmtN(it.price) : '—'}</td></tr>`).join('')}</tbody></table>${totalLine}</div>`; }
  // ---- Legal report + queries + transactions (shared render) ----
  const DISPO_LBL = { cleared: 'Cleared', conditional: 'Conditionally cleared', material_issue: 'Material issue', rejected: 'Rejected' };
  const TX_TYPE_LBL = { reservation: 'Reservation', sale: 'Sale / purchase', subscription: 'SPV subscription', jv: 'Joint venture' };
  const TX_STATUS_LBL = { initiated: 'Initiated', documents_issued: 'Documents issued', buyer_signed: 'Buyer signed', countersigned: 'Countersigned', funded: 'Funded', completed: 'Completed', cancelled: 'Cancelled' };
  const txStatusBadge = (s) => { const c = s === 'completed' ? 'verified' : s === 'cancelled' ? 'rejected' : 'pending'; return `<span class="badge ${c}">${esc(TX_STATUS_LBL[s] || s)}</span>`; };
  function reportCardHtml(r) { if (!r) return ''; const c = r.disposition === 'cleared' ? 'verified' : r.disposition === 'conditional' ? 'pending' : 'rejected';
    return `<div class="card pad" style="margin-top:16px"><div class="spread"><h3 style="margin:0;font-size:16px">Counsel report <span class="tiny muted">v${r.version} · ${esc(fmtDate(r.issuedAt))}</span></h3><span class="badge ${c}">${esc(DISPO_LBL[r.disposition] || r.disposition)}</span></div>${r.scope ? `<div class="tiny muted" style="margin-top:6px"><b>Scope:</b> ${esc(r.scope)}</div>` : ''}${r.summary ? `<p class="small" style="margin:8px 0 0">${esc(r.summary)}</p>` : ''}${r.conditions ? `<div class="small" style="margin-top:8px"><b>Conditions:</b> ${esc(r.conditions)}</div>` : ''}</div>`; }
  function queryThreadHtml(qs) { if (!qs || !qs.length) return `<div class="tiny muted">No queries yet. CoDev's counsel will post any questions here during review.</div>`;
    return qs.map(q => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><div class="tiny muted spread"><span><b>${q.authorKind === 'counsel' ? 'CoDev Counsel' : 'Developer'}</b> · ${esc(fmtDate(q.createdAt))}</span>${q.status === 'resolved' ? '<span class="badge verified">resolved</span>' : ''}</div><div class="small" style="margin-top:3px;white-space:pre-wrap">${esc(q.body)}</div></div>`).join(''); }
  async function postQuery(pid, kind) { const el = document.getElementById(kind === 'developer' ? 'devQuery' : 'clQuery'); const body = (el && el.value.trim()) || ''; if (!body) { toast('Enter a message'); return; }
    try { await db.legalQueries.add(pid, body, kind); toast('Sent'); route(); } catch (e) { toast((e && e.message) || 'Could not send'); } }
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
  // Password input with a show/hide eye toggle.
  function passField(label, name, extra) { return `<div class="field"><label>${label}</label>
    <div style="position:relative">
      <input name="${name}" type="password" ${extra || ''} style="width:100%;padding-right:42px">
      <button type="button" tabindex="-1" aria-label="Show password" onclick="CODEVAPP.togglePass(this)"
        style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;font-size:16px;line-height:1;padding:4px;opacity:.7">👁</button>
    </div></div>`; }
  function togglePass(btn) { const i = btn.parentNode.querySelector('input'); if (!i) return; const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; btn.textContent = show ? '🙈' : '👁'; btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); }
  function signinForm() { return `<form onsubmit="return CODEVAPP.doSignin(event)">
    <div class="field"><label>Email</label><input name="email" type="email" required></div>
    ${passField('Password', 'pass', 'required')}
    <div style="text-align:right;margin:2px 0 10px"><a href="#" class="tiny muted" onclick="CODEVAPP.forgotFromSignin();return false">Forgot password?</a></div>
    <button class="btn primary" style="width:100%" id="siBtn">Sign in</button>
    <p class="small muted center" style="margin-top:12px">New here? <a href="#" onclick="CODEVAPP.openAuth('signup');return false">Create an account</a></p></form>`; }
  function signupForm() { return `<form onsubmit="return CODEVAPP.doSignup(event)">
    <div class="field"><label>Full name / company</label><input name="name" required></div>
    <div class="field"><label>Email</label><input name="email" type="email" required></div>
    <div class="field"><label>I am a…</label><select name="role">
      <option value="investor">Investor — co-develop verified property</option>
      <option value="developer">Developer — list &amp; raise co-development capital</option>
      <option value="visitor">Property owner — list my property</option></select></div>
    ${passField('Password', 'pass', 'minlength="6" required')}
    <button class="btn primary" style="width:100%" id="suBtn">Create account</button>
    <p class="small muted center" style="margin-top:12px">Have an account? <a href="#" onclick="CODEVAPP.openAuth('signin');return false">Sign in</a></p></form>`; }

  // Friendly message when the mail provider (Supabase SMTP) can't deliver the code.
  function mailErr(err) { const m = (err && err.message) || '';
    if (/magic link|sending|smtp|rate limit|\(5\d\d\)|\(429\)/i.test(m)) return 'We couldn’t email your code right now. Please try again in a moment.';
    return m || 'Could not send code'; }

  async function doSignin(e) { e.preventDefault(); const f = e.target; const email = f.email.value.trim(); const btn = $('#siBtn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      if (CFG.configured) {
        await auth.passwordCheck({ email, password: f.pass.value });          // factor 1: password (no session yet)
        btn.textContent = 'Emailing code…';
        const sent = await startEmailCode(email);                             // factor 2: emailed code
        if (!sent) { btn.disabled = false; btn.textContent = 'Sign in'; }
        return false;
      }
      await auth.signIn({ email, password: f.pass.value }); await afterAuth();
    } catch (err) { toast(err.message || 'Invalid email or password'); btn.disabled = false; btn.textContent = 'Sign in'; } return false; }
  async function doSignup(e) { e.preventDefault(); const f = e.target; const email = f.email.value.trim(); const btn = $('#suBtn'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      if (CFG.configured) {
        const d = await auth.startSignup({ name: f.name.value.trim(), email, role: f.role.value, password: f.pass.value });
        btn.textContent = 'Emailing code…';
        const sent = await startEmailCode(email);                            // verify via emailed code
        if (!sent) {
          // Mailer is down — don't strand the client. The account is already created & auto-confirmed.
          if (d && d.access_token) { await auth.completeSignup(d); toast('Account created — welcome to CoDev!'); await afterAuth(); }
          else { toast('Your account was created, but the verification email is temporarily unavailable. Please try Sign in shortly.'); btn.disabled = false; btn.textContent = 'Create account'; }
        }
        return false;
      }
      await auth.signUp({ name: f.name.value.trim(), email, role: f.role.value, password: f.pass.value }); toast('Welcome to CoDev!'); await afterAuth();
    } catch (err) { toast(err.message || 'Sign up failed'); btn.disabled = false; btn.textContent = 'Create account'; } return false; }

  // ---- 2FA via emailed code (required for all public accounts) ----
  // Returns true if a code was sent and the entry form is shown; false if delivery failed.
  async function startEmailCode(email) {
    try { await auth.sendEmailCode(email); }
    catch (err) { toast(mailErr(err)); return false; }
    $('#authTitle').textContent = 'Check your email';
    $('#authBody').innerHTML = `<p class="small muted">We emailed a 6-digit verification code to <b>${esc(email)}</b>. Enter it to finish signing in.</p>
      <form onsubmit="return CODEVAPP.confirmCode(event,'${esc(email)}')">
        <div class="field"><label>6-digit code</label><input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autofocus></div>
        <button class="btn primary" style="width:100%" id="ecBtn">Verify &amp; continue</button></form>
      <p class="tiny muted center" style="margin-top:10px">Didn't get it? <a href="#" onclick="CODEVAPP.resendCode('${esc(email)}');return false">Resend code</a> · also check spam.</p>`;
    $('#authModal').classList.add('show');
    return true;
  }
  async function confirmCode(e, email) { e.preventDefault(); const code = e.target.code.value.trim(); const btn = $('#ecBtn'); btn.disabled = true; btn.textContent = 'Verifying…';
    try { await auth.verifyEmailCode({ email, code }); try { await auth.welcome(); } catch {} await afterAuth(); }
    catch (err) { toast(err.message || 'Invalid or expired code'); btn.disabled = false; btn.textContent = 'Verify & continue'; } return false; }
  async function resendCode(email) { try { await auth.sendEmailCode(email); toast('New code sent'); } catch (err) { toast(mailErr(err)); } }

  // ---- forgot / reset password (emailed 6-digit code) ----
  function forgotFromSignin() { const el = document.querySelector('#authBody input[name=email]'); forgotStart(el ? el.value.trim() : ''); }
  function forgotStart(prefill) {
    $('#authTitle').textContent = 'Reset your password';
    $('#authBody').innerHTML = `<form onsubmit="return CODEVAPP.doForgot(event)">
      <p class="small muted" style="margin:0 0 10px">Enter your account email and we'll send a 6-digit reset code.</p>
      <div class="field"><label>Email</label><input name="email" type="email" required value="${prefill ? esc(prefill) : ''}" autofocus></div>
      <button class="btn primary" style="width:100%" id="fpBtn">Send reset code</button>
      <p class="small muted center" style="margin-top:12px"><a href="#" onclick="CODEVAPP.openAuth('signin');return false">Back to sign in</a></p></form>`;
    $('#authModal').classList.add('show');
  }
  async function doForgot(e) { e.preventDefault(); const email = e.target.email.value.trim(); const btn = $('#fpBtn'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await auth.sendRecovery(email);
      $('#authTitle').textContent = 'Create a new password';
      $('#authBody').innerHTML = `<form onsubmit="return CODEVAPP.doReset(event,'${esc(email)}')">
        <p class="small muted" style="margin:0 0 10px">We emailed a 6-digit code to <b>${esc(email)}</b>. Enter it and choose a new password.</p>
        <div class="field"><label>6-digit code</label><input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autofocus></div>
        ${passField('New password', 'pass', 'minlength="6" required')}
        <button class="btn primary" style="width:100%" id="rpBtn">Update password &amp; sign in</button>
        <p class="tiny muted center" style="margin-top:10px">Didn't get it? <a href="#" onclick="CODEVAPP.resendRecovery('${esc(email)}');return false">Resend</a> · also check spam.</p></form>`;
    } catch (err) { toast(mailErr(err) || 'Could not send code'); btn.disabled = false; btn.textContent = 'Send reset code'; }
    return false; }
  async function doReset(e, email) { e.preventDefault(); const code = e.target.code.value.trim(); const password = e.target.pass.value; const btn = $('#rpBtn'); btn.disabled = true; btn.textContent = 'Updating…';
    try { await auth.resetPassword({ email, code, password }); toast("Password updated — you're signed in"); await afterAuth(); }
    catch (err) { toast(err.message || 'Invalid or expired code'); btn.disabled = false; btn.textContent = 'Update password & sign in'; }
    return false; }
  async function resendRecovery(email) { try { await auth.sendRecovery(email); toast('New code sent'); } catch (err) { toast(mailErr(err)); } }
  function mfaGate() { if (!CFG.configured || !me() || auth.mfaOk()) return false; startEmailCode(me().email); return true; }
  // ---- admin-verification gate: an account holder must be admin-approved before any platform access ----
  function isApproved(u) { u = u || me(); if (!u) return false; const st = String(u.status || '').toLowerCase(); return st === 'approved' || st === 'active'; }
  function needsApproval() { return CFG.configured && !!me() && !isApproved(me()); }
  function pendingScreen() {
    const st = String((me() || {}).status || 'pending').toLowerCase();
    const blocked = st === 'rejected' || st === 'suspended';
    return sec(
      blocked ? 'Account not approved' : 'Account pending verification',
      blocked
        ? 'Your account is not approved for platform access. Please contact the CoDev team at info@codevproperty.com if you believe this is a mistake.'
        : 'Thank you for signing up. An administrator is reviewing and verifying your account. As soon as it is approved you will be able to view opportunities, list a development and use the platform — we will email you when you are cleared. You are securely signed in; you can log out from the top right.',
      '');
  }
  async function afterAuth() {
    const u = me();
    if (u && u.status === 'suspended') { await auth.signOut(); renderAuthArea(); closeAuth(); toast('Account suspended — contact admin'); location.hash = '#/'; route(); return; }
    if (u && u.role === 'admin') { closeAuth(); toast('Admins use the Admin console'); location.href = 'admin.html'; return; }
    closeAuth(); renderAuthArea();
    try { await auth.refreshProfile(); } catch {}
    if (needsApproval()) { location.hash = '#/'; route(); return; }
    const then = CODEVAPP._afterAuth; CODEVAPP._afterAuth = null;
    if (then) then(); else { location.hash = u.role === 'developer' ? '#/developer' : u.role === 'investor' ? '#/investor' : '#/account'; } route();
  }
  async function logout() { await auth.signOut(); renderAuthArea(); toast('Logged out'); location.hash = '#/'; route(); }
  function requireLogin(then) { if (me()) return true; openAuth('signin', then); return false; }

  // ---- pieces ----
  function coverBg(p) { return (p.images && p.images[0]) ? `background-image:url('${p.images[0]}');background-size:cover;background-position:center;` : ''; }
  function oppCard(p) { return `<div class="card opp-card">
    <div class="ph"${p.images && p.images[0] ? ' data-cover="1"' : ''} style="${coverBg(p)}"><span class="vb badge verified">✓ Verified</span><span class="loc">📍 ${esc(p.location)}</span></div>
    <div style="padding:16px"><div class="small muted" style="font-weight:600">${esc(p.developer)}</div>
      <h3 style="margin:2px 0 6px;font-size:19px">${esc(p.title)}</h3>
      ${p.ref ? `<div class="tiny" style="font-family:monospace;color:var(--ink2);margin:0 0 4px">${esc(p.ref)}</div>` : ''}
      ${cardTypeHtml(p)}
      ${legalVerified(p) ? `<div style="margin:0 0 7px">${legalBadgeHtml(p)}</div>` : ''}
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
    home(opps, counts) { const devCount = new Set(opps.map(o => o.developer).filter(Boolean)).size; return `<section class="hero"><div class="wrap" style="padding:66px 22px 60px;text-align:left">
      <span class="eyebrow" style="letter-spacing:.12em">🌍 Co-development · Property · Global access</span>
      <h1 style="font-size:clamp(32px,5vw,52px);line-height:1.06;margin:14px 0 14px;max-width:16ch">Co-develop <em style="font-style:italic;color:var(--bronze2)">exceptional</em> property.<br>Participate from the start.</h1>
      <p class="muted" style="font-size:17px;max-width:60ch;margin:0 0 24px">CoDev brings buyers, developers and capital together through a transparent, professionally governed platform — creating access to carefully selected property developments from inception to completion.</p>
      <div class="row" style="justify-content:flex-start;gap:10px"><a class="btn primary" href="#/opportunities">Explore Developments</a><a class="btn" href="#/how">How CoDev Works</a></div>
      <div style="display:flex;justify-content:flex-start">${flowStrip()}</div>
      <div class="hero-stats">
        <div><div class="n">4</div><div class="l">Curated prime markets<br><span style="opacity:.72">Lagos today · UK/US roadmap</span></div></div>
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
    opportunities(opps) { _opps = opps; return sec('All opportunities', 'Every listing here has been verified by our admin team. Filter by location or search as new developments are listed.', `${oppFilterBar(opps)}<div id="oppGrid">${oppGridHtml(opps)}</div>`); },
    opp(p, dstat) { if (!p) return sec('Not available', '', empty('This development is not available.'));
      const ms = p.milestones || []; _lb = p.images || [];
      return `<section class="wrap" style="padding:36px 22px"><a class="small muted" href="#/opportunities">← All opportunities</a>
        <div class="grid g2" style="margin-top:14px;align-items:start">
          <div class="card" style="overflow:hidden"><div class="ph${p.images && p.images.length ? ' clickable' : ''}" style="height:240px;${coverBg(p)}position:relative"${p.images && p.images.length ? ` onclick="CODEVAPP.openLightbox(0)" title="Click to enlarge"` : ''}>${p.images && p.images.length ? '<span class="lb-hint">🔍 Click to enlarge</span>' : ''}</div>
            ${p.images && p.images.length > 1 ? `<div class="photo-grid" style="padding:10px 10px 0">${p.images.map((d, i) => `<div class="ph-thumb clickable" onclick="CODEVAPP.openLightbox(${i})" title="Click to enlarge"><img src="${d}" alt="Development photo ${i + 1}"></div>`).join('')}</div>` : ''}
            <div style="padding:18px"><h3 style="margin:0 0 10px;font-size:17px">Construction schedule &amp; timeline</h3>
              <table style="margin-top:4px;font-size:13px"><thead><tr><th>Phase</th><th>%</th><th>Target</th></tr></thead><tbody>
              ${ms.map(m => `<tr><td>${esc(m.name)}</td><td>${m.pct}%</td><td class="tiny muted">${esc(m.targetDate || '—')}</td></tr>`).join('') || `<tr><td colspan="3" class="muted tiny">No schedule set.</td></tr>`}
              </tbody></table>
              <p class="tiny muted" style="margin-top:8px">Planned construction phasing. Payment schedules are agreed per buyer when a reservation or sale is created.</p></div></div>
          <div><span class="badge verified">✓ Verified</span> ${legalBadgeHtml(p)}<h1 style="font-size:30px;margin:10px 0 4px">${esc(p.title)}</h1>
            ${p.ref ? `<div class="tiny" style="font-family:monospace;color:var(--ink2);margin:0 0 4px">Ref: <b style="color:var(--navy)">${esc(p.ref)}</b></div>` : ''}
            <div class="muted">${esc(p.developer)} · 📍 ${esc(p.location)}</div>
            ${p.address ? `<div class="tiny muted" style="margin-top:3px">🏠 ${esc(p.address)}</div>` : ''}
            <p style="margin:16px 0">${esc(p.summary)}</p>
            <div class="card pad grid g2" style="gap:12px">
              ${(!(p.items && p.items.length) && (p.price === 0 || p.price)) ? `<div><div class="tiny muted">Price</div><div class="serif" style="font-size:22px;color:var(--bronze)">${fmtN(p.price)}</div></div>` : ''}
              <div><div class="tiny muted">Participation from</div><div class="serif" style="font-size:22px;color:var(--bronze)">${fmtN(p.priceFrom)}</div></div>
              <div><div class="tiny muted">Construction stage</div><div style="font-weight:700;color:var(--navy)">${esc(p.stage)}</div></div>
              ${(!(p.items && p.items.length) && window.CODEV.propTypeLabel(p)) ? `<div><div class="tiny muted">Property type</div><div style="font-weight:700;color:var(--navy)">${esc(window.CODEV.propTypeLabel(p))}</div></div>` : ''}
              ${(p.units === 0 || p.units) ? `<div><div class="tiny muted">Number of units</div><div style="font-weight:700;color:var(--navy)">${esc(String(p.units))}</div></div>` : ''}
              ${p.deliveryDate ? `<div><div class="tiny muted">Proposed delivery</div><div style="font-weight:700;color:var(--navy)">${esc(fmtDate(p.deliveryDate))}</div></div>` : ''}
            </div>
            ${listingItemsHtml(p)}
            <div class="card pad" style="margin-top:14px"><div class="spread" style="margin-bottom:8px"><h3 style="margin:0;font-size:15px">Verification &amp; assurance</h3>${legalBadgeHtml(p) || '<span class="tiny muted">CoDev legal due diligence</span>'}</div>
              <table style="font-size:13px;width:100%"><tbody>${mergeReqDocs(dstat || [], 'doc_key').map(r => { const st = (r.doc && r.doc.status) || 'awaiting'; return `<tr><td>${esc(r.label)}</td><td style="text-align:right;white-space:nowrap">${docStatusBadge(st)}</td></tr>`; }).join('')}</tbody></table>
              <div class="tiny muted" style="margin-top:8px">Key project documents are reviewed by CoDev's legal partner. Underlying documents can be requested during investor qualification.</div>
              ${(function(){ const u = me(); return (u && p.submittedBy && u.email && String(p.submittedBy).toLowerCase() === String(u.email).toLowerCase()) ? `<a class="btn primary sm" style="margin-top:10px" href="#/docs/${p.id}">📤 Upload / manage assurance documents</a>` : ''; })()}</div>
            <div class="row" style="gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn primary" onclick="CODEVAPP.express('${p.id}')">I'm Interested — start qualification</button><a class="btn" href="#/dealroom/${p.id}">🔐 Deal Room</a></div>
            <p class="tiny muted" style="margin-top:8px">Complete a short investor qualification. CoDev verifies applicants before granting Deal Room access to confidential project documents.</p></div></div></section>`; },
    how() { const steps = [['List', 'A developer or property owner submits a development or plot.'], ['Verify', 'Admin reviews and verifies the listing before it goes public.'], ['Co-develop', 'Investors browse verified opportunities and express interest.'], ['Govern', 'Milestone-based structure with timelines & payments; funds are released through licensed escrow partners against verified construction milestones.']];
      return sec('How it works', 'From listing to verification to co-development.', `<div class="grid g2">${steps.map((s, i) => `<div class="card pad row" style="gap:14px;align-items:flex-start"><span class="step-n">${i + 1}</span><div><h3 style="margin:0 0 4px;font-size:18px">${s[0]}</h3><p class="small muted" style="margin:0">${s[1]}</p></div></div>`).join('')}</div>`); },
    list(u, mine) { listingPhotos = []; listingItems = [{ type: '', bedrooms: '', landSqm: '', landSqft: '', units: '', price: '' }]; listingDocs = {};
      return sec('List a property', 'Developers and property owners can list here. Submissions are verified by admin before they go public.',
      `<div class="grid g2" style="align-items:start">
        <form class="card pad" onsubmit="return CODEVAPP.submitProperty(event)">
          <div class="field"><label>Property / development title</label><input name="title" required></div>
          <div class="field"><label>Developer / owner name</label><input name="developer" value="${esc(u.name)}" required></div>
          <div class="field"><label>Location <span class="tiny muted">(area — used for buyer filters)</span></label><input name="location" list="locOptions" placeholder="e.g. Lagos - Lekki" required autocomplete="off">
            <datalist id="locOptions">${(CFG.LOCATIONS || []).map(l => `<option value="${esc(l)}"></option>`).join('')}</datalist>
            <span class="tiny muted">Pick a suggestion or type a new area — it becomes filterable for buyers.</span></div>
          <div class="field"><label>Address <span class="tiny muted">(full project address)</span></label><input name="address" placeholder="Street, area, city, state"></div>
          <div class="field"><label>Properties in this development <span class="tiny muted">— add each property / unit type with its own price; residential shows bedrooms, land shows size</span></label>
            <div id="itemRowsDev" class="grid" style="gap:8px">${itemsDevHtml()}</div>
            <button type="button" class="btn sm" style="margin-top:8px" onclick="CODEVAPP.addItemDev()">+ Add property</button></div>
          <div class="row" style="gap:12px">
            <div class="field" style="flex:1"><label>Total number of units</label><input name="units" type="number" min="0" step="1"></div>
            <div class="field" style="flex:1"><label>Proposed delivery date</label><input name="deliveryDate" type="date"></div></div>
          <div class="field"><label>Summary</label><textarea name="summary" rows="3" required></textarea></div>
          <div class="field"><label>Photos <span class="tiny muted">— up to ${MAX_PHOTOS}, from your phone or computer</span></label>
            <label class="photo-drop"><input type="file" accept="image/*,.heic,.heif" multiple onchange="CODEVAPP.addPhotos(this)"><span class="pd-inner">📷 Tap to add photos or take a picture</span></label>
            <div id="photoPreviews" class="photo-grid"></div></div>
          <div class="field"><label>Assurance documents <span class="tiny muted">— attach the key documents for CoDev legal review (you can also add or replace them later)</span></label>
            <div id="listingDocsBox" class="grid" style="gap:8px">${listingDocsHtml()}</div></div>
          <div class="row" style="gap:12px"><div class="field" style="flex:1"><label>Participation from (₦)</label><input name="priceFrom" type="number" min="0" required></div>
            <div class="field" style="flex:1"><label>Construction stage</label><select name="stage">${CFG.STAGES.map(x => `<option>${x}</option>`).join('')}</select></div></div>
          <button class="btn primary" style="width:100%">Submit for verification</button>
          <p class="tiny muted center" style="margin-top:8px">A default milestone schedule is attached — admin can refine timelines &amp; payments.</p>
        </form>
        <div><h3 style="font-size:18px">Your submissions</h3><div id="mySubs">${listCards(mine)}</div></div></div>`); },
    investor(u, opps) { _opps = opps; return portalHead('Investor portal', u) + sec('', '', `<div class="spread" style="margin-bottom:14px"><h3 style="margin:0;font-size:19px">Verified opportunities</h3><span class="small muted">${opps.length} available</span></div>${oppFilterBar(opps)}<div id="oppGrid">${oppGridHtml(opps)}</div>`); },
    developer(u, mine) { pendingBrochure = null; return portalHead('Developer portal', u) + sec('', '', devProfileCard(u) + `<div class="spread" style="margin-bottom:14px"><h3 style="margin:0;font-size:19px">Your listings</h3><a class="btn primary sm" href="#/list">+ List a property</a></div><div id="mySubs">${listCards(mine)}</div>`); },
    account(u, mine) { return portalHead('Your account', u) + sec('', '', `<div class="grid g2" style="align-items:start">
      <div class="card pad"><h3 style="margin:0 0 10px;font-size:17px">Profile</h3><p class="small"><b>${esc(u.name)}</b><br><span class="muted">${esc(u.email)}</span><br><span class="badge role" style="margin-top:6px">${u.role}</span></p><button class="btn danger sm" style="margin-top:10px" onclick="CODEVAPP.logout()">Log out</button></div>
      <div><div class="spread"><h3 style="font-size:17px">Your listings</h3><a class="btn sm" href="#/list">+ List</a></div><div id="mySubs">${listCards(mine)}</div></div></div>`); },
    docs(u, p, st) {
      if (!p) return sec('Not found', '', empty('Listing not found.'));
      const docs = (st && st.docs) || [], queries = (st && st.queries) || [], report = (st && st.report) || null;
      const isOwner = u && p.submittedBy && u.email && String(p.submittedBy).toLowerCase() === String(u.email).toLowerCase();
      const back = u && u.role === 'developer' ? '#/developer' : '#/account';
      if (!isOwner) return sec('', '', `<a class="small muted" href="${back}">← Back</a>${empty('You can only manage documents for your own listings.')}`);
      const rows = mergeReqDocs(docs, 'key');
      return sec('', '', `<a class="small muted" href="${back}">← Back to my listings</a>
        <h1 style="font-size:26px;margin:8px 0 2px">${esc(p.title)} — assurance documents</h1>
        <div class="muted" style="margin-bottom:2px">${p.ref ? 'Ref ' + esc(p.ref) + ' · ' : ''}Submit each required document for CoDev legal review &amp; due diligence.</div>
        <div class="tiny muted" style="margin-bottom:14px">Buyers see only the verification <b>status</b> of each document — never your files. Files are visible only to you and CoDev's legal/verification team.</div>
        <div id="docList" class="grid" style="gap:10px">${rows.map(r => docRowDev(p.id, r)).join('')}</div>
        ${reportCardHtml(report)}
        <h3 style="font-size:17px;margin:22px 0 8px">Legal review — queries</h3>
        <div class="card pad">${queryThreadHtml(queries)}
          <div class="row" style="gap:8px;margin-top:10px;align-items:flex-start"><textarea id="devQuery" rows="2" placeholder="Reply to CoDev's counsel…" style="flex:1"></textarea><button class="btn primary sm" onclick="CODEVAPP.postQuery('${p.id}','developer')">Send</button></div></div>`);
    },
    deals(u, p, txs) {
      if (!p) return sec('Not found', '', empty('Listing not found.'));
      const isOwner = u && p.submittedBy && u.email && String(p.submittedBy).toLowerCase() === String(u.email).toLowerCase();
      const back = u && u.role === 'developer' ? '#/developer' : '#/account';
      if (!isOwner) return sec('', '', `<a class="small muted" href="${back}">← Back</a>${empty('You can only manage deals for your own listings.')}`);
      return sec('', '', `<a class="small muted" href="${back}">← Back to my listings</a>
        <h1 style="font-size:26px;margin:8px 0 2px">${esc(p.title)} — deals &amp; payment calls</h1>
        <div class="muted" style="margin-bottom:2px">${p.ref ? 'Ref ' + esc(p.ref) + ' · ' : ''}Track payment calls for each engaged buyer and the specific unit they are taking.</div>
        <div class="tiny muted" style="margin-bottom:14px">Deals are created by CoDev once a buyer is verified for this listing. Record and update payment calls (label, amount, due date, status) per buyer + unit here — this never appears on the public listing.</div>
        <div class="grid" style="gap:10px">${txs.length ? txs.map(t => devTxCard(t, p)).join('') : '<div class="card pad small muted">No deals yet. When CoDev verifies a buyer for this listing and creates a deal, it will appear here.</div>'}</div>`);
    },
    dealRoom(u, p, st) {
      if (!p) return sec('Not found', '', empty('Development not found.'));
      const head = `<a class="small muted" href="#/opp/${p.id}">← Back to ${esc(p.title)}</a>
        <h1 style="font-size:26px;margin:8px 0 2px">🔐 Deal Room — ${esc(p.title)}</h1>
        <div class="muted" style="margin-bottom:14px">${p.ref ? 'Ref ' + esc(p.ref) + ' · ' : ''}Confidential due-diligence documents for CoDev-verified investors.</div>`;
      if (!st.verified) return sec('', '', head + `<div class="card pad"><h3 style="margin:0 0 6px;font-size:17px">CoDev verification required</h3><p class="small muted">The Deal Room opens to investors CoDev has verified for this development. Complete the short qualification and we'll review and verify you.</p><a class="btn primary" style="margin-top:6px" href="#/opp/${p.id}">Start / check qualification →</a></div>`);
      const acc = st.access;
      if (acc && acc.status === 'revoked') return sec('', '', head + `<div class="card pad"><h3 style="margin:0 0 6px;font-size:17px">Access revoked</h3><p class="small muted">Your Deal Room access for this development has been revoked. Please contact CoDev at info@codevproperty.com.</p></div>`);
      if (acc && acc.status === 'expired') return sec('', '', head + `<div class="card pad"><h3 style="margin:0 0 6px;font-size:17px">Access expired</h3><p class="small muted">Your Deal Room access has expired. Please contact CoDev to renew it.</p></div>`);
      if (!acc || !acc.acknowledgedAt) {
        return sec('', '', head + `<div class="card pad">
          <h3 style="margin:0 0 8px;font-size:17px">Confidentiality acknowledgement</h3>
          <p class="small muted">The documents in this Deal Room (title, legal, survey, approvals, SPV/JV and related due-diligence) are confidential and shared solely to evaluate this opportunity. By entering you agree to keep them confidential, use them only for your own investment evaluation, not copy, share or distribute them, and that your access is logged and may be revoked at any time.</p>
          <label class="row" style="gap:9px;align-items:flex-start;margin:12px 0;cursor:pointer"><input type="checkbox" id="ndaAck" style="margin-top:3px"><span class="small">I have read and agree to the confidentiality terms above.</span></label>
          <button class="btn primary" onclick="CODEVAPP.enterDealRoom('${p.id}')">Acknowledge &amp; enter Deal Room</button>
        </div>`);
      }
      const docs = st.docs || [];
      const rows = docs.length ? docs.map(d => `<div class="card pad spread"><div><b>${esc(d.label)}</b><div class="tiny muted">${d.fileName ? esc(d.fileName) : ''}${d.reviewedAt ? ' · verified ' + esc(fmtDate(d.reviewedAt)) : ''}</div></div><div class="row" style="gap:8px">${d.fileData ? `<a class="btn ghost sm" href="${d.fileData}" target="_blank" rel="noopener" onclick="CODEVAPP.logDeal('${p.id}','${esc(d.key)}','viewed')">View</a><a class="btn ghost sm" href="${d.fileData}" download="${esc(d.fileName || d.key)}" onclick="CODEVAPP.logDeal('${p.id}','${esc(d.key)}','downloaded')">Download</a>` : '<span class="tiny muted">No file</span>'}</div></div>`).join('') : empty('No cleared documents are available yet. Documents appear here as CoDev legal review clears them.');
      const txs = st.txs || [];
      const txHtml = txs.length ? txs.map(t => buyerTxCard(p.id, t)).join('') : '';
      return sec('', '', head + `<div class="card pad" style="background:#fff8e6;border-color:#f0e2b8;margin-bottom:12px"><b>🔒 Confidential.</b> <span class="small muted">Access granted ${acc.acknowledgedAt ? esc(fmtDate(acc.acknowledgedAt)) : ''}. Your views and downloads are logged. Please do not share these documents.</span></div>
        ${reportCardHtml(st.report)}
        <h3 style="font-size:17px;margin:18px 0 8px">Due-diligence documents</h3>
        <div class="grid" style="gap:10px">${rows}</div>
        ${txHtml ? `<h3 style="font-size:17px;margin:22px 0 8px">Your transaction</h3><div class="grid" style="gap:10px">${txHtml}</div>` : ''}`);
    },
  };
  function listCards(mine) { if (!mine || !mine.length) return `<div class="card pad small muted">No submissions yet. <a href="#/list">List a property →</a></div>`;
    return `<div class="grid" style="gap:10px">${mine.map(p => `<div class="card pad"><div class="spread"><div class="row" style="gap:11px;align-items:center">${p.images && p.images[0] ? `<img src="${p.images[0]}" alt="" style="width:48px;height:48px;border-radius:9px;object-fit:cover;flex:none">` : ''}<div><b>${esc(p.title)}</b>${p.ref ? ` <span class="tiny" style="font-family:monospace;color:var(--ink2)">${esc(p.ref)}</span>` : ''}<div class="tiny muted">${esc(p.location)} · ${fmtN(p.priceFrom)} · funded ${funded(p)}%</div></div></div><span class="badge ${p.status}">${p.status}</span></div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap"><a class="btn primary sm" href="#/docs/${p.id}">📤 Upload / manage documents</a><a class="btn sm" href="#/deals/${p.id}">💳 Deals &amp; payment calls</a></div></div>`).join('')}</div>`; }
  function docRowDev(pid, r) { const d = r.doc || {}; const st = d.status || 'awaiting';
    return `<div class="card pad">
      <div class="spread"><b>${esc(r.label)}</b>${docStatusBadge(st)}</div>
      ${d.fileName ? `<div class="tiny muted" style="margin-top:5px">📎 ${esc(d.fileName)}${d.fileData ? ` · <a href="${d.fileData}" download="${esc(d.fileName)}">download</a>` : ''}${d.submittedAt ? ' · submitted ' + esc(fmtDate(d.submittedAt)) : ''}</div>` : ''}
      ${d.note ? `<div class="tiny" style="color:#b4232a;margin-top:5px">Reviewer note: ${esc(d.note)}</div>` : ''}
      <label class="photo-drop" style="margin-top:9px"><input type="file" accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.heic,.heif" onchange="CODEVAPP.submitDoc('${pid}','${esc(r.key)}',this)"><span class="pd-inner">📤 ${d.fileName ? 'Replace document' : 'Upload document'} — PDF or image, max 6MB</span></label>
    </div>`; }
  // ---- Developer: deals + payment calls (own listings only) ----
  function devTxCard(t, p) { const unitOpts = (p && p.ref) ? unitIds(p.ref, p.units) : [];
    const pays = t.payments || []; const tot = pays.reduce((n, x) => n + (Number(x.amount) || 0), 0); const paid = pays.filter(x => x.status === 'paid').reduce((n, x) => n + (Number(x.amount) || 0), 0);
    return `<div class="card pad">
      <div class="spread"><div><b>${esc(t.userName || t.userEmail || 'Buyer')}</b> · ${esc(t.txType)}${t.amount ? ' · ' + fmtN(t.amount) : ''}${t.unitRef ? ` · <span class="badge role" style="font-family:monospace">${esc(t.unitRef)}</span>` : ''}</div><span class="badge ${t.status === 'completed' ? 'verified' : 'pending'}">${esc(t.status)}</span></div>
      ${(p && p.ref) ? `<div class="row" style="gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap"><span class="tiny muted">Unit / asset:</span><select id="dvunit_${t.id}" onchange="CODEVAPP.devTxUnit('${p.id}','${t.id}')" style="min-width:170px"><option value="">— Whole development —</option>${unitOpts.map(u => `<option value="${esc(u)}" ${u === t.unitRef ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></div>` : ''}
      <div class="card pad" style="background:var(--soft);margin-top:10px">
        <div class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Payment calls</div>
        ${pays.length ? `<div style="overflow-x:auto"><table style="font-size:13px;width:100%"><tbody>${pays.map((pay, idx) => `<tr><td>${esc(pay.label || '')}</td><td class="tiny muted" style="white-space:nowrap">${esc(pay.dueDate || '')}</td><td style="text-align:right;white-space:nowrap">${(pay.amount != null && pay.amount !== '') ? fmtN(pay.amount) : '—'}</td><td style="width:110px"><select onchange="CODEVAPP.devTxPaySet('${p.id}','${t.id}',${idx},'status',this.value)">${['due', 'paid', 'overdue', 'waived'].map(s => `<option ${s === (pay.status || 'due') ? 'selected' : ''}>${s}</option>`).join('')}</select></td><td><button class="btn ghost sm" onclick="CODEVAPP.devTxDelPay('${p.id}','${t.id}',${idx})">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="tiny muted">No payment calls yet.</div>'}
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><input id="dvpl_${t.id}" placeholder="Label (e.g. Deposit, Milestone 1)" style="flex:2;min-width:150px"><input id="dvpa_${t.id}" type="number" placeholder="Amount (₦)" style="flex:1;min-width:110px"><input id="dvpd_${t.id}" type="date" style="flex:1;min-width:130px"><button class="btn primary sm" onclick="CODEVAPP.devTxAddPay('${p.id}','${t.id}')">+ Add call</button></div>
        ${tot > 0 ? `<div class="tiny muted" style="margin-top:6px;text-align:right">Paid ${fmtN(paid)} of ${fmtN(tot)}</div>` : ''}
      </div></div>`; }
  async function devTxUnit(pid, id) { const ref = (document.getElementById('dvunit_' + id) || {}).value || ''; try { await db.transactions.update(id, { unitRef: ref }); toast(ref ? ('Linked to ' + ref) : 'Set to whole development'); route(); } catch (e) { toast((e && e.message) || 'Failed'); } }
  async function devTxAddPay(pid, id) { const label = (document.getElementById('dvpl_' + id).value || '').trim(); const amount = document.getElementById('dvpa_' + id).value; const due = document.getElementById('dvpd_' + id).value; if (!label) { toast('Enter a label'); return; }
    const t = (await db.transactions.listForProperty(pid)).find(x => x.id === id) || { payments: [] };
    const payments = (t.payments || []).concat([{ label, amount: (amount === '' || amount == null) ? null : Number(amount), dueDate: due || '', status: 'due' }]);
    try { await db.transactions.update(id, { payments }); toast('Payment call added'); route(); } catch (e) { toast((e && e.message) || 'Failed'); } }
  async function devTxPaySet(pid, id, idx, k, v) { const t = (await db.transactions.listForProperty(pid)).find(x => x.id === id); if (!t) return; const payments = (t.payments || []).slice(); if (!payments[idx]) return;
    payments[idx] = Object.assign({}, payments[idx], { [k]: (k === 'amount' ? ((v === '' || v == null) ? null : Number(v)) : v) });
    try { await db.transactions.update(id, { payments }); route(); } catch (e) { toast((e && e.message) || 'Failed'); } }
  async function devTxDelPay(pid, id, idx) { const t = (await db.transactions.listForProperty(pid)).find(x => x.id === id); if (!t) return; const payments = (t.payments || []).slice(); payments.splice(idx, 1);
    try { await db.transactions.update(id, { payments }); toast('Payment call removed'); route(); } catch (e) { toast((e && e.message) || 'Failed'); } }
  async function enterDealRoom(pid) { const ck = document.getElementById('ndaAck'); if (!ck || !ck.checked) { toast('Please acknowledge the confidentiality terms'); return; }
    try { await db.dealroom.acknowledge(pid, 'v1'); toast('Welcome to the Deal Room'); route(); } catch (e) { toast((e && e.message) || 'Could not open the Deal Room'); } }
  function logDeal(pid, key, event) { try { db.dealroom.log(pid, event, key); } catch (e) {} }
  function onTypeChange(sel) { const f = document.getElementById('bedroomsFieldDev'); if (f) f.style.display = window.CODEV.isResidential(sel.value) ? '' : 'none'; }
  // ---- Developer "property items" editor (add multiple properties, each with its own price) ----
  let listingItems = [];
  function itemRowDevHtml(it, i) { const res = CFG.RESIDENTIAL_TYPES.indexOf(it.type) >= 0, land = CFG.LAND_TYPES.indexOf(it.type) >= 0;
    const typeSel = `<div class="field" style="flex:2;min-width:150px;margin:0"><label class="tiny muted">Property type</label><select onchange="CODEVAPP.itemSetDev(${i},'type',this.value)"><option value="">—</option>${CFG.PROPERTY_TYPES.map(x => `<option ${x === it.type ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`;
    const bedSel = res ? `<div class="field" style="flex:1;min-width:120px;margin:0"><label class="tiny muted">Bedrooms</label><select onchange="CODEVAPP.itemSetDev(${i},'bedrooms',this.value)"><option value="">—</option>${CFG.BEDROOMS.map(x => `<option ${x === it.bedrooms ? 'selected' : ''}>${x}</option>`).join('')}</select></div>` : '';
    const landF = land ? `<div class="field" style="flex:1;min-width:100px;margin:0"><label class="tiny muted">Size (sqm)</label><input type="number" min="0" value="${esc(it.landSqm || '')}" oninput="CODEVAPP.itemSizeDev(${i},'landSqm',this.value)"></div><div class="field" style="flex:1;min-width:100px;margin:0"><label class="tiny muted">Size (sqft)</label><input type="number" min="0" value="${esc(it.landSqft || '')}" oninput="CODEVAPP.itemSizeDev(${i},'landSqft',this.value)"></div>` : '';
    const unitsF = `<div class="field" style="flex:1;min-width:90px;margin:0"><label class="tiny muted">Units</label><input type="number" min="0" step="1" value="${(it.units === 0 || it.units) ? it.units : ''}" onchange="CODEVAPP.itemSetDev(${i},'units',this.value)"></div>`;
    const priceF = `<div class="field" style="flex:1;min-width:120px;margin:0"><label class="tiny muted">Price (₦)</label><input type="number" min="0" value="${(it.price === 0 || it.price) ? it.price : ''}" onchange="CODEVAPP.itemSetDev(${i},'price',this.value)"></div>`;
    return `<div class="card pad" style="background:var(--soft)"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end">${typeSel}${bedSel}${landF}${unitsF}${priceF}${listingItems.length > 1 ? `<button type="button" class="btn ghost sm" onclick="CODEVAPP.delItemDev(${i})">✕</button>` : ''}</div></div>`; }
  function itemsDevHtml() { return (listingItems || []).map((it, i) => itemRowDevHtml(it, i)).join(''); }
  function renderItemsDev() { const box = document.getElementById('itemRowsDev'); if (box) box.innerHTML = itemsDevHtml(); }
  function addItemDev() { listingItems.push({ type: '', bedrooms: '', landSqm: '', landSqft: '', units: '', price: '' }); renderItemsDev(); }
  function delItemDev(i) { listingItems.splice(i, 1); renderItemsDev(); }
  function itemSetDev(i, k, v) { listingItems[i][k] = v; if (k === 'type') { listingItems[i].bedrooms = ''; listingItems[i].landSqm = ''; listingItems[i].landSqft = ''; renderItemsDev(); } }
  function itemSizeDev(i, k, v) { listingItems[i][k] = v; const A = 10.7639; const other = k === 'landSqm' ? 'landSqft' : 'landSqm'; listingItems[i][other] = v ? String(Math.round(k === 'landSqm' ? Number(v) * A : Number(v) / A)) : ''; const el = document.querySelector(`#itemRowsDev .card:nth-child(${i + 1}) input[oninput*="'${other}'"]`); if (el) el.value = listingItems[i][other]; }
  // ---- Assurance documents staged during listing creation (uploaded after the listing is created) ----
  let listingDocs = {};
  function listingDocsHtml() { return (CFG.REQUIRED_DOCS || []).map(t => { const d = listingDocs[t.key];
    return `<div class="card pad" style="background:var(--soft)"><div class="spread"><span class="small">${esc(t.label)}</span>${d ? `<span class="badge pending">Attached</span>` : `<span class="tiny muted">Optional now</span>`}</div>
      ${d ? `<div class="tiny muted" style="margin-top:4px">📎 ${esc(d.fileName)}</div>` : ''}
      <label class="photo-drop" style="margin-top:8px;min-height:56px"><input type="file" accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.heic,.heif" onchange="CODEVAPP.stageDoc('${t.key}',this)"><span class="pd-inner" style="font-size:13px">📤 ${d ? 'Replace' : 'Attach'} document (PDF or image, max 6MB)</span></label></div>`; }).join(''); }
  function renderListingDocs() { const box = document.getElementById('listingDocsBox'); if (box) box.innerHTML = listingDocsHtml(); }
  async function stageDoc(key, input) { const f = input.files && input.files[0]; input.value = ''; if (!f) return; if (f.size > 6 * 1024 * 1024) { toast('File too large — max 6MB'); return; }
    try { const dataUrl = await fileToDataURL(f); listingDocs[key] = { fileData: dataUrl, fileName: f.name, fileType: f.type }; renderListingDocs(); } catch (e) { toast('Could not read file'); } }
  function buyerTxCard(pid, t) { const issued = (t.documents || []).filter(d => d.fileData);
    return `<div class="card pad"><div class="spread"><div><b>${esc(TX_TYPE_LBL[t.txType] || t.txType)}</b>${t.amount ? ` · <span class="serif" style="color:var(--bronze)">${fmtN(t.amount)}</span>` : ''}</div>${txStatusBadge(t.status)}</div>
      ${issued.length ? `<div class="tiny muted" style="margin-top:8px">Documents from CoDev:</div>${issued.map(d => `<div class="spread" style="padding:4px 0"><span class="small">${esc(d.title || d.docType || 'Document')}</span><a class="btn ghost sm" href="${d.fileData}" download="${esc(d.fileName || 'document')}">Download</a></div>`).join('')}` : ''}
      ${t.completedAt ? `<div class="small" style="margin-top:8px;color:var(--green)"><b>Completed</b> ${esc(fmtDate(t.completedAt))}${t.completionRef ? ' · Ref ' + esc(t.completionRef) : ''}</div>` : `
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
        <label class="btn ghost sm" style="cursor:pointer">📤 Upload signed document<input type="file" accept="application/pdf,image/*" style="display:none" onchange="CODEVAPP.txUpload('${t.id}','${pid}','signed',this)"></label>
        <label class="btn ghost sm" style="cursor:pointer">💳 Upload funding evidence<input type="file" accept="application/pdf,image/*" style="display:none" onchange="CODEVAPP.txUpload('${t.id}','${pid}','funding',this)"></label>
      </div>${t.fundingEvidence ? '<div class="tiny muted" style="margin-top:6px">✓ Funding evidence uploaded</div>' : ''}`}
    </div>`; }
  async function txUpload(txId, pid, kind, input) { const f = input.files && input.files[0]; input.value = ''; if (!f) return; if (f.size > 6 * 1024 * 1024) { toast('File too large — max 6MB'); return; }
    try { const dataUrl = await fileToDataURL(f);
      if (kind === 'signed') { const my = await db.transactions.listMineForProperty(pid); const t = my.find(x => x.id === txId) || { documents: [] };
        const documents = (t.documents || []).concat([{ docType: 'signed', title: 'Signed by buyer', fileData: dataUrl, fileName: f.name, status: 'buyer_signed', issuedAt: new Date().toISOString() }]);
        await db.transactions.update(txId, { documents, status: 'buyer_signed' }); }
      else { await db.transactions.update(txId, { fundingEvidence: dataUrl, fundingNote: 'Uploaded by buyer' }); }
      toast('Uploaded'); route();
    } catch (e) { toast((e && e.message) || 'Upload failed'); } }
  async function submitDoc(pid, key, input) { const f = input.files && input.files[0]; input.value = ''; if (!f) return;
    if (f.size > 6 * 1024 * 1024) { toast('File too large — max 6MB'); return; }
    const label = ((CFG.REQUIRED_DOCS || []).find(t => t.key === key) || {}).label || key;
    toast('Uploading…');
    try { const dataUrl = await fileToDataURL(f);
      await db.documents.submit(pid, { key, label, fileData: dataUrl, fileName: f.name, fileType: f.type });
      toast('Submitted for review');
      const docs = await db.documents.listForProperty(pid); const box = document.getElementById('docList');
      if (box) box.innerHTML = mergeReqDocs(docs, 'key').map(r => docRowDev(pid, r)).join('');
    } catch (e) { toast((e && e.message) || 'Upload failed'); } }
  function portalHead(t, u) { return `<section class="hero"><div class="wrap" style="padding:26px 22px"><span class="eyebrow">${u.role} · ${esc(u.email)}</span><h1 style="font-size:28px;margin:6px 0 0">${t}</h1></div></section>`; }
  function sec(t, sub, body) { return `<section class="wrap" style="padding:${t ? '40' : '24'}px 22px">${t ? `<span class="eyebrow">CoDev</span><h2 style="margin:4px 0 ${sub ? '4' : '18'}px;font-size:27px">${t}</h2>` : ''}${sub ? `<p class="muted" style="margin:0 0 22px;max-width:60ch">${sub}</p>` : ''}${body}</section>`; }
  const empty = (m) => `<div class="card pad center muted" style="grid-column:1/-1">${m}</div>`;
  const loading = () => `<section class="wrap" style="padding:60px 22px"><div class="card pad center muted">Loading…</div></section>`;

  // ---- location filter + search (dropdown grows automatically with the listings) ----
  let _opps = []; let _lb = [], _lbi = 0; let pendingBrochure = null;
  let pendingDocs = {}; let devExtrasWork = [];
  function oppLocations(list) { const s = new Set(); (list || []).forEach(p => { const l = (p.location || '').trim(); if (l) s.add(l); }); return Array.from(s).sort((a, b) => a.localeCompare(b)); }
  function oppGridHtml(list) { return `<div class="grid g3">${(list || []).map(oppCard).join('') || empty('No developments match your filter — try another location or search term.')}</div>`; }
  // Make on-image captions readable on ANY photo: sample the caption area's brightness and
  // pick dark text on a light photo, light text on a dark one (with a matching scrim).
  function setCoverTheme(ph, mode) { ph.classList.toggle('cover-light', mode === 'light'); ph.classList.toggle('cover-dark', mode === 'dark'); }
  function adaptCovers(root) {
    (root || document).querySelectorAll('.opp-card .ph[data-cover]').forEach(function (ph) {
      const m = (ph.style.backgroundImage || '').match(/url\(["']?(.*?)["']?\)/); if (!m) return;
      const img = new Image();
      img.onload = function () {
        try { const c = document.createElement('canvas'); const w = c.width = 24, h = c.height = 24;
          const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
          const d = ctx.getImageData(0, Math.floor(h * 0.6), w, Math.ceil(h * 0.4)).data;
          let sum = 0, n = 0; for (let i = 0; i < d.length; i += 4) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
          setCoverTheme(ph, (sum / n) > 150 ? 'light' : 'dark');
        } catch (e) { setCoverTheme(ph, 'dark'); }   // cross-origin photo can't be sampled → safe dark scrim + white text
      };
      img.onerror = function () { setCoverTheme(ph, 'dark'); };
      img.crossOrigin = 'anonymous'; img.src = m[1];
    });
  }
  function oppFilterBar(list) { const locs = oppLocations(list); const n = (list || []).length;
    return `<div class="row" style="gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:20px">
      <div class="field" style="margin:0;min-width:210px"><select id="oppLoc" onchange="CODEVAPP.filterOpps()" aria-label="Filter by location"><option value="">📍 All locations</option>${locs.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field" style="margin:0;flex:1;min-width:220px"><input id="oppSearch" type="search" placeholder="Search developments, developer or location…" oninput="CODEVAPP.filterOpps()" aria-label="Search developments"></div>
      <span id="oppCount" class="small muted">${n} development${n === 1 ? '' : 's'}</span>
    </div>`; }
  function filterOpps() {
    const loc = (document.getElementById('oppLoc') || {}).value || '';
    const q = ((document.getElementById('oppSearch') || {}).value || '').trim().toLowerCase();
    let list = _opps || [];
    if (loc) list = list.filter(p => (p.location || '').trim() === loc);
    if (q) list = list.filter(p => [p.title, p.developer, p.location, p.summary, p.stage].some(x => (x || '').toLowerCase().includes(q)));
    const g = document.getElementById('oppGrid'); if (g) g.innerHTML = oppGridHtml(list);
    const c = document.getElementById('oppCount'); if (c) c.textContent = `${list.length} of ${(_opps || []).length} development${(_opps || []).length === 1 ? '' : 's'}`;
    adaptCovers();
  }

  // ---- actions ----
  // ---- listing photos: mobile-friendly capture, HEIC-safe, compressed to data URLs ----
  const MAX_PHOTOS = 6;
  let listingPhotos = [];
  // Downscale + re-encode to JPEG (handles iPhone HEIC via the browser decoder). Returns a data URL or null.
  function compressImg(file, maxDim, quality) {
    maxDim = maxDim || 1500; quality = quality || 0.72;
    return new Promise((resolve) => {
      const isImg = (file && file.type && file.type.indexOf('image/') === 0) || /\.(jpe?g|png|webp|heic|heif)$/i.test((file && file.name) || '');
      if (!isImg) { resolve(null); return; }
      // Decode via a data: URL (not a blob: URL) so the site's CSP img-src allows it.
      const reader = new FileReader();
      reader.onload = () => { const img = new Image();
        img.onload = () => { try {
            const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
            const scale = Math.min(1, maxDim / Math.max(w0, h0));
            const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', quality));
          } catch (e) { resolve(null); } };
        img.onerror = () => resolve(null);
        img.src = reader.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }
  async function addPhotos(input) {
    const files = Array.from(input.files || []); input.value = '';
    const drop = input.closest('.photo-drop'); const label = drop && drop.querySelector('.pd-inner'); const prev = label && label.textContent;
    if (label) label.textContent = 'Processing…';
    let skipped = 0;
    for (const f of files) {
      if (listingPhotos.length >= MAX_PHOTOS) { toast('Up to ' + MAX_PHOTOS + ' photos'); break; }
      const d = await compressImg(f); if (d) listingPhotos.push(d); else skipped++;
    }
    if (label && prev) label.textContent = prev;
    if (skipped) toast('Skipped ' + skipped + ' file' + (skipped > 1 ? 's' : '') + " that couldn't be read");
    renderPhotoPreviews();
  }
  function removePhoto(i) { listingPhotos.splice(i, 1); renderPhotoPreviews(); }
  function renderPhotoPreviews() { const box = document.getElementById('photoPreviews'); if (!box) return;
    box.innerHTML = listingPhotos.map((d, i) => `<div class="ph-thumb"><img src="${d}" alt="photo ${i + 1}"><button type="button" aria-label="Remove photo" onclick="CODEVAPP.removePhoto(${i})">✕</button></div>`).join(''); }

  async function submitProperty(e) { e.preventDefault(); const f = e.target; const u = me();
    const btn = f.querySelector('button[type=submit],button:not([type])'); if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    try { const created = await db.properties.add({ title: f.title.value.trim(), developer: f.developer.value.trim(), location: f.location.value.trim(), address: f.address.value.trim(), items: (listingItems || []).filter(it => it.type), units: f.units.value, deliveryDate: f.deliveryDate.value, summary: f.summary.value.trim(), priceFrom: Number(f.priceFrom.value), stage: f.stage.value, images: listingPhotos.slice() });
      // Upload any documents attached during creation, now that the listing has an id.
      const newId = Array.isArray(created) ? (created[0] && created[0].id) : (created && created.id);
      const staged = Object.keys(listingDocs || {});
      if (newId && staged.length) { for (const key of staged) { const label = ((CFG.REQUIRED_DOCS || []).find(t => t.key === key) || {}).label || key;
        try { await db.documents.submit(newId, { key, label, fileData: listingDocs[key].fileData, fileName: listingDocs[key].fileName, fileType: listingDocs[key].fileType }); } catch (e) {} } }
      if (CFG.imagesUnavailable) toast('Listing submitted. (Photos need a quick backend setup before they save — see admin.)');
      else toast('Submitted! Admin will verify it before it goes public.' + (staged.length ? ' Documents attached.' : ''));
      listingPhotos = []; renderPhotoPreviews(); listingDocs = {};
      const mine = await db.properties.listMine(); const box = document.getElementById('mySubs'); if (box) box.innerHTML = listCards(mine);
      f.reset(); f.developer.value = u.name;
    } catch (err) { toast(err.message || 'Could not submit'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Submit for verification'; } } return false; }
  // ---- Investor / buyer qualification (Express Interest → qualification → CoDev verification) ----
  const INVESTOR_TYPES = ['Property Buyer', 'Co-Developer / Investor', 'Corporate Investor', 'Institutional Investor', 'Joint Investor'];
  const CURRENCIES = CFG.CURRENCIES || ['USD', 'NGN', 'GBP'];
  const OBJECTIVES = ['Purchase for personal use', 'Purchase for rental / investment', 'Co-develop for investment return', 'Acquire multiple units', 'Institutional / project investment', 'Other'];
  const READINESS = ['Ready immediately', 'Within 30 days', '1 – 3 months', '3 – 6 months', 'Exploring / 6+ months'];
  const FUNDING_METHODS = ['Cash / Savings', 'Business / Corporate funds', 'Mortgage', 'Investment finance', 'Sale of existing asset', 'Investment portfolio', 'Combination', 'Other'];
  const SOURCE_OF_FUNDS = ['Employment income', 'Business income', 'Savings', 'Investments', 'Property / asset sale', 'Inheritance', 'Corporate funds', 'Loan / mortgage', 'Other'];
  const optionList = (opts) => opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
  // Amount bands anchored in USD, converted to the chosen currency using super-admin-editable FX rates.
  const AMOUNT_USD = [25000, 50000, 100000, 250000, 500000, 1000000];
  let _fx = null;
  function fmtCur(v, sym) { return sym + Math.round(v).toLocaleString('en-US'); }
  function amountBands(cur, fx) { const r = (fx && fx[cur]) || 1; const sym = (CFG.CURRENCY_SYMBOLS || {})[cur] || (cur + ' ');
    const out = ['Under ' + fmtCur(AMOUNT_USD[0] * r, sym)];
    for (let i = 1; i < AMOUNT_USD.length; i++) out.push(fmtCur(AMOUNT_USD[i - 1] * r, sym) + ' – ' + fmtCur(AMOUNT_USD[i] * r, sym));
    out.push(fmtCur(AMOUNT_USD[AMOUNT_USD.length - 1] * r, sym) + '+'); return out; }
  function qCurrency(cur) { const labels = amountBands(cur, _fx); ['qAmount', 'qCapacity'].forEach(function (id) { const s = document.getElementById(id); if (!s) return; const idx = s.selectedIndex; s.innerHTML = labels.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join(''); if (idx >= 0) s.selectedIndex = idx; }); }
  async function express(id) { if (!requireLogin(() => express(id))) return;
    try { _fx = await db.settings.getFx(); } catch (e) { _fx = CFG.FX_DEFAULT; } if (!_fx) _fx = CFG.FX_DEFAULT;
    let p = null; try { p = await db.properties.byId(id); } catch {}
    const title = (p && p.title) || 'this development'; CODEVAPP._q = { id, title, dev: (p && p.developer) || '' };
    const cur0 = CURRENCIES[0]; const amtOpts = optionList(amountBands(cur0, _fx));
    const sel = (name, opts, extra) => `<select name="${name}" ${extra || ''}>${optionList(opts)}</select>`;
    $('#authTitle').textContent = 'Investor qualification';
    $('#authBody').innerHTML = `<p class="small muted" style="margin-top:0">Complete your investor profile for <b>${esc(title)}</b>. CoDev reviews and verifies every applicant before Deal Room access — this is how we match verified capital to the right opportunity.</p>
      <form onsubmit="return CODEVAPP.submitQualify(event)">
        <div class="field"><label>Investor type</label>${sel('investorType', INVESTOR_TYPES, 'required')}</div>
        <div class="field"><label>Interested unit / property type <span class="tiny muted">(optional)</span></label><input name="unitType" placeholder="e.g. 3-bed apartment, whole floor, SPV participation…"></div>
        <div class="row" style="gap:10px"><div class="field" style="flex:2;min-width:150px"><label>Investment / purchase amount</label><select name="amountBand" id="qAmount" required>${amtOpts}</select></div><div class="field" style="flex:1;min-width:90px"><label>Currency</label><select name="currency" id="qCurrency" onchange="CODEVAPP.qCurrency(this.value)">${optionList(CURRENCIES)}</select></div></div>
        <div class="field"><label>Investment objective</label>${sel('objective', OBJECTIVES, 'required')}</div>
        <div class="field"><label>Investment readiness</label>${sel('readiness', READINESS, 'required')}</div>
        <div class="field"><label>Funding method</label>${sel('fundingMethod', FUNDING_METHODS, 'required')}</div>
        <div class="row" style="gap:10px"><div class="field" style="flex:2;min-width:150px"><label>Available investment capacity</label><select name="capacityRange" id="qCapacity" required>${amtOpts}</select></div><div class="field" style="flex:1;min-width:90px"><label>Mortgage?</label>${sel('mortgageRequired', ['No', 'Yes'])}</div></div>
        <div class="field"><label>Principal source of funds</label>${sel('sourceOfFunds', SOURCE_OF_FUNDS, 'required')}</div>
        <div style="display:flex;gap:8px;align-items:flex-start;margin:6px 0 12px;font-size:11.5px;color:var(--ink2)"><input type="checkbox" name="declaration" id="qDecl" required style="margin-top:2px"><label for="qDecl" style="font-weight:normal;text-transform:none;letter-spacing:0;margin:0">I confirm this information is accurate; I understand co-development involves construction and timeline risk and that returns are not guaranteed; I may require independent legal, tax or financial advice; and I consent to CoDev's identity and compliance checks and to relevant information being shared with project parties under applicable confidentiality and data-protection terms.</label></div>
        <button class="btn primary" style="width:100%" id="qBtn">Submit qualification</button>
        <p class="tiny muted center" style="margin-top:8px">CoDev verification is required before Deal Room access. This is not investment, legal or tax advice.</p>
      </form>`;
    $('#authModal').classList.add('show'); }
  async function submitQualify(e) { e.preventDefault(); const f = e.target;
    if (!f.declaration.checked) { toast('Please accept the declaration to continue.'); return false; }
    const btn = $('#qBtn'); btn.disabled = true; btn.textContent = 'Submitting…';
    const q = { propertyId: CODEVAPP._q.id, propertyTitle: CODEVAPP._q.title, developer: CODEVAPP._q.dev,
      investorType: f.investorType.value, unitType: f.unitType.value.trim(), amountBand: f.amountBand.value, currency: f.currency.value,
      objective: f.objective.value, readiness: f.readiness.value, fundingMethod: f.fundingMethod.value, capacityRange: f.capacityRange.value,
      mortgageRequired: f.mortgageRequired.value === 'Yes', sourceOfFunds: f.sourceOfFunds.value, declaration: true };
    try { await db.qualifications.add(q); closeAuth(); toast('Qualification submitted — CoDev will review and verify, then unlock Deal Room access.'); }
    catch (err) { const m = (err && err.message) || '';
      if (/qualification|relation|does not exist|not found|\(40[34]\)|42P01|schema cache/i.test(m)) { closeAuth(); toast('Qualification received — CoDev will review and verify.'); }
      else { toast(m || 'Could not submit qualification'); btn.disabled = false; btn.textContent = 'Submit qualification'; } }
    return false; }

  // ---- CoDev Legal Verified badge (admin-controlled; restrained trust indicator with disclosure) ----
  function legalVerified(p) { return ['cleared', 'conditionally_cleared'].indexOf(String(p && p.legalStatus || '')) >= 0; }
  function legalBadgeHtml(p) { return legalVerified(p) ? `<span class="badge legalv" onclick="event.stopPropagation();event.preventDefault();CODEVAPP.legalInfo()" title="What this means">🛡️ CoDev Legal Verified</span>` : ''; }
  function legalInfo() { $('#authTitle').textContent = 'CoDev Legal Verified';
    $('#authBody').innerHTML = `<p class="small">“CoDev Legal Verified” indicates that specified development documentation has been reviewed under CoDev's legal due-diligence process, within a defined scope, as at the review date.</p>
      <p class="small muted">It is <b>not</b> a guarantee of title, investment performance or transaction outcome, and is <b>not</b> a substitute for independent legal, tax, financial or investment advice. Any disclosed conditions remain the buyer's responsibility to review before commitment.</p>
      <button class="btn primary" style="width:100%" onclick="CODEVAPP.closeAuth()">Understood</button>`;
    $('#authModal').classList.add('show'); }

  // ---- image lightbox (click a photo to enlarge; arrows / swipe / Esc) ----
  function ensureLB() { let bg = document.getElementById('lbBg'); if (bg) return bg;
    bg = document.createElement('div'); bg.id = 'lbBg'; bg.className = 'lb-bg';
    bg.innerHTML = `<button class="lb-close" aria-label="Close" onclick="CODEVAPP.lbClose()">✕</button>
      <button class="lb-nav lb-prev" aria-label="Previous" onclick="event.stopPropagation();CODEVAPP.lbPrev()">‹</button>
      <img class="lb-img" id="lbImg" alt="Development image">
      <button class="lb-nav lb-next" aria-label="Next" onclick="event.stopPropagation();CODEVAPP.lbNext()">›</button>
      <div class="lb-count" id="lbCount"></div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg) lbClose(); });
    document.body.appendChild(bg); return bg; }
  function lbRender() { const img = document.getElementById('lbImg'); if (img) img.src = _lb[_lbi] || ''; const c = document.getElementById('lbCount'); if (c) c.textContent = _lb.length > 1 ? `${_lbi + 1} / ${_lb.length}` : '';
    const bg = document.getElementById('lbBg'); if (bg) { const multi = _lb.length > 1; const pv = bg.querySelector('.lb-prev'), nx = bg.querySelector('.lb-next'); if (pv) pv.style.display = multi ? '' : 'none'; if (nx) nx.style.display = multi ? '' : 'none'; } }
  function openLightbox(i) { if (!_lb || !_lb.length) return; _lbi = ((i | 0) % _lb.length + _lb.length) % _lb.length; ensureLB(); lbRender(); document.getElementById('lbBg').classList.add('show'); document.addEventListener('keydown', lbKey); }
  function lbNext() { if (_lb.length) { _lbi = (_lbi + 1) % _lb.length; lbRender(); } }
  function lbPrev() { if (_lb.length) { _lbi = (_lbi - 1 + _lb.length) % _lb.length; lbRender(); } }
  function lbClose() { const bg = document.getElementById('lbBg'); if (bg) bg.classList.remove('show'); document.removeEventListener('keydown', lbKey); }
  function lbKey(e) { if (e.key === 'Escape') lbClose(); else if (e.key === 'ArrowRight') lbNext(); else if (e.key === 'ArrowLeft') lbPrev(); }

  // ---- "About developer" profile (self-service) ----
  // One document slot (optional). cur = currently-saved data URL (if any).
  function devDocField(label, slot, cur, hint) {
    const has = !!(pendingDocs[slot] || cur);
    return `<div class="field"><label>${label}${hint ? ` <span class="tiny muted">— ${hint}</span>` : ''}</label>
      <label class="photo-drop"><input type="file" accept="application/pdf,image/*" onchange="CODEVAPP.addDevDoc(this,'${slot}')"><span class="pd-inner" id="dd_${slot}">${has ? '📄 File attached — tap to replace' : '📄 Tap to upload (PDF or image)'}</span></label>
      <div id="ds_${slot}" class="tiny muted" style="margin-top:6px">${cur ? `<a href="#" onclick="CODEVAPP.viewDevDoc('${slot}');return false">View current ↗</a>` : ''}</div></div>`;
  }
  // One repeatable optional "additional information" row.
  function extraRowHtml(x, i) {
    return `<div class="card pad" style="background:#fafafa;margin-bottom:10px" id="exrow_${i}">
      <div class="spread" style="margin-bottom:6px"><strong class="tiny muted">Additional item ${i + 1}</strong><button type="button" class="btn ghost sm" onclick="CODEVAPP.delExtra(${i})">Remove</button></div>
      <div class="field"><label>Label</label><input value="${esc(x.label || '')}" oninput="CODEVAPP.extraSet(${i},'label',this.value)" placeholder="e.g. Awards, Past projects, Bank reference"></div>
      <div class="field"><label>Details</label><textarea rows="2" oninput="CODEVAPP.extraSet(${i},'note',this.value)" placeholder="Anything else you'd like us or investors to know…">${esc(x.note || '')}</textarea></div>
      <div class="field" style="margin-bottom:0"><label>Attachment <span class="tiny muted">— optional, PDF or image</span></label>
        <label class="photo-drop"><input type="file" accept="application/pdf,image/*" onchange="CODEVAPP.addExtraFile(this,${i})"><span class="pd-inner" id="exf_${i}">${x.file ? '📄 File attached — tap to replace' : '📄 Tap to attach a file (optional)'}</span></label></div>
    </div>`;
  }
  function devProfileCard(u) { const pr = (auth.profile && auth.profile()) || {};
    pendingDocs = {}; devExtrasWork = Array.isArray(pr.devExtras) ? JSON.parse(JSON.stringify(pr.devExtras)) : [];
    const about = pr.about || '', website = pr.website || '', phone = pr.phone || '', brochure = pr.brochure || '';
    const reg = pr.regNumber || '', yr = pr.yearEstablished || '', hq = pr.hqAddress || '';
    return `<div class="card pad" style="margin-bottom:18px">
      <div class="spread" style="margin-bottom:4px;flex-wrap:wrap;gap:6px"><h3 style="margin:0;font-size:18px">About developer</h3><span class="badge role">${esc(u.role)}</span></div>
      <p class="small muted" style="margin:0 0 14px">Shown to investors and our team. Only your company name is required — everything else is optional; add as much or as little as you like.</p>
      <form onsubmit="return CODEVAPP.saveDevProfile(event)">
        <div class="field"><label>Company / developer name <span style="color:#b91c1c">*</span></label><input name="name" value="${esc(u.name || '')}" required></div>
        <div class="field"><label>About / company profile</label><textarea name="about" rows="4" placeholder="Track record, focus areas, notable developments…">${esc(about)}</textarea></div>
        <div class="row" style="gap:12px;flex-wrap:wrap">
          <div class="field" style="flex:1 1 200px;min-width:0"><label>Website</label><input name="website" value="${esc(website)}" placeholder="https://"></div>
          <div class="field" style="flex:1 1 200px;min-width:0"><label>Phone</label><input name="phone" value="${esc(phone)}" placeholder="+234…"></div></div>
        <div class="row" style="gap:12px;flex-wrap:wrap">
          <div class="field" style="flex:1 1 180px;min-width:0"><label>CAC / RC registration number</label><input name="reg_number" value="${esc(reg)}" placeholder="RC123456"></div>
          <div class="field" style="flex:1 1 120px;min-width:0"><label>Year established</label><input name="year_established" value="${esc(yr)}" placeholder="e.g. 2015"></div></div>
        <div class="field"><label>Head office address</label><input name="hq_address" value="${esc(hq)}" placeholder="Street, city, state"></div>

        <h4 style="margin:18px 0 8px;font-size:15px;color:#0f2233">Credentials &amp; documents <span class="tiny muted">— all optional, PDF or image up to 5MB each</span></h4>
        ${devDocField('Company profile document', 'companyProfileDoc', pr.companyProfileDoc, 'company profile / portfolio')}
        ${devDocField('CAC / incorporation documents', 'cacDoc', pr.cacDoc, 'certificate, status report')}
        ${devDocField('References', 'referencesDoc', pr.referencesDoc, 'references / recommendation letters')}
        <div class="field"><label>Brochure <span class="tiny muted">— PDF or image, up to 5MB</span></label>
          <label class="photo-drop"><input type="file" accept="application/pdf,image/*" onchange="CODEVAPP.addBrochure(this)"><span class="pd-inner" id="brocLabel">${brochure ? '📄 Brochure attached — tap to replace' : '📄 Tap to upload a brochure (PDF or image)'}</span></label>
          <div id="brocState" class="tiny muted" style="margin-top:6px">${brochure ? `<a href="#" onclick="CODEVAPP.viewBrochure();return false">View current brochure ↗</a>` : ''}</div></div>

        <h4 style="margin:18px 0 8px;font-size:15px;color:#0f2233">Additional information <span class="tiny muted">— optional, add anything else about your company</span></h4>
        <div id="exWrap">${devExtrasWork.map((x, i) => extraRowHtml(x, i)).join('')}</div>
        <button type="button" class="btn ghost sm" onclick="CODEVAPP.addExtra()" style="margin-bottom:4px">+ Add more information</button>

        <div style="margin-top:16px"><button class="btn primary" id="dpBtn">Save profile</button></div>
      </form></div>`; }
  function addBrochure(input) { const f = (input.files || [])[0]; input.value = ''; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Brochure must be under 5MB'); return; }
    const r = new FileReader(); r.onload = () => { pendingBrochure = r.result; const l = document.getElementById('brocLabel'); if (l) l.textContent = '📄 ' + (f.name || 'Brochure') + ' ready — press Save to attach'; const st = document.getElementById('brocState'); if (st) st.textContent = 'New brochure selected: ' + (f.name || 'file'); };
    r.onerror = () => toast('Could not read that file'); r.readAsDataURL(f); }
  // Generic optional-document handlers (company profile / CAC / references).
  function addDevDoc(input, slot) { const f = (input.files || [])[0]; input.value = ''; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('File must be under 5MB'); return; }
    const r = new FileReader(); r.onload = () => { pendingDocs[slot] = r.result; const l = document.getElementById('dd_' + slot); if (l) l.textContent = '📄 ' + (f.name || 'File') + ' ready — press Save to attach'; const st = document.getElementById('ds_' + slot); if (st) st.textContent = 'New file selected: ' + (f.name || 'file'); };
    r.onerror = () => toast('Could not read that file'); r.readAsDataURL(f); }
  function viewDevDoc(slot) { const pr = (auth.profile && auth.profile()) || {}; const b = pendingDocs[slot] || pr[slot]; if (!b) { toast('Nothing uploaded yet'); return; }
    try { const url = URL.createObjectURL(dataURLtoBlob(b)); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (e) { toast('Could not open the file'); } }
  function addExtra() { devExtrasWork.push({ label: '', note: '', file: '' }); const w = document.getElementById('exWrap'); if (w) w.insertAdjacentHTML('beforeend', extraRowHtml(devExtrasWork[devExtrasWork.length - 1], devExtrasWork.length - 1)); }
  function delExtra(i) { devExtrasWork.splice(i, 1); const w = document.getElementById('exWrap'); if (w) w.innerHTML = devExtrasWork.map((x, ix) => extraRowHtml(x, ix)).join(''); }
  function extraSet(i, field, val) { if (devExtrasWork[i]) devExtrasWork[i][field] = val; }
  function addExtraFile(input, i) { const f = (input.files || [])[0]; input.value = ''; if (!f || !devExtrasWork[i]) return;
    if (f.size > 5 * 1024 * 1024) { toast('File must be under 5MB'); return; }
    const r = new FileReader(); r.onload = () => { devExtrasWork[i].file = r.result; const l = document.getElementById('exf_' + i); if (l) l.textContent = '📄 ' + (f.name || 'File') + ' attached'; };
    r.onerror = () => toast('Could not read that file'); r.readAsDataURL(f); }
  function dataURLtoBlob(d) { const [meta, b64] = String(d).split(','); const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream'; const bin = atob(b64 || ''); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: mime }); }
  function viewBrochure() { const pr = (auth.profile && auth.profile()) || {}; const b = pendingBrochure || pr.brochure; if (!b) { toast('No brochure uploaded yet'); return; }
    try { const url = URL.createObjectURL(dataURLtoBlob(b)); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (e) { toast('Could not open the brochure'); } }
  async function saveDevProfile(e) { e.preventDefault(); const f = e.target; const btn = $('#dpBtn'); btn.disabled = true; btn.textContent = 'Saving…';
    const patch = { name: f.name.value.trim(), about: f.about.value.trim(), website: f.website.value.trim(), phone: f.phone.value.trim(),
      reg_number: f.reg_number.value.trim(), year_established: f.year_established.value.trim(), hq_address: f.hq_address.value.trim(),
      dev_extras: devExtrasWork.filter(x => (x.label && x.label.trim()) || (x.note && x.note.trim()) || x.file)
        .map(x => ({ label: (x.label || '').trim(), note: (x.note || '').trim(), file: x.file || '' })) };
    if (pendingBrochure) patch.brochure = pendingBrochure;
    if (pendingDocs.companyProfileDoc) patch.company_profile_doc = pendingDocs.companyProfileDoc;
    if (pendingDocs.cacDoc) patch.cac_doc = pendingDocs.cacDoc;
    if (pendingDocs.referencesDoc) patch.references_doc = pendingDocs.referencesDoc;
    try { await db.profiles.updateMine(patch); pendingBrochure = null; pendingDocs = {};
      if (CFG.devAboutUnavailable) toast('Profile saved. (Extra "About developer" fields need a one-time backend setup — run PROFILE-ABOUT.sql — to be stored.)');
      else toast('Profile saved.');
      renderAuthArea(); route(); }
    catch (err) { const m = (err && err.message) || '';
      if (/about|website|phone|brochure|column|schema cache|\(40[0-4]\)/i.test(m)) toast('Developer profile needs a quick backend setup (run PROFILE-ABOUT.sql).');
      else toast(m || 'Could not save profile');
      btn.disabled = false; btn.textContent = 'Save profile'; }
    return false; }

  // ---- router (async) ----
  async function route() {
    const h = (location.hash || '#/').slice(2); const [path, arg] = h.split('/');
    const gated = ['list', 'investor', 'developer', 'account', 'docs', 'dealroom', 'deals'];
    if (gated.includes(path) && !requireLogin(() => route())) { app.innerHTML = sec('Sign in required', 'Please sign in to continue.', ''); return; }
    if (gated.includes(path) && mfaGate()) { app.innerHTML = sec('Two-factor required', 'Complete two-factor authentication to continue.', ''); return; }
    // Admin-verification gate: a signed-in account holder cannot operate, list or view until approved.
    if (needsApproval()) { try { await auth.refreshProfile(); } catch {} if (needsApproval()) { app.innerHTML = pendingScreen(); return; } }
    app.innerHTML = loading();
    try {
      const u = me();
      if (path === '' || path === undefined) { const opps = await db.properties.listPublic(); let devs = 0, inv = 0; try { const accs = CFG.configured ? await db.profiles.listAll() : []; devs = accs.filter(a => a.role === 'developer').length; inv = accs.filter(a => a.role === 'investor').length; } catch {} app.innerHTML = V.home(opps, { opps: opps.length, devs: devs || '—', investors: inv || '—' }); }
      else if (path === 'opportunities') app.innerHTML = V.opportunities(await db.properties.listPublic());
      else if (path === 'opp') { const p = await db.properties.byId(arg); const dstat = p ? await db.documents.statusForProperty(arg) : []; app.innerHTML = V.opp(p, dstat); }
      else if (path === 'docs') { const p = await db.properties.byId(arg); let docs = [], queries = [], report = null;
        if (p) { docs = await db.documents.listForProperty(arg).catch(() => []); queries = await db.legalQueries.list(arg).catch(() => []); report = await db.legalReports.latest(arg).catch(() => null); }
        app.innerHTML = V.docs(u, p, { docs, queries, report }); }
      else if (path === 'dealroom') { const p = await db.properties.byId(arg); let verified = false, access = null, docs = [], report = null, txs = [];
        if (p) { try { verified = await db.dealroom.isVerifiedBuyer(p.id); } catch {} try { access = await db.dealroom.myAccess(p.id); } catch {}
          if (verified && access && access.status === 'active' && access.acknowledgedAt) {
            try { docs = await db.dealroom.clearedDocs(p.id); } catch {} try { report = await db.legalReports.latest(p.id); } catch {}
            try { txs = await db.transactions.listMineForProperty(p.id); } catch {} try { await db.dealroom.log(p.id, 'opened', null); } catch {} } }
        app.innerHTML = V.dealRoom(u, p, { verified, access, docs, report, txs }); }
      else if (path === 'how') app.innerHTML = V.how();
      else if (path === 'list') app.innerHTML = V.list(u, await db.properties.listMine());
      else if (path === 'investor') app.innerHTML = V.investor(u, await db.properties.listPublic());
      else if (path === 'developer') app.innerHTML = V.developer(u, await db.properties.listMine());
      else if (path === 'account') app.innerHTML = V.account(u, await db.properties.listMine());
      else if (path === 'deals') { const p = arg ? await db.properties.byId(arg) : null; let txs = []; if (p) { try { txs = await db.transactions.listForProperty(p.id); } catch {} } app.innerHTML = V.deals(u, p, txs); }
      else { const opps = await db.properties.listPublic(); app.innerHTML = V.home(opps, { opps: opps.length, devs: '—', investors: '—' }); }
    } catch (err) { app.innerHTML = sec('Something went wrong', err.message || 'Please try again.', ''); }
    adaptCovers();
    window.scrollTo(0, 0);
  }

  window.CODEVAPP = { openAuth, closeAuth, doSignin, doSignup, logout, submitProperty, submitDoc, stageDoc, enterDealRoom, logDeal, onTypeChange, addItemDev, delItemDev, itemSetDev, itemSizeDev, postQuery, txUpload, express, submitQualify, qCurrency, legalInfo, confirmCode, resendCode, togglePass, addPhotos, removePhoto, forgotFromSignin, forgotStart, doForgot, doReset, resendRecovery, filterOpps, openLightbox, lbNext, lbPrev, lbClose, addBrochure, saveDevProfile, viewBrochure, addDevDoc, viewDevDoc, addExtra, delExtra, extraSet, addExtraFile, devTxUnit, devTxAddPay, devTxPaySet, devTxDelPay, _afterAuth: null };
  // Session timeout → clean logout + re-login prompt (fired by the data layer on an expired JWT).
  window.addEventListener('codev:session-expired', () => {
    renderAuthArea();
    const p = (location.hash || '#/').slice(2).split('/')[0];
    if (['list', 'investor', 'developer', 'account'].includes(p)) location.hash = '#/';
    openAuth('signin');
    toast('Your session timed out — please sign in again.');
  });
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => { renderAuthArea(); route(); });
  renderAuthArea(); route();
})();
