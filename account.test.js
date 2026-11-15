'use strict';
/* Password reset, data export, account deletion, and real SMTP delivery (against a local test mail server). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMailer } = require('../src/mailer');

const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);
const MIN = 60e3;
let clock = T0;
const sent = [];
const fakeMailer = { provider: 'dev', send: async m => { sent.push(m); return { provider: 'dev', id: '' }; } };
const app = createApp({ dbFile: ':memory:', now: () => clock, mailer: fakeMailer, log() {}, env: { NODE_ENV: 'test', APP_URL: 'http://x.test' } });
let base;

async function api(method, url, body, cookie) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ElderEase', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json, cookie: set ? set.split(';')[0] : null, headers: res.headers };
}
const reg = (name, email, role, age, password = 'Passw0rd1') => api('POST', '/api/auth/register', { name, email, role, age, password });
const login = async (email, password = 'Passw0rd1') => (await api('POST', '/api/auth/login', { email, password })).cookie;
const settle = () => new Promise(r => setTimeout(r, 30));            // reset emails are sent in the background
const tokenFrom = m => /#t=([A-Za-z0-9_-]+)/.exec(m.text)[1];

test.before(async () => { await new Promise(r => app.server.listen(0, r)); base = 'http://127.0.0.1:' + app.server.address().port; });
test.after(async () => { await app.close(); });

test('forgot password: same reply for every email, link works once, signs out every device', async () => {
    await reg('Kamala Iyer', 'kamala@x.in', 'elder', 72);
    const oldSession = await login('kamala@x.in');
    assert.ok(oldSession);
    const anon = await api('GET', '/api/session');
    assert.equal(anon.status, 200); assert.equal(anon.json.user, null);                 // quiet check: no 401 when signed out
    assert.equal((await api('GET', '/api/session', null, oldSession)).json.user.email, 'kamala@x.in');

    const known = await api('POST', '/api/auth/forgot', { email: 'kamala@x.in' });
    const unknown = await api('POST', '/api/auth/forgot', { email: 'nobody@x.in' });
    const junk = await api('POST', '/api/auth/forgot', { email: 'not an email' });
    assert.equal(known.status, 200);
    assert.deepEqual(known.json, unknown.json);                    // no way to tell who has an account
    assert.deepEqual(known.json, junk.json);
    await settle();
    const mails = sent.filter(m => m.subject === 'Reset your ElderEase password');
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'kamala@x.in');
    const token = tokenFrom(mails[0]);
    assert.match(mails[0].text, /^[\s\S]*http:\/\/x\.test\/reset\.html#t=/);

    // the email log keeps a copy without the link, so the database never holds a working reset link
    const logged = app.db.prepare("SELECT body_text, body_html FROM email_log WHERE kind = 'password_reset'").get();
    assert.ok(!logged.body_text.includes(token) && !logged.body_html.includes(token));
    assert.match(logged.body_text, /link removed/);
    // the stored value is a hash, never the token itself
    const row = app.db.prepare('SELECT token_hash FROM password_resets').get();
    assert.notEqual(row.token_hash, token);
    assert.equal(row.token_hash.length, 64);

    assert.equal((await api('POST', '/api/auth/reset', { token, password: 'short' })).status, 400);
    assert.equal((await api('POST', '/api/auth/reset', { token: 'x'.repeat(43), password: 'NewPassw0rd' })).status, 400);
    assert.equal((await api('POST', '/api/auth/reset', { token, password: 'NewPassw0rd' })).status, 200);
    assert.equal((await api('POST', '/api/auth/reset', { token, password: 'Another1pass' })).status, 400);   // single use

    assert.equal((await api('GET', '/api/me', null, oldSession)).status, 401);            // old devices signed out
    assert.equal(await login('kamala@x.in'), null);                                        // old password gone
    assert.ok(await login('kamala@x.in', 'NewPassw0rd'));
    await settle();
    assert.equal(sent.filter(m => m.subject === 'Your ElderEase password was changed').length, 1);
});

test('forgot password: links expire, only the newest works, and requests are rate limited', async () => {
    await api('POST', '/api/auth/forgot', { email: 'kamala@x.in' }); await settle();
    const first = tokenFrom(sent.filter(m => m.subject === 'Reset your ElderEase password').at(-1));
    await api('POST', '/api/auth/forgot', { email: 'kamala@x.in' }); await settle();
    const second = tokenFrom(sent.filter(m => m.subject === 'Reset your ElderEase password').at(-1));
    assert.notEqual(first, second);
    assert.equal((await api('POST', '/api/auth/reset', { token: first, password: 'NewPassw0rd2' })).status, 400);    // replaced by the newer link
    clock += 31 * MIN;
    assert.equal((await api('POST', '/api/auth/reset', { token: second, password: 'NewPassw0rd2' })).status, 400);   // expired

    const before = sent.length;
    await api('POST', '/api/auth/forgot', { email: 'kamala@x.in' }); await settle();          // 4th request for this email this hour
    assert.equal(sent.length, before);                                                         // quietly not sent
});

test('export: everything about you, nothing secret', async () => {
    await reg('Gopal Rao', 'gopal@x.in', 'elder', 80);
    await reg('Lata Rao', 'lata@x.in', 'caretaker', 45);
    const elder = await login('gopal@x.in'), care = await login('lata@x.in');
    const code = (await api('POST', '/api/care/invites', { role: 'caretaker' }, elder)).json.code;
    await api('POST', '/api/care/join', { code }, care);
    const elderId = (await api('GET', '/api/me', null, elder)).json.user.id;
    await api('POST', `/api/elders/${elderId}/medications`, { name: 'Metformin', dose: '500 mg', times: ['08:00', '20:00'] }, care);

    const r = await api('GET', '/api/me/export', null, elder);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="elderease-data-\d{4}-\d{2}-\d{2}\.json"/);
    assert.equal(r.json.account.email, 'gopal@x.in');
    assert.equal(r.json.medications[0].name, 'Metformin');
    assert.ok(Array.isArray(r.json.doses) && r.json.doses.length > 0);
    assert.equal(r.json.care_links[0].member_name, 'Lata Rao');
    const flat = JSON.stringify(r.json);
    assert.ok(!flat.includes('pass_hash') && !flat.includes('scrypt$') && !flat.includes('token'));
    assert.equal((await api('GET', '/api/me/export')).status, 401);
});

test('delete account: needs password + DELETE, removes the elder and every trace, others keep working', async () => {
    const elder = await login('gopal@x.in'), care = await login('lata@x.in');
    const elderId = (await api('GET', '/api/me', null, elder)).json.user.id;
    const careId = (await api('GET', '/api/me', null, care)).json.user.id;
    // the caretaker marks a dose, so other rows point at her
    const dose = (await api('GET', `/api/elders/${elderId}/overview`, null, care)).json.doses.find(d => d.status === 'pending');
    clock = Date.parse(dose.due_at);
    assert.equal((await api('POST', `/api/doses/${dose.id}/mark`, { status: 'taken' }, care)).status, 200);
    app.db.prepare("INSERT INTO email_log(dedupe_key, to_user_id, to_email, elder_id, kind, subject, body_text, body_html, created_at) VALUES ('t1', ?, 'lata@x.in', ?, 'dose_missed', 's', 'b', 'b', 'now')").run(careId, elderId);

    assert.equal((await api('POST', '/api/me/delete', { password: 'Passw0rd1' }, care)).status, 400);                       // no DELETE
    assert.equal((await api('POST', '/api/me/delete', { password: 'wrong-pass1', confirm: 'DELETE' }, care)).status, 403);

    // a caretaker deleting herself: the elder's dose history survives, just without her name
    const c = await api('POST', '/api/me/delete', { password: 'Passw0rd1', confirm: 'DELETE' }, care);
    assert.equal(c.status, 200);
    assert.match(c.cookie, /ee_session=$/);
    assert.equal((await api('GET', '/api/me', null, care)).status, 401);
    const hist = (await api('GET', `/api/elders/${elderId}/doses?date=${dose.local_date}`, null, elder)).json.doses.find(d => d.id === dose.id);
    assert.equal(hist.status, 'taken');
    assert.equal(hist.acted_by_name, null);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE to_user_id = ?').get(careId).n, 0);

    // the elder deleting herself takes all her health records with her
    assert.equal((await api('POST', '/api/me/delete', { password: 'Passw0rd1', confirm: 'DELETE' }, elder)).status, 200);
    for (const t of ['medications', 'dose_events', 'appointments', 'care_links', 'invites']) {
        assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE elder_id = ?`).get(elderId).n, 0, t);
    }
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE elder_id = ?').get(elderId).n, 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id IN (?, ?)').get(elderId, careId).n, 0);
    assert.equal(await login('gopal@x.in'), null);
    assert.ok(await login('kamala@x.in', 'NewPassw0rd'));                    // nobody else affected
});

test('SMTP: a reminder is really delivered through a mail server (STARTTLS + login)', async () => {
    const { SMTPServer } = require('smtp-server');
    const got = [];
    const server = new SMTPServer({
        authOptional: false,
        onAuth(auth, session, cb) { cb(auth.username === 'bot@x.in' && auth.password === 'app-pass' ? null : new Error('bad login'), { user: auth.username }); },
        onData(stream, session, cb) { let raw = ''; stream.on('data', c => { raw += c; }); stream.on('end', () => { got.push({ raw, secure: session.secure, user: session.user }); cb(); }); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.server.address().port;
    const mailer = createMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'bot@x.in', SMTP_PASS: 'app-pass', SMTP_TLS_INSECURE: '1' });
    assert.equal(mailer.provider, 'smtp');
    const r = await mailer.send({ to: 'family@x.in', subject: 'Missed dose: Metformin', text: 'Please check in.', html: '<p>Please check in.</p>' });
    assert.equal(r.provider, 'smtp');
    assert.equal(got.length, 1);
    assert.equal(got[0].secure, true);                 // upgraded to TLS before the password was sent
    assert.equal(got[0].user, 'bot@x.in');
    assert.match(got[0].raw, /Subject: Missed dose: Metformin/);
    assert.match(got[0].raw, /From: ElderEase <bot@x\.in>/);

    const wrong = createMailer({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_USER: 'bot@x.in', SMTP_PASS: 'nope', SMTP_TLS_INSECURE: '1' });
    await assert.rejects(wrong.send({ to: 'a@x.in', subject: 's', text: 't', html: 'h' }));
    mailer.close(); wrong.close();
    await new Promise(r => server.close(r));
});
