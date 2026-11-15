// MULTI-SCENARIO DEFAULT DATASET
const defaultTasks = [
    {
        id: "task-1",
        title: "Need help fetching medicine from pharmacy",
        desc: "I need someone to pick up my regular blood pressure prescription from Apollo Pharmacy down the street. Walking has been tough with my knee pain this week.",
        location: "Indiranagar, Bengaluru",
        category: "Household",
        status: "open", // 'open' | 'pending_approval' | 'in_progress' | 'completed'
        isUrgent: true,
        helperName: null,
        friendlyRating: null
    },
    {
        id: "task-2",
        title: "Setup smart TV and JioFiber remote",
        desc: "The new internet connection is too confusing. I just need someone to help configure Hotstar and Netflix on the TV so I can watch my evening serials.",
        location: "Andheri West, Mumbai",
        category: "Tech Support",
        status: "open",
        isUrgent: false,
        helperName: null,
        friendlyRating: null
    },
    {
        id: "task-3",
        title: "Lift heavy steel almirah into bedroom",
        desc: "The delivery workers left a heavy Godrej almirah in the entryway. Need 2 minutes of extra muscle help to safely push it into the primary bedroom.",
        location: "Salt Lake, Block CL, Kolkata",
        category: "Heavy Lifting",
        status: "open",
        isUrgent: false,
        helperName: null,
        friendlyRating: null
    },
    {
        id: "task-4",
        title: "Teach digital payment steps for electricity bill",
        desc: "I want to learn how to pay my electricity and water bills using Google Pay or Paytm safely so I don't have to stand in queues at the office.",
        location: "T Nagar, Chennai",
        category: "Tech Support",
        status: "open",
        isUrgent: false,
        helperName: null,
        friendlyRating: null
    },
    {
        id: "task-5",
        title: "Accompaniment to park for evening walk",
        desc: "Recovering from surgery and feeling unsteady. Just looking for a polite neighbor to walk along with me in the local community park for 20 minutes.",
        location: "Sector 15, Rohini, New Delhi",
        category: "Other",
        status: "open",
        isUrgent: false,
        helperName: null,
        friendlyRating: null
    },
    {
        id: "task-6",
        title: "Urgent: Assist carrying heavy water cans",
        desc: "The regular water supply line is under repair. Bought 2 large 20-litre Bisleri bottles but cannot carry them up to the second floor alone.",
        location: "Hazratganj, Lucknow",
        category: "Heavy Lifting",
        status: "open",
        isUrgent: true,
        helperName: null,
        friendlyRating: null
    },
    {
        id: "task-7",
        title: "Help filing physical pension voucher copies",
        desc: "Have a stack of bank receipts and statements that need to be organized chronologically into cardboard file folders for tax documentation tracking.",
        location: "Bani Park, Jaipur",
        category: "Household",
        status: "open",
        isUrgent: false,
        helperName: null,
        friendlyRating: null
    }
];

// DETERMINE PAGE ROLE ISOLATION
const PAGE_ROLE = document.body.getAttribute('data-page-role') || (window.location.pathname.includes('adult') ? 'adult' : 'helper');
const AUTH_OK = Auth.guard(PAGE_ROLE);   // not logged in / wrong role -> sent back to login

function getActiveProfile() {
    const s = Auth.current();
    return s ? { id: s.id, name: s.name, age: s.age, role: s.role, coins: 0 }
             : { id: null, name: "Guest", role: PAGE_ROLE, coins: 0 };
}

// Per-person data is stored under that person's own id, so accounts on one device never see each other's data
function userKey(base) { const s = Auth.current(); return `${base}:${s ? s.id : 'guest'}`; }

// Elders can only manage their own requests (demo requests without an owner stay open to everyone)
function canManage(task) { return !task.ownerId || task.ownerId === activeProfile.id; }

function rankFor(coins) {
    coins = coins || 0;
    if (coins >= 200) return "Community Legend";
    if (coins >= 100) return "Neighborhood Hero";
    if (coins >= 50) return "Local Helper";
    return "Getting Started";
}

// Which requests the "All / My active / My history" dropdown shows
function scopeMatch(t, scope) {
    const mine = PAGE_ROLE === 'adult' ? t.ownerId === activeProfile.id : t.helperId === activeProfile.id;
    const over = ['completed', 'cancelled', 'expired'].includes(t.status);
    if (scope === 'mine') return mine && !over;
    if (scope === 'history') return mine && over;
    if (t.status === 'cancelled' || t.status === 'expired') return mine;   // dead requests only show to their owner
    return true;
}

let activeProfile = getActiveProfile();

/* ---------- INPUT LIMITS & CLEAN-UP ----------
   Everything typed by a person, or read back from storage, passes through these before it is saved or shown.
   Text is always written to the page escaped (escapeHTML / textContent), so this is the second line of defence. */
const LIMITS = { title: 100, desc: 600, location: 100, address: 200, note: 300, phone: 60, name: 80 };
const CATEGORIES = ['Household', 'Tech Support', 'Heavy Lifting', 'Other'];
const STATUSES = ['open', 'pending_approval', 'in_progress', 'finished', 'completed', 'cancelled', 'expired'];
const REPEATS = ['none', 'daily', 'weekly'];
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const cleanLine = (v, max) => cleanText(v, max).replace(/\s+/g, ' ');
const pick = (v, list, fallback) => list.includes(v) ? v : fallback;
const safeId = v => /^[A-Za-z0-9_-]{1,64}$/.test(String(v)) ? String(v) : null;
const readJSON = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } };

