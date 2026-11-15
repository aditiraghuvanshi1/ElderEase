/* login.js — log in / sign up / forgot password. Kept in its own file so the page needs no inline script.

   Two modes, chosen when the page loads:
   - SERVER: the ElderEase server answers /api/health. Elders, family and caretakers have real accounts there.
             Volunteer helpers still use browser-only accounts (the request board has not moved to the server yet).
   - LOCAL:  the site is hosted as plain files. Everything works as before, on this device only. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    let serverMode = false;

    // already logged in on this tab? go straight to the dashboard
    const existing = Auth.current();
    if (existing) { location.replace(Auth.homeFor(existing.role)); return; }

    async function api(method, url, body) {
        const res = await fetch(url, { method, credentials: 'same-origin', signal: AbortSignal.timeout(15000),
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ElderEase' }, body: body ? JSON.stringify(body) : undefined });
        let json = {};
        try { json = await res.json(); } catch (e) { /* not JSON: no server here */ }
        return { status: res.status, ok: res.ok, json };
    }

    // where a server account goes after signing in
    function enterServer(user) {
        if (user.role === 'elder') { Auth.adoptServer(user); location.replace('adult.html'); }
        else location.replace('care.html');
    }

    function showMsg(text, ok) {
        const m = $('auth-msg');
        m.textContent = text;
        m.className = 'auth-msg ' + (ok ? 'ok' : 'err');
        m.hidden = false;
    }
    function showTab(which) {
        const login = which === 'login', signup = which === 'signup', forgot = which === 'forgot';
        $('login-form').hidden = !login;
        $('signup-form').hidden = !signup;
        $('forgot-form').hidden = !forgot;
        $('tab-login').classList.toggle('active', login || forgot);
        $('tab-signup').classList.toggle('active', signup);
        $('tab-login').setAttribute('aria-selected', login || forgot);
        $('tab-signup').setAttribute('aria-selected', signup);
        $('auth-msg').hidden = true;
    }
    $('tab-login').addEventListener('click', () => showTab('login'));
    $('tab-signup').addEventListener('click', () => showTab('signup'));
    $('forgot-open').addEventListener('click', () => {
        showTab('forgot');
        $('forgot-email').value = $('login-email').value.trim();
        $('forgot-email').focus();
    });
    $('forgot-close').addEventListener('click', () => showTab('login'));

    document.querySelectorAll('[data-show-for]').forEach(cb => {
        cb.addEventListener('change', () => { $(cb.dataset.showFor).type = cb.checked ? 'text' : 'password'; });
    });

    // demo cards: browser-only accounts always; server accounts only when the server has its demo data
    const DEMO = {
        elder:      { email: 'elder@demo.in', password: () => Auth.DEMOS['elder@demo.in'].password },
        helper:     { email: 'helper@demo.in', password: () => Auth.DEMOS['helper@demo.in'].password },
        's-elder':  { email: 'elder.demo@elderease.in', password: () => 'Elder@123' },
        's-care':   { email: 'caretaker.demo@elderease.in', password: () => 'Care@1234' },
        's-family': { email: 'family.demo@elderease.in', password: () => 'Family@123' }
    };
    document.querySelectorAll('.demo-card').forEach(b => b.addEventListener('click', () => {
        const d = Object.prototype.hasOwnProperty.call(DEMO, b.dataset.demo) ? DEMO[b.dataset.demo] : null;
        if (!d) return;
        showTab('login');
        $('login-email').value = d.email;
        $('login-password').value = d.password();
        $('login-password').focus();
    }));

    const role = () => document.querySelector('input[name="user-role"]:checked').value;
    // age limits follow the chosen role: elders 60+, everyone else 18+
    function syncRole() {
        const elder = role() === 'adult';
        $('su-age').min = elder ? 60 : 18;
        $('age-hint').dataset.i18n = elder ? 'agehint_elder' : 'agehint_helper';
        $('age-hint').textContent = elder ? I18N.t('agehint_elder') : (role() === 'helper' ? I18N.t('agehint_helper') : 'You must be 18 or older.');
        $('su-passcode-row').hidden = !(role() === 'family' || role() === 'caretaker');
    }
    document.querySelectorAll('input[name="user-role"]').forEach(r => r.addEventListener('change', syncRole));
    window.addEventListener('langchange', syncRole);
    document.addEventListener('DOMContentLoaded', syncRole);

    function friendly(err) {
        return err && err.message === 'secure-context'
            ? 'Open this site over https:// (or on localhost). Browsers block secure login on plain http.'
            : 'That did not work. Check your connection and try again.';
    }
    async function busy(btn, label, fn) {
        const old = btn.textContent;
        btn.disabled = true;
        btn.textContent = label;
        try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
    }

    /* ---------- detect the server, and pick up an existing server sign-in ---------- */
    async function detect() {
        try {
            const probe = await fetch('manifest.json', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(8000) });
            if (probe.headers.get('X-ElderEase-Server') !== '1') return;      // plain static hosting: browser-only mode
            const h = await api('GET', '/api/health');
            serverMode = h.ok && h.json && h.json.ok === true;
            if (!serverMode) return;
            document.querySelectorAll('.server-only').forEach(el => { el.hidden = false; });
            if (h.json.demo) {
                document.querySelectorAll('.server-demo').forEach(el => { el.hidden = false; });
                document.querySelectorAll('.local-only').forEach(el => { el.hidden = true; });
            }
            const me = await api('GET', '/api/session');
            if (me.ok && me.json.user) enterServer(me.json.user);
        } catch (e) { serverMode = false; }
    }
    const ready = detect();

    /* ---------- log in ---------- */
    $('login-form').addEventListener('submit', e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        if (btn.disabled) return;
        busy(btn, 'Checking...', async () => {
            await ready;
            const email = $('login-email').value, password = $('login-password').value;
            try {
                if (serverMode && !Auth.isLocal(email)) {
                    const r = await api('POST', '/api/auth/login', { email, password });
                    if (r.ok && r.json.user) { enterServer(r.json.user); return; }
                    if (r.status !== 401) { $('login-password').value = ''; showMsg(r.json.error || 'That did not work. Try again.', false); return; }
                    // not a server account: fall through to browser-only accounts (gives the same generic error if none)
                }
                const r = await Auth.login(email, password);
                if (r.ok) { location.replace(Auth.homeFor(r.role)); return; }
                $('login-password').value = '';
                showMsg(r.error, false);
            } catch (err) { showMsg(friendly(err), false); }
        });
    });

    /* ---------- sign up ---------- */
    $('signup-form').addEventListener('submit', e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        if (btn.disabled) return;
        busy(btn, 'Creating...', async () => {
            await ready;
            const email = $('su-email').value;
            const fields = { name: $('su-name').value, age: $('su-age').value, email, password: $('su-password').value };
            try {
                const rl = role();
                if (serverMode && rl !== 'helper') {
                    const body = { ...fields, age: Number(fields.age), role: rl === 'adult' ? 'elder' : rl };
                    if (rl === 'family' || rl === 'caretaker') body.passcode = $('su-passcode').value;
                    const r = await api('POST', '/api/auth/register', body);
                    if (!r.ok) { showMsg(r.json.error || 'That did not work. Try again.', false); return; }
                } else {
                    if (rl === 'family' || rl === 'caretaker') { showMsg('Family and caretaker accounts need the ElderEase server.', false); return; }
                    const r = await Auth.signup({ ...fields, role: rl });
                    if (!r.ok) { showMsg(r.error, false); return; }
                }
                // Same message and same screen whether the email was new or already registered
                e.target.reset();
                syncRole();
                showTab('login');
                $('login-email').value = email.trim();
                showMsg('Account ready. Log in with your email and password.', true);
                $('login-password').focus();
            } catch (err) { showMsg(friendly(err), false); }
        });
    });

    /* ---------- forgot password ---------- */
    $('forgot-form').addEventListener('submit', e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        if (btn.disabled) return;
        busy(btn, 'Sending...', async () => {
            try {
                const r = await api('POST', '/api/auth/forgot', { email: $('forgot-email').value });
                showMsg(r.json.message || r.json.error || 'That did not work. Try again.', r.ok);
            } catch (err) { showMsg(friendly(err), false); }
        });
    });
})();
