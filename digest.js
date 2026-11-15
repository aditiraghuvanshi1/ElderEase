'use strict';
const U = require('./util');

/* One function feeds the dashboard, the API and the emailed summaries.
   "rate" = taken / (taken + skipped + missed). Doses that are still pending are not counted against anyone. */
function buildDigest(db, elder, days, nowMs) {
    const off = elder.tz_offset_min;
    const today = U.localParts(nowMs, off).date;
    const from = U.addDays(today, -(days - 1));
    const rows = db.prepare(`SELECT d.id, d.local_date, d.hhmm, d.status, d.acted_at, m.name, m.dose
        FROM dose_events d JOIN medications m ON m.id = d.medication_id
        WHERE d.elder_id = ? AND d.local_date BETWEEN ? AND ? ORDER BY d.due_at`).all(elder.id, from, today);

    const blank = () => ({ taken: 0, skipped: 0, missed: 0, pending: 0 });
    const totals = blank(), perDay = {}, perMed = {}, missedList = [];
    for (let i = 0; i < days; i++) perDay[U.addDays(from, i)] = blank();
    for (const r of rows) {
        totals[r.status]++;
        perDay[r.local_date][r.status]++;
        const k = r.name + '|' + r.dose;
        (perMed[k] = perMed[k] || { name: r.name, dose: r.dose, ...blank() })[r.status]++;
        if (r.status === 'missed') missedList.push({ name: r.name, dose: r.dose, date: r.local_date, hhmm: r.hhmm });
    }
    const rate = o => { const c = o.taken + o.skipped + o.missed; return c ? Math.round(100 * o.taken / c) : null; };
    const days_ = Object.keys(perDay).map(date => ({ date, ...perDay[date], rate: rate(perDay[date]) }));
    let perfectDays = 0;                                   // consecutive fully-taken days, counting back from the latest finished day
    for (let i = days_.length - 1; i >= 0; i--) {
        const d = days_[i];
        if (d.date === today && d.pending > 0) continue;
        if (d.taken + d.skipped + d.missed > 0 && d.skipped + d.missed === 0) perfectDays++; else if (d.taken + d.skipped + d.missed > 0) break;
    }
    const appts = db.prepare(`SELECT id, title, doctor, location, starts_at FROM appointments
        WHERE elder_id = ? AND cancelled = 0 AND starts_at >= ? AND starts_at <= ? ORDER BY starts_at`)
        .all(elder.id, U.iso(nowMs), U.iso(nowMs + 14 * 864e5))
        .map(a => ({ ...a, local: U.fmtLocal(Date.parse(a.starts_at), off) }));
    return {
        elder: { id: elder.id, name: elder.name }, days, from, to: today,
        totals: { ...totals, scheduled: rows.length, rate: rate(totals) },
        perDay: days_, perMed: Object.values(perMed).map(m => ({ ...m, rate: rate(m) })),
        missed: missedList, appointments: appts, perfectDays
    };
}
module.exports = { buildDigest };