function normaliseTask(t, idx) {
    if (!t || typeof t !== 'object') return null;
    const id = safeId(t.id) || `task-${idx + 1}`;
    const time = v => (typeof v === 'number' && isFinite(v)) ? v : null;
    return {
        id,
        ownerId: t.ownerId ? String(t.ownerId) : undefined,
        ownerName: t.ownerName ? cleanLine(t.ownerName, LIMITS.name) : undefined,
        title: cleanLine(t.title, LIMITS.title) || 'Community request',
        desc: cleanText(t.desc, LIMITS.desc),
        location: cleanLine(t.location, LIMITS.location) || 'Nearby',
        address: cleanText(t.address, LIMITS.address),
        category: pick(t.category, CATEGORIES, 'Other'),
        status: pick(t.status, STATUSES, t.isClaimed ? 'completed' : 'open'),
        isUrgent: Boolean(t.isUrgent),
        helperId: t.helperId ? String(t.helperId) : null,
        helperName: t.helperName ? cleanLine(t.helperName, LIMITS.name) : null,
        friendlyRating: pick(t.friendlyRating, ['friendly', 'unfriendly'], null),
        repeat: pick(t.repeat, REPEATS, 'none'),
        scheduledFor: time(t.scheduledFor),
        createdAt: time(t.createdAt),
        completedAt: time(t.completedAt)
    };
}

function getStoredTasks() {
    const stored = readJSON('indiaNetworkTasks', null);
    if (Array.isArray(stored) && stored.length > 0) {
        const seen = new Set();
        return stored.map(normaliseTask).filter(t => t && !seen.has(t.id) && seen.add(t.id));
    }
    return defaultTasks.map(normaliseTask);
}

let tasks = getStoredTasks();

const DEFAULT_LEADERS = [
    { id: "demo-arjun", name: "Arjun Mehta", coins: 140, friendlyCount: 12 },
    { id: "demo-priya", name: "Priya Sharma", coins: 85, friendlyCount: 8 },
    { id: "demo-rohan", name: "Rohan Das", coins: 40, friendlyCount: 3 }
];
function getStoredLeaders() {
    const stored = readJSON('helperLeaderboard', null);
    if (!Array.isArray(stored)) return DEFAULT_LEADERS.map(l => ({ ...l, badge: rankFor(l.coins) }));
    return stored.filter(l => l && typeof l === 'object').map(l => {
        const coins = Math.max(0, Math.floor(Number(l.coins) || 0));
        return { id: String(l.id || ''), name: cleanLine(l.name, LIMITS.name) || 'Volunteer', coins,
                 friendlyCount: Math.max(0, Math.floor(Number(l.friendlyCount) || 0)), badge: rankFor(coins) };
    });
}
let leaders = getStoredLeaders();

// DAILY HEALTH LOG STORE
function getDailyLogs() {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // local date, not UTC
    let allLogs = readJSON(userKey('elderDailyHealthLogs'), {});
    if (!allLogs || typeof allLogs !== 'object' || Array.isArray(allLogs)) allLogs = {};
    const day = allLogs[today];
    if (!day || typeof day !== 'object' || !day.medications || !Array.isArray(day.entries)) {
        allLogs[today] = {
            medications: { Morning: false, Afternoon: false, Night: false },
            entries: []
        };
    }
    return { todayKey: today, data: allLogs };
}

// Optional AI spam-check/translation. Put the URL of YOUR OWN serverless function here (the key stays on the server).
const AI_PROXY_URL = "";

function saveGlobalState() {
    localStorage.setItem('indiaNetworkTasks', JSON.stringify(tasks));
    localStorage.setItem('helperLeaderboard', JSON.stringify(leaders));
}

// SAFE INITIALIZATION ORDER
document.addEventListener('DOMContentLoaded', () => {
    if (!AUTH_OK) return;
    activeProfile = getActiveProfile();

    const nameDisplay = document.getElementById('display-profile-name');
    if (nameDisplay) {
        nameDisplay.innerText = activeProfile.name || (PAGE_ROLE === 'adult' ? "Elder" : "Helper");
    }

    try { renderTasks(); } catch (err) { console.error("renderTasks error:", err); }
    try { syncStateToUI(); } catch (err) { console.error("syncStateToUI error:", err); }
    try { checkPendingApprovals(); } catch (err) { console.error("checkPendingApprovals error:", err); }
    try { checkActiveInProgressTasks(); } catch (err) { console.error("checkActiveInProgressTasks error:", err); }
    try { initDailyHealthLogUI(); } catch (err) { console.error("initDailyHealthLogUI error:", err); }
    try { initElderEmergencyData(); } catch (err) { console.error("initElderEmergencyData error:", err); }
    try { initElderMode(); } catch (err) { console.error("initElderMode error:", err); }
    try { setupEventListeners(); } catch (err) { console.error("setupEventListeners error:", err); }
});

// re-draw the dynamic parts when the language is switched
window.addEventListener('langchange', () => {
    try { renderTasks(); syncStateToUI(); checkPendingApprovals(); checkActiveInProgressTasks(); renderDailyLogEntriesUI(); } catch (e) { /* page without these parts */ }
});

// REAL-TIME AUTO-UPDATE ACROSS TABS
window.addEventListener('storage', (e) => {
    if (e.key === 'indiaNetworkTasks' || e.key === 'helperLeaderboard' || (e.key || '').startsWith('elderDailyHealthLogs')) {
        tasks = getStoredTasks();
        leaders = getStoredLeaders();
        activeProfile = getActiveProfile();

        syncStateToUI();
        renderTasks();
        checkPendingApprovals();
        checkActiveInProgressTasks();
        initDailyHealthLogUI();
    }
});

