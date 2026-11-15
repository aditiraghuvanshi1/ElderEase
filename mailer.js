'use strict';
/* Sends one email. The provider is picked from the environment, first match wins:
     RESEND_API_KEY   -> Resend (HTTPS API)
     SENDGRID_API_KEY -> SendGrid (HTTPS API)
     SMTP_HOST        -> any normal mail server over SMTP, e.g. Gmail with an app password (uses Nodemailer)
     none             -> "dev": nothing leaves the machine; the message is still saved in email_log
                         and shown in the app's notification list.
   EMAIL_PROVIDER=resend|sendgrid|smtp|dev forces one. */
function pickProvider(env) {
    if (env.EMAIL_PROVIDER) return env.EMAIL_PROVIDER;
    if (env.RESEND_API_KEY) return 'resend';
    if (env.SENDGRID_API_KEY) return 'sendgrid';
    if (env.SMTP_HOST) return 'smtp';
    return 'dev';
}

function createMailer(env) {
    const provider = pickProvider(env);
    const from = env.MAIL_FROM || (provider === 'smtp' && env.SMTP_USER ? `ElderEase <${env.SMTP_USER}>` : 'ElderEase <onboarding@resend.dev>');

    async function post(url, headers, body) {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
        const txt = await res.text();
        if (!res.ok) throw new Error(`${provider} ${res.status}: ${txt.slice(0, 200)}`);
        try { return JSON.parse(txt); } catch (e) { return {}; }
    }

    let smtp = null;                                   // created on first use, so Nodemailer is only needed when SMTP is configured
    function smtpTransport() {
        if (smtp) return smtp;
        let nodemailer;
        try { nodemailer = require('nodemailer'); } catch (e) { throw new Error('SMTP is configured but Nodemailer is not installed. Run "npm install".'); }
        const port = Number(env.SMTP_PORT) || 587;
        smtp = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port,
            secure: env.SMTP_SECURE === '1' || port === 465,            // 465 = TLS from the start; 587 = upgrades with STARTTLS
            requireTLS: env.SMTP_REQUIRE_TLS !== '0' && port !== 465,   // never send a password over an unencrypted link
            auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
            tls: env.SMTP_TLS_INSECURE === '1' ? { rejectUnauthorized: false } : undefined,   // only for local test servers
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
        });
        return smtp;
    }

    async function send({ to, subject, text, html }) {
        if (provider === 'resend') {
            const r = await post('https://api.resend.com/emails', { Authorization: 'Bearer ' + env.RESEND_API_KEY }, { from, to: [to], subject, text, html });
            return { provider, id: r.id || '' };
        }
        if (provider === 'sendgrid') {
            const m = /^(.*)<(.+)>$/.exec(from);
            await post('https://api.sendgrid.com/v3/mail/send', { Authorization: 'Bearer ' + env.SENDGRID_API_KEY }, {
                personalizations: [{ to: [{ email: to }] }], from: m ? { name: m[1].trim(), email: m[2] } : { email: from }, subject,
                content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }] });
            return { provider, id: '' };
        }
        if (provider === 'smtp') {
            const info = await smtpTransport().sendMail({ from, to, subject, text, html });
            return { provider, id: info.messageId || '' };
        }
        return { provider: 'dev', id: '' };
    }
    return { send, provider, close: () => { if (smtp) smtp.close(); } };
}
module.exports = { createMailer };
