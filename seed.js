'use strict';
const U = require('./util');
const sec = require('./security');
const { materializeForElder } = require('./worker');

/* Demo circle: an elder, her caretaker and her son (family), with 14 days of realistic dose history. Safe to run twice. */
async function seedDemo(db, nowMs) {
    if (db.prepare("SELECT 1 FROM users WHERE email = 'elder.demo@elderease.in'").get()) return false;
    const iso = U.iso, off = 330, created = iso(nowMs - 15 * 864e5);
    const mk = async (email, name, role, age, pw, digest) => Number(db.prepare('INSERT INTO users(email, name, role, age, pass_hash, digest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(email, name, role, age, await sec.hashPassword(pw), digest, created).lastInsertRowid);
    const elder = await mk('elder.demo@elderease.in', 'Savitri Devi', 'elder', 68, 'Elder@123', 'off');
    const care = await mk('caretaker.demo@elderease.in', 'Meena Joshi', 'caretaker', 34, 'Care@1234', 'daily');
    const fam = await mk('family.demo@elderease.in', 'Arjun Devi', 'family', 41, 'Family@123', 'weekly');
    for (const [id, role] of [[care, 'caretaker'], [fam, 'family']]) db.prepare('INSERT INTO care_links(elder_id, member_id, role, created_at) VALUES (?, ?, ?, ?)').run(elder, id, role, created);

    const meds = [['Metformin', '500 mg', ['08:00', '20:00']], ['Amlodipine', '5 mg', ['08:00']], ['Vitamin D3', '1 capsule', ['14:00']]];
    const medIds = {};
    for (const [name, dose, times] of meds) {
        const id = Number(db.prepare('INSERT INTO medications(elder_id, name, dose, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(elder, name, dose, care, created).lastInsertRowid);
        for (const t of times) db.prepare('INSERT INTO med_times(medication_id, hhmm) VALUES (?, ?)').run(id, t);
        medIds[name] = { id, times };
    }
    const today = U.localParts(nowMs, off).date;
    for (let i = 14; i >= 0; i--) {
        const date = U.addDays(today, -i);
        for (const [name, m] of Object.entries(medIds)) for (const hhmm of m.times) {
            const due = U.localToUtcMs(date, hhmm, off);
            if (due > nowMs) continue;
            let status = 'taken';
            if (i > 0) {
                if (name === 'Metformin' && hhmm === '20:00' && i % 5 === 2) status = 'missed';
                if (name === 'Amlodipine' && i === 4) status = 'missed';
                if (name === 'Vitamin D3' && i % 6 === 3) status = 'skipped';
            }
            const acted = status === 'missed' ? null : iso(due + (5 + (i * 7) % 35) * 60000);
            db.prepare('INSERT INTO dose_events(elder_id, medication_id, hhmm, due_at, local_date, status, acted_at, acted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(elder, m.id, hhmm, iso(due), date, status, acted, acted ? (i % 4 === 0 ? care : elder) : null);
        }
    }
    const appt = (days, hhmm, title, doctor, location) => db.prepare('INSERT INTO appointments(elder_id, title, doctor, location, starts_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(elder, title, doctor, location, iso(U.localToUtcMs(U.addDays(today, days), hhmm, off)), care, created);
    appt(2, '11:00', 'BP and sugar review', 'Dr. Verma', 'City Clinic, Indiranagar');
    appt(9, '16:30', 'Eye check-up', 'Dr. Rao', 'Vision Care Centre');
    materializeForElder(db, { id: elder, tz_offset_min: off }, nowMs);
    return true;
}
module.exports = { seedDemo };
