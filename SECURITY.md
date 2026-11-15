# ElderEase security review

Reviewed 15 November 2026. ElderEase is a static web app: HTML, CSS and JavaScript only. There is no server, no database and no build step. Accounts and data are stored in the browser (`localStorage` and `sessionStorage`) on each device.

That one fact decides what "secure" can mean today, so read the limits section before you put this in front of real users.

## What was checked and what changed

| Item you asked for | Result |
|---|---|
| Hide APIs | No API keys or secrets anywhere in the code. The only API hook is `AI_PROXY_URL` in `app.js`, which is empty. It now sends only `{ task, text }`, so the prompt and the key stay on your server (see "If you turn on the AI check"). |
| Environment variables | None exist, and none are needed. There is no `.env` file in the project. |
| Protect admin routes | There are no admin pages. The two role areas (elder pages, helper page) are guarded: wrong role or no login sends you back to log in. Sessions are now checked against the stored account, so editing the session to change role logs you out (tested). |
| Proper authentication | PBKDF2-SHA256 raised from 150,000 to 600,000 iterations (current OWASP figure). Each account stores its own count, so older accounts still work and are upgraded on their next login. Sessions now expire after 12 hours. Inherited object keys (for example an email of `constructor`) can no longer reach the login code. |
| Check user access | Actions now check role and state, not only ownership. A helper action can't run on an elder page, and the reverse. An elder can no longer "complete" a request that no helper accepted (this used to award coins to nobody). Coins can't be paid twice for the same request. |
| Sanitize forms | Every field has a length limit in the HTML and again in code. Control characters are stripped. Category, status and repeat are checked against fixed lists. Dates in the past are rejected. Phone numbers are checked. Data read back from storage is cleaned the same way before use. |
| Protect against XSS | Every value written into the page is escaped. Three places were not: leaderboard badge, repeat label and request IDs inside `onclick`. All inline `onclick` handlers are gone, replaced with `data-action` buttons and one allow-listed click handler. Tested with `<img onerror>`, `<script>` and `<svg onload>` in titles, descriptions, chat and hand-edited storage: all show as plain text. |
| Rate limiting | Login: 5 wrong passwords lock that email for 1 minute, doubling up to 30 minutes. New requests: at most 5 per person in 10 minutes. Chat: at most 15 messages a minute. These run in the browser only; see limits. |
| Secure API endpoints | No endpoints exist yet. Requirements for the AI proxy are listed below. |
| CORS | Nothing to configure: the app makes no cross-origin requests. Fonts are now self-hosted instead of fetched from Google. |
| Security headers | Every page has a strict Content Security Policy (`script-src 'self'`, no inline scripts or styles, no `eval`). Full headers (HSTS, `frame-ancestors`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP) are in `_headers` (Netlify, Cloudflare Pages) and `vercel.json` (Vercel). |
| Debug mode | There is no debug mode. Console messages report errors only and contain no personal data. |
| Update dependencies / remove unused packages | No packages. Nothing to update or remove. |
| Exposed files | Nothing sensitive in the folder. Do not upload a `.git` folder or any notes with passwords next to the site. |
| Secure database access | No database. |
| Check git for secrets | The upload has no git history. The current files contain no secrets. The demo passwords in `auth.js` are meant to be public. |

Other fixes made during the review:

- External links (Google Maps, WhatsApp) open with `noopener,noreferrer`.
- The service worker only caches successful responses from your own site.
- Login and signup scripts moved out of the HTML into `login.js` so the policy can block inline code.

## Limits you need to know

These cannot be fixed without a server:

1. **Everything lives on one device.** An elder's request is only visible to a helper on the same phone or computer. Real use needs a backend.
2. **Browser-side checks can be bypassed.** Anyone with the browser's developer tools can edit `localStorage`. The login lockout and other limits stop casual misuse, not a determined person on that device.
3. **Health data is not encrypted at rest.** Anyone who uses the device can open the browser storage.

### Before real users

- Move accounts, requests, chat and health data to a server: Supabase, Firebase or your own API.
- Hash passwords on the server (Argon2id or bcrypt).
- Use HttpOnly, Secure, SameSite cookies for sessions.
- Enforce rate limits and role checks on the server.
- Encrypt health data, and write a privacy notice. The Digital Personal Data Protection Act, 2023 applies.

## If you turn on the AI check

The app now sends `POST { "task": "moderate-translate", "text": "<description>" }` and expects `{ "text": "..." }` back, or exactly `REJECTED`. Your serverless function should:

- keep the AI key in an environment variable on the server, never in this code;
- build the prompt itself and treat `text` as data;
- allow only your site's origin in `Access-Control-Allow-Origin`;
- cap input at 600 characters and rate-limit by IP.

Also add the function's address to `connect-src` in the Content Security Policy, in both the HTML pages and `_headers` / `vercel.json`.

## Fonts

Newsreader and Atkinson Hyperlegible are under the SIL Open Font License; the license files are in `fonts/`.

## Server (added in 3.1)

See `BACKEND.md`. Passwords: scrypt (N=32768, r=8, p=1) with a per-user salt. Sessions: random 256-bit tokens, stored only as SHA-256 hashes,
sent in an `HttpOnly; SameSite=Strict` cookie (`Secure` in production), valid 7 days. Writes require `X-Requested-With: ElderEase` plus a same-origin check.
Passcodes: 8 characters, single use, 48 hours, stored hashed, join attempts rate limited. Access to an elder's data returns **404** (not 403) for outsiders.
Login/registration give the same reply for existing and new emails. Login lockouts persist in the database. The service worker never caches `/api/`.

## Accounts and data (added in 3.2)

- **One login.** The front page now signs elders, caretakers and family into the server. An elder's server sign-in opens the older browser-based pages with a local session that has no password, sits under its own key (never merged with a browser-only account that shares the email), and closes as soon as the server says the sign-in has ended. Logging out ends both, and waits for the server, so the login page cannot sign you straight back in.
- **Volunteer helpers** still use browser-only accounts. The login page sends them straight to the browser login, so their logins never count as failed server logins (which could otherwise lock out a whole household or office).
- **Password reset.** `POST /api/auth/forgot` gives the same reply for every email and sends in the background, so neither the reply nor its timing shows who has an account. 3 requests per email and 10 per connection an hour. The link carries a 256-bit token after `#`, so it never appears in server logs or Referer headers; the reset page removes it from the address bar at once. Only a SHA-256 of the token is stored. A link works once, expires in 30 minutes, and asking again cancels the previous one. Using it signs out every device, clears the login lockout, and emails a "your password was changed" notice. The email log keeps a copy with the link removed, so a copy of the database never holds a working link.
- **Your data.** `GET /api/me/export` downloads everything about you as JSON (no password hash or tokens). `POST /api/me/delete` needs your password and the word DELETE. Deleting an elder removes all their medicines, doses, appointments, passcodes, links and every email about them. Deleting a caretaker or family member keeps the elder's history but removes their name from it.
- **SMTP.** Nodemailer is the one package, loaded only when `SMTP_HOST` is set. It refuses to send a password over an unencrypted connection (`requireTLS` on port 587; TLS from the start on 465). `npm audit`: 0 vulnerabilities at the time of writing.
- The site tells the server apart from static hosting by an `X-ElderEase-Server` header, so static hosting sees no failed API calls.
