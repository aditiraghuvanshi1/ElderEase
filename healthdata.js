/* healthdata.js — shared storage helpers for the Health Logs and Doctor Summary pages (loaded after app.js). */
const HD = (() => {
    const pad = n => String(n).padStart(2, '0');
    const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const read = (k, f) => { try { const v = JSON.parse(localStorage.getItem(k)); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : f; } catch (e) { return f; } };
    const load = () => {
        const d = read(userKey('elderHealthV2'), null) || {};
        if (!d.days || typeof d.days !== 'object') d.days = {};
        d.appts = Array.isArray(d.appts) ? d.appts.filter(a => a && typeof a.date === 'string') : [];
        Object.keys(d.days).forEach(k => { const x = d.days[k]; if (!x || typeof x !== 'object') { delete d.days[k]; return; } x.vitals = Array.isArray(x.vitals) ? x.vitals : []; x.symptoms = Array.isArray(x.symptoms) ? x.symptoms : []; });
        return d;
    };
    const save = d => localStorage.setItem(userKey('elderHealthV2'), JSON.stringify(d));
    const day = (d, k) => (d.days[k] = d.days[k] || { vitals: [], mood: null, symptoms: [], water: 0, walk: 0 });
    const logs = () => read(userKey('elderDailyHealthLogs'), {});
    const dosesTaken = (L, k) => { const m = (L[k] && L[k].medications) || {}; return ['Morning', 'Afternoon', 'Night'].filter(x => m[x]).length; };
    // returns the dictionary keys of any warnings for one vitals reading
    const flags = v => {
        const f = [];
        if (v.sys >= 140 || v.dia >= 90) f.push('al_bp');
        if ((v.sys && v.sys < 90) || (v.dia && v.dia < 60)) f.push('al_bplow');
        if (v.sugar >= 180 || (v.sugarWhen === 'fasting' && v.sugar >= 130)) f.push('al_sugar');
        if (v.sugar && v.sugar < 70) f.push('al_sugarlow');
        if (v.spo2 && v.spo2 < 92) f.push('al_spo2');
        return f;
    };
    const fmtVitals = v => [
        (v.sys && v.dia) ? `BP ${v.sys}/${v.dia}` : '',
        v.pulse ? `${v.pulse} bpm` : '',
        v.spo2 ? `SpO₂ ${v.spo2}%` : '',
        v.sugar ? `${I18N.t('sugar').split(' (')[0]} ${v.sugar} (${I18N.t(v.sugarWhen === 'aftermeal' ? 'aftermeal' : v.sugarWhen === 'random' ? 'random' : 'fasting')})` : '',
        v.weight ? `${v.weight} kg` : ''
    ].filter(Boolean).join(' · ');
    const dateLabel = (k, opts) => new Date(k + 'T12:00:00').toLocaleDateString(I18N.lang().speech, opts || { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    return { pad, key, load, save, day, logs, dosesTaken, flags, fmtVitals, dateLabel };
})();
