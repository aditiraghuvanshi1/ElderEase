'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const N = 32768, R = 8, P = 1, MAXMEM = 128 * 1024 * 1024;   // scrypt, ~32 MB per hash

async function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(pw, salt, 32, { N, r: R, p: P, maxmem: MAXMEM });
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const key = await scrypt(pw, Buffer.from(parts[4], 'base64'), 32, { N: +parts[1], r: +parts[2], p: +parts[3], maxmem: MAXMEM });
    const want = Buffer.from(parts[5], 'base64');
    return want.length === key.length && crypto.timingSafeEqual(key, want);
}
let dummy;
const dummyHash = () => (dummy = dummy || hashPassword('not-a-real-password-' + crypto.randomUUID()));   // so unknown emails cost the same time

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        // no 0/O/1/I, easy to read over the phone
function newInviteCode() {
    let s = '';
    for (const b of crypto.randomBytes(8)) s += ALPHABET[b % ALPHABET.length];
    return s.slice(0, 4) + '-' + s.slice(4);
}
const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function makeLimiter(max, windowMs, nowFn = Date.now) {
    const m = new Map();
    return { hit(key) {
        const t = nowFn(); let e = m.get(key);
        if (!e || e.reset <= t) { e = { count: 0, reset: t + windowMs }; m.set(key, e); }
        e.count += 1;
        if (m.size > 5000) for (const [k, v] of m) if (v.reset <= t) m.delete(k);
        return e.count <= max;
    } };
}
module.exports = { hashPassword, verifyPassword, dummyHash, sha256, newToken, safeEqual, newInviteCode, normCode, makeLimiter };
