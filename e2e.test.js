'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createApp } = require('../src/app');
const { seedDemo } = require('../src/seed');

const T0 = Date.UTC(2026, 10, 16, 2, 0, 0);          // Mon 16 Nov 2026, 07:30 IST
const MIN = 60e3, HR = 3600e3;
let clock = T0;
const sent = [];
const fakeMailer = { provider: 'dev', send: async m => { sent.push(m); return { provider: 'dev', id: '' }; } };
const app = createApp({ dbFile: ':memory:', now: () => clock, mailer: fakeMailer, log() {}, env: { CRON_SECRET: 's3cret', NODE_ENV: 'test', APP_URL: 'http://x.test' } });
let base;

async function api(method, url, body, cookie) {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ElderEase', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json, cookie: set ? set.split(';')[0] : null };
}
const reg = (name, email, role, age, extra = {}) => api('POST', '/api/auth/register', { name, email, role, age, password: 'Passw0rd1', ...extra });
const login = async (email, password = 'Passw0rd1') => (await api('POST', '/api/auth/login', { email, password })).cookie;
const emails = kind => sent.filter(m => m.subject && kind(m));
let elderC, careC, famC, otherC, elderId, medId, doseId;

test.before(async () => { await new Promise(r => app.server.listen(0, r)); base = 'http://127.0.0.1:' + app.server.address().port; });
test.after(async () => { await app.close(); });

test('registration rules and no account enumeration', async () => {
    assert.equal((await reg('Asha Rani', 'asha@x.in', 'elder', 59)).status, 400);
    assert.match((await reg('Asha Rani', 'asha@x.in', 'elder', 59)).json.error, /60 or older/);
    assert.equal((await reg('Kid Kumar', 'kid@x.in', 'family', 17)).status, 400);
    assert.equal((await reg('Bad Pw', 'bad@x.in', 'elder', 70, { password: 'short' })).status, 400);
    const a = await reg('Asha Rani', 'asha@x.in', 'elder', 70);
    const b = await reg('Imposter', 'ASHA@x.in', 'family', 30);        // same email again
    assert.deepEqual(a.json, b.json);                                   // identical reply: no "already exists"
    assert.equal(a.status, b.status);
    assert.equal((await api('POST', '/api/auth/login', { email: 'asha@x.in', password: 'Passw0rd1' })).json.user.role, 'elder');   // imposter did not replace her
    await reg('Meena Joshi', 'meena@x.in', 'caretaker', 34);
    await reg('Arjun', 'arjun@x.in', 'family', 40);
    await reg('Other Elder', 'other@x.in', 'elder', 75);
    elderC = await login('asha@x.in'); careC = await login('meena@x.in'); famC = await login('arjun@x.in'); otherC = await login('other@x.in');
    elderId = (await api('GET', '/api/me', null, elderC)).json.user.id;
    assert.ok(elderC && careC && famC);
});

test('login: generic error, lockout, session required, CSRF header required', async () => {
    const wrong = await api('POST', '/api/auth/login', { email: 'asha@x.in', password: 'nope-nope1' });
    const nobody = await api('POST', '/api/auth/login', { email: 'nobody@x.in', password: 'nope-nope1' });
    assert.equal(wrong.status, 401); assert.deepEqual(wrong.json, nobody.json);
    for (let i = 0; i < 4; i++) await api('POST', '/api/auth/login', { email: 'lock@x.in', password: 'x' + i });
    assert.equal((await api('POST', '/api/auth/login', { email: 'lock@x.in', password: 'x5' })).status, 401);
    assert.equal((await api('POST', '/api/auth/login', { email: 'lock@x.in', password: 'x6' })).status, 429);
    assert.equal((await api('GET', '/api/me')).status, 401);
    const noHeader = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(noHeader.status, 403);
});

