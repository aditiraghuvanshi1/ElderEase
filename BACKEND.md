# ElderEase backend (v3.2)

One small Node service that serves the website **and** a JSON API, so the site's strict Content Security Policy
(`connect-src 'self'`) keeps working. It uses Node 22's built-in SQLite, crypto and fetch. The only package is Nodemailer,
and it is loaded only if you send email over SMTP (for example Gmail). Run `npm install` once.

```
npm start            # http://localhost:3000  (needs Node 22.13 or newer)
npm run dev          # same, plus demo accounts with 14 days of history
npm test             # 16 tests (accounts, roles, scheduler, emails, live sync, password reset, export/delete, real SMTP)
```

Open **http://localhost:3000** and use the demo cards on the login page (when `SEED_DEMO=1`): `elder.demo@elderease.in / Elder@123`,
`caretaker.demo@elderease.in / Care@1234`, `family.demo@elderease.in / Family@123`. Elders land on their home page, which now shows
today's doses from the server with Taken / Skip. Caretakers and family land in the Care Circle.

## What it covers

| Requirement | Where |
|---|---|
| Proactive email reminders (upcoming dose, missed dose, appointments) | `worker.js` + `templates.js` + `mailer.js` (Resend or SendGrid) |
| Scheduler | `index.js` runs `worker.tick()` every minute; `POST /api/cron/tick` + `x-cron-secret` lets an outside cron do it on hosts that sleep |
| Passcode + roles | Elders create one-time passcodes (48 h, hashed). Roles: **elder** (owner), **caretaker** (view + edit + mark doses), **family** (view only). Checked on every request in `app.js` (`need()`) |
| Shared data, live sync | SQLite is the single source of truth. Server-Sent Events push changes to everyone viewing the same elder |
| Taken / skipped / missed history | `dose_events` (one row per scheduled dose, with `acted_at` / `acted_by`) and `dose_audit` (every change, never overwritten) |
| Caretaker digests | `digest.js`. Daily 8 pm / weekly Sunday 9 am (elder's local time) by email, plus the "Adherence & summary" tab |
| One login (3.2) | `site/login.js`: the front page signs elders, caretakers and family in to the server; volunteer helpers stay browser-only |
| Elder home on the server (3.2) | `site/elder-sync.js`: today's doses from the shared schedule, Taken / Skip saved to the history, live updates, page alarms at server times |
| Password reset (3.2) | `POST /api/auth/forgot` + `/api/auth/reset`, `site/reset.html` |
| Data export / delete (3.2) | `GET /api/me/export`, `POST /api/me/delete`; buttons under Care Circle -> Circle & settings -> Your data |

## Emails

Set **one** of these:

- `RESEND_API_KEY` or `SENDGRID_API_KEY` (plus `MAIL_FROM`). Resend only delivers to addresses outside your own account after you verify a sending domain; check their current rules.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: any normal mail server. **Gmail is the quickest way to email anyone in a demo:** turn on 2-Step Verification on the Google account, create an App Password, then use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<the 16-letter app password>`. Gmail has a daily sending limit; check Google's current numbers.

With none, nothing is sent: each email is saved and shown under *Care Circle -> Circle & settings -> Recent notifications*, so the whole flow can be demoed without keys. Password-reset links are then printed to the server log (only when `NODE_ENV` is not `production`).

| Email | When | Goes to |
|---|---|---|
| Upcoming dose | 15 min before (`DOSE_LEAD_MIN`) | the elder |
| Missed dose | 60 min after with no Taken/Skip (`MISSED_GRACE_MIN`) | elder + every caretaker and family member |
| Appointment | about 24 h and 2 h before | elder + whole circle |
| Summary | daily 20:00 / weekly Sunday 09:00 (each person chooses) | caretakers / family |
| Password reset / password changed | when asked / after a reset | that person |

Every email has a `dedupe_key` in `email_log`, so restarts and retries can never send one twice. Failed sends retry up to 3 times.

## API (all JSON, cookie session, header `X-Requested-With: ElderEase` on writes)

```
POST /api/auth/register  /login  /logout  /forgot  /reset        GET/PATCH /api/me   GET /api/session (200, user or null)
GET  /api/me/export      POST /api/me/delete {password, confirm: "DELETE"}
GET  /api/care/circle    POST /api/care/invites  POST /api/care/join   DELETE /api/care/links/:id
GET  /api/elders/:id/overview | medications | doses?date= | appointments | adherence?days= | digest?days= | stream (SSE)
POST /api/elders/:id/medications | appointments | digest/send      PATCH/DELETE /api/medications/:id
POST /api/doses/:id/mark {status: taken|skipped}                    DELETE /api/appointments/:id
GET  /api/notifications                                              POST /api/cron/tick (secret)
```

## Deploy (demo)

1. Push the repo. On Render: *New -> Blueprint* picks up `render.yaml` (or create a Node web service: build `npm ci --omit=dev`, start `npm start`, Node 22).
2. Set `APP_URL` (password-reset links use it), and either `RESEND_API_KEY` + `MAIL_FROM` or the `SMTP_*` settings if you want real email.
3. Free hosts sleep when idle, so also add a free cron (cron-job.org) that calls `POST https://YOUR-APP/api/cron/tick`
   every minute with header `x-cron-secret: <CRON_SECRET>`. That keeps the app awake and the reminders on time.
4. SQLite lives in one file (`DB_FILE`). Free instances lose it on redeploy; use a persistent disk, or move the same schema to Postgres/Supabase.

## Honest limits

- **Medicines, doses, appointments and accounts are on the server.** The neighbourhood request board, helper coins, the vitals/mood health log and the doctor summary still store data in the browser, so they are per-device. Moving those is the next step; the same accounts and `care_links` can protect them.
- Volunteer helper accounts are browser-only, so they cannot reset a password by email.
- The page alarm on the elder's home page uses the device clock, so it rings at the right time only when the device is in the elder's time zone. Email reminders always use the elder's time zone.
- Timezone is a fixed offset per elder (default +5:30, India). No daylight-saving support.
- Rate limits on general requests are in memory (reset on restart); login lockouts are in the database.
- One server instance only (SQLite + in-memory live sync). Scale-out needs Postgres and a message bus.
- Health data is not encrypted at rest. Before real users: HTTPS only, an encrypted disk or database, and a privacy notice and consent flow under India's DPDP Act 2023. (Export and deletion now exist.)
- Email addresses are not verified at sign-up, so a typo means reminders go to the wrong inbox. Add an email confirmation step before real use.
- Emails are reminders, not medical advice or an emergency service.
