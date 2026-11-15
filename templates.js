'use strict';
const { esc } = require('./util');

const wrap = (title, inner, appUrl, note) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1B2A41;line-height:1.5">
<p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#7C8A9B;margin:0 0 4px">ElderEase</p>
<h2 style="margin:0 0 14px;font-size:22px">${esc(title)}</h2>${inner}
<p style="margin:22px 0 0"><a href="${esc(appUrl)}/care.html" style="background:#1B2A41;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open Care Circle</a></p>
<p style="font-size:12px;color:#7C8A9B;margin-top:22px">${esc(note || 'You get this because you are in this care circle. You can switch emails off under Care Circle → Settings.')} ElderEase is a reminder tool, not medical advice. In an emergency call 112.</p></div>`;

function doseUpcoming({ med, dose, hhmm, elderName }, appUrl) {
    const what = `${med}${dose ? ' (' + dose + ')' : ''}`;
    return {
        subject: `Reminder: ${med} at ${hhmm}`,
        text: `Hello ${elderName},\n\nIt is almost time for ${what} at ${hhmm}.\nPlease tap "Taken" in ElderEase after you take it: ${appUrl}/care.html`,
        html: wrap(`Time for ${med} at ${hhmm}`, `<p>Hello ${esc(elderName)}, it is almost time for <strong>${esc(what)}</strong> at <strong>${esc(hhmm)}</strong>.</p><p>After you take it, tap <em>Taken</em> so your family knows.</p>`, appUrl)
    };
}
function doseMissed({ med, dose, date, hhmm, elderName }, recipientName, appUrl) {
    const what = `${med}${dose ? ' (' + dose + ')' : ''}`;
    return {
        subject: `Missed dose: ${med} for ${elderName}`,
        text: `Hello ${recipientName},\n\n${elderName} has not confirmed ${what} that was due at ${hhmm} on ${date}.\nPlease check in with them. ${appUrl}/care.html`,
        html: wrap(`Missed dose for ${elderName}`, `<p>Hello ${esc(recipientName)},</p><p><strong>${esc(elderName)}</strong> has not confirmed <strong>${esc(what)}</strong> that was due at <strong>${esc(hhmm)}</strong> on ${esc(date)}.</p><p>Please check in with them.</p>`, appUrl)
    };
}
function appointment({ kind, a, elderName, local }, recipientName, appUrl) {
    const when = kind === 'appt_2h' ? 'in about 2 hours' : 'within the next 24 hours';
    const where = [a.doctor, a.location].filter(Boolean).join(', ');
    return {
        subject: `Appointment ${kind === 'appt_2h' ? 'in 2 hours' : 'tomorrow'}: ${a.title} (${elderName})`,
        text: `Hello ${recipientName},\n\n${elderName} has an appointment ${when}: ${a.title}${where ? ' with ' + where : ''}, ${local}.\n${appUrl}/care.html`,
        html: wrap(`Appointment ${when}`, `<p>Hello ${esc(recipientName)},</p><p><strong>${esc(elderName)}</strong> has <strong>${esc(a.title)}</strong>${where ? ' with ' + esc(where) : ''}.</p><p style="font-size:18px"><strong>${esc(local)}</strong></p>`, appUrl)
    };
}
function digest(d, recipientName, appUrl) {
    const kind = d.days === 1 ? 'daily' : 'weekly';
    const t = d.totals, rate = t.rate == null ? 'no doses recorded' : t.rate + '% of doses taken';
    const medRows = d.perMed.map(m => `<tr><td style="padding:4px 8px">${esc(m.name)}${m.dose ? ' ' + esc(m.dose) : ''}</td><td style="padding:4px 8px">${m.taken}</td><td style="padding:4px 8px">${m.skipped}</td><td style="padding:4px 8px">${m.missed}</td><td style="padding:4px 8px">${m.rate == null ? '-' : m.rate + '%'}</td></tr>`).join('');
    const missed = d.missed.slice(0, 12).map(m => `<li>${esc(m.name)}${m.dose ? ' ' + esc(m.dose) : ''} - ${esc(m.date)} ${esc(m.hhmm)}</li>`).join('');
    const appts = d.appointments.map(a => `<li>${esc(a.local)} - ${esc(a.title)}${a.doctor ? ' (' + esc(a.doctor) + ')' : ''}</li>`).join('');
    const text = [`Hello ${recipientName},`, '', `${kind === 'daily' ? 'Today' : 'Last ' + d.days + ' days'} for ${d.elder.name}: ${rate}.`,
        `Taken ${t.taken}, skipped ${t.skipped}, missed ${t.missed}, still to come ${t.pending}.`,
        ...(d.missed.length ? ['', 'Missed doses:', ...d.missed.slice(0, 12).map(m => `- ${m.name} ${m.dose} ${m.date} ${m.hhmm}`)] : []),
        ...(d.appointments.length ? ['', 'Coming up:', ...d.appointments.map(a => `- ${a.local} ${a.title}`)] : []), '', `${appUrl}/care.html`].join('\n');
    return {
        subject: `ElderEase ${kind} summary for ${d.elder.name}: ${t.rate == null ? 'no doses yet' : t.rate + '% taken'}`,
        text,
        html: wrap(`${kind === 'daily' ? 'Daily' : 'Weekly'} summary for ${d.elder.name}`,
            `<p>Hello ${esc(recipientName)},</p><p style="font-size:28px;margin:6px 0"><strong>${esc(rate)}</strong></p>