// DAILY REMINDER HANDLERS
window.dismissDailyReminder = function() {
    const banner = document.getElementById('daily-reminder-banner');
    if (banner) {
        banner.style.display = 'none';
        sessionStorage.setItem('reminderDismissedToday', 'true');
    }
};

// ACTIVE DAILY HEALTH LOG & MEDICATION CHECKLIST ENGINE
function initDailyHealthLogUI() {
    if (PAGE_ROLE !== 'adult') return;

    const banner = document.getElementById('daily-reminder-banner');
    if (banner && sessionStorage.getItem('reminderDismissedToday') === 'true') {
        banner.style.display = 'none';
    }

    const { todayKey, data } = getDailyLogs();
    const todayData = data[todayKey];

    const morningCb = document.getElementById('med-morning');
    const afternoonCb = document.getElementById('med-afternoon');
    const nightCb = document.getElementById('med-night');

    if (morningCb) morningCb.checked = Boolean(todayData.medications.Morning);
    if (afternoonCb) afternoonCb.checked = Boolean(todayData.medications.Afternoon);
    if (nightCb) nightCb.checked = Boolean(todayData.medications.Night);

    renderDailyLogEntriesUI();
}

window.toggleMedicationLog = function(timeOfDay) {
    const { todayKey, data } = getDailyLogs();
    const cb = document.getElementById(`med-${timeOfDay.toLowerCase()}`);
    if (!cb) return;

    data[todayKey].medications[timeOfDay] = cb.checked;
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const logText = cb.checked ? `Confirmed taking ${timeOfDay} medication` : `Unchecked ${timeOfDay} medication`;
    data[todayKey].entries.unshift({ time: timestamp, text: logText, type: 'medication' });

    localStorage.setItem(userKey('elderDailyHealthLogs'), JSON.stringify(data));
    renderDailyLogEntriesUI();
};

window.saveDailyHealthLog = function() {
    const input = document.getElementById('health-log-input');
    if (!input || !cleanText(input.value, LIMITS.note)) {
        toast('Write or speak a note first, then save.');
        return;
    }

    const { todayKey, data } = getDailyLogs();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    data[todayKey].entries.unshift({
        time: timestamp,
        text: cleanText(input.value, LIMITS.note),
        type: 'health_log'
    });

    localStorage.setItem(userKey('elderDailyHealthLogs'), JSON.stringify(data));
    input.value = '';
    renderDailyLogEntriesUI();
    toast('Note saved to today’s log.');
};

function renderDailyLogEntriesUI() {
    const container = document.getElementById('daily-log-entries-list');
    if (!container) return;

    const { todayKey, data } = getDailyLogs();
    const entries = data[todayKey].entries || [];

    if (entries.length === 0) {
        container.innerHTML = `<p class="empty-note">${escapeHTML(I18N.t('none'))}</p>`;
        return;
    }

    container.innerHTML = '';
    entries.slice(0, 5).forEach(item => {
        const row = document.createElement('div');
        row.className = 'log-item-row';
        row.innerHTML = `<span>${escapeHTML(item.text)}</span> <time>${escapeHTML(item.time)}</time>`;
        container.appendChild(row);
    });
}

// CAREGIVER & FAMILY DAILY HEALTH SUMMARY
window.generateDailyCaregiverSummary = function() {
    const { todayKey, data } = getDailyLogs();
    const todayData = data[todayKey];
    const user = activeProfile.name || "Elder";

    const meds = todayData.medications;
    const medSummary = (window.ElderSync && ElderSync.active && ElderSync.loaded) ? ElderSync.summaryLines() : `Morning: ${meds.Morning ? 'Taken' : 'Pending'} | Afternoon: ${meds.Afternoon ? 'Taken' : 'Pending'} | Night: ${meds.Night ? 'Taken' : 'Pending'}`;

    let healthDetails = todayData.entries.map(e => `• [${e.time}] ${e.text}`).join('\n');
    if (!healthDetails) healthDetails = "• No vitals or health complaints recorded today.";

    const summaryText = `DAILY HEALTH SUMMARY (${todayKey})\nSeeker: ${user}\n\nMEDICATION ADHERENCE:\n${medSummary}\n\nRECORDED HEALTH LOGS:\n${healthDetails}\n\nGenerated by ElderEase.`;

    const modal = document.getElementById('summary-modal');
    const modalBody = document.getElementById('summary-modal-body');
    if (modal && modalBody) {
        modalBody.innerText = summaryText;
        modal.style.display = 'flex';
    }
};

window.closeSummaryModal = function() {
    const modal = document.getElementById('summary-modal');
    if (modal) modal.style.display = 'none';
};

window.copyDailySummaryText = function() {
    const modalBody = document.getElementById('summary-modal-body');
    if (modalBody && navigator.clipboard) {
        navigator.clipboard.writeText(modalBody.innerText).then(() => {
            toast('Summary copied. Paste it into WhatsApp for your family or carer.');
        }).catch(() => {});
    }
};

// MULTI-FIELD VOICE-TO-TEXT ENGINE
let activeSpeechRecognizer = null;
let currentActiveMicBtn = null;

