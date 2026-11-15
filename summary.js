/* summary.js — Doctor Summary page: builds a printable report from the Health Logs + Daily Routine data. */
(function () {
    'use strict';
    if (typeof AUTH_OK === 'undefined' || !AUTH_OK) return;
    const $ = id => document.getElementById(id);
    const t = k => I18N.t(k);
    const esc = escapeHTML;
    const NOTE_KEY = () => userKey('elderDoctorNotes');
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const f1 = n => n == null ? '—' : (Math.round(n * 10) / 10).toString();
    const rng = a => a.length ? `${Math.min(...a)}–${Math.max(...a)}` : '—';

    function keysFor(days) {
        const out = [];
        for (let i = days - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); out.push(HD.key(d)); }
        return out;
    }
    const sec = (title, body) => `<section class="rep-sec"><h3>${title}</h3>${body}</section>`;
    const kv = rows => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>`;

    function build() {
        const days = Number($('sum-period').value), keys = keysFor(days);
        const hd = HD.load(), L = HD.logs(), me = Auth.current() || {};
        const dayOf = k => hd.days[k] || { vitals: [], mood: null, symptoms: [], water: 0, walk: 0 };
        const vitals = keys.flatMap(k => dayOf(k).vitals.map(v => ({ ...v, k })));
        const bp = vitals.filter(v => v.sys && v.dia), sg = vitals.filter(v => v.sugar), pu = vitals.filter(v => v.pulse), ox = vitals.filter(v => v.spo2), wt = vitals.filter(v => v.weight);
        const phone = localStorage.getItem(userKey('elderEmergencyPhone')) || '—', addr = localStorage.getItem(userKey('elderEmergencyAddress')) || '—';
        const from = HD.dateLabel(keys[0], { day: 'numeric', month: 'short', year: 'numeric' }), to = HD.dateLabel(keys[keys.length - 1], { day: 'numeric', month: 'short', year: 'numeric' });
        let h = `<header class="rep-head"><div><p class="rep-brand">ElderEase</p><h1>${esc(t('sm_title'))}</h1><p>${esc(t('period'))}: <b>${esc(from)} → ${esc(to)}</b></p></div></header>`;

        h += sec(esc(t('patient')), kv([[t('p_name'), esc(me.name || '—')], [t('age'), esc(me.age || '—')], [t('p_contact'), esc(phone)], [t('p_addr'), esc(addr)]]));

        // adherence
        const taken = keys.reduce((s, k) => s + HD.dosesTaken(L, k), 0), possible = keys.length * 3;
        const strip = keys.map(k => { const n = HD.dosesTaken(L, k); return `<span class="ad ad${n}" title="${esc(k)}: ${n}/3">${n}</span>`; }).join('');
        let rems = [];
        try { const v = JSON.parse(localStorage.getItem(userKey('elderMedReminders'))); if (Array.isArray(v)) rems = v.filter(r => r && typeof r.name === 'string'); } catch (e) { /* keep empty */ }
        h += sec(esc(t('adherence')),
            `<p><b>${taken}/${possible}</b> ${esc(t('doses_taken'))} (${possible ? Math.round(taken * 100 / possible) : 0}%)</p><div class="ad-strip">${strip}</div>` +
            `<p class="muted">${esc(t('med_list'))}: ${rems.length ? rems.map(r => esc(`${r.name} (${r.time})`)).join(', ') : esc(t('none'))}</p>`);

        // vitals
        const stat = [
            [t('bp_trend'), bp.length ? `${esc(t('avg'))} <b>${Math.round(avg(bp.map(v => v.sys)))}/${Math.round(avg(bp.map(v => v.dia)))}</b> · ${esc(t('range'))} ${rng(bp.map(v => v.sys))} / ${rng(bp.map(v => v.dia))} (${bp.length})` : esc(t('none'))],
            [t('sugar_trend'), sg.length ? `${esc(t('avg'))} <b>${Math.round(avg(sg.map(v => v.sugar)))}</b> mg/dL · ${esc(t('range'))} ${rng(sg.map(v => v.sugar))} (${sg.length})` : esc(t('none'))],
            [t('pulse'), pu.length ? `${esc(t('avg'))} <b>${Math.round(avg(pu.map(v => v.pulse)))}</b> · ${esc(t('range'))} ${rng(pu.map(v => v.pulse))}` : esc(t('none'))],
            ['SpO₂', ox.length ? `${esc(t('avg'))} <b>${f1(avg(ox.map(v => v.spo2)))}%</b> · ${esc(t('range'))} ${rng(ox.map(v => v.spo2))}` : esc(t('none'))],
            [t('weight'), wt.length ? `<b>${wt[wt.length - 1].weight}</b> kg (${esc(HD.dateLabel(wt[wt.length - 1].k, { day: 'numeric', month: 'short' }))})` : esc(t('none'))]
        ];
        let rows = vitals.slice(-40).map(v => {
            const bad = HD.flags(v).length;
            return `<tr class="${bad ? 'bad' : ''}"><td>${esc(HD.dateLabel(v.k, { day: 'numeric', month: 'short' }))}</td><td>${esc(v.time)}</td><td>${v.sys && v.dia ? v.sys + '/' + v.dia : '—'}</td><td>${v.pulse || '—'}</td><td>${v.spo2 || '—'}</td><td>${v.sugar ? v.sugar + ' (' + esc(t(v.sugarWhen === 'aftermeal' ? 'aftermeal' : v.sugarWhen === 'random' ? 'random' : 'fasting')) + ')' : '—'}</td><td>${v.weight || '—'}</td><td>${bad ? 'Flag' : ''}</td></tr>`;
        }).join('');
        h += sec(esc(t('vitals_sum')), kv(stat) + (rows ? `<table class="grid"><thead><tr><th>${esc(t('c_date'))}</th><th>${esc(t('c_time'))}</th><th>BP</th><th>${esc(t('pulse'))}</th><th>SpO₂</th><th>${esc(t('sugar'))}</th><th>kg</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : ''));

        // mood
        const md = keys.map(k => dayOf(k).mood).filter(Boolean);
        h += sec(esc(t('mood_sum')), md.length ? kv([
            [t('avg_mood'), `<b>${f1(avg(md.map(m => m.mood)))}</b> <span class="muted">${esc(t('m' + Math.round(avg(md.map(m => m.mood)))))}</span>`],
            [t('avg_sleep'), `<b>${f1(avg(md.filter(m => m.sleep != null).map(m => m.sleep)))}</b>`],
            [t('stress') + ' — ' + t('lvl_high'), `${md.filter(m => m.stress === 'high').length}`],
            [t('lonely_days'), `${md.filter(m => m.lonely).length}`]
        ]) : `<p class="muted">${esc(t('none'))}</p>`);

        // symptoms
        const sym = {};
        keys.forEach(k => dayOf(k).symptoms.forEach(s => { const e = sym[s.key] = sym[s.key] || { n: 0, worst: 0 }; e.n++; e.worst = Math.max(e.worst, ['sev_mild', 'sev_mod', 'sev_sev'].indexOf(s.sev)); }));
        const sk = Object.keys(sym).sort((a, b) => sym[b].n - sym[a].n);
        h += sec(esc(t('sym_sum')), sk.length ? kv(sk.map(k => [t(k), `${sym[k].n} ${esc(t('times'))} · ${esc(t(['sev_mild', 'sev_mod', 'sev_sev'][sym[k].worst]))}`])) : `<p class="muted">${esc(t('none'))}</p>`);

        // wellness
        const wd = keys.map(k => dayOf(k)).filter(d => d.water || d.walk);
        h += sec(esc(t('wellness_sum')), wd.length ? kv([[t('water'), f1(avg(wd.map(d => d.water || 0)))], [t('walk'), f1(avg(wd.map(d => d.walk || 0)))]]) : `<p class="muted">${esc(t('none'))}</p>`);

        // routine notes
        const notes = keys.flatMap(k => ((L[k] || {}).entries || []).filter(e => e.type === 'health_log').map(e => `<li><b>${esc(HD.dateLabel(k, { day: 'numeric', month: 'short' }))} ${esc(e.time)}</b> — ${esc(e.text)}</li>`));
        const moodNotes = keys.flatMap(k => { const m = dayOf(k).mood; return m && m.note ? [`<li><b>${esc(HD.dateLabel(k, { day: 'numeric', month: 'short' }))}</b> — ${esc(m.note)}</li>`] : []; });
        h += sec(esc(t('notes_sum')), (notes.length + moodNotes.length) ? `<ul class="notes">${notes.concat(moodNotes).slice(0, 40).join('')}</ul>` : `<p class="muted">${esc(t('none'))}</p>`);

        // appointments
        const today = HD.key(new Date());
        const ap = hd.appts.filter(a => a.date >= keys[0]).sort((a, b) => a.date.localeCompare(b.date));
        h += sec(esc(t('appts_sum')), ap.length ? `<ul class="notes">${ap.map(a => `<li><b>${esc(HD.dateLabel(a.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</b>${a.date < today ? ' ✓' : ''} — ${esc(a.text)}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('none'))}</p>`);

        const note = localStorage.getItem(NOTE_KEY()) || '';
        h += sec(esc(t('questions')), `<textarea id="doc-notes" rows="3" class="no-print" data-i18n-ph="q_ph" maxlength="1000">${esc(note)}</textarea><div id="doc-notes-print" class="print-only">${esc(note).replace(/\n/g, '<br>') || '—'}</div>`);
        h += `<footer class="rep-foot">${esc(t('generated'))} ${esc(new Date().toLocaleString(I18N.lang().speech))}<br>${esc(t('disclaimer'))}</footer>`;

        $('report').innerHTML = h;
        I18N.apply($('report'));
        $('doc-notes').addEventListener('input', e => {
            localStorage.setItem(NOTE_KEY(), e.target.value);
            $('doc-notes-print').innerHTML = esc(e.target.value).replace(/\n/g, '<br>') || '—';
        });
    }

    $('sum-period').addEventListener('change', build);
    $('dl-pdf').addEventListener('click', () => {
        const old = document.title, me = (Auth.current() || {}).name || 'Elder';
        document.title = `ElderEase-Doctor-Summary-${me.replace(/\s+/g, '-')}-${HD.key(new Date())}`;   // becomes the PDF file name
        toast(t('pdf_tip'));
        setTimeout(() => { window.print(); document.title = old; }, 400);
    });
    window.addEventListener('langchange', build);
    window.addEventListener('storage', build);
    I18N.apply();
    build();
})();
