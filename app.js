/* CoDevelop — public site, auth, role portals, property submission */
(function () {
  const { CFG, store, fmtN, esc } = window.CODEV;
  const app = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);

  // ---------- helpers ----------
  function toast(msg) {
    const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  const sess = () => store.session.get();
  function requireLogin(then) {
    if (sess()) return true;
    openAuth('signin', then); return false;
  }

  // ---------- header auth area ----------
  function renderAuthArea() {
    const el = document.getElementById('authArea'); const s = sess();
    if (!s) {
      el.innerHTML = `<button class="btn sm" onclick="CODEVAPP.openAuth('signin')">Sign in</button>
        <button class="btn primary sm" onclick="CODEVAPP.openAuth('signup')">Create account</button>`;
    } else {
      const home = s.role === 'developer' ? '#/developer' : s.role === 'investor' ? '#/investor' : '#/account';
      el.innerHTML = `<a class="btn sm" href="${home}">My portal</a>
        <div class="row" style="align-items:center;gap:8px">
          <span class="badge role">${esc(s.name.split(' ')[0])} · ${s.role}</span>
          <button class="btn ghost sm" onclick="CODEVAPP.logout()">Log out</button></div>`;
    }
  }

  // ---------- auth modal ----------
  function openAuth(mode, then) {
    CODEVAPP._afterAuth = then || null;
    $('#authTitle').textContent = mode === 'signup' ? 'Create your account' : 'Sign in';
    $('#authBody').innerHTML = mode === 'signup' ? signupForm() : signinForm();
    $('#authModal').classList.add('show');
  }
  function closeAuth() { $('#authModal').classList.remove('show'); }
  function signinForm() {
    return `<form onsubmit="return CODEVAPP.doSignin(event)">
      <div class="field"><label>Email</label><input name="email" type="email" required placeholder="you@email.com"></div>
      <div class="field"><label>Password</label><input name="pass" type="password" required></div>
      <button class="btn primary" style="width:100%">Sign in</button>
      <p class="small muted center" style="margin-top:12px">New here? <a href="#" onclick="CODEVAPP.openAuth('signup');return false">Create an account</a></p>
      <p class="tiny muted center">Demo logins — investor@example.com · dev@meridian.example (pw: demo1234)</p></form>`;
  }
  function signupForm() {
    return `<form onsubmit="return CODEVAPP.doSignup(event)">
      <div class="field"><label>Full name / company</label><input name="name" required></div>
      <div class="field"><label>Email</label><input name="email" type="email" required></div>
      <div class="field"><label>I am a…</label>
        <select name="role">
          <option value="investor">Investor — co-develop verified property</option>
          <option value="developer">Developer — list &amp; raise co-development capital</option>
          <option value="visitor">Property owner — list my property</option>
        </select></div>
      <div class="field"><label>Password</label><input name="pass" type="password" minlength="6" required></div>
      <button class="btn primary" style="width:100%">Create account</button>
      <p class="tiny muted center" style="margin-top:12px">Sandbox mode — no real capital, KYC or escrow yet. Real auth &amp; MFA arrive with the production build.</p>
      <p class="small muted center">Have an account? <a href="#" onclick="CODEVAPP.openAuth('signin');return false">Sign in</a></p></form>`;
  }
  function doSignin(e) {
    e.preventDefault(); const f = e.target;
    const acc = store.accounts.verifyPass(f.email.value.trim(), f.pass.value);
    if (!acc) { toast('Invalid email or password'); return false; }
    if (acc.status !== 'active') { toast('Account is ' + acc.status + ' — contact admin'); return false; }
    if (acc.role === 'admin') { toast('Use the Admin console for admin accounts'); location.href = 'admin.html'; return false; }
    store.session.set(acc); afterAuth(); return false;
  }
  function doSignup(e) {
    e.preventDefault(); const f = e.target;
    try {
      const acc = store.accounts.add({ name: f.name.value.trim(), email: f.email.value.trim(), role: f.role.value, pass: f.pass.value });
      store.session.set(acc); toast('Welcome to CoDevelop, ' + acc.name.split(' ')[0] + '!'); afterAuth();
    } catch (err) { toast(err.message); }
    return false;
  }
  function afterAuth() {
    closeAuth(); renderAuthArea();
    const then = CODEVAPP._afterAuth; CODEVAPP._afterAuth = null;
    if (then) then(); else {
      const s = sess(); location.hash = s.role === 'developer' ? '#/developer' : s.role === 'investor' ? '#/investor' : '#/account';
    }
    route();
  }
  function logout() { store.session.clear(); renderAuthArea(); toast('Logged out'); location.hash = '#/'; route(); }

  // ---------- views ----------
  function oppCard(p) {
    return `<div class="card opp-card">
      <div class="ph"><span class="vb badge verified">✓ Verified</span><span class="loc">📍 ${esc(p.location)}</span></div>
      <div style="padding:16px">
        <div class="small muted" style="font-weight:600">${esc(p.developer)}</div>
        <h3 style="margin:2px 0 6px;font-size:19px">${esc(p.title)}</h3>
        <p class="small muted" style="min-height:38px">${esc(p.summary)}</p>
        <div class="spread" style="border-top:1px solid var(--line);padding-top:11px;margin-top:6px">
          <div><div class="tiny muted">Participation from</div><div class="serif" style="color:var(--bronze);font-size:17px">${fmtN(p.priceFrom)}</div></div>
          <span class="tiny" style="font-weight:700;color:var(--navy)">${esc(p.stage)}</span>
        </div>
        <a class="btn sm" style="width:100%;justify-content:center;margin-top:12px" href="#/opp/${p.id}">View development →</a>
      </div></div>`;
  }

  const views = {
    home() {
      const opps = store.properties.listPublic().slice(0, 3);
      return `<section class="hero"><div class="wrap grid g2" style="padding:56px 22px;align-items:center">
        <div>
          <span class="eyebrow">Nigeria · Ikoyi · VI · Lekki · Ikeja GRA</span>
          <h1 style="font-size:40px;line-height:1.08;margin:10px 0 14px">Co-develop verified property — before the developer's margin.</h1>
          <p class="muted" style="font-size:16px;max-width:46ch">List a property, get it verified, and co-develop with qualified capital on one governed platform. Every listing is reviewed and approved before it goes public.</p>
          <div class="row" style="margin-top:22px">
            <a class="btn primary" href="#/opportunities">Explore opportunities</a>
            <a class="btn" href="#/list">List a property</a>
          </div>
        </div>
        <div class="grid" style="gap:14px">
          <div class="card pad"><div class="spread"><div><div class="serif" style="font-size:26px;color:var(--navy)">${store.properties.listPublic().length}</div><div class="tiny muted">Verified opportunities</div></div>
          <div><div class="serif" style="font-size:26px;color:var(--navy)">${store.accounts.list().filter(a=>a.role==='developer').length}</div><div class="tiny muted">Developers</div></div>
          <div><div class="serif" style="font-size:26px;color:var(--navy)">${store.accounts.list().filter(a=>a.role==='investor').length}</div><div class="tiny muted">Investors</div></div></div></div>
          <div class="card pad" style="background:var(--navy);color:#fff"><div class="eyebrow" style="color:var(--bronze2)">Trust before conversion</div>
            <p style="margin:8px 0 0;font-size:14px;color:#dbe4ec">Listings from developers <b style="color:#fff">and</b> property owners are verified by our admin team before appearing here.</p></div>
        </div>
      </div></section>
      <section class="wrap" style="padding:44px 22px">
        <div class="spread" style="margin-bottom:18px"><div><span class="eyebrow">Curated opportunities</span><h2 style="margin:4px 0 0;font-size:27px">Featured developments</h2></div>
        <a class="btn sm" href="#/opportunities">View all →</a></div>
        <div class="grid g3">${opps.map(oppCard).join('') || emptyMsg('No verified opportunities yet.')}</div>
      </section>`;
    },
    opportunities() {
      const opps = store.properties.listPublic();
      return section('All opportunities', 'Every listing here has been verified by our admin team.',
        `<div class="grid g3">${opps.map(oppCard).join('') || emptyMsg('No verified opportunities yet — check back soon.')}</div>`);
    },
    opp(id) {
      const p = store.properties.byId(id);
      if (!p || p.status !== 'verified') return section('Not available', '', emptyMsg('This development is not available.'));
      return `<section class="wrap" style="padding:36px 22px">
        <a class="small muted" href="#/opportunities">← All opportunities</a>
        <div class="grid g2" style="margin-top:14px;align-items:start">
          <div class="card" style="overflow:hidden"><div class="ph" style="height:260px"></div></div>
          <div>
            <span class="badge verified">✓ Verified</span>
            <h1 style="font-size:30px;margin:10px 0 4px">${esc(p.title)}</h1>
            <div class="muted">${esc(p.developer)} · 📍 ${esc(p.location)}</div>
            <p style="margin:16px 0">${esc(p.summary)}</p>
            <div class="card pad grid g2" style="gap:12px">
              <div><div class="tiny muted">Participation from</div><div class="serif" style="font-size:22px;color:var(--bronze)">${fmtN(p.priceFrom)}</div></div>
              <div><div class="tiny muted">Current stage</div><div style="font-weight:700;color:var(--navy)">${esc(p.stage)}</div></div>
            </div>
            <button class="btn primary" style="margin-top:16px" onclick="CODEVAPP.express('${p.id}')">Express interest</button>
          </div>
        </div></section>`;
    },
    how() {
      const steps = [['List', 'A developer or property owner submits a development or plot.'],
        ['Verify', 'Our admin team reviews and verifies the listing before it goes public.'],
        ['Co-develop', 'Investors browse verified opportunities and express interest.'],
        ['Govern', 'Milestone-based structure, kept transparent (sandbox — real escrow with partners).']];
      return section('How it works', 'From listing to verification to co-development.',
        `<div class="grid g2">${steps.map((s, i) => `<div class="card pad row" style="gap:14px;align-items:flex-start">
          <span class="step-n">${i + 1}</span><div><h3 style="margin:0 0 4px;font-size:18px">${s[0]}</h3><p class="small muted" style="margin:0">${s[1]}</p></div></div>`).join('')}</div>`);
    },
    list() {
      if (!requireLogin(() => location.hash = '#/list')) return section('List a property', 'Sign in to list a property.', '');
      const s = sess();
      return section('List a property', 'Developers and property owners can list here. Submissions are verified by admin before they go public.',
        `<div class="grid g2" style="align-items:start">
          <form class="card pad" onsubmit="return CODEVAPP.submitProperty(event)">
            <div class="field"><label>Property / development title</label><input name="title" required></div>
            <div class="field"><label>Developer / owner name</label><input name="developer" value="${esc(s.name)}" required></div>
            <div class="field"><label>Location</label><input name="location" placeholder="e.g. Lekki, Lagos" required></div>
            <div class="field"><label>Summary</label><textarea name="summary" rows="3" required></textarea></div>
            <div class="row" style="gap:12px">
              <div class="field" style="flex:1"><label>Participation from (₦)</label><input name="priceFrom" type="number" min="0" required></div>
              <div class="field" style="flex:1"><label>Stage</label><select name="stage">${CFG.STAGES.map(x => `<option>${x}</option>`).join('')}</select></div>
            </div>
            <button class="btn primary" style="width:100%">Submit for verification</button>
          </form>
          <div><h3 style="font-size:18px">Your submissions</h3><div id="mySubs">${myListingsHTML(s.email)}</div></div>
        </div>`);
    },
    investor() {
      if (!requireLogin(() => location.hash = '#/investor')) return section('Investor portal', 'Sign in to continue.', '');
      const s = sess(); const opps = store.properties.listPublic();
      return portalHead('Investor portal', s) + section('', '',
        `<div class="spread" style="margin-bottom:14px"><h3 style="margin:0;font-size:19px">Verified opportunities</h3><span class="small muted">${opps.length} available</span></div>
         <div class="grid g3">${opps.map(oppCard).join('') || emptyMsg('No verified opportunities yet.')}</div>`);
    },
    developer() {
      if (!requireLogin(() => location.hash = '#/developer')) return section('Developer portal', 'Sign in to continue.', '');
      const s = sess();
      return portalHead('Developer portal', s) + section('', '',
        `<div class="spread" style="margin-bottom:14px"><h3 style="margin:0;font-size:19px">Your listings</h3><a class="btn primary sm" href="#/list">+ List a property</a></div>
         <div id="mySubs">${myListingsHTML(s.email)}</div>`);
    },
    account() {
      if (!requireLogin(() => location.hash = '#/account')) return section('Account', 'Sign in to continue.', '');
      const s = sess();
      return portalHead('Your account', s) + section('', '',
        `<div class="grid g2" style="align-items:start">
          <div class="card pad"><h3 style="margin:0 0 10px;font-size:17px">Profile</h3>
            <p class="small"><b>${esc(s.name)}</b><br><span class="muted">${esc(s.email)}</span><br><span class="badge role" style="margin-top:6px">${s.role}</span></p>
            <button class="btn danger sm" style="margin-top:10px" onclick="CODEVAPP.logout()">Log out</button></div>
          <div><div class="spread"><h3 style="font-size:17px">Your listings</h3><a class="btn sm" href="#/list">+ List</a></div><div id="mySubs">${myListingsHTML(s.email)}</div></div>
        </div>`);
    },
  };

  function myListingsHTML(email) {
    const mine = store.properties.listBy(email);
    if (!mine.length) return `<div class="card pad small muted">No submissions yet. <a href="#/list">List a property →</a></div>`;
    return `<div class="grid" style="gap:10px">${mine.map(p => `<div class="card pad spread">
      <div><b>${esc(p.title)}</b><div class="tiny muted">${esc(p.location)} · ${fmtN(p.priceFrom)}</div></div>
      <span class="badge ${p.status}">${p.status}</span></div>`).join('')}</div>`;
  }
  function portalHead(title, s) {
    return `<section class="hero"><div class="wrap" style="padding:26px 22px">
      <span class="eyebrow">${s.role} · ${esc(s.email)}</span><h1 style="font-size:28px;margin:6px 0 0">${title}</h1></div></section>`;
  }
  function section(title, sub, body) {
    return `<section class="wrap" style="padding:${title ? '40' : '24'}px 22px">
      ${title ? `<span class="eyebrow">CoDevelop</span><h2 style="margin:4px 0 ${sub ? '4' : '18'}px;font-size:27px">${title}</h2>` : ''}
      ${sub ? `<p class="muted" style="margin:0 0 22px;max-width:60ch">${sub}</p>` : ''}${body}</section>`;
  }
  const emptyMsg = (m) => `<div class="card pad center muted" style="grid-column:1/-1">${m}</div>`;

  // ---------- actions ----------
  function submitProperty(e) {
    e.preventDefault(); const f = e.target; const s = sess();
    store.properties.add({
      title: f.title.value.trim(), developer: f.developer.value.trim(), location: f.location.value.trim(),
      summary: f.summary.value.trim(), priceFrom: Number(f.priceFrom.value), stage: f.stage.value,
      submittedBy: s.email, submittedByRole: s.role,
    });
    toast('Submitted! Our admin team will verify it before it goes public.');
    const box = document.getElementById('mySubs'); if (box) box.innerHTML = myListingsHTML(s.email); f.reset(); f.developer.value = s.name;
    return false;
  }
  function express(id) { if (!requireLogin(() => express(id))) return; toast('Interest registered — the team will be in touch (sandbox).'); }

  // ---------- router ----------
  function route() {
    const h = (location.hash || '#/').slice(2);
    const [path, arg] = h.split('/');
    let html;
    if (path === '' ) html = views.home();
    else if (path === 'opportunities') html = views.opportunities();
    else if (path === 'opp') html = views.opp(arg);
    else if (path === 'how') html = views.how();
    else if (path === 'list') html = views.list();
    else if (path === 'investor') html = views.investor();
    else if (path === 'developer') html = views.developer();
    else if (path === 'account') html = views.account();
    else html = views.home();
    app.innerHTML = html; window.scrollTo(0, 0);
  }

  window.CODEVAPP = { openAuth, closeAuth, doSignin, doSignup, logout, submitProperty, express, _afterAuth: null };
  window.addEventListener('hashchange', route);
  document.addEventListener('DOMContentLoaded', () => { renderAuthArea(); route(); });
  renderAuthArea(); route();
})();