window.startVoiceForField = function(fieldId, fieldLabel) {
    const targetElement = document.getElementById(fieldId);
    const langSelect = document.getElementById('voice-lang-select');
    const statusText = document.getElementById('voice-status-text');

    if (!targetElement) return;

    // Find the adjacent mic button
    let micBtn = null;
    const parentWrapper = targetElement.closest('.input-with-end-mic') || targetElement.parentElement;
    if (parentWrapper) {
        micBtn = parentWrapper.querySelector('.field-mic-btn') || parentWrapper.querySelector('.mic-round-btn');
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        toast('Speaking instead of typing needs Google Chrome or Microsoft Edge.');
        return;
    }

    if (activeSpeechRecognizer && currentActiveMicBtn === micBtn) {
        activeSpeechRecognizer.stop();
        return;
    }

    if (activeSpeechRecognizer) {
        activeSpeechRecognizer.stop();
    }

    try {
        activeSpeechRecognizer = new SpeechRecognition();
        activeSpeechRecognizer.continuous = false;
        activeSpeechRecognizer.interimResults = true;

        const chosenLang = langSelect ? langSelect.value : I18N.lang().speech;
        activeSpeechRecognizer.lang = chosenLang;

        activeSpeechRecognizer.onstart = () => {
            currentActiveMicBtn = micBtn;
            if (micBtn) micBtn.classList.add('recording');

            const langName = (langSelect && langSelect.selectedOptions[0]) ? langSelect.selectedOptions[0].text : 'your language';
            if (statusText) {
                statusText.style.display = 'block';
                statusText.textContent = `Listening in ${langName}. Speak now.`;
            }
        };

        activeSpeechRecognizer.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                transcript += event.results[i][0].transcript;
            }
            if (transcript.trim()) {
                targetElement.value = transcript;
            }
        };

        activeSpeechRecognizer.onerror = (event) => {
            console.warn("Speech recognition error:", event.error);
            if (statusText) {
                statusText.textContent = `The microphone did not start (${event.error}). Check that this site is allowed to use it.`;
            }
        };

        activeSpeechRecognizer.onend = () => {
            if (currentActiveMicBtn) {
                currentActiveMicBtn.classList.remove('recording');
                currentActiveMicBtn = null;
            }
            activeSpeechRecognizer = null;
            if (statusText) {
                statusText.textContent = `Added to ${fieldLabel}. Read it over and edit if needed.`;
                setTimeout(() => { if (statusText) statusText.style.display = 'none'; }, 4000);
            }
        };

        activeSpeechRecognizer.start();
    } catch (err) {
        console.error("Speech recognition start failed:", err);
        if (micBtn) micBtn.classList.remove('recording');
        currentActiveMicBtn = null;
        activeSpeechRecognizer = null;
    }
};

// SYNC UI (WALLET, BADGES, LEADERBOARD)
const pad2 = n => String(n).padStart(2, '0');

function syncStateToUI() {
    const coinCounter = document.getElementById('karma-score');
    const badgeText = document.getElementById('karma-badge-text');
    const leaderboardBox = document.getElementById('leaderboard-container');

    const myEntry = leaders.find(l => l.id && l.id === activeProfile.id);
    if (myEntry && PAGE_ROLE === 'helper') {
        activeProfile.coins = myEntry.coins;
    }

    if (PAGE_ROLE === 'helper') {
        const coins = activeProfile.coins || 0;
        if (coinCounter) coinCounter.textContent = coins;
        if (badgeText) badgeText.textContent = rankFor(coins);
        const friendly = document.getElementById('helper-friendly-count');
        if (friendly) friendly.textContent = myEntry ? myEntry.friendlyCount : 0;

        [['ms-1', 50], ['ms-2', 100], ['ms-3', 200]].forEach(([id, need]) => {
            const li = document.getElementById(id);
            if (!li) return;
            const done = coins >= need;
            li.classList.toggle('unlocked', done);
            li.classList.toggle('locked', !done);
            const state = li.querySelector('.ms-state');
            if (state) state.textContent = done ? 'Unlocked' : `${need - coins} to go`;
        });
    }

    if (leaderboardBox) {
        leaderboardBox.innerHTML = '';
        leaders.sort((a, b) => (b.coins || 0) - (a.coins || 0));
        leaders.slice(0, 10).forEach((lead, i) => {
            const row = document.createElement('li');
            row.className = 'leader-row';
            row.innerHTML = `
                <span class="leader-rank">${pad2(i + 1)}</span>
                <span class="leader-name">${escapeHTML(lead.name)}<small>${escapeHTML(rankFor(lead.coins))} · ${Number(lead.friendlyCount) || 0} friendly ratings</small></span>
                <span class="leader-coins">${Number(lead.coins) || 0}<small>coins</small></span>`;
            leaderboardBox.appendChild(row);
        });
    }
}

// small builder so every action button is written the same way: no inline JavaScript, ids escaped
function actionBtn(action, id, label, cls) {
    return `<button type="button" class="btn ${cls || 'btn-secondary'} btn-sm" data-action="${action}" data-id="${escapeHTML(id)}">${escapeHTML(label)}</button>`;
}

// INCOMING VOLUNTEER NOTIFICATIONS AWAITING APPROVAL
function checkPendingApprovals() {
    const approvalSection = document.getElementById('helper-approval-section');
    const container = document.getElementById('approval-cards-container');
    if (!approvalSection || !container) return;

    if (PAGE_ROLE !== 'adult') {
        approvalSection.hidden = true;
        return;
    }

    const pendingTasks = tasks.filter(t => t.status === 'pending_approval' && canManage(t));
    container.innerHTML = '';
    approvalSection.hidden = pendingTasks.length === 0;

    pendingTasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'approval-card';
        card.innerHTML = `
            <div>
                <h4>${escapeHTML(task.title)}</h4>
                <p><strong>${escapeHTML(task.helperName || 'A neighbour')}</strong> has offered to help with this.</p>
            </div>
            <div class="action-row">
                ${actionBtn('accept', task.id, I18N.t('t_accept'), 'btn-primary')}
                ${actionBtn('decline', task.id, I18N.t('t_decline'), 'btn-secondary')}
            </div>`;
        container.appendChild(card);
    });
}

