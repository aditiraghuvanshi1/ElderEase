/* elder-sync.js — connects the elder's home page to the ElderEase server.
   Only does anything when the elder signed in with a server account (Auth.current().server).
   Then today's medicines come from the server schedule (set by the elder or a caretaker in Care Circle),
   "Taken" / "Skip" are saved to the shared dose history, and changes made by a caretaker appear here live.
   Loaded after app.js and before features.js. Writes everything with textContent: no HTML from the server is trusted. */
window.ElderSync = (function () {
    'use strict';
    const s = (typeof Auth !== 'undefined') ? Auth.current() : null;
    const active = Boolean(s && s.server && Number.isInteger(s.serverId));
    const state = { active, elderId: active ? s.serverId : null, doses: [], appointments: [], week: null, write: false, loaded: false };
    if (!active) return state;

    const $ = id => document.getElementById(id);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const LABEL = { pending: 'Not yet', taken: 'Taken', skipped: 'Skipped', missed: 'Missed' };

    async function api(method, url, body) {
        const res = await fetch(url, { method, credentials: 'same-origin', signal: AbortSignal.timeout(15000),
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ElderEase' }, body: body ? JSON.stringify(body) : undefined });
        let json = {};
        try { json = await res.json(); } catch (e) { /* no body */ }
        if (res.status === 401) { Auth.logout(); throw new Error('Your sign-in has ended. Please log in again.'); }
        if (!res.ok) throw new Error(json.error || 'That did not work. Try again.');
        return json;
    }
    const changed = () => window.dispatchEvent(new CustomEvent('eldersync'));

    async function refresh() {
        try {
            const o = await api('GET', `/api/elders/${state.elderId}/overview`);
            state.doses = Array.isArray(o.doses) ? o.doses : [];
            state.appointments = Array.isArray(o.appointments) ? o.appointments : [];
            state.week = o.week || null;
            state.write = Boolean(o.write);
            state.loaded = true;
            render();
            changed();
        } catch (e) {
            const box = $('server-doses');
            if (box) { box.replaceChildren(el('p', 'empty-note', 'Could not load your medicines. ' + e.message)); box.hidden = false; }
        }
    }

    async function mark(doseId, status) {
        try {
            await api('POST', `/api/doses/${Number(doseId)}/mark`, { status });
            if (typeof toast === 'function') toast(status === 'taken' ? 'Marked as taken. Your care circle can see it.' : 'Marked as skipped.');
            await refresh();
            return true;
        } catch (e) {
            if (typeof toast === 'function') toast(e.message);
            return false;
        }
    }

    function render() {
        const box = $('server-doses');
        if (!box) return;
        const local = $('local-meds');
        if (local) local.hidden = true;
        box.hidden = false;
        const kids = [];

        if (!state.doses.length) {
            kids.push(el('p', 'empty-note', 'No medicines scheduled today.'));
        } else {
            const list = el('ul', 'dose-list');
            const now = Date.now();
            state.doses.forEach(d => {
                const li = el('li', 'dose-row is-' + d.status);
                li.append(el('span', 'dose-time', d.hhmm));
                const name = el('span', 'dose-name', d.name);
                if (d.dose) name.append(' ', el('small', null, d.dose));
                li.append(name);
                const st = el('span', 'dose-state');
                st.textContent = LABEL[d.status] || d.status;
                if ((d.status === 'taken' || d.status === 'skipped') && d.acted_by_name) st.textContent += ` (${d.acted_by_name})`;
                li.append(st);
                const canAct = (d.status === 'pending' || d.status === 'missed') && Date.parse(d.due_at) <= now + 3 * 3600e3;
                if (canAct) {
                    const acts = el('span', 'dose-actions');
                    const take = el('button', 'btn btn-primary btn-sm', 'Taken');
                    take.type = 'button';
                    take.setAttribute('aria-label', `Taken: ${d.name} at ${d.hhmm}`);
                    take.addEventListener('click', () => { take.disabled = true; mark(d.id, 'taken'); });
                    const skip = el('button', 'btn btn-secondary btn-sm', 'Skip');
                    skip.type = 'button';
                    skip.setAttribute('aria-label', `Skip: ${d.name} at ${d.hhmm}`);
                    skip.addEventListener('click', () => { skip.disabled = true; mark(d.id, 'skipped'); });
                    acts.append(take, skip);
                    li.append(acts);
                } else if (d.status === 'pending') {
                    li.append(el('span', 'dose-actions dose-later', 'Later today'));
                }
                list.append(li);
            });
            kids.push(list);
        }

        if (state.week && state.week.rate != null) kids.push(el('p', 'dose-week', `Last 7 days: ${state.week.rate}% of doses taken.`));
        if (state.appointments.length) {
            const a = state.appointments[0];
            kids.push(el('p', 'dose-week', `Next appointment: ${a.title}${a.doctor ? ' with ' + a.doctor : ''}, ${a.local}.`));
        }
        const link = el('a', 'link-inline', 'Change medicines, appointments or who can see them');
        link.href = 'care.html';
        const p = el('p', 'dose-week'); p.append(link);
        kids.push(p);
        box.replaceChildren(...kids);
    }

    // live updates: a caretaker marking a dose or editing a medicine shows up here within a second
    function listen() {
        if (!('EventSource' in window)) { setInterval(refresh, 60000); return; }
        const es = new EventSource(`/api/elders/${state.elderId}/stream`);
        let t = null;
        const soon = () => { clearTimeout(t); t = setTimeout(refresh, 250); };
        ['dose', 'meds', 'appts', 'circle'].forEach(ev => es.addEventListener(ev, soon));
        window.addEventListener('pagehide', () => es.close());
    }

    // alarms for features.js: today's doses that are still open, as { id, doseId, name, time }
    function alarms() {
        return state.doses.filter(d => d.status === 'pending')
            .map(d => ({ id: 'd' + d.id, doseId: d.id, name: d.dose ? `${d.name} ${d.dose}` : d.name, time: d.hhmm }));
    }

    // plain-text lines for the "send to family" daily summary
    function summaryLines() {
        if (!state.doses.length) return 'No medicines scheduled today.';
        return state.doses.map(d => `${d.hhmm} ${d.name}${d.dose ? ' ' + d.dose : ''}: ${LABEL[d.status] || d.status}`).join('\n');
    }

    function start() { refresh(); listen(); setInterval(refresh, 5 * 60000); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

    return Object.assign(state, { refresh, mark, alarms, summaryLines });
})();
