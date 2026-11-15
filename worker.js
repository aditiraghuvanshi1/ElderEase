'use strict';
const U = require('./util');
const T = require('./templates');
const { buildDigest } = require('./digest');

/* Makes sure every scheduled dose for today and tomorrow exists as a row. Safe to call any number of times. */
function materializeForElder(db, elder, nowMs) {
    const meds = db.prepare('SELECT id, days, created_at FROM medications WHERE elder_id = ? AND active = 1').all(elder.id);
    if (!meds.length) return 0;
    const times = db.prepare('SELECT hhmm FROM med_times WHERE medication_id = ?');
    const ins = db.prepare("INSERT OR IGNORE INTO dose_events(elder_id, medication_id, hhmm, due_at, local_date, status) VALUES (?, ?, ?, ?, ?, 'pending')");
    const today = U.localParts(nowMs, elder.tz_offset_min).date;
    let n = 0;
    for (const date of [today, U.addDays(today, 1)]) {
        const dow = U.dowOf(date);
        for (const m of meds) {
            if (m.days[dow] !== '1') continue;
            const createdMs = Date.parse(m.created_at);
            for (const t of times.all(m.id)) {
                const due = U.localToUtcMs(date, t.hhmm, elder.tz_offset_min);
                if (due < createdMs) continue;                      // a medicine added at 3 pm doesn't owe you the 8 am dose
                n += Number(ins.run(elder.id, m.id, t.hhmm, U.iso(due), date).changes);
            }
        }
    }
    return n;
}