// ACTIVE IN-PROGRESS SECTION: ASKS THE ADULT IF THE HELP IS DONE
function checkActiveInProgressTasks() {
    const progressSection = document.getElementById('in-progress-section');
    const container = document.getElementById('in-progress-cards-container');
    if (!progressSection || !container) return;

    if (PAGE_ROLE !== 'adult') {
        progressSection.hidden = true;
        return;
    }

    const inProgressTasks = tasks.filter(t => (t.status === 'in_progress' || t.status === 'finished') && canManage(t));
    container.innerHTML = '';
    progressSection.hidden = inProgressTasks.length === 0;

    inProgressTasks.forEach(task => {
        const who = escapeHTML(task.helperName || 'Your helper');
        const card = document.createElement('div');
        card.className = 'in-progress-card';
        card.innerHTML = `
            <div>
                <h4>${escapeHTML(task.title)}</h4>
                <p>${task.status === 'finished'
                    ? `<strong>${who}</strong> says the work is finished. Please confirm and rate.`
                    : `<strong>${who}</strong> is on it. Confirm here once the help is done.`}</p>
            </div>
            <div class="action-row">
                ${actionBtn('chat', task.id, I18N.t('t_chat'))}
                ${actionBtn('rate', task.id, I18N.t('t_confirm'), 'btn-primary')}
                ${actionBtn('reassign', task.id, I18N.t('t_reassign'), 'btn-danger')}
            </div>`;
        container.appendChild(card);
    });
}

// ADULT ACCEPTS OR REJECTS HELPER
window.respondToHelper = function(taskId, accepted) {
    if (PAGE_ROLE !== 'adult') return;
    const task = tasks.find(t => String(t.id) === String(taskId));
    if (!task || !canManage(task) || task.status !== 'pending_approval') return;

    if (accepted) {
        task.status = 'in_progress';
        toast(`You accepted ${task.helperName || 'the helper'}'s offer. When the work is done, press "${I18N.t('t_confirm')}" to release their Mitra Coins.`);
    } else {
        task.status = 'open';
        task.helperName = null;
        task.helperId = null;
        toast('Offer declined. The request is open again for other helpers.');
    }
    saveGlobalState();
    checkPendingApprovals();
    checkActiveInProgressTasks();
    renderTasks();
};

const SPEAK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 9h4l5-4v14l-5-4H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const statusNote = (text, tone) => `<span class="status-note${tone ? ' is-' + tone : ''}">${text}</span>`;

