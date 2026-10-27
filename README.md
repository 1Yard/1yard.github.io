# 1Yard Portal

Volunteer yard help in Kingston, ON. Clients request help, university student volunteers sign up for jobs in pairs, admins keep it all moving.

- **Website:** `docs/` — plain HTML/JS, served free by GitHub Pages
- **Database, logins, waiver storage:** Supabase free tier — set up by `supabase/schema.sql`
- **Rules and flows:** `SPEC.md`
- **Clickable prototype with fake data:** `prototype/demo.html`
- **Local test copy** (real site + in-browser database, no Supabase needed): run `python3 -m http.server 8765` in this folder and open http://localhost:8765/test/ — log in as `admin@test.ca` / `testpass1`

Cost: $0. Nothing here needs a credit card.

---

## Setup (about 20 minutes, once)

### 1. Create the Supabase project
1. Sign up at **supabase.com** (free) and click **New project**.
2. Name: `1yard`. Region: **Canada (Central)**. Save the database password somewhere safe (you won't need it day to day).
3. Wait about a minute for it to start.

### 2. Create the database
1. In the project, open **SQL Editor → New query**.
2. Paste the whole of `supabase/schema.sql` and click **Run**. You should see "Success. No rows returned".

### 3. Turn off email confirmation (for now)
**Authentication → Sign In / Providers → Email** → turn off **Confirm email** → Save.
Supabase's built-in email sender is for testing only. Admin approval already stops fake volunteers. (Later: set up custom SMTP to turn confirmations and password resets on.)

### 4. Connect the website to Supabase
1. **Project Settings → API Keys**. Copy the **Project URL** and the **publishable** key (or the legacy **anon public** key).
2. Paste both into `docs/config.js`.
3. Never use the **secret / service_role** key anywhere in this project.

### 5. Put the site online with GitHub Pages
1. Sign up at **github.com** (free) and create a free organization called `1yard`, then a **public** repository in it called `1yard.github.io`.
2. Upload this folder to it (see "Updating the site" below).
3. Repo **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main`, folder: `/docs` → Save.
4. After a minute the site is live at `https://1yard.github.io/`.
5. Back in Supabase: **Authentication → URL Configuration** → set **Site URL** to that address.

### 6. Make yourself an admin
1. On the live site, click **Volunteer log in → Apply here** and sign up with your own email.
2. In Supabase **SQL Editor**, run (with your email):
   ```sql
   update profiles set role = 'admin', status = 'experienced' where email = 'you@example.com';
   ```
3. Log out and back in. You'll see the admin dashboard. Repeat for any other admins.

### 7. Fill in your real info (`docs/config.js`)
- `officePhone` — the number clients should call
- `training` — real links to your training videos/docs
- `waiverUrl` — put your blank waiver PDF in `docs/` as `waiver.pdf` (or link to it elsewhere)

### 8. Turn on email (free, about 20 minutes)
Bell notifications work as soon as `schema.sql` is run. Emails are queued in the database from then on, and go out once these steps are done. Until then they wait in **Settings → Email log**; anything older than 2 days is never sent, so nobody gets stale emails.

1. **Resend account:** sign up free at resend.com (3,000 emails a month, 100 a day).
2. **Add the domain:** Resend → **Domains → Add domain** → `1yard.ca`. Resend shows 3–4 DNS records. Add each one, exactly as shown, wherever 1yard.ca's DNS is managed (the company you bought the domain from, or Cloudflare):
   - **MX** record on `send` (pointing to an `amazonses.com` address, priority 10)
   - **TXT** record on `send`: `v=spf1 include:amazonses.com ~all`
   - **TXT** record on `resend._domainkey`: a long key starting `p=` (copy it from Resend)
   - Recommended: **TXT** on `_dmarc`: `v=DMARC1; p=none;`

   These sit on the `send.` subdomain and a DKIM name, so they don't touch any email you already get at 1yard.ca. Click **Verify** in Resend; it usually takes minutes, sometimes a few hours.
3. **API key:** Resend → **API Keys → Create** (Sending access, domain 1yard.ca). Copy it. Never put it in the website's code.
4. **Deploy the sender:** Supabase → **Edge Functions → Deploy a new function → Via editor**. Name it `send-emails`, paste in `supabase/functions/send-emails/index.ts`, and deploy. Then open the function's **Details** and turn **off** "Verify JWT" (the database calls it without a login; it only sends what's already queued).
5. **Secrets:** Supabase → **Edge Functions → Secrets**, add:
   - `RESEND_API_KEY` = the key from step 3
   - `EMAIL_FROM` = `1Yard <hello@1yard.ca>`
   - `EMAIL_REPLY_TO` = `1yardqueens@gmail.com`
6. **Hook it up:** Supabase → **SQL Editor**, run `supabase/email.sql`. This sends queued emails right away, retries failures every 5 minutes, and runs the hourly task (day-before reminders at 6pm, "needs new dates" alerts).
7. **Test:** approve a test volunteer, then check **Settings → Email log**. It should say **Sent** within a minute. **Failed** shows the reason.

### What sends what
- **Bell** (volunteers): crew confirmed, time changed, job cancelled, taken off a job, partner dropped out, hours corrected, promoted, application approved.
- **Bell** (admins): new request, new application, crew set (call the client), needs new dates, volunteer dropped out (marked urgent within 24 hours), a job tomorrow still missing a volunteer, concern reported.
- **Email** (volunteers): crew confirmed (with calendar file), time changed, cancelled, taken off a job, partner dropped out, day-before reminder, application approved.
- **Email** (clients, only if they gave an email): crew confirmed, day-before reminder, time changed, cancelled by 1Yard. Never volunteers' contact details.
- **Email** (admins): only concerns from an hours log.

---

## Day to day

- **Admins** log in on the site. Everything is on the dashboard: To call, New requests, Volunteer applications, Jobs, Volunteers.
- **Volunteer forgot their password?** Until email is set up: Supabase → **Authentication → Users** → find them → delete the user, and ask them to apply again (an admin re-approves). Setting up free SMTP (e.g. a 1Yard Gmail account) fixes this properly.
- **Keep-awake:** `.github/workflows/keep-awake.yml` pings Supabase twice a week so the free project doesn't pause. GitHub turns scheduled jobs off after 60 days with no commits; if that happens, re-enable it from the repo's **Actions** tab.

## Updating the site
Edit files, commit, and push to `main`. GitHub Pages republishes in about a minute.

## Moving to winter
Edit `SERVICES` and `SEASON` at the top of `docs/app.js` (e.g. snow shovelling, salting walkways), commit, push.
