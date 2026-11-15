/* health.js — Health Logs page: vitals, mood, symptoms, wellness, calendar, trends, appointments. */
(function () {
    'use strict';
    if (typeof AUTH_OK === 'undefined' || !AUTH_OK) return;
    const $ = id => document.getElementById(id);
    const t = k => I18N.t(k);
    const esc = escapeHTML;
    const todayKey = () => HD.key(new Date());

    const SYMS = ['sy_head', 'sy_dizzy', 'sy_chest', 'sy_breath', 'sy_joint', 'sy_weak', 'sy_nausea', 'sy_cough'];
    const chosen = new Set();
    let mood = 0, sel = todayKey();
    let vy = new Date().getFullYear(), vm = new Date().getMonth();

    /* ---------- inputs ---------- */
    function renderMoodRow() {
        const row = $('mood-row');
        row.innerHTML = '';
        [1, 2, 3, 4, 5].forEach((_, i) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mood-btn' + (mood === i + 1 ? ' on' : '');
            b.setAttribute('aria-pressed', mood === i + 1);
            b.innerHTML = `<span class="mood-num">${i + 1}</span><small>${esc(t('m' + (i + 1)))}</small>`;
            b.onclick = () => { mood = i + 1; renderMoodRow(); updateLonelyTip(); };
            row.appendChild(b);
        });
    }
    function updateLonelyTip() { $('lonely-tip').hidden = !($('m-lonely').checked || (mood && mood <= 2)); }
    function renderChips() {
        const box = $('sym-chips');
        box.innerHTML = '';
        SYMS.forEach(k => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip' + (chosen.has(k) ? ' on' : '');
            b.setAttribute('aria-pressed', chosen.has(k));
            b.textContent = t(k);
            b.onclick = () => { chosen.has(k) ? chosen.delete(k) : chosen.add(k); renderChips(); $('sym-warn').hidden = !(chosen.has('sy_chest') || chosen.has('sy_breath')); };
            box.appendChild(b);
        });
    }
    function fillToday() {
        const d = HD.load().days[todayKey()];
        if (!d) return;
        if (d.mood) {
            mood = d.mood.mood || 0;
            $('m-sleep').value = d.mood.sleep ?? '';
            $('m-stress').value = d.mood.stress || 'low';
            $('m-lonely').checked = !!d.mood.lonely;
            $('m-note').value = d.mood.note || '';
        }
        $('w-water').value = d.water || '';
        $('w-walk').value = d.walk || '';
    }
    const num = id => { const el = $(id), v = el.value.trim(); if (v === '') return null; const n = Number(v); return (isFinite(n) && n >= Number(el.min) && n <= Number(el.max)) ? n : NaN; };

    function renderAlerts() {
        const v = (HD.load().days[todayKey()] || { vitals: [] }).vitals.slice(-1)[0];
        const box = $('alert-box');
        const f = v ? HD.flags(v) : [];
        box.hidden = !f.length;
        box.innerHTML = f.map(k => `<p>${esc(t(k))}</p>`).join('');
    }

    /* ---------- save handlers ---------- */
    $('save-vitals').onclick = () => {
        const e = { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            sys: num('v-sys'), dia: num('v-dia'), pulse: num('v-pulse'), spo2: num('v-spo2'), sugar: num('v-sugar'), weight: num('v-weight'), sugarWhen: $('v-sugar-when').value };
        const vals = ['sys', 'dia', 'pulse', 'spo2', 'sugar', 'weight'].map(k => e[k]);
        if (vals.some(Number.isNaN)) { toast('Please check the numbers — one is outside the allowed range.'); return; }
        if (vals.every(v => v === null)) { toast(t('enter_value')); return; }
        if ((e.sys === null) !== (e.dia === null)) { toast('BP needs both the top and bottom number.'); return; }
        const d = HD.load();
        HD.day(d, todayKey()).vitals.push(e);
        HD.save(d);
        ['v-sys', 'v-dia', 'v-pulse', 'v-spo2', 'v-sugar', 'v-weight'].forEach(i => { $(i).value = ''; });
        toast(t('saved')); refresh();
    };
    $('save-mood').onclick = () => {
        if (!mood) { toast(t('mood_q')); return; }
        const d = HD.load();
        HD.day(d, todayKey()).mood = { mood, sleep: num('m-sleep'), stress: $('m-stress').value, lonely: $('m-lonely').checked, note: cleanText($('m-note').value, 300) };
        HD.save(d); toast(t('saved')); refresh();
    };
    $('save-sym').onclick = () => {
        if (!chosen.size) { toast(t('enter_value')); return; }
        const d = HD.load(), time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        chosen.forEach(k => HD.day(d, todayKey()).symptoms.push({ key: k, sev: $('sym-sev').value, time }));
        HD.save(d); chosen.clear(); renderChips(); toast(t('saved')); refresh();
    };
    $('save-well').onclick = () => {
        const w = num('w-water'), k = num('w-walk');
        if (Number.isNaN(w) || Number.isNaN(k)) { toast('Please check the numbers.'); return; }
        const d = HD.load(), day = HD.day(d, todayKey());
        if (w !== null) day.water = w;
        if (k !== null) day.walk = k;
        HD.save(d); toast(t('saved')); refresh();
    };
    $('m-lonely').onchange = updateLonelyTip;

    /* ---------- calendar ---------- */
    function renderCalendar() {
        const loc = I18N.lang().speech, hd = HD.load(), L = HD.logs();
        $('cal-title').textContent = new Date(vy, vm, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
        $('cal-dow').innerHTML = Array.from({ length: 7 }, (_, i) => `<span>${esc(new Date(2023, 0, 1 + i).toLocaleDateString(loc, { weekday: 'short' }))}</span>`).join('');
        const grid = $('cal-grid');
        grid.innerHTML = '';
        const first = new Date(vy, vm, 1).getDay(), days = new Date(vy, vm + 1, 0).getDate(), today = todayKey();
        for (let i = 0; i < first; i++) grid.appendChild(document.createElement('span'));
        for (let n = 1; n <= days; n++) {
            const k = `${vy}-${HD.pad(vm + 1)}-${HD.pad(n)}`, d = hd.days[k] || {};
            const dots = [
                (d.vitals || []).length ? 'd-vit' : '', d.mood ? 'd-mood' : '', (d.symptoms || []).length ? 'd-sym' : '',
                HD.dosesTaken(L, k) === 3 ? 'd-med' : '', hd.appts.some(a => a.date === k) ? 'd-appt' : ''].filter(Boolean);
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'cal-cell' + (k === today ? ' today' : '') + (k === sel ? ' sel' : '');
            b.innerHTML = `<b>${n}</b><span class="dots">${dots.map(c => `<i class="dot ${c}"></i>`).join('')}</span>`;
            b.setAttribute('aria-label', `${n}${dots.length ? ', ' + dots.length + ' entries' : ''}`);
            b.onclick = () => { sel = k; renderCalendar(); renderDetail(); };
            grid.appendChild(b);
        }
    }
    function renderDetail() {
        const hd = HD.load(), d = hd.days[sel] || {}, L = HD.logs(), box = $('day-detail');
        const rows = [];
        (d.vitals || []).forEach(v => {
            const bad = HD.flags(v).length;
            rows.push(`<div class="dd-row ${bad ? 'bad' : ''}"><small>${esc(v.time)}</small> ${esc(HD.fmtVitals(v))}${bad ? ' <span class="dd-flag">Out of range</span>' : ''}</div>`);
        });
        if (d.mood) {
            rows.push(`<div class="dd-row"><small>${esc(t('lg_mood'))}</small> ${esc(t('m' + d.mood.mood))}` +
                `${d.mood.sleep != null ? ` · ${esc(t('sleep'))}: ${esc(d.mood.sleep)}` : ''} · ${esc(t('stress'))}: ${esc(t('lvl_' + d.mood.stress))}${d.mood.lonely ? ' · ' + esc(t('lonely')) : ''}` +
                `${d.mood.note ? `<br><em>${esc(d.mood.note)}</em>` : ''}</div>`);
        }
        (d.symptoms || []).forEach(s => rows.push(`<div class="dd-row"><small>${esc(s.time)}</small> ${esc(t(s.key))} — ${esc(t(s.sev))}</div>`));
        if (d.water || d.walk) rows.push(`<div class="dd-row">${esc(t('water'))}: ${esc(d.water || 0)} · ${esc(t('walk'))}: ${esc(d.walk || 0)}</div>`);
        const m = (L[sel] || {}).medications;
        if (m) rows.push(`<div class="dd-row"><small>Medicines</small> ${['Morning', 'Afternoon', 'Night'].map(x => `${esc(t(x.toLowerCase()))}: ${m[x] ? '<b>taken</b>' : 'not marked'}`).join(' · ')}</div>`);
        ((L[sel] || {}).entries || []).filter(e => e && e.type === 'health_log').forEach(e => rows.push(`<div class="dd-row"><small>${esc(e.time)}</small> ${esc(e.text)}</div>`));
        hd.appts.filter(a => a.date === sel).forEach(a => rows.push(`<div class="dd-row"><small>${esc(t('lg_appt'))}</small> ${esc(a.text)}</div>`));
        box.innerHTML = `<h4>${esc(HD.dateLabel(sel))}</h4>` + (rows.join('') || `<p class="chat-empty">${esc(t('no_data'))}</p>`);
    }
    $('cal-prev').onclick = () => { vm--; if (vm < 0) { vm = 11; vy--; } renderCalendar(); };
    $('cal-next').onclick = () => { vm++; if (vm > 11) { vm = 0; vy++; } renderCalendar(); };

    /* ---------- trends (inline SVG) ---------- */
    function chart(box, series, hint) {
        const W = 320, H = 130, P = 26;
        const n = Math.max(...series.map(s => s.vals.length));
        if (n < 2) { box.innerHTML = `<p class="chat-empty">${esc(t('need_more'))}</p>`; return; }
        const all = series.flatMap(s => s.vals.filter(v => v != null));
        let lo = Math.min(...all), hi = Math.max(...all);
        if (hi - lo < 10) { hi += 5; lo -= 5; }
        const x = i => P + (W - 2 * P) * (i / (n - 1)), y = v => H - P - (H - 2 * P) * ((v - lo) / (hi - lo));
        let svg = `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="${esc(hint)}">`;
        svg += `<text x="2" y="${y(hi) + 4}" class="ax">${Math.round(hi)}</text><text x="2" y="${y(lo) + 4}" class="ax">${Math.round(lo)}</text>`;
        svg += `<line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" class="axl"/>`;
        series.forEach(s => {
            const pts = s.vals.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean);
            svg += `<polyline class="ln ${s.cls}" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
            pts.forEach(p => { svg += `<circle class="pt ${s.cls}" cx="${p[0]}" cy="${p[1]}" r="3"/>`; });
        });
        box.innerHTML = svg + '</svg>';
    }
    function renderCharts() {
        const hd = HD.load();
        const all = Object.keys(hd.days).sort().flatMap(k => hd.days[k].vitals.map(v => ({ ...v, k })));
        const bp = all.filter(v => v.sys && v.dia).slice(-10), sg = all.filter(v => v.sugar).slice(-10);
        chart($('chart-bp'), [{ vals: bp.map(v => v.sys), cls: 's-accent' }, { vals: bp.map(v => v.dia), cls: 's-ink' }], t('bp_trend'));
        chart($('chart-sugar'), [{ vals: sg.map(v => v.sugar), cls: 's-ink' }], t('sugar_trend'));
    }

    /* ---------- appointments ---------- */
    function renderAppts() {
        const hd = HD.load(), box = $('appt-list'), today = todayKey();
        const list = hd.appts.filter(a => a.date >= today).sort((a, b) => a.date.localeCompare(b.date));
        box.innerHTML = list.length ? '' : `<p class="chat-empty">${esc(t('none'))}</p>`;
        list.forEach(a => {
            const row = document.createElement('div');
            row.className = 'reminder-row';
            const s = document.createElement('span');
            s.textContent = `${HD.dateLabel(a.date, { day: 'numeric', month: 'short' })}, ${a.text}`;
            const del = document.createElement('button');
            del.type = 'button'; del.className = 'btn btn-danger btn-sm'; del.textContent = t('delete');
            del.onclick = () => { const d = HD.load(); d.appts = d.appts.filter(x => x.id !== a.id); HD.save(d); refresh(); };
            row.append(s, del);
            box.appendChild(row);
        });
    }
    $('appt-form').addEventListener('submit', e => {
        e.preventDefault();
        const d = HD.load();
        const date = $('appt-date').value, text = cleanLine($('appt-text').value, 80);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) { toast(t('enter_value')); return; }
        d.appts.push({ id: 'a-' + Date.now(), date, text });
        HD.save(d); e.target.reset(); toast(t('saved')); refresh();
    });

    function refresh() { renderAlerts(); renderCalendar(); renderDetail(); renderCharts(); renderAppts(); }
    function all() { renderMoodRow(); renderChips(); updateLonelyTip(); refresh(); }
    window.addEventListener('langchange', all);
    window.addEventListener('storage', refresh);
    fillToday();
    I18N.apply();
    all();
})();