// RENDER TASK BOARD
function renderTasks() {
    const taskBoard = document.getElementById('task-board');
    if (!taskBoard) return;
    taskBoard.innerHTML = '';

    const filterSelect = document.getElementById('filter-select');
    const searchInput = document.getElementById('search-input');

    const selectedCategory = filterSelect ? filterSelect.value : 'All';
    const searchQuery = (searchInput && searchInput.value) ? searchInput.value.toLowerCase().trim().slice(0, 100) : '';
    const scopeSelect = document.getElementById('scope-select');
    const scope = scopeSelect ? scopeSelect.value : 'all';

    const viewableList = tasks.filter(t => {
        const catMatch = (selectedCategory === 'All' || t.category === selectedCategory);
        const searchMatch = !searchQuery || (
            (t.title && t.title.toLowerCase().includes(searchQuery)) ||
            (t.desc && t.desc.toLowerCase().includes(searchQuery)) ||
            (t.location && t.location.toLowerCase().includes(searchQuery))
        );
        return catMatch && searchMatch && scopeMatch(t, scope);
    });

    viewableList.sort((a, b) => {
        if (a.status === 'open' && b.status !== 'open') return -1;
        if (b.status === 'open' && a.status !== 'open') return 1;
        return Number(b.isUrgent) - Number(a.isUrgent);
    });

    const count = document.getElementById('task-count');
    if (count) count.textContent = viewableList.length === 1 ? '1 request' : `${viewableList.length} requests`;

    if (viewableList.length === 0) {
        taskBoard.innerHTML = `<p class="empty-board">${escapeHTML(I18N.t('t_nomatch'))}</p>`;
        return;
    }

    const catLabel = { 'Household': 'c_house', 'Tech Support': 'c_tech', 'Heavy Lifting': 'c_heavy', 'Other': 'c_other' };

    viewableList.forEach(task => {
        const card = document.createElement('article');
        let classes = 'task-card';
        if (task.status === 'completed') classes += ' is-done';
        else if (task.status === 'cancelled' || task.status === 'expired') classes += ' is-closed';
        else if (task.status === 'in_progress' || task.status === 'finished') classes += ' is-active';
        else if (task.status === 'pending_approval') classes += ' is-pending';
        else if (task.isUrgent) classes += ' is-urgent';
        card.className = classes;

        let actionMarkup = '';
        const id = task.id;
        const helper = escapeHTML(task.helperName || 'a helper');
        const chatBtn = actionBtn('chat', id, I18N.t('t_chat'));
        const dead = task.status === 'expired' ? 'Expired. Nobody was free in time.' : 'Cancelled';

        if (PAGE_ROLE === 'helper') {
            const isMe = task.helperId === activeProfile.id;
            if (task.status === 'completed') {
                actionMarkup = statusNote(isMe ? 'Done. Your coins have been added.' : 'Completed');
            } else if (task.status === 'cancelled' || task.status === 'expired') {
                actionMarkup = statusNote(dead);
            } else if (task.status === 'finished') {
                actionMarkup = isMe
                    ? `${statusNote('Waiting for the elder to confirm', 'active')}${chatBtn}`
                    : statusNote(`Taken by ${helper}`);
            } else if (task.status === 'in_progress') {
                actionMarkup = isMe
                    ? `${chatBtn}${actionBtn('finish', id, "I've finished", 'btn-primary')}${actionBtn('withdraw', id, 'Withdraw', 'btn-danger')}`
                    : statusNote(`Taken by ${helper}`);
            } else if (task.status === 'pending_approval') {
                actionMarkup = isMe
                    ? `${statusNote('Offer sent. Waiting for the elder to accept.', 'pending')}${actionBtn('withdraw', id, 'Withdraw', 'btn-danger')}`
                    : statusNote('Another helper has offered');
            } else {
                actionMarkup = actionBtn('claim', id, 'I can help', 'btn-primary');
            }
        } else {
            const mine = canManage(task);
            if (task.status === 'completed') {
                const ratingLabel = (task.friendlyRating === 'friendly') ? 'rated friendly and helpful' : 'rated neutral';
                actionMarkup = statusNote(`${escapeHTML(I18N.t('t_completed'))}, ${ratingLabel}`, 'done');
            } else if (task.status === 'cancelled' || task.status === 'expired') {
                actionMarkup = statusNote(dead) + (mine ? actionBtn('repost', id, I18N.t('t_repost'), 'btn-primary') : '');
            } else if (task.status === 'finished' || task.status === 'in_progress') {
                actionMarkup = mine
                    ? statusNote(task.status === 'finished' ? `${helper} says it is finished` : `With ${helper}`, 'active') +
                      chatBtn + actionBtn('rate', id, I18N.t('t_confirm'), 'btn-primary') + actionBtn('reassign', id, I18N.t('t_reassign'), 'btn-danger')
                    : statusNote('In progress with a helper', 'active');
            } else if (task.status === 'pending_approval') {
                actionMarkup = mine
                    ? statusNote(`${helper} has offered to help. Accept or decline above.`, 'pending')
                    : statusNote('A helper has offered', 'pending');
            } else {
                actionMarkup = statusNote(escapeHTML(I18N.t('t_live'))) +
                    (mine && task.ownerId ? actionBtn('cancel', id, I18N.t('t_cancel'), 'btn-danger') : '');
            }
        }

        // schedule + repeat tags, and the private address (only the owner, or the helper they accepted)
        const when = [];
        if (task.scheduledFor) when.push(escapeHTML(new Date(task.scheduledFor).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })));
        if (task.repeat === 'daily' || task.repeat === 'weekly') when.push(escapeHTML(I18N.t(task.repeat === 'daily' ? 'r_daily' : 'r_weekly')));
        const seesAddress = task.address && (
            (PAGE_ROLE === 'adult' && task.ownerId === activeProfile.id) ||
            (PAGE_ROLE === 'helper' && task.helperId === activeProfile.id && ['in_progress', 'finished'].includes(task.status)));

        card.innerHTML = `
            <p class="task-kicker">
                <span class="task-cat">${escapeHTML(I18N.t(catLabel[task.category] || 'c_other'))}</span>
                <span class="task-loc">${escapeHTML(task.location)}</span>
                ${(task.status === 'open' && task.isUrgent) ? `<span class="task-flag">${escapeHTML(I18N.t('t_critical'))}</span>` : ''}
            </p>
            <h3 class="task-title">${escapeHTML(task.title)}<button type="button" class="speak-btn" data-action="speak" data-id="${escapeHTML(id)}" aria-label="Read this request aloud">${SPEAK_ICON}</button></h3>
            ${task.desc ? `<p class="task-desc">${escapeHTML(task.desc)}</p>` : ''}
            ${when.length ? `<p class="task-when">${when.join(' · ')}</p>` : ''}
            ${seesAddress ? `<p class="private-address"><strong>Address</strong> ${escapeHTML(task.address)}</p>` : ''}
            <div class="action-row">${actionMarkup}</div>`;
        taskBoard.appendChild(card);
    });
}

// HELPER OFFERS ASSISTANCE
window.claimTask = function(taskId) {
    if (PAGE_ROLE !== 'helper' || !activeProfile.id) return;
    const task = tasks.find(t => String(t.id) === String(taskId));
    if (!task) return;
    if (task.status !== 'open') { toast('Someone else has just offered to help with this one.'); renderTasks(); return; }

    task.status = 'pending_approval';
    task.helperName = activeProfile.name || "Volunteer";
    task.helperId = activeProfile.id;

    saveGlobalState();
    renderTasks();

    const modal = document.getElementById('contact-modal');
    const modalText = document.getElementById('modal-body-text');
    if (modal && modalText) {
        modalText.innerHTML = `Your offer for <strong>${escapeHTML(task.title)}</strong> has gone to the elder. Once they accept, you will see their address and can chat to agree a time.`;
        modal.style.display = 'flex';
    } else {
        toast('Offer sent. You earn coins once the elder confirms the work is done.');
    }
};

// RATING MODAL
let currentRatingTaskId = null;
let currentRatingChoice = 'friendly';

window.openRatingModal = function(taskId) {
    if (PAGE_ROLE !== 'adult') return;
    const task = tasks.find(t => String(t.id) === String(taskId));
    // only the owner, and only once a helper has actually been accepted
    if (!task || !canManage(task) || !task.helperId || !['in_progress', 'finished'].includes(task.status)) return;

    currentRatingTaskId = task.id;
    currentRatingChoice = 'friendly'; // default selection

    const modal = document.getElementById('rating-modal');
    const titleEl = document.getElementById('rating-task-title');
    const helperEl = document.getElementById('rating-helper-name');

    if (titleEl) titleEl.textContent = task.title;
    if (helperEl) helperEl.textContent = task.helperName || 'the volunteer';

    // Set friendly card as selected initially
    document.querySelectorAll('.rating-option-card').forEach(card => {
        const on = card.dataset.rating === 'friendly';
        card.classList.toggle('selected-rating', on);
        card.setAttribute('aria-pressed', on);
    });

    if (modal) modal.style.display = 'flex';
};

