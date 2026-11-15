/* auth.js — email + password accounts.
   Passwords are never stored: only a salted PBKDF2 hash. Sessions live in sessionStorage (one login per tab).
   NOTE: everything is kept in this browser's localStorage, so this stops people using each other's accounts
   through the app, but it is not a replacement for a real server-side login (see "Next step: backend"). */
const Auth = (() => {
    const USERS = 'neUsers', SESSION = 'neSession', FAILS = 'neLoginFails';
    // OWASP (2023) guidance for PBKDF2-HMAC-SHA256. Each account stores its own count, so older
    // accounts made with 150,000 still log in and are upgraded to this value on their next login.
    const ITERATIONS = 600000, LEGACY_ITERATIONS = 150000;
    const MAX_FAILS = 5, LOCK_MS = 60 * 1000;
    const SESSION_MS = 12 * 60 * 60 * 1000;          // a login lasts 12 hours, then you sign in again
    const LIMITS = { name: 80, email: 254, password: 128 };

    const toB64 = bytes => btoa(String.fromCharCode(...bytes));
    const fromB64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return isObj(v) ? v : fallback; } catch (e) { return fallback; } };
    const write = (key, val) => localStorage.setItem(key, JSON.stringify(val));
    const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;   // never read inherited keys like "constructor"
    const normEmail = e => String(e || '').trim().toLowerCase().slice(0, LIMITS.email);
    const cleanText = (v, max) => String(v || '').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
    const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
    const randomHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
    const DUMMY_SALT = toB64(new Uint8Array(16));

    async function hashPassword(password, saltB64, iterations) {
        if (!(window.crypto && crypto.subtle)) throw new Error('secure-context');
        const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
        const bits = await crypto.subtle.deriveBits(
            { name: 'PBKDF2', salt: fromB64(saltB64), iterations: iterations || ITERATIONS, hash: 'SHA-256' }, key, 256);
        return toB64(new Uint8Array(bits));
    }

    function sameString(a, b) {           // compares every character, no early exit
        if (a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        return diff === 0;
    }

    /* DEMO ACCOUNTS — fixed logins so the app can be tried without signing up. */
    const DEMOS = {
        'elder@demo.in':  { name: 'Savitri Devi', age: 68, role: 'adult',  password: 'Elder@123' },
        'helper@demo.in': { name: 'Rahul Verma',  age: 22, role: 'helper', password: 'Helper@123' }
    };
    function seedElderData(id) {
        const pad = n => String(n).padStart(2, '0');
        const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const health = { days: {}, appts: [] }, logs = {};
        const sys = [138, 142, 135, 146, 132, 140, 128, 136, 144, 130], sug = [118, 142, 126, 190, 112, 134, 121, 148, 132, 116];
        for (let i = 9; i >= 1; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            const k = key(d), n = 9 - i;
            health.days[k] = {
                vitals: [{ time: '08:15', sys: sys[n], dia: 80 + (n % 4) * 3, pulse: 72 + (n % 5), spo2: 97 - (n % 2), sugar: sug[n], sugarWhen: 'fasting', weight: 66.5 }],
                mood: { mood: 3 + (n % 3 === 0 ? 1 : 0) - (n === 4 ? 1 : 0), sleep: 6 + (n % 3), stress: n === 4 ? 'high' : 'low', lonely: n === 3 || n === 4, note: n === 4 ? 'Worried about the knee pain' : '' },
                symptoms: n % 3 === 1 ? [{ key: 'sy_joint', sev: 'sev_mild', time: '18:00' }] : [],
                water: 5 + (n % 4), walk: 15 + (n % 3) * 10
            };
            logs[k] = { medications: { Morning: true, Afternoon: n % 4 !== 2, Night: n % 5 !== 3 },
                entries: [{ time: '09:00', text: n % 2 ? 'Slight back pain after waking' : 'Felt fine, evening walk done', type: 'health_log' }] };
        }
        const next = new Date(); next.setDate(next.getDate() + 5);
        health.appts.push({ id: 'a-demo', date: key(next), text: 'Dr. Verma — sugar & BP review' });
        write('elderHealthV2:' + id, health);
        write('elderDailyHealthLogs:' + id, logs);
        write('elderMedReminders:' + id, [
            { id: 'r-1', name: 'BP tablet', time: '08:00', firedOn: null, pendingSince: null, familyAsked: false },
            { id: 'r-2', name: 'Diabetes tablet', time: '20:00', firedOn: null, pendingSince: null, familyAsked: false }]);
        localStorage.setItem('elderEmergencyPhone:' + id, 'Dr. Verma (+91 98765 43210)');
        localStorage.setItem('elderFamilyPhone:' + id, '9876501234');
        localStorage.setItem('elderEmergencyAddress:' + id, 'Flat 402, Block B, Indiranagar, Bengaluru');
    }
    async function ensureDemo(email) {
        const demo = own(DEMOS, email);
        const users = read(USERS, {});
        if (!demo || own(users, email)) return;
        const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
        const id = 'u-demo-' + demo.role;
        users[email] = { id, name: demo.name, age: demo.age, role: demo.role, salt, iter: ITERATIONS, hash: await hashPassword(demo.password, salt, ITERATIONS), created: Date.now(), demo: true };
        write(USERS, users);
        if (demo.role === 'adult') seedElderData(id);
    }

    function homeFor(role) { return role === 'adult' ? 'adult.html' : 'helper.html'; }

    /* SIGN UP
       Errors returned here are only about the INPUT (bad email format, weak password...).
       If the email is already registered we do nothing and return the exact same { ok: true }
       as for a brand-new account, so nobody can use this form to find out who has an account. */
    async function signup({ name, email, age, role, password }) {
        email = normEmail(email);
        name = cleanText(name, LIMITS.name);
        age = Number(age);
        password = String(password || '');

        if (name.length < 2) return { ok: false, error: 'Please enter your full name.' };
        if (!EMAIL_RE.test(email)) return { ok: false, error: 'Please enter a valid email address.' };
        if (role !== 'adult' && role !== 'helper') return { ok: false, error: 'Please choose a role.' };
        if (!Number.isInteger(age)) return { ok: false, error: 'Please enter your age as a whole number.' };
        if (role === 'adult' && !(age >= 60 && age <= 120)) return { ok: false, error: 'Elder accounts are for people aged 60 or older.' };
        if (role === 'helper' && !(age >= 18 && age <= 120)) return { ok: false, error: 'Helpers must be 18 or older.' };
        if (password.length > LIMITS.password) return { ok: false, error: `Password must be ${LIMITS.password} characters or fewer.` };
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
            return { ok: false, error: 'Password must be at least 8 characters and include a letter and a number.' };
        }
        if (own(DEMOS, email)) return { ok: true };          // demo addresses are reserved; same reply as any other

        const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await hashPassword(password, salt, ITERATIONS);   // always do the work, so timing is the same either way
        const users = read(USERS, {});
        if (!own(users, email)) {
            users[email] = { id: 'u-' + randomHex(8), name, age, role, salt, iter: ITERATIONS, hash, created: Date.now() };
            write(USERS, users);
        }
        return { ok: true };
    }

    /* LOG IN — one generic error for "no such email" and "wrong password".
       Repeated failures lock that email for 1 minute, then 2, 4 ... up to 30 minutes. */
    async function login(email, password) {
        email = normEmail(email);
        password = String(password || '').slice(0, LIMITS.password);
        if (!EMAIL_RE.test(email) || !password) return { ok: false, error: 'Incorrect email or password.' };

        const fails = read(FAILS, {});
        const rec = isObj(own(fails, email)) ? own(fails, email) : { n: 0, until: 0, locks: 0 };
        if (rec.until > Date.now()) {
            return { ok: false, error: `Too many attempts. Please try again in ${Math.ceil((rec.until - Date.now()) / 1000)} seconds.` };
        }

        await ensureDemo(email);
        const users = read(USERS, {});
        const user = own(users, email);
        const valid = isObj(user) && typeof user.salt === 'string' && typeof user.hash === 'string';
        const iter = valid && Number.isInteger(user.iter) ? user.iter : LEGACY_ITERATIONS;
        const hash = await hashPassword(password, valid ? user.salt : DUMMY_SALT, valid ? iter : ITERATIONS);
        if (!valid || !sameString(hash, user.hash)) {
            rec.n = (rec.n || 0) + 1;
            if (rec.n >= MAX_FAILS) {
                rec.locks = (rec.locks || 0) + 1;
                rec.n = 0;
                rec.until = Date.now() + Math.min(LOCK_MS * 2 ** (rec.locks - 1), 30 * 60 * 1000);
            }
            fails[email] = rec;
            write(FAILS, fails);
            return { ok: false, error: 'Incorrect email or password.' };
        }

        // upgrade an older, weaker hash now that we know the password
        if (iter < ITERATIONS) {
            const salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
            user.salt = salt;
            user.iter = ITERATIONS;
            user.hash = await hashPassword(password, salt, ITERATIONS);
            users[email] = user;
            write(USERS, users);
        }

        delete fails[email];
        write(FAILS, fails);
        sessionStorage.setItem(SESSION, JSON.stringify({ id: user.id, name: user.name, email, age: user.age, role: user.role, exp: Date.now() + SESSION_MS }));
        return { ok: true, role: user.role };
    }

    // Returns the signed-in person for this tab, or null if there is none, it has expired, or it looks tampered with.
    function current() {
        let s;
        try { s = JSON.parse(sessionStorage.getItem(SESSION)); } catch (e) { s = null; }
        const ok = isObj(s) && typeof s.id === 'string' && (s.role === 'adult' || s.role === 'helper') &&
                   typeof s.exp === 'number' && s.exp > Date.now();
        if (!ok) { if (s) sessionStorage.removeItem(SESSION); return null; }
        const u = own(read(USERS, {}), s.email);
        if (!isObj(u) || u.id !== s.id || u.role !== s.role) { sessionStorage.removeItem(SESSION); return null; }
        return s;
    }

    // Call at the top of a dashboard page. Sends visitors to the right place and returns true only if they may stay.
    function guard(role) {
        const s = current();
        if (!s) { location.replace('index.html'); return false; }
        if (s.role !== role) { location.replace(homeFor(s.role)); return false; }
        return true;
    }

    /* SERVER ACCOUNTS
       When the ElderEase server is running, elders sign in there (real accounts, shared with their care circle).
       The older pages (requests, health log, doctor summary) still keep their own data in this browser, so a
       server sign-in also opens a matching local session for them. It holds no password: it cannot be used to
       log in, and it is closed whenever the server says the sign-in has ended. */
    function adoptServer(user) {
        if (!isObj(user) || user.role !== 'elder' || !Number.isInteger(user.id)) return false;
        // kept under its own key, never merged with a browser-only account that happens to use the same email
        const key = 'server:' + user.id, id = 'srv-' + user.id;
        const users = read(USERS, {});
        const first = !own(users, key);
        users[key] = { id, name: cleanText(user.name, LIMITS.name), age: user.age, role: 'adult', serverId: user.id, created: Date.now() };
        if (first && normEmail(user.email) === 'elder.demo@elderease.in') seedElderData(id);   // demo: same sample health log as the browser demo
        write(USERS, users);
        sessionStorage.setItem(SESSION, JSON.stringify({ id, name: users[key].name, email: key, age: user.age, role: 'adult', server: true, serverId: user.id, exp: Date.now() + SESSION_MS }));
        return true;
    }

    function logout() {
        const s = current();
        sessionStorage.removeItem(SESSION);
        if (s && s.server) {
            // end the server sign-in too, and wait for it, or the login page would sign straight back in
            fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ElderEase' }, body: '{}', signal: AbortSignal.timeout(4000) })
                .catch(() => {}).finally(() => location.replace('index.html'));
            return;
        }
        location.replace('index.html');
    }

    // true if this email belongs to a browser-only account on this device (or a built-in demo), so the
    // login page does not send it to the server first and count it as a failed server login
    function isLocal(email) {
        email = normEmail(email);
        const u = own(read(USERS, {}), email);
        return Boolean(own(DEMOS, email)) || (isObj(u) && typeof u.hash === 'string');
    }

    return { signup, login, current, guard, logout, homeFor, adoptServer, isLocal, DEMOS, cleanText };
})();
