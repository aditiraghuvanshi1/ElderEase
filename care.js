/* care.js — Care Circle: talks to the ElderEase server (real accounts, roles, shared data, live updates).
   No inline scripts or styles, every value goes in through textContent, so the page's strict CSP stays intact. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const S = { user: null, elders: [], elder: null, tab: 'today', demo: false, es: null, tabs: [] };

    /* ---- tiny helpers ---- */
    const h = (tag, props, ...kids) => {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(props || {})) {
            if (v == null || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
            else if (['value', 'type', 'checked', 'disabled', 'min', 'max', 'required', 'placeholder', 'maxLength', 'selected', 'name', 'id', 'htmlFor'].includes(k)) el[k] = v;
            else el.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        return el;
    };
    let toastTimer;
    function say(msg, bad) {
        const t = $('care-toast');
        t.textContent = msg; t.className = 'care-toast' + (bad ? ' bad' : ''); t.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
    }
    async function api(method, url, body) {
        const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ElderEase' }, body: body ? JSON.stringify(body) : undefined });
        let json = {}; try { json = await res.json(); } catch (e) { /* no body */ }
        if (res.status === 401 && S.user) { S.user = null; showAuth(); }
        if (!res.ok) { const err = new Error(json.error || 'Something went wrong.'); err.status = res.status; throw err; }
        return json;
    }
    const tryDo = async fn => { try { return await fn(); } catch (e) { say(e.message, true); } };
    const stLabel = { pending: 'Pending', taken: 'Taken', skipped: 'Skipped', missed: 'Missed' };
    const chip = s => h('span', { class: 'st st-' + s, text: stLabel[s] });
    // show times on the ELDER's clock (not the viewer's), so "taken 08:35" means 08:35 where the elder lives
    const timeOf = iso => { const d = new Date(Date.parse(iso) + ((S.elder && S.elder.tz_offset_min) || 330) * 60000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
    const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    /* ---- auth view ---- */
    function showMsg(text, ok) { const m = $('c-msg'); m.textContent = text; m.className = 'auth-msg ' + (ok ? 'ok' : 'err'); m.hidden = false; }
    function authTab(login) {
        $('c-login').hidden = !login; $('c-signup').hidden = login;
        $('c-tab-login').classList.toggle('active', login); $('c-tab-signup').classList.toggle('active', !login);
        $('c-tab-login').setAttribute('aria-selected', login); $('c-tab-signup').setAttribute('aria-selected', !login);
        $('c-msg').hidden = true;
    }
    function syncRole() {
        const role = document.querySelector('input[name="c-role"]:checked').value;
        $('r-age').min = role === 'elder' ? 60 : 18;
        $('r-agehint').textContent = role === 'elder' ? 'Elder accounts are for ages 60 and over.' : 'You must be 18 or older.';
        $('r-passcode-row').hidden = role === 'elder';
    }
    function showAuth() {
        if (S.es) { S.es.close(); S.es = null; }
        $('view-auth').hidden = false; $('view-app').hidden = true; $('care-logout').hidden = true;
        $('care-sub').textContent = 'Care Circle: medicines, appointments and updates, shared with family';
    }
    $('c-tab-login').addEventListener('click', () => authTab(true));
    $('c-tab-signup').addEventListener('click', () => authTab(false));
    document.querySelectorAll('input[name="c-role"]').forEach(r => r.addEventListener('change', syncRole));
    document.querySelectorAll('[data-demo]').forEach(b => b.addEventListener('click', () => {
        const [email, pw] = b.dataset.demo.split('|');
        authTab(true); $('c-email').value = email; $('c-pass').value = pw; $('c-pass').focus();
    }));
    $('c-login').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
        try { const r = await api('POST', '/api/auth/login', { email: $('c-email').value, password: $('c-pass').value }); $('c-pass').value = ''; S.user = r.user; await enterApp(); }
        catch (err) { $('c-pass').value = ''; showMsg(err.message, false); } finally { btn.disabled = false; }
    });
    $('c-signup').addEventListener('submit', async e => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true;
        try {
            const email = $('r-email').value;
            await api('POST', '/api/auth/register', { name: $('r-name').value, age: $('r-age').value, email, password: $('r-pass').value,
                role: document.querySelector('input[name="c-role"]:checked').value, passcode: $('r-passcode').value });
            e.target.reset(); syncRole(); authTab(true); $('c-email').value = email.trim();
            showMsg('Account ready. Sign in with your email and password.', true); $('c-pass').focus();
        } catch (err) { showMsg(err.message, false); } finally { btn.disabled = false; }
    });
    $('care-logout').addEventListener('click', async () => { await tryDo(() => api('POST', '/api/auth/logout', {})); S.user = null; showAuth(); authTab(true); });

    /* ---- app shell ---- */
    async function enterApp() {
        $('view-auth').hidden = true; $('view-app').hidden = false; $('care-logout').hidden = false;
        $('care-sub').textContent = `${S.user.name} · ${{ elder: 'Elder', caretaker: 'Caretaker', family: 'Family member' }[S.user.role]}`;
        await loadCircle();
    }
    async function loadCircle() {
        const c = await api('GET', '/api/care/circle');
        S.elders = c.elders; S.members = c.members;
        if (!S.elder || !S.elders.some(e => e.id === S.elder.id)) S.elder = S.elders[0] || null;
        const pick = $('elder-pick'); pick.replaceChildren(...S.elders.map(e => h('option', { value: e.id, text: e.name, selected: S.elder && e.id === S.elder.id })));
        $('elder-pick-wrap').hidden = S.elders.length < 2;
        S.tabs = S.elder ? [['today', 'Today'], ['meds', 'Medicines'], ['appts', 'Appointments'], ['adherence', 'Adherence & summary'], ['circle', 'Circle & settings']] : [['circle', 'Circle & settings']];
        if (!S.tabs.some(t => t[0] === S.tab)) S.tab = S.tabs[0][0];
        renderTabs(); connectStream(); await render();
    }
    $('elder-pick').addEventListener('change', async e => { S.elder = S.elders.find(x => x.id === Number(e.target.value)); connectStream(); await render(); });
    function renderTabs() {
        $('care-tabs').replaceChildren(...S.tabs.map(([k, label]) => h('button', { type: 'button', 'aria-selected': String(S.tab === k), text: label, on: { click: () => { S.tab = k; renderTabs(); render(); } } })));
    }
    let renderQueued = false;
    function connectStream() {
        if (S.es) { S.es.close(); S.es = null; }
        $('care-live').hidden = true;
        if (!S.elder) return;
        S.es = new EventSource(`/api/elders/${S.elder.id}/stream`);
        S.es.addEventListener('open', () => { $('care-live').hidden = false; });
        S.es.addEventListener('error', () => { $('care-live').hidden = true; });
        for (const ev of ['dose', 'meds', 'appts']) S.es.addEventListener(ev, () => { if (renderQueued) return; renderQueued = true; setTimeout(() => { renderQueued = false; render(true); }, 250); });
        S.es.addEventListener('circle', () => { loadCircle().catch(e => { if (e.status !== 401) say(e.message, true); }); });
    }
    async function render(quiet) {
        const panel = $('panel');
        try {
            const fn = { today: pToday, meds: pMeds, appts: pAppts, adherence: pAdherence, circle: pCircle }[S.tab];
            panel.replaceChildren(await fn());
        } catch (e) { if (!quiet || e.status) say(e.message, true); }
    }
    const eid = () => S.elder.id, canWrite = () => S.elder && S.elder.write;

    /* ---- Today ---- */
    async function pToday() {
        const o = await api('GET', `/api/elders/${eid()}/overview`);
        const w = o.week;
        const rows = o.doses.map(d => h('li', { class: 'care-row' },
            h('span', { class: 'when', text: d.hhmm }),
            h('span', {}, h('strong', { text: d.name }), d.dose ? ' ' + d.dose : '', d.acted_at ? h('div', { class: 'meta', text: `${d.status === 'skipped' ? 'Skipped' : 'Taken'} ${timeOf(d.acted_at)}${d.acted_by_name ? ' · ' + d.acted_by_name : ''}` }) : null),
            chip(d.status),
            o.write && (d.status === 'pending' || d.status === 'missed') && Date.parse(d.due_at) <= Date.now() + 3 * 3600e3 ? h('span', { class: 'care-actions' },
                h('button', { type: 'button', class: 'btn btn-primary', text: 'Taken', on: { click: () => mark(d.id, 'taken') } }),
                h('button', { type: 'button', class: 'btn btn-secondary', text: 'Skip', on: { click: () => mark(d.id, 'skipped') } })) : null));
        return h('div', { class: 'care-grid two' },
            h('section', { class: 'form-section' }, h('h2', { text: `Today for ${o.elder.name}` }),
                rows.length ? h('ul', { class: 'care-list' }, rows) : h('p', { class: 'care-empty', text: 'No doses scheduled today. Add a medicine under Medicines.' }),
                !o.write ? h('p', { class: 'hint', text: 'You have view-only access. Only the elder and caretakers can mark doses.' }) : null),
            h('div', { class: 'care-grid' },
                h('section', { class: 'form-section' }, h('h2', { text: 'Last 7 days' }),
                    h('div', { class: 'care-big', text: w.rate == null ? '–' : w.rate + '%' }), w.rate == null ? null : h('meter', { min: 0, max: 100, value: w.rate, 'aria-label': 'Doses taken' }),
                    h('div', { class: 'care-stats' }, h('span', { text: `Taken ${w.taken}` }), h('span', { text: `Skipped ${w.skipped}` }), h('span', { text: `Missed ${w.missed}` }),
                        o.perfectDays > 1 ? h('span', { text: `${o.perfectDays}-day perfect streak` }) : null)),
                h('section', { class: 'form-section' }, h('h2', { text: 'Next appointments' }),
                    o.appointments.length ? h('ul', { class: 'care-list' }, o.appointments.map(a => h('li', { class: 'care-row' }, h('strong', { text: a.title }), h('span', { class: 'meta', text: `${a.local}${a.doctor ? ' · ' + a.doctor : ''}` })))) : h('p', { class: 'care-empty', text: 'Nothing booked.' }))));
    }
    const mark = (id, status) => tryDo(async () => { await api('POST', `/api/doses/${id}/mark`, { status }); say(status === 'taken' ? 'Marked as taken.' : 'Marked as skipped.'); await render(true); });

    /* ---- Medicines ---- */
    async function pMeds() {
        const { medications } = await api('GET', `/api/elders/${eid()}/medications`);
        const list = medications.map(m => h('li', { class: 'care-row' },
            h('span', {}, h('strong', { text: m.name }), m.dose ? ' ' + m.dose : '', h('div', { class: 'meta', text: `${m.times.join(', ')} · ${m.days === '1111111' ? 'every day' : DAYN.filter((_, i) => m.days[i] === '1').join(' ')}${m.notes ? ' · ' + m.notes : ''}` })),
            canWrite() ? h('button', { type: 'button', class: 'btn btn-danger', text: 'Remove', on: { click: () => tryDo(async () => { await api('DELETE', `/api/medications/${m.id}`); say('Medicine removed. Past records are kept.'); await render(); }) } }) : null));
        const form = canWrite() ? h('form', { class: 'form-section', on: { submit: addMed } },
            h('h2', { text: 'Add a medicine' }),
            h('div', { class: 'form-group' }, h('label', { htmlFor: 'm-name', text: 'Name' }), h('input', { id: 'm-name', type: 'text', maxLength: 80, required: true })),
            h('div', { class: 'form-group' }, h('label', { htmlFor: 'm-dose', text: 'Dose (optional)' }), h('input', { id: 'm-dose', type: 'text', maxLength: 60, placeholder: '500 mg' })),
            h('div', { class: 'form-group' }, h('label', { text: 'Times each day' }), h('div', { class: 'care-times' }, [0, 1, 2].map(i => h('input', { type: 'time', class: 'm-time', 'aria-label': 'Time ' + (i + 1), value: i === 0 ? '08:00' : '' })))),
            h('div', { class: 'care-days-pick' }, DAYN.map((d, i) => h('label', {}, h('input', { type: 'checkbox', class: 'm-day', checked: true, value: i }), d))),
            h('div', { class: 'form-group' }, h('label', { htmlFor: 'm-notes', text: 'Notes (optional)' }), h('input', { id: 'm-notes', type: 'text', maxLength: 200, placeholder: 'After food' })),
            h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save medicine' })) : null;
        return h('div', { class: 'care-grid two' }, h('section', { class: 'form-section' }, h('h2', { text: 'Medicine schedule' }),
            list.length ? h('ul', { class: 'care-list' }, list) : h('p', { class: 'care-empty', text: 'No medicines yet.' })), form);
    }
    function addMed(e) {
        e.preventDefault();
        const times = [...document.querySelectorAll('.m-time')].map(i => i.value).filter(Boolean);
        const days = [...document.querySelectorAll('.m-day')].map(c => (c.checked ? '1' : '0')).join('');
        return tryDo(async () => { await api('POST', `/api/elders/${eid()}/medications`, { name: $('m-name').value, dose: $('m-dose').value, notes: $('m-notes').value, times, days }); say('Medicine saved. Reminders are now scheduled.'); await render(); });
    }

    /* ---- Appointments ---- */
    async function pAppts() {
        const { appointments } = await api('GET', `/api/elders/${eid()}/appointments`);
        const list = appointments.map(a => h('li', { class: 'care-row' },
            h('span', {}, h('strong', { text: a.title }), h('div', { class: 'meta', text: `${a.local}${a.doctor ? ' · ' + a.doctor : ''}${a.location ? ' · ' + a.location : ''}` })),
            canWrite() ? h('button', { type: 'button', class: 'btn btn-danger', text: 'Cancel', on: { click: () => tryDo(async () => { await api('DELETE', `/api/appointments/${a.id}`); await render(); }) } }) : null));
        const form = canWrite() ? h('form', { class: 'form-section', on: { submit: addAppt } },
            h('h2', { text: 'Add an appointment' }),
            h('div', { class: 'form-group' }, h('label', { htmlFor: 'a-title', text: 'What for?' }), h('input', { id: 'a-title', type: 'text', maxLength: 100, required: true })),
            h('div', { class: 'form-group' }, h('label', { htmlFor: 'a-when', text: 'Date and time' }), h('input', { id: 'a-when', type: 'datetime-local', required: true })),
            h('div', { class: 'form-group' }, h('label', { htmlFor: 'a-doc', text: 'Doctor (optional)' }), h('input', { id: 'a-doc', type: 'text', maxLength: 80 })),
            h('div', { class: 'form-group' }, h('label', { htmlFor: 'a-loc', text: 'Place (optional)' }), h('input', { id: 'a-loc', type: 'text', maxLength: 120 })),
            h('p', { class: 'hint', text: 'Everyone in the circle gets an email about 24 hours and 2 hours before.' }),
            h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save appointment' })) : null;
        return h('div', { class: 'care-grid two' }, h('section', { class: 'form-section' }, h('h2', { text: 'Upcoming appointments' }),
            list.length ? h('ul', { class: 'care-list' }, list) : h('p', { class: 'care-empty', text: 'Nothing booked.' })), form);
    }
    function addAppt(e) {
        e.preventDefault();
        return tryDo(async () => { await api('POST', `/api/elders/${eid()}/appointments`, { title: $('a-title').value, starts_local: $('a-when').value, doctor: $('a-doc').value, location: $('a-loc').value }); say('Appointment saved.'); await render(); });
    }

    /* ---- Adherence & caretaker summary ---- */
    let period = 7;
    async function pAdherence() {
        const d = await api('GET', `/api/elders/${eid()}/adherence?days=${period}`), t = d.totals;
        const pick = h('select', { 'aria-label': 'Period', on: { change: e => { period = Number(e.target.value); render(); } } },
            [[1, 'Today'], [7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days']].map(([v, l]) => h('option', { value: v, text: l, selected: v === period })));
        const dayRows = d.perDay.slice().reverse().map(x => h('tr', {}, h('td', { text: x.date }), h('td', { text: `${x.taken}/${x.taken + x.skipped + x.missed || 0}` }),
            h('td', {}, x.rate == null ? '–' : h('meter', { min: 0, max: 100, value: x.rate, 'aria-label': 'Rate for ' + x.date })), h('td', { text: x.missed ? `${x.missed} missed` : '' })));
        const medRows = d.perMed.map(m => h('tr', {}, h('td', { text: m.name + (m.dose ? ' ' + m.dose : '') }), h('td', { text: m.taken }), h('td', { text: m.skipped }), h('td', { text: m.missed }), h('td', { text: m.rate == null ? '–' : m.rate + '%' })));
        return h('div', { class: 'care-grid two' },
            h('section', { class: 'form-section' }, h('h2', { text: `Compliance for ${d.elder.name}` }), pick,
                h('div', { class: 'care-big', text: t.rate == null ? '–' : t.rate + '%' }),
                h('div', { class: 'care-stats' }, h('span', { text: `Taken ${t.taken}` }), h('span', { text: `Skipped ${t.skipped}` }), h('span', { text: `Missed ${t.missed}` }), h('span', { text: `Still to come ${t.pending}` })),
                medRows.length ? h('table', { class: 'care-days' }, h('thead', {}, h('tr', {}, ['Medicine', 'Taken', 'Skipped', 'Missed', 'Rate'].map(x => h('th', { text: x })))), h('tbody', {}, medRows)) : h('p', { class: 'care-empty', text: 'No doses in this period yet.' }),
                d.missed.length ? h('div', {}, h('h3', { text: 'Missed doses' }), h('ul', { class: 'care-list' }, d.missed.slice(0, 15).map(m => h('li', { class: 'care-row' }, h('span', { text: `${m.name}${m.dose ? ' ' + m.dose : ''}` }), h('span', { class: 'meta', text: `${m.date} ${m.hhmm}` }))))) : null,
                h('button', { type: 'button', class: 'btn btn-secondary', text: 'Email me this summary', on: { click: () => tryDo(async () => { const r = await api('POST', `/api/elders/${eid()}/digest/send`, { days: period }); say(r.provider === 'dev' ? 'Summary saved to your notifications (email provider not configured on this server).' : 'Summary sent to ' + r.to + '.'); }) } })),
            h('section', { class: 'form-section' }, h('h2', { text: 'Day by day' }),
                h('table', { class: 'care-days' }, h('thead', {}, h('tr', {}, ['Date', 'Taken', 'Rate', ''].map(x => h('th', { text: x })))), h('tbody', {}, dayRows))));
    }

    /* ---- Circle & settings ---- */
    async function pCircle() {
        const [{ notifications }] = await Promise.all([api('GET', '/api/notifications'), loadCircleData()]);
        const u = S.user, isElder = u.role === 'elder';
        const out = [];
        if (isElder) {
            let codeBox = h('div', {});
            const role = h('select', { id: 'inv-role', 'aria-label': 'Who is this passcode for' }, h('option', { value: 'family', text: 'A family member (view only)' }), h('option', { value: 'caretaker', text: 'A caretaker (can edit and mark doses)' }));
            out.push(h('section', { class: 'form-section' }, h('h2', { text: 'Invite someone' }),
                h('p', { class: 'hint', text: 'Create a one-time passcode and give it to them. It works once and expires in 48 hours.' }), role, codeBox,
                h('button', { type: 'button', class: 'btn btn-primary', text: 'Create passcode', on: { click: () => tryDo(async () => {
                    const r = await api('POST', '/api/care/invites', { role: role.value });
                    codeBox.replaceChildren(h('div', { class: 'care-code', text: r.code }), h('p', { class: 'hint', text: `For a ${r.role}. They enter it after signing up. Shown once.` }));
                }) } })));
            out.push(h('section', { class: 'form-section' }, h('h2', { text: 'Your care circle' }),
                S.members.length ? h('ul', { class: 'care-list' }, S.members.map(m => h('li', { class: 'care-row' }, h('span', {}, h('strong', { text: m.name }), h('div', { class: 'meta', text: `${m.role === 'caretaker' ? 'Caretaker' : 'Family (view only)'} · ${m.email}` })),
                    h('button', { type: 'button', class: 'btn btn-danger', text: 'Remove access', on: { click: () => tryDo(async () => { await api('DELETE', `/api/care/links/${m.link_id}`); await render(); }) } })))) : h('p', { class: 'care-empty', text: 'Nobody yet.' })));
        } else {
            out.push(h('section', { class: 'form-section' }, h('h2', { text: 'People you look after' }),
                S.elders.length ? h('ul', { class: 'care-list' }, S.elders.map(e => h('li', { class: 'care-row' }, h('span', {}, h('strong', { text: e.name }), h('div', { class: 'meta', text: e.write ? 'You can edit and mark doses' : 'View only' })),
                    h('button', { type: 'button', class: 'btn btn-danger', text: 'Leave', on: { click: () => tryDo(async () => { await api('DELETE', `/api/care/links/${e.link_id}`); await loadCircle(); }) } })))) : h('p', { class: 'care-empty', text: 'Not linked to anyone yet. Enter the passcode the elder gave you.' }),
                h('form', { on: { submit: e => { e.preventDefault(); tryDo(async () => { await api('POST', '/api/care/join', { code: $('join-code').value }); say('You are now linked.'); await loadCircle(); }); } } },
                    h('div', { class: 'form-group' }, h('label', { htmlFor: 'join-code', text: 'Care passcode' }), h('input', { id: 'join-code', type: 'text', maxLength: 9, placeholder: 'K7M2-9QXP', autocomplete: 'off', required: true })),
                    h('button', { type: 'submit', class: 'btn btn-primary', text: 'Link to this person' }))));
        }
        out.push(h('section', { class: 'form-section' }, h('h2', { text: 'My email settings' }),
            h('div', { class: 'form-group' }, h('label', {}, h('input', { type: 'checkbox', checked: u.email_reminders, on: { change: e => tryDo(async () => { const r = await api('PATCH', '/api/me', { email_reminders: e.target.checked }); S.user = r.user; say('Saved.'); }) } }), ' Send me reminders and alerts at ' + u.email)),
            isElder ? h('p', { class: 'hint', text: 'You get a reminder 15 minutes before each dose and an email to your whole circle if one is missed.' }) : h('div', { class: 'form-group' }, h('label', { htmlFor: 'dg', text: 'Summary email' }),
                h('select', { id: 'dg', on: { change: e => tryDo(async () => { const r = await api('PATCH', '/api/me', { digest: e.target.value }); S.user = r.user; say('Saved.'); }) } }, [['off', 'Off'], ['daily', 'Every evening (8 pm)'], ['weekly', 'Sunday morning (9 am)']].map(([v, l]) => h('option', { value: v, text: l, selected: u.digest === v }))))));
        const delPw = h('input', { id: 'del-pass', type: 'password', autocomplete: 'current-password', maxLength: 128, required: true });
        const delWord = h('input', { id: 'del-word', type: 'text', autocomplete: 'off', maxLength: 6, placeholder: 'DELETE', required: true });
        out.push(h('section', { class: 'form-section' }, h('h2', { text: 'Your data' }),
            h('p', { class: 'hint', text: isElder
                ? 'Download everything ElderEase keeps about you: medicines, every dose and who marked it, appointments, your care circle and the emails sent.'
                : 'Download everything ElderEase keeps about you: your account, who you are linked to, and the emails sent to you.' }),
            h('p', {}, h('a', { class: 'btn btn-secondary', href: '/api/me/export', download: '', text: 'Download my data' })),
            h('details', { class: 'care-delete' }, h('summary', { text: 'Delete my account' }),
                h('p', { class: 'hint', text: isElder
                    ? 'This removes your account, all your medicines, dose history and appointments, and ends access for everyone in your circle. It cannot be undone. Download your data first if you want a copy.'
                    : 'This removes your account and your access. The people you look after keep their records. It cannot be undone.' }),
                h('form', { on: { submit: e => { e.preventDefault(); tryDo(async () => {
                    await api('POST', '/api/me/delete', { password: delPw.value, confirm: delWord.value.trim().toUpperCase() === 'DELETE' ? 'DELETE' : delWord.value });
                    try { sessionStorage.clear(); } catch (x) { /* ignore */ }
                    location.replace('index.html');
                }); } } },
                    h('div', { class: 'form-group' }, h('label', { htmlFor: 'del-pass', text: 'Your password' }), delPw),
                    h('div', { class: 'form-group' }, h('label', { htmlFor: 'del-word', text: 'Type DELETE to confirm' }), delWord),
                    h('button', { type: 'submit', class: 'btn btn-danger', text: 'Delete my account for good' })))));
        out.push(h('section', { class: 'form-section' }, h('h2', { text: 'Recent notifications' }),
            notifications.length ? h('ul', { class: 'care-list' }, notifications.slice(0, 15).map(n => h('li', { class: 'care-row' }, h('span', {}, h('strong', { text: n.subject }), h('div', { class: 'meta', text: n.preview.replace(/\s+/g, ' ').slice(0, 140) })), h('span', { class: 'meta', text: `${n.status === 'dev' ? 'logged' : n.status} · ${new Date(n.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` })))) : h('p', { class: 'care-empty', text: 'No emails yet.' })));
        return h('div', { class: 'care-grid two' }, out);
    }
    async function loadCircleData() { const c = await api('GET', '/api/care/circle'); S.members = c.members; S.elders = c.elders.map(e => ({ ...e, write: e.write })); if (S.elder) S.elder = S.elders.find(x => x.id === S.elder.id) || S.elders[0] || null; }

    /* ---- start ---- */
    (async function init() {
        syncRole();
        try { S.demo = (await api('GET', '/api/health')).demo; } catch (e) { /* server not reachable */ }
        $('care-demo').hidden = !S.demo;
        try {
            const r = await api('GET', '/api/session');                 // 200 with user: null when signed out, so no error in the console
            if (r.user) { S.user = r.user; await enterApp(); } else showAuth();
        } catch (e) { showAuth(); if (e.status !== 401) showMsg('Cannot reach the ElderEase server. Start it with "npm start" (see BACKEND.md).', false); }
    })();
})();