function createWorker({ db, mailer, now, cfg, publish, log }) {
    const circle = (elderId, includeElder) => {
        const members = db.prepare(`SELECT u.id, u.name, u.email, u.role FROM users u JOIN care_links l ON l.member_id = u.id
            WHERE l.elder_id = ? AND u.email_reminders = 1`).all(elderId);
        if (includeElder) {
            const e = db.prepare('SELECT id, name, email, role FROM users WHERE id = ? AND email_reminders = 1').get(elderId);
            if (e) members.unshift(e);
        }
        return members;
    };

    async function deliver(row) {
        try {
            const r = await mailer.send({ to: row.to_email, subject: row.subject, text: row.body_text, html: row.body_html });
            db.prepare('UPDATE email_log SET status = ?, sent_at = ?, provider_id = ?, attempts = attempts + 1, error = NULL WHERE id = ?')
                .run(r.provider === 'dev' ? 'dev' : 'sent', U.iso(now()), r.id || r.provider, row.id);
            return true;
        } catch (e) {
            db.prepare("UPDATE email_log SET status = 'failed', attempts = attempts + 1, error = ? WHERE id = ?").run(String(e.message).slice(0, 300), row.id);
            log('mail failed:', e.message);
            return false;
        }
    }

    // Writes the email to the log first (UNIQUE dedupe_key), and only sends if that row is new.
    async function queue({ key, user, elderId, kind, mail }) {
        const r = db.prepare(`INSERT OR IGNORE INTO email_log(dedupe_key, to_user_id, to_email, elder_id, kind, subject, body_text, body_html, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key, user.id, user.email, elderId, kind, mail.subject, mail.text, mail.html, U.iso(now()));
        if (!Number(r.changes)) return false;
        await deliver(db.prepare('SELECT * FROM email_log WHERE id = ?').get(r.lastInsertRowid));
        return true;
    }

    // For messages that carry a secret (password reset links): send the real message, but keep only a copy
    // with the secret removed in email_log, and never retry it from the log.
    async function sendSecret({ key, user, kind, mail, logged }) {
        const r = db.prepare(`INSERT OR IGNORE INTO email_log(dedupe_key, to_user_id, to_email, elder_id, kind, subject, body_text, body_html, attempts, created_at)
            VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 3, ?)`).run(key, user.id, user.email, kind, logged.subject, logged.text, logged.html, U.iso(now()));
        if (!Number(r.changes)) return false;
        try {
            const res = await mailer.send({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
            db.prepare('UPDATE email_log SET status = ?, sent_at = ?, provider_id = ? WHERE id = ?').run(res.provider === 'dev' ? 'dev' : 'sent', U.iso(now()), res.id || res.provider, r.lastInsertRowid);
            return true;
        } catch (e) {
            db.prepare("UPDATE email_log SET status = 'failed', error = ? WHERE id = ?").run(String(e.message).slice(0, 300), r.lastInsertRowid);
            log('mail failed:', e.message);
            return false;
        }
    }

    async function tick(nowMs = now()) {
        const stats = { materialized: 0, missed: 0, upcoming: 0, appointments: 0, digests: 0, retried: 0 };
        const elders = db.prepare("SELECT id, name, email, tz_offset_min FROM users WHERE role = 'elder'").all();
        for (const e of elders) stats.materialized += materializeForElder(db, e, nowMs);

        // 1. doses that are due soon -> reminder to the elder
        const soon = db.prepare(`SELECT d.id, d.elder_id, d.hhmm, m.name AS med, m.dose FROM dose_events d JOIN medications m ON m.id = d.medication_id
            WHERE d.status = 'pending' AND d.due_at > ? AND d.due_at <= ?`).all(U.iso(nowMs), U.iso(nowMs + cfg.leadMin * 60000));
        for (const d of soon) {
            const el = db.prepare('SELECT id, name, email FROM users WHERE id = ? AND email_reminders = 1').get(d.elder_id);
            if (el && await queue({ key: `upcoming:${d.id}:${el.id}`, user: el, elderId: el.id, kind: 'dose_upcoming', mail: T.doseUpcoming({ med: d.med, dose: d.dose, hhmm: d.hhmm, elderName: el.name }, cfg.appUrl) })) stats.upcoming++;
        }

        // 2. pending past the grace period -> missed, and tell the elder + whole circle
        const late = db.prepare(`SELECT d.id, d.elder_id, d.hhmm, d.local_date, d.due_at, m.name AS med, m.dose, u.name AS elder_name
            FROM dose_events d JOIN medications m ON m.id = d.medication_id JOIN users u ON u.id = d.elder_id
            WHERE d.status = 'pending' AND d.due_at <= ?`).all(U.iso(nowMs - cfg.graceMin * 60000));
        for (const d of late) {
            db.prepare("UPDATE dose_events SET status = 'missed' WHERE id = ? AND status = 'pending'").run(d.id);
            db.prepare("INSERT INTO dose_audit(dose_id, old_status, new_status, by_user, at) VALUES (?, 'pending', 'missed', NULL, ?)").run(d.id, U.iso(nowMs));
            stats.missed++;
            publish(d.elder_id, 'dose', { id: d.id, status: 'missed' });
            if (Date.parse(d.due_at) < nowMs - 12 * 3600e3) continue;      // old backlog (server was off): record it, don't spam
            for (const r of circle(d.elder_id, true)) {
                await queue({ key: `missed:${d.id}:${r.id}`, user: r, elderId: d.elder_id, kind: 'dose_missed',
                    mail: T.doseMissed({ med: d.med, dose: d.dose, date: d.local_date, hhmm: d.hhmm, elderName: d.elder_name }, r.name, cfg.appUrl) });
            }
        }

        // 3. appointments: one email ~24 h before, one ~2 h before
        const appts = db.prepare(`SELECT a.id, a.elder_id, a.title, a.doctor, a.location, a.starts_at, u.name AS elder_name, u.tz_offset_min
            FROM appointments a JOIN users u ON u.id = a.elder_id WHERE a.cancelled = 0 AND a.starts_at > ? AND a.starts_at <= ?`)
            .all(U.iso(nowMs), U.iso(nowMs + 24 * 3600e3));
        for (const a of appts) {
            const kind = Date.parse(a.starts_at) - nowMs <= 2 * 3600e3 ? 'appt_2h' : 'appt_24h';
            const local = U.fmtLocal(Date.parse(a.starts_at), a.tz_offset_min);
            for (const r of circle(a.elder_id, true)) {
                if (await queue({ key: `${kind}:${a.id}:${r.id}`, user: r, elderId: a.elder_id, kind, mail: T.appointment({ kind, a, elderName: a.elder_name, local }, r.name, cfg.appUrl) })) stats.appointments++;
            }
        }

        // 4. digests for caretakers / family, at the elder's local evening (daily) or Sunday morning (weekly)
        const links = db.prepare(`SELECT l.elder_id, u.id, u.name, u.email, u.digest, e.name AS elder_name, e.tz_offset_min
            FROM care_links l JOIN users u ON u.id = l.member_id JOIN users e ON e.id = l.elder_id
            WHERE u.digest != 'off' AND u.email_reminders = 1`).all();
        for (const l of links) {
            const lp = U.localParts(nowMs, l.tz_offset_min), hour = Number(lp.hhmm.slice(0, 2));
            let days = 0;
            if (l.digest === 'daily' && hour >= cfg.dailyHour) days = 1;
            if (l.digest === 'weekly' && lp.dow === 0 && hour >= cfg.weeklyHour) days = 7;
            if (!days) continue;
            const d = buildDigest(db, { id: l.elder_id, name: l.elder_name, tz_offset_min: l.tz_offset_min }, days, nowMs);
            if (!d.totals.scheduled && !d.appointments.length) continue;
            if (await queue({ key: `digest:${l.digest}:${l.id}:${l.elder_id}:${lp.date}`, user: l, elderId: l.elder_id, kind: 'digest_' + l.digest, mail: T.digest(d, l.name, cfg.appUrl) })) stats.digests++;
        }

        // 5. retry emails that failed (max 3 tries, last 24 h)
        const failed = db.prepare("SELECT * FROM email_log WHERE status = 'failed' AND attempts < 3 AND created_at > ?").all(U.iso(nowMs - 24 * 3600e3));
        for (const row of failed) if (await deliver(row)) stats.retried++;

        db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(U.iso(nowMs));
        return stats;
    }
    return { tick, deliver, queue, sendSecret, circle };
}
module.exports = { createWorker, materializeForElder };