window.selectRatingChoice = function(choice, element) {
    currentRatingChoice = choice === 'unfriendly' ? 'unfriendly' : 'friendly';
    document.querySelectorAll('.rating-option-card').forEach(btn => {
        const on = btn === element;
        btn.classList.toggle('selected-rating', on);
        btn.setAttribute('aria-pressed', on);
    });
};

function setupEventListeners() {
    const submitRatingBtn = document.getElementById('submit-completion-btn');
    if (submitRatingBtn) {
        submitRatingBtn.addEventListener('click', () => {
            if (!currentRatingTaskId) return;

            const task = tasks.find(t => String(t.id) === String(currentRatingTaskId));
            // owner only, an accepted helper only, coins only once
            if (PAGE_ROLE !== 'adult' || !task || !canManage(task) || !task.helperId || !['in_progress', 'finished'].includes(task.status)) return;

            task.status = 'completed';
            task.friendlyRating = currentRatingChoice;

            task.completedAt = Date.now();
            spawnRepeat(task);   // recurring requests queue their next date
            const payout = task.isUrgent ? 25 : 10;

            let helperEntry = leaders.find(l => l.id && l.id === task.helperId);
            if (!helperEntry) {
                helperEntry = {
                    id: task.helperId,
                    name: task.helperName || "Volunteer",
                    coins: 0,
                    badge: "Getting Started",
                    friendlyCount: 0
                };
                leaders.push(helperEntry);
            }

            helperEntry.coins = (helperEntry.coins || 0) + payout;
            if (currentRatingChoice === 'friendly') {
                helperEntry.friendlyCount = (helperEntry.friendlyCount || 0) + 1;
            }

            helperEntry.badge = rankFor(helperEntry.coins);

            saveGlobalState();
            syncStateToUI();
            checkPendingApprovals();
            checkActiveInProgressTasks();
            renderTasks();

            const modal = document.getElementById('rating-modal');
            if (modal) modal.style.display = 'none';

            toast(`Done. ${task.helperName || 'Your helper'} receives ${payout} Mitra Coins. Rating saved: ${currentRatingChoice === 'friendly' ? 'friendly and helpful' : 'neutral'}.`);
            currentRatingTaskId = null;
        });
    }

    const closeRatingBtn = document.getElementById('close-rating-modal-btn');
    if (closeRatingBtn) {
        closeRatingBtn.addEventListener('click', () => {
            const modal = document.getElementById('rating-modal');
            if (modal) modal.style.display = 'none';
            currentRatingTaskId = null;
        });
    }

    const closeContactBtn = document.getElementById('close-modal-btn');
    if (closeContactBtn) {
        closeContactBtn.addEventListener('click', () => {
            const modal = document.getElementById('contact-modal');
            if (modal) modal.style.display = 'none';
        });
    }

    const filterSelect = document.getElementById('filter-select');
    if (filterSelect) filterSelect.addEventListener('change', renderTasks);
    const scopeSelectEl = document.getElementById('scope-select');
    if (scopeSelectEl) scopeSelectEl.addEventListener('change', renderTasks);

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', renderTasks);

    ['Morning', 'Afternoon', 'Night'].forEach(slot => {
        const cb = document.getElementById(`med-${slot.toLowerCase()}`);
        if (cb) cb.addEventListener('change', () => toggleMedicationLog(slot));
    });

    // New request form (optional AI spam check runs only if AI_PROXY_URL is set)
    const taskForm = document.getElementById('task-form');
    if (taskForm) {
        taskForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const val = id => (document.getElementById(id) || {}).value || '';
            const title = cleanLine(val('task-title'), LIMITS.title);
            const location = cleanLine(val('task-location'), LIMITS.location);
            let processedDesc = cleanText(val('task-desc'), LIMITS.desc);
            const category = pick(val('task-category'), CATEGORIES, 'Other');
            const repeat = pick(val('task-repeat'), REPEATS, 'none');
            const whenRaw = val('task-when');
            const whenMs = whenRaw ? new Date(whenRaw).getTime() : null;
            const urg = document.getElementById('task-urgent');
            const subBtn = taskForm.querySelector('button[type="submit"]');

            if (title.length < 3) { toast('Please give your request a short title.'); return; }
            if (!processedDesc) { toast('Please add a line or two about what you need.'); return; }
            if (!location) { toast('Please add your area or locality.'); return; }
            if (whenRaw && !(isFinite(whenMs) && whenMs > Date.now() - 60 * 60 * 1000)) { toast('Please pick a time that has not already passed.'); return; }

            // simple flood guard: no more than 5 new requests from one person in 10 minutes
            const recent = tasks.filter(t => t.ownerId === activeProfile.id && t.createdAt && Date.now() - t.createdAt < 10 * 60 * 1000);
            if (recent.length >= 5) { toast('You have posted several requests just now. Please wait a few minutes before adding another.'); return; }

            const fallbackTxt = subBtn.textContent;
            subBtn.textContent = 'Posting...';
            subBtn.disabled = true;

            if (AI_PROXY_URL) {
                try {
                    // The description is sent as data, never pasted into the instructions, so it cannot rewrite them.
                    const res = await fetch(AI_PROXY_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'omit',
                        body: JSON.stringify({ task: 'moderate-translate', text: processedDesc })
                    });
                    if (res.ok) {
                        const responseData = await res.json();
                        const parseString = cleanText(responseData && responseData.text, LIMITS.desc);
                        if (parseString === 'REJECTED') {
                            toast('This looks like an advert or spam, so it was not posted. Please keep requests to help you need.');
                            subBtn.textContent = fallbackTxt;
                            subBtn.disabled = false;
                            return;
                        }
                        if (parseString) processedDesc = parseString;
                    }
                } catch (err) {
                    console.error('AI check failed, using the description as typed:', err);
                }
            }

            const newTask = normaliseTask({
                id: `task-${Date.now()}`,
                ownerId: activeProfile.id,
                ownerName: activeProfile.name,
                address: val('task-address'),
                scheduledFor: whenMs,
                repeat,
                createdAt: Date.now(),
                helperId: null,
                title,
                desc: processedDesc,
                location,
                category,
                status: 'open',
                isUrgent: Boolean(urg && urg.checked),
                helperName: null,
                friendlyRating: null
            }, 0);

            tasks.unshift(newTask);
            saveGlobalState();
            renderTasks();
            taskForm.reset();
            toast('Request posted. Helpers nearby can see it now.');

            subBtn.textContent = fallbackTxt;
            subBtn.disabled = false;
        });
    }
}

