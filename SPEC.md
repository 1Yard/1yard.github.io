# 1Yard Portal — MVP spec

The working prototype is `index.html` (single file, dummy data, role switcher).
Service area: **Kingston, ON** (team based at Queen's). This doc is the contract for moving it to **Supabase** (DB, auth, storage, functions) + **GitHub Pages** (static site).

## Roles

| Role | How they get in | Can do |
|---|---|---|
| Client | Signs up while sending their first request | Send a request (**one open request at a time**), see status, cancel |
| Volunteer | Applies via form (**university students only**: school email, university, year) | See their stage; once trained: job board, sign up / leave, mark done |
| Admin | Manually flagged in DB | Approve/decline volunteers, review + schedule requests, **edit request/client details** after calling the client, **set any volunteer's level directly** (e.g. skip shadow shifts), **remove a volunteer** (deletes their account, frees upcoming jobs, keeps past jobs on record), cancel/mark jobs done |

## Volunteer lifecycle

```
pending ──admin approves──▶ approved ──training ✓ + waiver PDF──▶ trainee ──2 shadow shifts──▶ experienced
   └──admin declines──▶ declined
```

- **Shadow shift** = a job marked `done` where the volunteer signed up *as a trainee* and the other crew member was *experienced*. Computed from data, not stored as a counter.
- When a job is marked done, any trainee on it with `shadow_count >= 2` is promoted to `experienced` automatically.
- Only `trainee` and `experienced` volunteers can see the job board.

## Job (client request) lifecycle

```
review ──admin sets date/time/estimate──▶ scheduled ──crew of 2 marks done (or admin)──▶ done
   └──admin declines──▶ declined          └──client or admin cancels──▶ cancelled
```

## Scheduling

1. **Client picks 2–4 days** from the next 14 days (shown as "next 7 days" / "the week after"), each **Morning 9–12**, **Afternoon 1–6**, or **Either 9–6**. Nudged to pick one from each week.
2. **Admin reviews** the request (can edit the days after a call), sets estimated hours, publishes. No date picking by the admin.
3. **First volunteer locks the time**: picks one of the client's days + an exact start time (30-min steps, job must fit inside the window). Picking inside the client's window counts as agreed.
4. While alone, the first volunteer **can change the time** (only inside the client's windows). If they leave, the time clears and all days reopen.
5. **Second volunteer joins at that exact time.** Once the crew is full, both see each other's name, phone and email. No in-app chat.
6. **Client sees the confirmation on the site** ("Ethan and Sam will come Saturday, October 24 at 10:30am"), and the job lands on the admin's **To call** list until the admin clicks "Called ✓" ("No answer" logs an attempt and keeps it on the list).
7. **Only the admin changes the time once the crew is full**, either:
   - *Move time, keep crew* (after both volunteers agree) → volunteers see a "time changed" banner, or
   - *Release crew and repost with new days* → same job, crew removed, back on the board.
8. **Expiry:** days in the past drop off. If none are left and the crew isn't full (or a lone volunteer's date passes), the job shows as **Needs new dates** on the admin's To call list and disappears from the board.

## Matching rules (enforce server-side)

1. Every job has exactly **2 spots**.
2. A job may **never have two trainees**.
   - Empty job → anyone trained can take a spot.
   - Job with an experienced volunteer → anyone trained can take the 2nd spot.
   - Job with a trainee → **only experienced** can take the 2nd spot.
3. A volunteer can't take two spots on the same job.
4. "Mark done" requires a full crew of 2.
5. Volunteers only see the **neighbourhood** on the board; the full address and client phone are visible only once they're on the crew.
6. Outdoor work only. Volunteers bring gloves; the client provides all tools. Admin is warned when a needed tool is missing.

## Seasons

`services` are tied to a season. Fall 2026: raking leaves, last lawn mow, garden bed clean-up, branches & debris, other/not sure.
Each service lists the skills it needs and the tools the client must provide. Winter = new rows (e.g. snow shovelling, salting walkways) + flip the active season.

## Proposed Supabase tables

```
profiles      id (= auth.users.id), role ('client'|'volunteer'|'admin'), name, phone, email
volunteers    profile_id, status, university, year_of_study, skills text[], availability text[], why,
              applied_at, reviewed_at, trained_at, promoted_at, waiver_path (storage)
clients       profile_id, address, postal_code, neighbourhood, contact_pref
seasons       id, label, is_active
services      id, season_id, name, hint, icon, skills text[], tools text[]
jobs          id, client_id, services text[], tools_on_site jsonb, flags text[], notes,
              windows jsonb  -- [{date, part: am|pm|any}], 2-4 of them
              status, date, start_time, est_hours, told_client_at, call_attempts, last_call_at, time_changed_at,
              created_at, published_at, done_at, edited_at
              -- partial unique index: one row per client_id where status in ('review','scheduled')
job_signups   id, job_id, volunteer_id, as_trainee bool, created_at   -- unique(job_id, volunteer_id)
```

### Access rules (RLS) sketch
- `jobs`: clients read/insert their own (insert blocked if they already have an open one); admins can update any; trainee/experienced volunteers read `scheduled` jobs; admins all.
- Full address / client phone: expose via a view or function that only returns them to crew members (and admins).
- `job_signups` insert: **database function `join_job(job_id, date, start)`** that checks the matching rules and, for the first volunteer, that the time falls inside a client window — in one transaction (avoids two people grabbing the same spot or setting two times at once).
- `change_job_time` (lone volunteer, inside windows) and `admin_move_time` / `admin_repost` (admin only) as separate functions.
- `mark_job_done(job_id)`: function that checks crew = 2, sets `done`, promotes trainees.
- Storage bucket `waivers`: volunteer can upload their own; only admins can read.

## Open questions
- Who can mark a job done: crew, admin, or both? (prototype: both)
- Should clients log in with a password, or a one-time code by text/email? (recommended: one-time code; lower digital literacy)
- Do volunteers get reminders (email/SMS) before a job? Not in MVP.
