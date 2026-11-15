/* features.js — loaded AFTER app.js. Adds: toasts, richer task flow (finish / withdraw / reassign / cancel /
   repost / repeat / expiry), per-task chat, SOS, medicine reminders, read-aloud, PWA and accessibility helpers. */

/* ---------- TOASTS (replace alert) ---------- */
window.toast = function (msg, opts) {
    opts = (typeof opts === 'number') ? { ms: opts } : (opts || {});
    let box = document.getElementById('toast-box');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toast-box';
        box.setAttribute('role', 'status');
        box.setAttribute('aria-live', 'polite');
        document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    const text = document.createElement('div');
    text.textContent = String(msg);
    t.appendChild(text);
    const close = () => { t.classList.add('hide'); setTimeout(() => t.remove(), 300); };
    if (opts.actions) {
        const row = document.createElement('div');
        row.className = 'toast-actions';
        opts.actions.forEach(a => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = a.label;
            b.onclick = () => { try { a.fn && a.fn(); } finally { close(); } };
            row.appendChild(b);
        });
        t.appendChild(row);
    }
    box.appendChild(t);
    if (!opts.sticky) setTimeout(close, opts.ms || 4500);
    return t;
};

(function () {
    'use strict';
    if (typeof AUTH_OK === 'undefined' || !AUTH_OK) return;   // redirecting to login

    const $ = id => document.getElementById(id);
    const pad = n => String(n).padStart(2, '0');
    const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const findTask = id => tasks.find(t => String(t.id) === String(id));
    const phoneDigits = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };

    function persist() {
        saveGlobalState();
        renderTasks();
        checkPendingApprovals();
        checkActiveInProgressTasks();
    }

    /* ---------- CORE FLOW ---------- */
    window.markFinished = function (id) {
        const t = findTask(id);
        if (!t || t.helperId !== activeProfile.id || t.status !== 'in_progress') return;
        t.status = 'finished';
        persist();
        toast('Marked as finished. Your Mitra Coins are released when the elder confirms.');
    };

    window.withdrawOffer = function (id) {
        const t = findTask(id);
        if (!t || t.helperId !== activeProfile.id || !['pending_approval', 'in_progress'].includes(t.status)) return;
        t.status = 'open'; t.helperName = null; t.helperId = null;
        persist();
        toast('You withdrew. The request is open again for other helpers.');
    };

    window.reassignTask = function (id) {
        const t = findTask(id);
        if (!t || !canManage(t) || !['in_progress', 'finished'].includes(t.status)) return;
        t.status = 'open'; t.helperName = null; t.helperId = null;
        persist();
        toast('Request reopened so another helper can offer.');
    };

    window.cancelTask = function (id) {
        const t = findTask(id);
        if (!t || !canManage(t) || t.status !== 'open') return;
        t.status = 'cancelled';
        persist();
        toast('Request cancelled. You can repost it from "My history".');
    };

    window.repostTask = function (id) {
        const t = findTask(id);
        if (!t || !canManage(t) || !['cancelled', 'expired'].includes(t.status)) return;
        t.status = 'open';
        t.createdAt = Date.now();
        if (t.scheduledFor && t.scheduledFor < Date.now()) t.scheduledFor = null;
        persist();
        toast('Request posted again.');
    };

    // Recurring requests: when one is confirmed done, queue the next one (called from app.js)
    window.spawnRepeat = function (t) {
        if (!t.repeat || t.repeat === 'none') return;
        const step = (t.repeat === 'daily' ? 1 : 7) * 864e5;
        let when = (t.scheduledFor || Date.now()) + step;
        while (when < Date.now()) when += step;
        tasks.unshift({ ...t, id: `task-${Date.now()}`, status: 'open', helperName: null, helperId: null,
                        friendlyRating: null, completedAt: null, scheduledFor: when, createdAt: Date.now() });
    };

    // Open requests that nobody picked up expire: 48h after posting, or 2h after the scheduled time
    function expireOldTasks() {
        const now = Date.now();
        let changed = false;
        tasks.forEach(t => {
            if (t.status !== 'open' || !t.createdAt) return;
            const deadline = t.scheduledFor ? t.scheduledFor + 2 * 36e5 : t.createdAt + 48 * 36e5;
            if (now > deadline) { t.status = 'expired'; changed = true; }
        });
        if (changed) { saveGlobalState(); renderTasks(); }
    }

    /* ---------- CHAT (only the elder who owns the task and the helper they accepted) ---------- */
    const CHAT_KEY = 'neChats';
    let chatTaskId = null;
    const readChats = () => {
        try {
            const v = JSON.parse(localStorage.getItem(CHAT_KEY));
            if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
            Object.keys(v).forEach(k => { if (!Array.isArray(v[k])) delete v[k]; });
            return v;
        } catch (e) { return {}; }
    };

    function chatAllowed(t) {
        if (!t || !['in_progress', 'finished'].includes(t.status)) return false;
        return PAGE_ROLE === 'adult' ? canManage(t) : t.helperId === activeProfile.id;
    }

    function buildChatModal() {
        if ($('chat-modal')) return;
        const m = document.createElement('div');
        m.id = 'chat-modal';
        m.className = 'modal-overlay';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        m.setAttribute('aria-labelledby', 'chat-title');
        m.innerHTML = `
            <div class="modal-content chat-box">
                <button type="button" class="modal-close-btn" aria-label="Close chat" data-action="close-chat">&times;</button>
                <h2 id="chat-title">Chat</h2>
                <div id="chat-log" class="chat-log"></div>
                <form id="chat-form" class="chat-form">
                    <input id="chat-input" type="text" placeholder="Type a message…" maxlength="300" autocomplete="off" required aria-label="Message">
                    <button class="btn btn-primary" type="submit">Send</button>
                </form>
            </div>`;
        document.body.appendChild(m);
        $('chat-form').addEventListener('submit', e => {
            e.preventDefault();
            const input = $('chat-input');
            const text = input.value.trim();
            const t = findTask(chatTaskId);
            if (!text || !chatAllowed(t)) return;
            const chats = readChats();
            const list = chats[chatTaskId] || [];
            const recent = list.filter(m => m.from === activeProfile.id && Date.now() - m.ts < 60000).length;
            if (recent >= 15) { toast('You are sending messages very quickly. Please wait a moment.'); return; }
            list.push({ from: activeProfile.id, name: activeProfile.name, text: cleanText(text, 300), ts: Date.now() });
            chats[chatTaskId] = list.slice(-200);
            localStorage.setItem(CHAT_KEY, JSON.stringify(chats));
            input.value = '';
            renderChat();
        });
    }

    function renderChat() {
        const log = $('chat-log');
        if (!log || !chatTaskId) return;
        const list = readChats()[chatTaskId] || [];
        log.innerHTML = '';
        if (!list.length) {
            const p = document.createElement('p');
            p.className = 'chat-empty';
            p.textContent = 'Say hello and agree a time. Never share bank details, card numbers or OTPs here.';
            log.appendChild(p);
        }
        list.filter(msg => msg && typeof msg === 'object').forEach(msg => {
            const row = document.createElement('div');
            row.className = 'chat-msg ' + (msg.from === activeProfile.id ? 'mine' : 'theirs');
            const who = document.createElement('small');
            who.textContent = (msg.from === activeProfile.id ? 'You' : String(msg.name || 'Neighbour')) + ' · ' + new Date(Number(msg.ts) || 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const body = document.createElement('div');
            body.textContent = String(msg.text || '');
            row.append(who, body);
            log.appendChild(row);
        });
        log.scrollTop = log.scrollHeight;
    }

    window.openChat = function (id) {
        const t = findTask(id);
        if (!chatAllowed(t)) { toast('Chat opens after the elder accepts a helper.'); return; }
        buildChatModal();
        chatTaskId = t.id;
        $('chat-title').textContent = t.title;
        renderChat();
        $('chat-modal').style.display = 'flex';
        $('chat-input').focus();
    };
    window.closeChat = function () {
        const m = $('chat-modal');
        if (m) m.style.display = 'none';
        chatTaskId = null;
    };

    window.addEventListener('storage', e => {
        if (e.key !== CHAT_KEY) return;
        const open = $('chat-modal') && $('chat-modal').style.display === 'flex';
        if (open) { renderChat(); return; }
        try {
            const chats = readChats();
            Object.keys(chats).forEach(id => {
                const last = chats[id][chats[id].length - 1];
                if (last && last.from !== activeProfile.id && Date.now() - last.ts < 4000 && chatAllowed(findTask(id))) {
                    toast(`${String(last.name || 'Neighbour')}: ${String(last.text || '').slice(0, 300)}`);
                }
            });
        } catch (err) { /* ignore */ }
    });

    /* ---------- READ ALOUD (works with Indian scripts if the device has the voice) ---------- */
    function speak(text) {
        if (!('speechSynthesis' in window)) { toast('Read-aloud is not supported on this browser.'); return; }
        if (speechSynthesis.speaking) { speechSynthesis.cancel(); return; }
        const u = new SpeechSynthesisUtterance(text);
        const scripts = [[/[\u0900-\u097F]/, 'hi-IN'], [/[\u0980-\u09FF]/, 'bn-IN'], [/[\u0B80-\u0BFF]/, 'ta-IN'],
                         [/[\u0C00-\u0C7F]/, 'te-IN'], [/[\u0A80-\u0AFF]/, 'gu-IN'], [/[\u0A00-\u0A7F]/, 'pa-IN']];
        u.lang = (scripts.find(([re]) => re.test(text)) || [null, 'en-IN'])[1];
        u.rate = 0.9;
        speechSynthesis.speak(u);
    }
    window.speakTask = function (id) {
        const t = findTask(id);
        if (t) speak(`${t.title}. ${t.desc}. ${t.location}.`);
    };

    /* ---------- SOS (elder page) ---------- */
    function sosParts() {
        return {
            name: activeProfile.name || 'Elder',
            address: localStorage.getItem(userKey('elderEmergencyAddress')) || '',
            doctor: localStorage.getItem(userKey('elderEmergencyPhone')) || '',
            family: phoneDigits(localStorage.getItem(userKey('elderFamilyPhone')))
        };
    }

    function buildSOS() {
        if (PAGE_ROLE !== 'adult') return;
        const fab = document.createElement('button');
        fab.id = 'sos-fab';
        fab.type = 'button';
        fab.setAttribute('aria-label', 'Emergency SOS');
        fab.textContent = 'SOS';
        document.body.appendChild(fab);

        const m = document.createElement('div');
        m.id = 'sos-modal';
        m.className = 'modal-overlay';
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-modal', 'true');
        m.setAttribute('aria-labelledby', 'sos-title');
        m.innerHTML = `
            <div class="modal-content sos-box">
                <button type="button" class="modal-close-btn" aria-label="Close" data-action="close-modal">&times;</button>
                <h2 id="sos-title">Send an alert to your family</h2>
                <p id="sos-status" class="sos-status">Finding your location…</p>
                <a id="sos-wa" class="sos-btn sos-wa" target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
                <a id="sos-sms" class="sos-btn sos-sms">Send as SMS</a>
                <a id="sos-call" class="sos-btn sos-call" href="tel:112">Call 112 now</a>
                <p class="sos-hint">Save a family WhatsApp number on your Home page so the alert goes straight to them.</p>
            </div>`;
        document.body.appendChild(m);

        fab.addEventListener('click', () => {
            const p = sosParts();
            const build = locLine => encodeURIComponent(
                `EMERGENCY — I need help!\nName: ${p.name}\n${locLine}${p.address ? '\nAddress: ' + p.address : ''}` +
                `${p.doctor ? '\nDoctor/Kin: ' + p.doctor : ''}\nAmbulance 108 · Emergency 112\n(Sent from ElderEase)`);
            const setLinks = locLine => {
                const body = build(locLine);
                $('sos-wa').href = `https://wa.me/${p.family}?text=${body}`;
                $('sos-sms').href = `sms:${p.family ? '+' + p.family : ''}?body=${body}`;
            };
            setLinks('Location: not available');
            $('sos-status').textContent = 'Finding your location… you can already send, or wait a few seconds for a map link.';
            m.style.display = 'flex';
            if (!navigator.geolocation) { $('sos-status').textContent = 'Location not supported on this device.'; return; }
            navigator.geolocation.getCurrentPosition(pos => {
                const { latitude, longitude } = pos.coords;
                setLinks(`Location: https://maps.google.com/?q=${latitude},${longitude}`);
                $('sos-status').textContent = 'Location added. Choose how to send.';
            }, () => {
                $('sos-status').textContent = 'Could not get location (permission off?). The alert will still include your saved address.';
            }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
        });
    }

    /* ---------- MEDICINE REMINDERS (elder page) ---------- */
    const remKey = () => userKey('elderMedReminders');
    // With a server account the alarm list is today's open doses from the server schedule;
    // only "already rang / waiting since" is remembered in this browser.
    const srv = () => Boolean(window.ElderSync && ElderSync.active);
    const firedKey = () => userKey('elderServerAlarms');
    const readFired = () => { try { const v = JSON.parse(localStorage.getItem(firedKey())); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } };
    const loadRem = () => {
        if (srv()) {
            const fired = readFired();
            return ElderSync.alarms().map(a => ({ firedOn: null, pendingSince: null, familyAsked: false, ...(fired[a.id] || {}), ...a }));
        }
        try {
            const v = JSON.parse(localStorage.getItem(remKey()));
            return Array.isArray(v) ? v.filter(r => r && typeof r.name === 'string' && typeof r.time === 'string') : [];
        } catch (e) { return []; }
    };
    const saveRem = list => {
        if (srv()) {
            const keep = {};
            list.forEach(r => { keep[r.id] = { firedOn: r.firedOn, pendingSince: r.pendingSince, familyAsked: r.familyAsked }; });
            localStorage.setItem(firedKey(), JSON.stringify(keep));
            return;
        }
        localStorage.setItem(remKey(), JSON.stringify(list));
    };

    function buildReminders() {
        if (PAGE_ROLE !== 'adult') return;
        const slot = $('reminder-slot');
        if (!slot) return;                       // only the Home page shows the reminders card
        const s = document.createElement('section');
        s.className = 'form-section';
        s.id = 'reminder-section';
        s.innerHTML = `
            <h2 data-i18n="mr_title">Medicine Reminders</h2>
            <p class="form-intro" data-i18n="mr_intro">Add each medicine with its time.</p>
            <form id="reminder-form" class="reminder-form">
                <input id="rem-name" type="text" data-i18n-ph="mr_name" placeholder="Medicine (e.g., BP tablet)" required aria-label="Medicine name" maxlength="60">
                <input id="rem-time" type="time" required aria-label="Time to take it">
                <button class="btn btn-secondary" type="submit" data-i18n="add">Add</button>
            </form>
            <div id="reminder-list"></div>
            <button type="button" id="rem-notify-btn" class="btn btn-secondary btn-block-top" data-i18n="notif">Allow notifications</button>`;
        if (srv()) {
            // the schedule lives on the server; this card only shows it and rings at each time
            s.querySelector('[data-i18n="mr_intro"]').remove();
            s.querySelector('#reminder-form').replaceWith(Object.assign(document.createElement('p'), {
                className: 'form-intro',
                textContent: 'This page rings at each dose time while it is open. You also get an email 15 minutes before, and your care circle is told if a dose is missed.' }));
            window.addEventListener('eldersync', renderReminders);
        }
        slot.appendChild(s);
        I18N.apply(s);
        window.addEventListener('langchange', renderReminders);
        if (srv()) { $('rem-notify-btn').addEventListener('click', notifyAsk); renderReminders(); return; }

        $('reminder-form').addEventListener('submit', e => {
            e.preventDefault();
            const list = loadRem();
            const name = cleanLine($('rem-name').value, 60), time = $('rem-time').value;
            if (!name || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { toast('Add the medicine name and a time.'); return; }
            if (list.length >= 20) { toast('You can keep up to 20 reminders.'); return; }
            list.push({ id: 'r-' + Date.now(), name, time, firedOn: null, pendingSince: null, familyAsked: false });
            list.sort((a, b) => a.time.localeCompare(b.time));
            saveRem(list);
            e.target.reset();
            renderReminders();
            toast('Reminder added.');
        });
        $('rem-notify-btn').addEventListener('click', notifyAsk);
        renderReminders();
    }
    async function notifyAsk() {
        if (!('Notification' in window)) { toast('Notifications are not supported on this browser.'); return; }
        const r = await Notification.requestPermission();
        toast(r === 'granted' ? 'Notifications are on.' : 'Notifications are blocked. You will still see and hear reminders on this page.');
    }

    function renderReminders() {
        const box = $('reminder-list');
        if (!box) return;
        const list = loadRem();
        box.innerHTML = '';
        if (srv()) {
            if (!ElderSync.loaded) { box.innerHTML = '<p class="chat-empty">Loading your medicine times...</p>'; return; }
            if (!list.length) { box.innerHTML = '<p class="chat-empty">No more doses due today.</p>'; return; }
            list.forEach(r => {
                const row = document.createElement('div');
                row.className = 'reminder-row';
                row.textContent = `${r.time}  ${r.name}`;
                box.appendChild(row);
            });
            return;
        }
        if (!list.length) {
            box.innerHTML = `<p class="chat-empty">${escapeHTML(I18N.t('no_rem'))}</p>`;
            return;
        }
        list.forEach(r => {
            const row = document.createElement('div');
            row.className = 'reminder-row';
            const label = document.createElement('span');
            label.textContent = `${r.name} — ${r.time}`;
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'btn btn-danger btn-sm';
            del.textContent = I18N.t('delete');
            del.setAttribute('aria-label', 'Delete reminder ' + r.name);
            del.onclick = () => { saveRem(loadRem().filter(x => x.id !== r.id)); renderReminders(); };
            row.append(label, del);
            box.appendChild(row);
        });
    }

    function beep() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [0, 0.35, 0.7].forEach(delay => {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
                g.gain.setValueAtTime(0.25, ctx.currentTime + delay);
                o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.25);
            });
        } catch (e) { /* sound blocked until the page has been clicked once */ }
    }

    function logTaken(r) {
        const { todayKey, data } = getDailyLogs();
        data[todayKey].entries.unshift({ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: `Took ${r.name} (reminder)`, type: 'medication' });
        localStorage.setItem(userKey('elderDailyHealthLogs'), JSON.stringify(data));
        renderDailyLogEntriesUI();
    }

    function updateRem(id, patch) {
        const list = loadRem();
        const r = list.find(x => x.id === id);
        if (r) { Object.assign(r, patch); saveRem(list); }
    }

    function fireReminder(r) {
        beep();
        speak(`Time to take your ${r.name}`);
        if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Medicine time', { body: `Take your ${r.name}`, icon: 'icon-192.png' }); } catch (e) { /* ignore */ }
        }
        toast(`Time to take: ${r.name}`, {
            sticky: true,
            actions: [
                { label: 'Taken', fn: () => { updateRem(r.id, { pendingSince: null }); if (r.doseId) ElderSync.mark(r.doseId, 'taken'); else logTaken(r); } },
                { label: 'Snooze 10 min', fn: () => setTimeout(() => fireReminder(r), 10 * 60000) }
            ]
        });
    }

    function offerFamily(r) {
        const p = sosParts();
        const msg = encodeURIComponent(`Hi, ${p.name} has not confirmed taking "${r.name}" (due ${r.time}). Please check in. — ElderEase`);
        toast(`You haven't confirmed "${r.name}" yet.`, {
            sticky: true,
            actions: [
                { label: 'Tell family', fn: () => window.open(`https://wa.me/${p.family}?text=${msg}`, '_blank', 'noopener,noreferrer') },
                { label: 'Dismiss', fn: () => updateRem(r.id, { pendingSince: null }) }
            ]
        });
    }

    function reminderTick() {
        const list = loadRem();
        if (!list.length) return;
        const now = new Date();
        const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const today = localDate(now);
        let changed = false;
        list.forEach(r => {
            if (r.time === hm && r.firedOn !== today) {
                r.firedOn = today; r.pendingSince = Date.now(); r.familyAsked = false; changed = true;
                fireReminder(r);
            }
            if (r.pendingSince && !r.familyAsked && Date.now() - r.pendingSince > 30 * 60000) {
                r.familyAsked = true; changed = true;
                offerFamily(r);
            }
        });
        if (changed) saveRem(list);
    }

    /* ---------- ACCESSIBILITY ---------- */
    function a11yPass() {
        document.querySelectorAll('.field-mic-btn, .mic-round-btn').forEach(b => {
            if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'Speak instead of typing');
        });
        document.querySelectorAll('.modal-overlay').forEach(m => {
            m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            document.querySelectorAll('.modal-overlay').forEach(m => { m.style.display = 'none'; });
            chatTaskId = null;
            if ('speechSynthesis' in window) speechSynthesis.cancel();
        });
    }

    /* ---------- ONE CLICK HANDLER FOR THE WHOLE APP ----------
       Buttons say what they do with data-action="..." instead of onclick="...". Only the actions
       listed here can run, which lets the Content Security Policy block every inline script. */
    const ACTIONS = {
        'claim':          el => claimTask(el.dataset.id),
        'accept':         el => respondToHelper(el.dataset.id, true),
        'decline':        el => respondToHelper(el.dataset.id, false),
        'rate':           el => openRatingModal(el.dataset.id),
        'pick-rating':    el => selectRatingChoice(el.dataset.rating, el),
        'reassign':       el => reassignTask(el.dataset.id),
        'cancel':         el => cancelTask(el.dataset.id),
        'repost':         el => repostTask(el.dataset.id),
        'finish':         el => markFinished(el.dataset.id),
        'withdraw':       el => withdrawOffer(el.dataset.id),
        'chat':           el => openChat(el.dataset.id),
        'close-chat':     () => closeChat(),
        'speak':          el => speakTask(el.dataset.id),
        'call':           el => triggerEmergencyCall(el.dataset.number, el.dataset.label),
        'hospitals':      () => findNearbyHospitals(),
        'call-doctor':    () => callSavedDoctor(),
        'copy-sos':       () => copySOSDetails(),
        'save-log':       () => saveDailyHealthLog(),
        'summary':        () => generateDailyCaregiverSummary(),
        'copy-summary':   () => copyDailySummaryText(),
        'dismiss-reminder': () => dismissDailyReminder(),
        'voice':          el => startVoiceForField(el.dataset.field, el.dataset.label),
        'logout':         () => Auth.logout(),
        'close-modal':    el => { const m = el.closest('.modal-overlay'); if (m) m.style.display = 'none'; if (m && m.id === 'chat-modal') chatTaskId = null; }
    };
    function wireActions() {
        document.addEventListener('click', e => {
            const overlay = e.target.classList && e.target.classList.contains('modal-overlay') ? e.target : null;
            if (overlay) { overlay.style.display = 'none'; if (overlay.id === 'chat-modal') chatTaskId = null; return; }   // click outside the box
            const el = e.target.closest('[data-action]');
            if (!el || !Object.prototype.hasOwnProperty.call(ACTIONS, el.dataset.action)) return;
            if (el.tagName === 'A') e.preventDefault();
            ACTIONS[el.dataset.action](el);
        });
    }

    /* ---------- START ---------- */
    function init() {
        wireActions();
        expireOldTasks();
        setInterval(expireOldTasks, 60000);
        buildSOS();
        buildReminders();
        a11yPass();
        if (PAGE_ROLE === 'adult') { reminderTick(); setInterval(reminderTick, 20000); }
        if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
            navigator.serviceWorker.register('sw.js').catch(() => { /* app still works without it */ });
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