// EMERGENCY SERVICES DIRECTORY
function initElderEmergencyData() {
    const contactInput = document.getElementById('elder-contact-no');
    const addressInput = document.getElementById('elder-home-address');
    const saveBtn = document.getElementById('save-emergency-btn');
    const statusMsg = document.getElementById('emergency-save-status');

    if (!contactInput || !addressInput || !saveBtn) return;

    contactInput.value = localStorage.getItem(userKey('elderEmergencyPhone')) || '';
    addressInput.value = localStorage.getItem(userKey('elderEmergencyAddress')) || '';
    const famInput = document.getElementById('elder-family-no');
    if (famInput) famInput.value = localStorage.getItem(userKey('elderFamilyPhone')) || '';

    saveBtn.addEventListener('click', () => {
        const fam = famInput ? cleanLine(famInput.value, LIMITS.phone) : '';
        const famDigits = fam.replace(/\D/g, '');
        if (fam && (famDigits.length < 10 || famDigits.length > 13)) {
            toast('The family WhatsApp number should have 10 digits, or 12 with the 91 country code.');
            famInput.focus();
            return;
        }
        if (famInput) localStorage.setItem(userKey('elderFamilyPhone'), fam);
        localStorage.setItem(userKey('elderEmergencyPhone'), cleanLine(contactInput.value, LIMITS.phone));
        localStorage.setItem(userKey('elderEmergencyAddress'), cleanText(addressInput.value, LIMITS.address));
        if (statusMsg) {
            statusMsg.textContent = 'Saved';
            setTimeout(() => { statusMsg.textContent = ''; }, 2500);
        }
    });
}

window.triggerEmergencyCall = function(phoneNumber, label) {
    const num = String(phoneNumber || '').replace(/[^0-9]/g, '');
    if (!num) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(num).catch(() => {});
    }
    window.location.href = `tel:${num}`;
    toast(`Calling ${label || 'emergency services'} on ${num}. The number is also copied, in case your phone asks.`);
};

window.findNearbyHospitals = function() {
    const savedAddress = localStorage.getItem(userKey('elderEmergencyAddress')) || '';
    let mapsUrl = "https://www.google.com/maps/search/hospitals+near+me";
    if (savedAddress) {
        mapsUrl = `https://www.google.com/maps/search/hospitals+near+${encodeURIComponent(savedAddress)}`;
    }
    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
};

window.callSavedDoctor = function() {
    const docPhone = localStorage.getItem(userKey('elderEmergencyPhone'));
    if (!docPhone) {
        toast('Add and save a doctor or relative number first.');
        const input = document.getElementById('elder-contact-no');
        if (input) input.focus();
        return;
    }
    const cleanNumber = docPhone.replace(/[^0-9+]/g, '');
    if (!cleanNumber.replace('+', '')) { toast('The saved contact has no phone number in it. Please add the digits.'); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(cleanNumber).catch(() => {});
    window.location.href = `tel:${cleanNumber}`;
    toast(`Calling ${docPhone}`);
};

window.copySOSDetails = function() {
    const phone = localStorage.getItem(userKey('elderEmergencyPhone')) || 'Not provided';
    const address = localStorage.getItem(userKey('elderEmergencyAddress')) || 'Not provided';
    const user = activeProfile.name || 'Elder';
    const sosMsg = `EMERGENCY ASSISTANCE NEEDED\nName: ${user}\nAddress: ${address}\nDoctor/Kin Contact: ${phone}\nAmbulance: 108 | Emergency: 112\nPlatform: ElderEase`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sosMsg).then(() => {
            toast('Emergency details copied. Paste them into WhatsApp or an SMS.');
        }).catch(() => toast(sosMsg));
    } else {
        toast(sosMsg);
    }
};

function initElderMode() {
    const elderBtn = document.getElementById('elder-mode-btn');
    if (!elderBtn) return;

    const label = () => {
        const on = document.body.classList.contains('elder-mode');
        document.documentElement.classList.toggle('elder-mode', on);
        elderBtn.textContent = I18N.t(on ? 'elderoff' : 'elderon');
        elderBtn.setAttribute('aria-pressed', on);
    };
    if (localStorage.getItem('elderModeActive') === 'true') document.body.classList.add('elder-mode');
    label();
    window.addEventListener('langchange', label);

    elderBtn.addEventListener('click', () => {
        const activeState = document.body.classList.toggle('elder-mode');
        localStorage.setItem('elderModeActive', activeState);
        label();
    });
}

function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
}
