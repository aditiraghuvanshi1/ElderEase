'use strict';
const { createApp } = require('./app');
const { seedDemo } = require('./seed');

(async () => {
    const app = createApp();
    if (process.env.SEED_DEMO === '1') await seedDemo(app.db, Date.now());
    const port = Number(process.env.PORT) || 3000;
    app.server.listen(port, () => console.log(`[elderease] http://localhost:${port}  (email provider: ${require('./mailer').createMailer(process.env).provider})`));

    // The scheduler: checks doses, appointments and digests every minute. Errors never stop the loop.
    const every = (Number(process.env.TICK_SECONDS) || 60) * 1000;
    let running = false;
    const run = async () => {
        if (running) return; running = true;
        try { const s = await app.worker.tick(Date.now()); if (s.upcoming || s.missed || s.appointments || s.digests) console.log('[elderease] tick', JSON.stringify(s)); }
        catch (e) { console.error('[elderease] tick failed', e); } finally { running = false; }
    };
    setTimeout(run, 3000); setInterval(run, every).unref();
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
})();
