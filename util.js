'use strict';
const pad = n => String(n).padStart(2, '0');
const iso = ms => new Date(ms).toISOString();
// "local" = the elder's wall clock, expressed as minutes east of UTC (India = 330).
const localParts = (ms, off) => {
    const d = new Date(ms + off * 60000);
    return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hhmm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, dow: d.getUTCDay() };
};
const localToUtcMs = (date, hhmm, off) => {
    const [y, m, d] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
    return Date.UTC(y, m - 1, d, h, mi) - off * 60000;
};
const addDays = (date, n) => {
    const [y, m, d] = date.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const dowOf = date => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtLocal = (ms, off) => { const d = new Date(ms + off * 60000); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const fmtDate = date => { const [y, m, d] = date.split('-').map(Number); return `${DAYS[dowOf(date)]} ${d} ${MONTHS[m - 1]}`; };
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
const isTime = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
module.exports = { pad, iso, localParts, localToUtcMs, addDays, dowOf, fmtLocal, fmtDate, clean, EMAIL_RE, isTime, isDate, esc, HttpError };
