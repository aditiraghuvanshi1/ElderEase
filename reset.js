/* reset.js — finishes a password reset. The token arrives after "#" in the emailed link, so it is never sent
   to any server in a URL; we read it, then remove it from the address bar and history straight away. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const m = /(?:^#|&)t=([A-Za-z0-9_-]{20,80})(?:&|$)/.exec(location.hash);
    const token = m ? m[1] : null;
    history.replaceState(null, '', location.pathname);

    function say(text, ok) {
        const el = $('reset-msg');
        el.textContent = text;
        el.className = 'auth-msg ' + (ok ? 'ok' : 'err');
        el.hidden = false;
    }
    if (!token) {
        $('reset-form').hidden = true;
        $('reset-done').hidden = false;
        say('This page needs the link from your reset email. Ask for a new one from the log in page.', false);
        return;
    }
    $('rs-show').addEventListener('change', e => { $('rs-pass').type = $('rs-pass2').type = e.target.checked ? 'text' : 'password'; });

    $('reset-form').addEventListener('submit', async e => {
        e.preventDefault();
        const pw = $('rs-pass').value;
        if (pw !== $('rs-pass2').value) { say('The two passwords are different. Type them again.', false); return; }
        if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) { say('Use at least 8 characters, with a letter and a number.', false); return; }
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
            const res = await fetch('/api/auth/reset', { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ElderEase' }, body: JSON.stringify({ token, password: pw }) });
            let json = {}; try { json = await res.json(); } catch (x) { /* no body */ }
            if (!res.ok) { say(json.error || 'That did not work. Try again.', false); btn.disabled = false; return; }
            try { sessionStorage.clear(); } catch (x) { /* ignore */ }
            $('reset-form').hidden = true;
            $('reset-done').hidden = false;
            say('Password saved. Log in with your new password.', true);
        } catch (err) {
            say('That did not work. Check your connection and try again.', false);
            btn.disabled = false;
        }
    });
})();