test('passcodes link family and caretakers; roles are enforced', async () => {
    assert.equal((await api('POST', '/api/care/invites', { role: 'family' }, famC)).status, 403);      // only elders create passcodes
    const fam = (await api('POST', '/api/care/invites', { role: 'family' }, elderC)).json.code;
    const care = (await api('POST', '/api/care/invites', { role: 'caretaker' }, elderC)).json.code;
    assert.match(fam, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal((await api('POST', '/api/care/join', { code: fam }, careC)).status, 400);            // family code on a caretaker account
    assert.equal((await api('POST', '/api/care/join', { code: 'AAAA-AAAA' }, famC)).status, 400);
    assert.equal((await api('POST', '/api/care/join', { code: fam }, famC)).status, 200);
    assert.equal((await api('POST', '/api/care/join', { code: fam }, famC)).status, 400);            // single use
    assert.equal((await api('POST', '/api/care/join', { code: care }, careC)).status, 200);
    const circle = (await api('GET', '/api/care/circle', null, elderC)).json;
    assert.equal(circle.members.length, 2);
    assert.equal((await api('GET', `/api/elders/${elderId}/overview`, null, otherC)).status, 404);   // a different elder sees nothing
    assert.equal((await api('GET', `/api/elders/${elderId}/overview`, null, famC)).status, 200);
});

test('medicines: caretaker may edit, family may not; doses are materialised', async () => {
    const body = { name: 'Metformin<script>', dose: '500 mg', times: ['08:00'] };
    assert.equal((await api('POST', `/api/elders/${elderId}/medications`, body, famC)).status, 403);
    const r = await api('POST', `/api/elders/${elderId}/medications`, body, careC);
    assert.equal(r.status, 200);
    assert.ok(!r.json.medications[0].name.includes('<'));
    medId = r.json.medications[0].id;
    assert.equal((await api('POST', `/api/elders/${elderId}/medications`, { name: 'X', times: ['25:00'] }, careC)).status, 400);
    const ov = (await api('GET', `/api/elders/${elderId}/overview`, null, famC)).json;
    assert.equal(ov.doses.length, 1); assert.equal(ov.doses[0].status, 'pending');
    doseId = ov.doses[0].id;
});

test('scheduler: upcoming reminder, then missed alert to the whole circle, each sent once', async () => {
    clock = T0 + 50 * MIN;                                   // 08:20 IST? no: 07:30 + 50 = 08:20 -> too late; so go back
    clock = Date.UTC(2026, 10, 16, 2, 20);                   // 07:50 IST, 10 min before 08:00
    await app.worker.tick(clock);
    const up = emails(m => /^Reminder:/.test(m.subject));
    assert.equal(up.length, 1); assert.equal(up[0].to, 'asha@x.in');
    await app.worker.tick(clock);
    assert.equal(emails(m => /^Reminder:/.test(m.subject)).length, 1);                    // restart-safe: no duplicate

    clock = Date.UTC(2026, 10, 16, 3, 45);                   // 09:15 IST, 75 min after
    const s = await app.worker.tick(clock);
    assert.equal(s.missed, 1);
    const miss = emails(m => /^Missed dose/.test(m.subject));
    assert.deepEqual(miss.map(m => m.to).sort(), ['arjun@x.in', 'asha@x.in', 'meena@x.in']);
    assert.ok(miss[0].html.includes('Metformin') && !miss[0].html.includes('<script>'));
    await app.worker.tick(clock);
    assert.equal(emails(m => /^Missed dose/.test(m.subject)).length, 3);
    const adh = (await api('GET', `/api/elders/${elderId}/adherence?days=7`, null, famC)).json;
    assert.equal(adh.totals.missed, 1); assert.equal(adh.totals.rate, 0);
});

test('dose logging: audit trail, late "taken", view-only family blocked', async () => {
    assert.equal((await api('POST', `/api/doses/${doseId}/mark`, { status: 'taken' }, famC)).status, 403);
    assert.equal((await api('POST', `/api/doses/${doseId}/mark`, { status: 'taken' }, otherC)).status, 404);
    assert.equal((await api('POST', `/api/doses/${doseId}/mark`, { status: 'dancing' }, careC)).status, 400);
    assert.equal((await api('POST', `/api/doses/${doseId}/mark`, { status: 'taken', note: 'took it with lunch' }, careC)).status, 200);
    const dose = (await api('GET', `/api/elders/${elderId}/doses`, null, elderC)).json.doses[0];
    assert.equal(dose.status, 'taken'); assert.equal(dose.acted_by_name, 'Meena Joshi'); assert.ok(dose.acted_at);
    const audit = app.db.prepare('SELECT old_status, new_status FROM dose_audit WHERE dose_id = ? ORDER BY id').all(doseId);
    assert.deepEqual(audit.map(a => a.old_status + '>' + a.new_status), ['pending>missed', 'missed>taken']);   // history kept
    const tomorrow = (await api('GET', `/api/elders/${elderId}/overview`, null, elderC)).json;
    assert.equal(tomorrow.week.taken, 1);
});

test('appointments: validated, 24 h and 2 h reminders to the circle, once each', async () => {
    assert.equal((await api('POST', `/api/elders/${elderId}/appointments`, { title: 'Past', starts_local: '2020-01-01T10:00' }, careC)).status, 400);
    assert.equal((await api('POST', `/api/elders/${elderId}/appointments`, { title: 'X', starts_local: '2026-11-17T11:00' }, famC)).status, 403);
    const r = await api('POST', `/api/elders/${elderId}/appointments`, { title: 'Eye check', doctor: 'Dr. Rao', starts_local: '2026-11-17T11:00' }, careC);   // 11:00 IST = 05:30Z
    assert.equal(r.status, 200); assert.equal(r.json.appointments[0].local, 'Tue 17 Nov, 11:00');
    clock = Date.UTC(2026, 10, 16, 6, 0);                    // 11:30 IST Monday: 23.5 h before
    await app.worker.tick(clock); await app.worker.tick(clock);
    assert.equal(emails(m => /^Appointment tomorrow/.test(m.subject)).length, 3);
    clock = Date.UTC(2026, 10, 17, 4, 0);                    // 09:30 IST Tuesday: 1.5 h before
    await app.worker.tick(clock);
    assert.equal(emails(m => /^Appointment in 2 hours/.test(m.subject)).length, 3);
});

test('digests: caretaker daily, family weekly (Sunday morning)', async () => {
    clock = Date.UTC(2026, 10, 17, 14, 45);                  // Tue 20:15 IST
    await app.worker.tick(clock);
    const daily = emails(m => /daily summary/.test(m.subject));
    assert.deepEqual(daily.map(m => m.to), ['meena@x.in']);
    clock = Date.UTC(2026, 10, 22, 4, 0);                    // Sun 22 Nov 09:30 IST
    await app.worker.tick(clock);
    const weekly = emails(m => /weekly summary/.test(m.subject));
    assert.deepEqual(weekly.map(m => m.to), ['arjun@x.in']);
    assert.match(weekly[0].text, /Missed doses|taken/);
    const manual = await api('POST', `/api/elders/${elderId}/digest/send`, { days: 7 }, famC);
    assert.equal(manual.json.ok, true);
    const mine = (await api('GET', '/api/notifications', null, famC)).json.notifications;
    assert.ok(mine.some(n => n.kind === 'digest_manual') && mine.some(n => n.kind === 'dose_missed'));
});

test('live sync: a dose change reaches a connected family member', async () => {
    const ac = new AbortController();
    const res = await fetch(`${base}/api/elders/${elderId}/stream`, { headers: { Cookie: famC }, signal: ac.signal });
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body.getReader();
    await reader.read();                                       // retry hint
    clock = Date.UTC(2026, 10, 22, 5, 0);
    const d = (await api('GET', `/api/elders/${elderId}/overview`, null, elderC)).json.doses[0];
    const got = (async () => { let buf = ''; for (;;) { const { value } = await reader.read(); buf += Buffer.from(value).toString(); if (buf.includes('event: dose')) return buf; } })();
    await api('POST', `/api/doses/${d.id}/mark`, { status: 'skipped' }, elderC);
    assert.match(await got, /"status":"skipped"/);
    ac.abort();
    assert.equal((await api('GET', `/api/elders/${elderId}/stream`, null, otherC)).status, 404);
});

test('revoking access, cron endpoint, static files', async () => {
    const link = (await api('GET', '/api/care/circle', null, elderC)).json.members.find(m => m.email === 'arjun@x.in').link_id;
    assert.equal((await api('DELETE', `/api/care/links/${link}`, null, otherC)).status, 404);
    assert.equal((await api('DELETE', `/api/care/links/${link}`, null, elderC)).status, 200);
    assert.equal((await api('GET', `/api/elders/${elderId}/overview`, null, famC)).status, 404);
    assert.equal((await api('POST', '/api/cron/tick', {})).status, 404);
    const ok = await fetch(base + '/api/cron/tick', { method: 'POST', headers: { 'x-cron-secret': 's3cret' } });
    assert.equal(ok.status, 200);
    const page = await fetch(base + '/adult.html');
    assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(base + '/..%2fserver%2fsrc%2fdb.js')).status, 404);
    assert.equal((await fetch(base + '/.env')).status, 404);
});

test('demo seed gives a realistic history', async () => {
    const a2 = createApp({ dbFile: ':memory:', now: () => T0 + 6 * HR, mailer: fakeMailer, log() {} });
    await seedDemo(a2.db, T0 + 6 * HR);
    const elder = a2.db.prepare("SELECT id, name, tz_offset_min FROM users WHERE role = 'elder'").get();
    const d = require('../src/digest').buildDigest(a2.db, elder, 14, T0 + 6 * HR);
    assert.ok(d.totals.taken > 30 && d.totals.missed >= 2 && d.totals.rate > 70 && d.totals.rate < 100, JSON.stringify(d.totals));
    await a2.close();
});