<p>Taken ${t.taken} · skipped ${t.skipped} · missed ${t.missed} · still to come ${t.pending}${d.perfectDays > 1 ? ' · ' + d.perfectDays + ' perfect days in a row' : ''}</p>
${medRows ? `<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="text-align:left;background:#E9EFF1"><th style="padding:4px 8px">Medicine</th><th style="padding:4px 8px">Taken</th><th style="padding:4px 8px">Skipped</th><th style="padding:4px 8px">Missed</th><th style="padding:4px 8px">Rate</th></tr>${medRows}</table>` : ''}
${missed ? `<h3 style="margin:16px 0 4px">Missed doses</h3><ul>${missed}</ul>` : ''}${appts ? `<h3 style="margin:16px 0 4px">Coming up</h3><ul>${appts}</ul>` : ''}`, appUrl)
    };
}
const ACCOUNT_NOTE = 'You get this because someone asked to reset the password for this ElderEase account.';
function passwordReset({ name, link, minutes }, appUrl) {
    return {
        subject: 'Reset your ElderEase password',
        text: `Hello ${name},\n\nUse this link to choose a new password. It works once and expires in ${minutes} minutes:\n${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`,
        html: wrap('Reset your password', `<p>Hello ${esc(name)},</p><p>Use the button below to choose a new password. It works once and expires in ${minutes} minutes.</p>
<p style="margin:18px 0"><a href="${esc(link)}" style="background:#1B2A41;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Choose a new password</a></p>
<p style="font-size:13px;color:#4B5B70">If you did not ask for this, ignore this email. Your password stays the same.</p>`, appUrl, ACCOUNT_NOTE)
    };
}
function passwordChanged({ name }, appUrl) {
    return {
        subject: 'Your ElderEase password was changed',
        text: `Hello ${name},\n\nThe password for your ElderEase account was just changed, and every device was signed out.\nIf this was not you, reset it again now at ${appUrl}/index.html and tell your family or caretaker.`,
        html: wrap('Your password was changed', `<p>Hello ${esc(name)},</p><p>The password for your ElderEase account was just changed, and every device was signed out.</p><p>If this was not you, reset it again now and tell your family or caretaker.</p>`, appUrl, 'This is a security notice about your account.')
    };
}
module.exports = { doseUpcoming, doseMissed, appointment, digest, passwordReset, passwordChanged };
