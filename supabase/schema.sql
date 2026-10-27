-- =====================================================================
-- 1Yard portal — database setup
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: functions and policies are replaced, tables are only
-- created if missing.
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

-- Volunteers and admins (anyone who logs in). One row per auth user.
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null default 'volunteer' check (role in ('volunteer', 'admin')),
  name          text not null default '',
  email         text not null default '',
  phone         text not null default '',
  university    text not null default '',
  year          text not null default '',
  skills        text[] not null default '{}',
  availability  text[] not null default '{}',
  why           text not null default '',
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'trainee', 'experienced', 'declined')),
  waiver_path   text,
  applied_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  trained_at    timestamptz,
  promoted_at   timestamptz
);

-- Clients don't log in. They're matched by phone number (or email).
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null default '',
  phone_key   text not null default '',          -- digits only, for matching
  email       text not null default '',
  contact     text not null default 'phone' check (contact in ('phone', 'email', 'either')),
  address     text not null,
  postal      text not null default '',
  area        text not null default 'Kingston',
  created_at  timestamptz not null default now()
);
create index if not exists clients_phone_key on public.clients (phone_key);

-- A client request. Becomes a job once an admin publishes it.
create table if not exists public.jobs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  access_token     uuid not null unique default gen_random_uuid(),  -- the client's private status link
  services         text[] not null,
  tools            jsonb not null default '{}',     -- { "rake": true, "mower": false, ... }
  flags            text[] not null default '{}',
  notes            text not null default '',
  windows          jsonb not null default '[]',     -- [{ "date": "2026-10-24", "part": "am|pm|any" }], 2-4 of them
  status           text not null default 'review'
                   check (status in ('review', 'scheduled', 'done', 'declined', 'cancelled')),
  date             date,                            -- set by the first volunteer
  start_time       text,                            -- 'H:MM', set by the first volunteer
  hours            int not null default 2 check (hours between 1 and 8),
  told_at          timestamptz,                     -- admin called the client about the crew
  attempts         int not null default 0,
  last_attempt_at  timestamptz,
  time_changed_at  timestamptz,
  created_at       timestamptz not null default now(),
  published_at     timestamptz,
  done_at          timestamptz,
  edited_at        timestamptz
);
-- One open request per client.
-- Hours the crew actually worked, logged when the job is marked done.
alter table public.jobs add column if not exists actual_hours numeric(4,1);
-- First time the crew reached 2 (the client is told this time, so it stays locked
-- even if a volunteer drops out), and the last drop-out after that.
alter table public.jobs add column if not exists crewed_at timestamptz;
alter table public.jobs add column if not exists dropout_at timestamptz;

create unique index if not exists one_open_request_per_client
  on public.jobs (client_id) where status in ('review', 'scheduled');

create table if not exists public.job_signups (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs(id) on delete cascade,
  volunteer_id  uuid not null references public.profiles(id) on delete cascade,
  as_trainee    boolean not null,
  created_at    timestamptz not null default now(),
  unique (job_id, volunteer_id)
);

-- When a volunteer is removed, keep their completed jobs on record (with no
-- name) so their partners' shadow-shift counts don't change.
alter table public.job_signups alter column volunteer_id drop not null;
alter table public.job_signups drop constraint if exists job_signups_volunteer_id_fkey;
alter table public.job_signups add constraint job_signups_volunteer_id_fkey
  foreign key (volunteer_id) references public.profiles(id) on delete set null;

-- Bell notifications for volunteers and admins. Only database functions create them.
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  recipient   uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,
  job_id      uuid references public.jobs(id) on delete cascade,
  message     text not null,
  link        text not null default '',       -- where the bell takes you, e.g. 'job:<id>', 'calls'
  urgent      boolean not null default false,
  dedupe_key  text unique,                    -- stops the same event notifying twice
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_recipient on public.notifications (recipient, created_at desc);

-- Emails waiting to be sent. The send-emails Edge Function drains this table.
create table if not exists public.email_outbox (
  id           uuid primary key default gen_random_uuid(),
  to_email     text not null,
  subject      text not null,
  html         text not null,
  text_body    text not null,
  ics          text,                          -- calendar file to attach, if any
  kind         text not null,
  job_id       uuid references public.jobs(id) on delete set null,
  dedupe_key   text not null unique,          -- nobody gets the same email twice
  status       text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts     int not null default 0,
  last_error   text,
  provider_id  text,
  created_at   timestamptz not null default now(),
  locked_at    timestamptz,
  sent_at      timestamptz
);
create index if not exists email_outbox_pending on public.email_outbox (created_at) where status <> 'sent';

-- Notes and concerns logged when a job is marked done. Admins only.
create table if not exists public.job_reports (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  volunteer_id    uuid references public.profiles(id) on delete set null,
  reporter_name   text not null default '',
  note            text not null default '',
  concern         text check (concern in ('safety', 'not_home', 'bigger', 'other')),
  concern_detail  text not null default '',
  created_at      timestamptz not null default now()
);

-- Admin call notes on a request/job (the same row, so they carry over when it's published).
create table if not exists public.admin_notes (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  author       uuid references public.profiles(id) on delete set null,
  author_name  text not null default '',
  body         text not null,
  created_at   timestamptz not null default now()
);

-- ---------- Helpers ---------------------------------------------------

create or replace function public.local_today() returns date
language sql stable as $$ select (now() at time zone 'America/Toronto')::date $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.to_minutes(t text) returns int
language sql immutable as $$ select split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int $$;

-- Does a start time on a date fit inside one of the client's windows?
-- Morning 9-12, Afternoon 13-18, Either 9-18. The job has to finish inside the window
-- (unless it's longer than the window, then it starts at the window start).
create or replace function public.time_fits(w jsonb, d date, start text, hrs int) returns boolean
language plpgsql immutable as $$
declare x jsonb; f int; t int; s int;
begin
  if start is null or start !~ '^\d{1,2}:(00|30)$' then return false; end if;
  s := public.to_minutes(start);
  for x in select * from jsonb_array_elements(w) loop
    if (x->>'date')::date = d then
      f := case x->>'part' when 'pm' then 13 * 60 else 9 * 60 end;
      t := case x->>'part' when 'am' then 12 * 60 else 18 * 60 end;
      if s >= f and s <= greatest(f, t - hrs * 60) then return true; end if;
    end if;
  end loop;
  return false;
end $$;

-- Completed jobs where this volunteer went as a trainee alongside an experienced volunteer.
create or replace function public.shadow_count(vid uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from job_signups s join jobs j on j.id = s.job_id
  where s.volunteer_id = vid and s.as_trainee and j.status = 'done'
    and exists (select 1 from job_signups p where p.job_id = s.job_id and p.volunteer_id is distinct from vid and not p.as_trainee)
$$;

create or replace function public.jobs_done(vid uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from job_signups s join jobs j on j.id = s.job_id
  where s.volunteer_id = vid and j.status = 'done'
$$;

-- No full crew and no usable date left → admin needs to call for new days.
create or replace function public.needs_new_dates(j public.jobs) returns boolean
language sql stable security definer set search_path = public as $$
  select j.status = 'scheduled'
     and (select count(*) from job_signups where job_id = j.id) < 2
     and case
           when j.date is not null and (j.crewed_at is not null or exists (select 1 from job_signups where job_id = j.id))
             then j.date <= local_today()
           else not exists (select 1 from jsonb_array_elements(j.windows) x where (x->>'date')::date > local_today())
         end
$$;

-- ---------- New volunteer accounts -----------------------------------
-- The sign-up form passes the application as user metadata; this copies it into profiles.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, name, phone, university, year, skills, availability, why)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data->>'name', ''), 120),
    left(coalesce(new.raw_user_meta_data->>'phone', ''), 40),
    left(coalesce(new.raw_user_meta_data->>'university', ''), 120),
    left(coalesce(new.raw_user_meta_data->>'year', ''), 40),
    coalesce(array(select jsonb_array_elements_text(new.raw_user_meta_data->'skills')), '{}'),
    coalesce(array(select jsonb_array_elements_text(new.raw_user_meta_data->'availability')), '{}'),
    left(coalesce(new.raw_user_meta_data->>'why', ''), 2000)
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Access rules (RLS) ---------------------------------------
-- Admins read and write tables directly. Everyone else goes through the
-- functions below, which return only what they're allowed to see.

alter table public.profiles    enable row level security;
alter table public.clients     enable row level security;
alter table public.jobs        enable row level security;
alter table public.job_signups enable row level security;

drop policy if exists "read own profile or admin" on public.profiles;
create policy "read own profile or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "admin updates profiles" on public.profiles;
create policy "admin updates profiles" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin only" on public.clients;
create policy "admin only" on public.clients
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin only" on public.jobs;
create policy "admin only" on public.jobs
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin only" on public.job_signups;
create policy "admin only" on public.job_signups
  for all using (public.is_admin()) with check (public.is_admin());

alter table public.notifications enable row level security;
alter table public.email_outbox  enable row level security;
alter table public.job_reports   enable row level security;
alter table public.admin_notes   enable row level security;

drop policy if exists "read own notifications" on public.notifications;
create policy "read own notifications" on public.notifications
  for select using (recipient = auth.uid());
drop policy if exists "admin reads" on public.email_outbox;
create policy "admin reads" on public.email_outbox for select using (public.is_admin());
drop policy if exists "admin reads" on public.job_reports;
create policy "admin reads" on public.job_reports for select using (public.is_admin());
drop policy if exists "admin only" on public.admin_notes;
create policy "admin only" on public.admin_notes
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- Messages: wording helpers --------------------------------
-- Site details used in emails. Change here if the address or phone changes.
create or replace function public.site_url() returns text language sql immutable as $$ select 'https://1yard.github.io' $$;
create or replace function public.office_phone() returns text language sql immutable as $$ select '416-431-0010' $$;

create or replace function public.first_name(n text) returns text language sql immutable as $$ select split_part(coalesce(n, ''), ' ', 1) $$;
create or replace function public.h(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;
create or replace function public.urlenc(t text) returns text language sql immutable as $$
  select coalesce(string_agg(case when c ~ '^[A-Za-z0-9._~-]$' then c
                                  else regexp_replace(upper(encode(convert_to(c, 'UTF8'), 'hex')), '(..)', '%\1', 'g') end, '' order by i), '')
  from regexp_split_to_table(coalesce(t, ''), '') with ordinality x(c, i) $$;
create or replace function public.fmt_time(t text) returns text language sql immutable as $$
  select ((split_part(t, ':', 1)::int + 11) % 12 + 1)::text
      || case when split_part(t, ':', 2)::int = 0 then '' else ':' || lpad(split_part(t, ':', 2), 2, '0') end
      || case when split_part(t, ':', 1)::int < 12 then 'am' else 'pm' end $$;
-- 'Saturday, October 24 at 10:30am' (long) or 'Sat, Oct 24 at 10:30am'
create or replace function public.fmt_when(d date, t text, long boolean default true) returns text language sql stable as $$
  select case when d is null then 'a day to be confirmed'
         else to_char(d, case when long then 'FMDay, FMMonth FMDD' else 'Dy, Mon FMDD' end) || coalesce(' at ' || fmt_time(t), '') end $$;
create or replace function public.svc_names(s text[]) returns text language sql immutable as $$
  select coalesce(string_agg(case x when 'leaves' then 'Raking leaves' when 'mow' then 'Last lawn mow'
           when 'garden' then 'Garden bed clean-up' when 'debris' then 'Branches and yard debris' else 'Yard help' end, ' + ' order by i), 'Yard help')
  from unnest(s) with ordinality u(x, i) $$;
create or replace function public.tool_names(tools jsonb) returns text language sql immutable as $$
  select string_agg(case k when 'rake' then 'rake' when 'bags' then 'yard waste bags' when 'mower' then 'lawn mower'
           when 'shears' then 'garden clippers' when 'wheelbarrow' then 'wheelbarrow' else k end, ', ' order by k)
  from jsonb_each(coalesce(tools, '{}')) e(k, v) where v = 'true'::jsonb $$;
create or replace function public.job_address(c public.clients) returns text language sql immutable as $$
  select c.address || case when coalesce(c.postal, '') <> '' then ', ' || c.postal else '' end $$;

-- Simple, large-text email layout. Every paragraph is escaped.
create or replace function public.email_html(heading text, paras text[], btn_label text default null, btn_url text default null, extra_html text default '')
returns text language sql immutable as $$
  select '<!doctype html><html><body style="margin:0;padding:0;background:#F4F6EF">'
    || '<div style="max-width:560px;margin:0 auto;padding:28px 22px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.55;color:#1F2A1F">'
    || '<p style="margin:0 0 18px;font-size:16px;color:#1F4D2B;font-weight:bold">1Yard</p>'
    || '<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:26px;line-height:1.25;margin:0 0 18px;color:#1F4D2B">' || h(heading) || '</h1>'
    || coalesce((select string_agg('<p style="margin:0 0 14px">' || h(p) || '</p>', '' order by i) from unnest(paras) with ordinality u(p, i)), '')
    || case when btn_url is not null then '<p style="margin:24px 0"><a href="' || h(btn_url) || '" style="display:inline-block;background:#1F4D2B;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:bold">' || h(btn_label) || '</a></p>' else '' end
    || coalesce(extra_html, '')
    || '<p style="margin:26px 0 0;font-size:15px;color:#5B6B5B">1Yard · volunteer yard help in Kingston · ' || office_phone() || '</p></div></body></html>' $$;

-- Calendar links for a job (Google link uses Kingston local time; the .ics file uses UTC).
create or replace function public.gcal_link(j public.jobs, addr text) returns text language sql stable as $$
  select 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' || urlenc('1Yard: ' || svc_names(j.services))
    || '&dates=' || to_char(j.date + j.start_time::time, 'YYYYMMDD"T"HH24MISS') || '/'
    || to_char(j.date + j.start_time::time + make_interval(hours => j.hours), 'YYYYMMDD"T"HH24MISS')
    || '&ctz=America/Toronto&location=' || urlenc(addr)
    || '&details=' || urlenc('1Yard volunteer job. The client provides the tools; bring your own gloves. ' || site_url() || '/?go=job:' || j.id) $$;
create or replace function public.ics_esc(t text) returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n') $$;
create or replace function public.job_ics(j public.jobs, addr text) returns text language sql stable as $$
  select concat_ws(E'\r\n', 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//1Yard//Volunteer jobs//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' || j.id || '@1yard.ca',
    'DTSTAMP:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
    'DTSTART:' || to_char(((j.date + j.start_time::time) at time zone 'America/Toronto') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
    'DTEND:' || to_char(((j.date + j.start_time::time + make_interval(hours => j.hours)) at time zone 'America/Toronto') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
    'SUMMARY:' || ics_esc('1Yard: ' || svc_names(j.services)),
    'LOCATION:' || ics_esc(addr),
    'DESCRIPTION:' || ics_esc('The client provides the tools; bring your own gloves. ' || site_url() || '/?go=job:' || j.id),
    'END:VEVENT', 'END:VCALENDAR') || E'\r\n' $$;

-- ---------- Messages: bell + email outbox ---------------------------
create or replace function public.notify(p_to uuid, p_kind text, p_job uuid, p_msg text, p_link text, p_urgent boolean, p_key text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (recipient, kind, job_id, message, link, urgent, dedupe_key)
  select p_to, p_kind, p_job, left(p_msg, 500), coalesce(p_link, ''), coalesce(p_urgent, false), p_key
  where p_to is not null
  on conflict (dedupe_key) do nothing $$;

create or replace function public.notify_admins(p_kind text, p_job uuid, p_msg text, p_link text, p_urgent boolean, p_key text)
returns void language sql security definer set search_path = public as $$
  select notify(id, p_kind, p_job, p_msg, p_link, p_urgent, p_key || ':' || id) from profiles where role = 'admin' $$;

create or replace function public.queue_email(p_to text, p_subject text, p_heading text, p_paras text[], p_btn_label text, p_btn_url text,
  p_kind text, p_job uuid, p_key text, p_ics text default null, p_extra_html text default '')
returns void language sql security definer set search_path = public as $$
  insert into email_outbox (to_email, subject, html, text_body, ics, kind, job_id, dedupe_key)
  select trim(p_to), p_subject, email_html(p_heading, p_paras, p_btn_label, p_btn_url, p_extra_html),
    p_heading || E'\n\n' || array_to_string(p_paras, E'\n\n') || coalesce(E'\n\n' || p_btn_label || ': ' || p_btn_url, '')
      || E'\n\n1Yard · volunteer yard help in Kingston · ' || office_phone(),
    p_ics, p_kind, p_job, p_key || ':' || lower(trim(p_to))
  where coalesce(trim(p_to), '') like '%_@_%'
  on conflict (dedupe_key) do nothing $$;

-- Crew just reached 2: tell both volunteers, the client (if they gave an email) and the admins.
create or replace function public.on_crew_full(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs; c clients; v record; names text; key text; addr text; tools text;
begin
  select * into j from jobs where id = p_job;
  select * into c from clients where id = j.client_id;
  addr := job_address(c); tools := tool_names(j.tools);
  select string_agg(first_name(p.name), ' and ' order by s.created_at), string_agg(s.volunteer_id::text, ':' order by s.volunteer_id)
    into names, key from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = p_job;
  key := 'crew:' || p_job || ':' || key || ':' || j.date || ':' || j.start_time;
  for v in select p.id, p.name, p.email,
             (select pp.name from job_signups ss join profiles pp on pp.id = ss.volunteer_id where ss.job_id = p_job and ss.volunteer_id <> p.id limit 1) partner
           from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = p_job loop
    perform notify(v.id, 'crew_confirmed', p_job,
      'Crew confirmed: you and ' || first_name(v.partner) || ', ' || fmt_when(j.date, j.start_time, false) || ' at ' || c.address || '.',
      'job:' || p_job, false, key || ':' || v.id);
    perform queue_email(v.email, 'You''re confirmed: ' || fmt_when(j.date, j.start_time, false), 'Your crew is set',
      array['Hi ' || first_name(v.name) || ',',
            'You and ' || v.partner || ' are confirmed for ' || lower(svc_names(j.services)) || '.',
            'When: ' || fmt_when(j.date, j.start_time) || ' (about ' || j.hours || ' hour' || case when j.hours = 1 then '' else 's' end || ')',
            'Where: ' || addr,
            'The client provides the tools' || coalesce(' (' || tools || ')', '') || '. Bring your own gloves.',
            'Can''t make it? Open the job and tap "I can''t make it" as early as you can, so we can find someone else.'],
      'Open the job', site_url() || '/?go=job:' || p_job, 'crew_confirmed', p_job, key,
      job_ics(j, addr),
      '<p style="margin:0 0 14px;font-size:16px"><a href="' || h(gcal_link(j, addr)) || '" style="color:#1F4D2B">Add to Google Calendar</a> · or open the attached calendar file.</p>');
  end loop;
  perform queue_email(c.email, 'Your volunteers are coming ' || fmt_when(j.date, j.start_time), 'Your volunteers are set',
    array['Hello ' || first_name(c.name) || ',',
          'Your volunteers ' || names || ' will come on ' || fmt_when(j.date, j.start_time) || '.',
          coalesce('Please leave these out for them: ' || tools || '.', 'They will bring gloves and work outside only.'),
          'Questions, or need to change something? Call us at ' || office_phone() || '.'],
    'See your request', site_url() || '/?request=' || j.access_token, 'client_crew', p_job, key);
  perform notify_admins('crew_full', p_job,
    'Crew set for ' || c.name || ': ' || names || ', ' || fmt_when(j.date, j.start_time, false) || '. Call the client.', 'calls', false, key);
end $$;

-- Partner can't make it (sent to the volunteer still on the job).
create or replace function public.email_partner_dropped(p_to uuid, p_job uuid, p_who text) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs; v profiles;
begin
  select * into j from jobs where id = p_job; select * into v from profiles where id = p_to;
  perform queue_email(v.email, 'Your partner can''t make it: ' || fmt_when(j.date, j.start_time, false), 'Your partner can''t make it',
    array['Hi ' || first_name(v.name) || ',',
          first_name(p_who) || ' is no longer on ' || lower(svc_names(j.services)) || ' on ' || fmt_when(j.date, j.start_time) || '.',
          'The time stays the same and the spot is back on the job board. We''ll let you know when someone joins.',
          'Please don''t go alone. If nobody has joined by the day before, an admin will be in touch.'],
    'Open the job', site_url() || '/?go=job:' || p_job, 'partner_dropped', p_job,
    'pdrop:' || p_job || ':' || p_to || ':' || extract(epoch from now())::bigint);
end $$;

-- A concern logged with an hours report: urgent bell + email to every admin.
create or replace function public.report_concern(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r job_reports; j jobs; c clients; a profiles; label text;
begin
  select * into r from job_reports where id = p_report;
  select * into j from jobs where id = r.job_id; select * into c from clients where id = j.client_id;
  label := case r.concern when 'safety' then 'Safety or injury' when 'not_home' then 'Client wasn''t home'
                          when 'bigger' then 'Job was bigger than described' else 'Other' end;
  perform notify_admins('concern', j.id, 'Concern (' || label || ') from ' || r.reporter_name || ' at ' || c.name || '''s: ' || r.concern_detail,
    'jobs:' || j.id, true, 'concern:' || r.id);
  for a in select * from profiles where role = 'admin' loop
    perform queue_email(a.email, 'Concern reported: ' || label || ' (' || c.address || ')', 'A volunteer reported a concern',
      array['Type: ' || label,
            'Job: ' || svc_names(j.services) || ' for ' || c.name || ', ' || job_address(c) || ', on ' || fmt_when(j.date, j.start_time),
            'Reported by: ' || r.reporter_name,
            'What happened: ' || r.concern_detail],
      'Open the admin dashboard', site_url() || '/?go=jobs:' || j.id, 'concern', j.id, 'concern:' || r.id);
  end loop;
end $$;

-- ---------- Volunteer functions --------------------------------------

create or replace function public.require_trained() returns public.profiles
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null or me.status not in ('trainee', 'experienced') then
    raise exception 'Finish training first';
  end if;
  return me;
end $$;

-- Everything a trained volunteer's job board needs. The address is shown on
-- every job; client name/phone, notes and partner contact only to the crew.
create or replace function public.volunteer_board() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  me := require_trained();
  return jsonb_build_object(
    'shadow_count', shadow_count(me.id),
    'jobs_done', jobs_done(me.id),
    -- Completed jobs and hours, for the volunteer's own record (e.g. school service hours).
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', j.id, 'date', j.date, 'services', j.services,
               'area', c.area, 'hours', coalesce(j.actual_hours, j.hours)) order by j.date desc)
      from job_signups s join jobs j on j.id = s.job_id join clients c on c.id = j.client_id
      where s.volunteer_id = me.id and j.status = 'done'), '[]'),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'services', j.services, 'tools', j.tools, 'flags', j.flags,
        'windows', j.windows, 'status', j.status, 'date', j.date, 'start_time', j.start_time,
        'hours', j.hours, 'time_changed_at', j.time_changed_at, 'created_at', j.created_at,
        'crewed_at', j.crewed_at,
        'needs_new_dates', needs_new_dates(j),
        'area', c.area,
        'client_name',  case when m.mine then c.name end,
        'client_phone', case when m.mine then c.phone end,
        'address', c.address,          -- every trained volunteer sees where the job is
        'postal',  c.postal,
        'notes',        case when m.mine then j.notes end,
        'crew', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'as_trainee', s.as_trainee, 'at', s.created_at,
            'phone', case when m.mine then p.phone end,
            'email', case when m.mine then p.email end) order by s.created_at)
          from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = j.id), '[]')
      ))
      from jobs j
      join clients c on c.id = j.client_id
      cross join lateral (select exists (select 1 from job_signups s where s.job_id = j.id and s.volunteer_id = me.id) as mine) m
      where j.status = 'scheduled'), '[]')
  );
end $$;

-- Sign up for a job. The first volunteer must pick a date + start inside the
-- client's windows; the second joins at that time. Never two trainees.
-- If the client was already given a time (crew was full once), everyone joins at that time.
create or replace function public.join_job(p_job uuid, p_date date default null, p_start text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles; j jobs; n int; has_trainee boolean;
begin
  me := require_trained();
  select * into j from jobs where id = p_job for update;
  if j.id is null or j.status <> 'scheduled' then raise exception 'This job is no longer open'; end if;
  if exists (select 1 from job_signups where job_id = p_job and volunteer_id = me.id) then
    raise exception 'You''re already on this job';
  end if;
  select count(*), coalesce(bool_or(as_trainee), false) into n, has_trainee from job_signups where job_id = p_job;
  if n >= 2 then raise exception 'This job is full'; end if;
  if me.status = 'trainee' and has_trainee then raise exception 'This spot is for experienced volunteers only'; end if;
  if n = 0 and j.crewed_at is null then
    if p_date is null or p_date <= local_today() or not time_fits(j.windows, p_date, p_start, j.hours) then
      raise exception 'Pick a time inside the client''s days';
    end if;
    update jobs set date = p_date, start_time = p_start, time_changed_at = null where id = p_job;
  elsif j.date is null or j.date <= local_today() then
    raise exception 'This job is waiting on new dates';
  end if;
  insert into job_signups (job_id, volunteer_id, as_trainee) values (p_job, me.id, me.status = 'trainee');
end $$;

-- The first volunteer can change the time while they're still alone on the job.
create or replace function public.change_my_time(p_job uuid, p_date date, p_start text) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  select * into j from jobs where id = p_job for update;
  if not exists (select 1 from job_signups where job_id = p_job and volunteer_id = auth.uid()) then
    raise exception 'You''re not on this job';
  end if;
  if (select count(*) from job_signups where job_id = p_job) > 1 then
    raise exception 'Your partner has joined. Ask an admin to change the time.';
  end if;
  if j.crewed_at is not null then
    raise exception 'This time was confirmed with the client. Ask an admin to change it.';
  end if;
  if p_date <= local_today() or not time_fits(j.windows, p_date, p_start, j.hours) then
    raise exception 'Pick a time inside the client''s days';
  end if;
  update jobs set date = p_date, start_time = p_start where id = p_job;
end $$;

-- "I can't make it": a volunteer drops out of a job before it starts.
-- Their spot goes back on the board. If the crew was full before, the time stays
-- (the client may have been told), the job goes back on the admin's To call list,
-- and the partner and admins are notified.
drop function if exists public.leave_job(uuid);
create or replace function public.leave_job(p_job uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs; me profiles; c clients; starts timestamptz; partner record; had_partner boolean := false; why text := nullif(left(trim(coalesce(p_reason, '')), 500), '');
begin
  select * into j from jobs where id = p_job for update;
  select * into me from profiles where id = auth.uid();
  if not exists (select 1 from job_signups where job_id = p_job and volunteer_id = auth.uid()) then
    raise exception 'You''re not on this job';
  end if;
  if j.status <> 'scheduled' then raise exception 'This job is closed'; end if;
  if j.date is not null and j.start_time is not null then
    starts := (j.date + j.start_time::time) at time zone 'America/Toronto';
    if starts <= now() then raise exception 'This job has already started. Please call a 1Yard admin.'; end if;
  end if;

  perform set_config('oneyard.actor', 'self', true);   -- the delete trigger leaves the messages to us
  delete from job_signups where job_id = p_job and volunteer_id = auth.uid();

  if j.crewed_at is not null then
    update jobs set told_at = null, dropout_at = now() where id = p_job;
  else
    update jobs set told_at = null where id = p_job;
    if not exists (select 1 from job_signups where job_id = p_job) then
      update jobs set date = null, start_time = null, time_changed_at = null where id = p_job;
    end if;
  end if;

  select * into c from clients where id = j.client_id;
  for partner in select p.* from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = p_job loop
    had_partner := true;
    perform notify(partner.id, 'partner_dropped', p_job,
      first_name(me.name) || ' can''t make it to ' || lower(svc_names(j.services)) || ' on ' || fmt_when(j.date, j.start_time, false)
        || '. The time stays the same while we find a new partner.', 'job:' || p_job, false, null);
    perform email_partner_dropped(partner.id, p_job, me.name);
  end loop;

  -- A lone volunteer un-claiming a job nobody was told about yet isn't news for admins.
  if j.crewed_at is not null or had_partner then
    perform notify_admins('dropout', p_job,
      me.name || ' can''t make it to ' || c.name || '''s job on ' || fmt_when(j.date, j.start_time, false)
        || coalesce(' (' || why || ')', '') || '. ' || case when j.crewed_at is not null then 'Let the client know.' else 'The spot is open again.' end,
      'calls', starts is not null and starts - now() < interval '24 hours',
      'drop:' || p_job || ':' || me.id || ':' || extract(epoch from now())::bigint);
  end if;
end $$;

-- Crew member or admin marks a full job done and logs how long it took
-- (counts as volunteer hours for both crew members). Trainees who now have
-- enough shadow shifts are promoted. Returns the names of anyone promoted.
drop function if exists public.finish_job(uuid);
drop function if exists public.finish_job(uuid, numeric);
create or replace function public.finish_job(p_job uuid, p_hours numeric default null, p_note text default null,
  p_concern text default null, p_concern_detail text default null) returns text[]
language plpgsql security definer set search_path = public as $$
declare promoted text[]; me profiles; rid uuid; note text := left(trim(coalesce(p_note, '')), 2000);
  detail text := left(trim(coalesce(p_concern_detail, '')), 2000);
begin
  if p_hours is not null and (p_hours < 0.5 or p_hours > 12) then raise exception 'Hours should be between 0.5 and 12'; end if;
  if not (is_admin() or exists (select 1 from job_signups where job_id = p_job and volunteer_id = auth.uid())) then
    raise exception 'Only the crew or an admin can finish this job';
  end if;
  if (select count(*) from job_signups where job_id = p_job) < 2 then raise exception 'The job needs a full crew first'; end if;
  -- Volunteers can only mark it done once the scheduled start time has passed (Kingston time). Admins any time.
  if not is_admin() and exists (select 1 from jobs where id = p_job
       and (date + start_time::time) > (now() at time zone 'America/Toronto')) then
    raise exception 'You can mark this job complete after it starts';
  end if;
  if p_concern is not null and p_concern not in ('safety', 'not_home', 'bigger', 'other') then raise exception 'Pick what kind of concern it is'; end if;
  if p_concern is not null and detail = '' then raise exception 'Please describe the concern in a few words'; end if;
  update jobs set status = 'done', done_at = now(), actual_hours = coalesce(p_hours, hours) where id = p_job and status = 'scheduled';
  if not found then raise exception 'This job is not open'; end if;

  if note <> '' or p_concern is not null then
    select * into me from profiles where id = auth.uid();
    insert into job_reports (job_id, volunteer_id, reporter_name, note, concern, concern_detail)
    values (p_job, me.id, coalesce(me.name, ''), note, p_concern, detail) returning id into rid;
    if p_concern is not null then perform report_concern(rid); end if;
  end if;

  with up as (
    update profiles set status = 'experienced', promoted_at = now()
    where status = 'trainee'
      and id in (select volunteer_id from job_signups where job_id = p_job and as_trainee)
      and shadow_count(id) >= 2
    returning name)
  select coalesce(array_agg(name), '{}') into promoted from up;
  return promoted;
end $$;

-- Approved volunteer has read the training guide and uploaded the signed waiver.
drop function if exists public.complete_training(text);
create or replace function public.complete_training(p_path text, p_read_guide boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(p_read_guide, false) then raise exception 'Please confirm you have read the training guide'; end if;
  if p_path is null or p_path not like auth.uid()::text || '/%' then raise exception 'Upload your waiver first'; end if;
  update profiles set status = 'trainee', trained_at = now(), waiver_path = p_path
  where id = auth.uid() and status = 'approved';
  if not found then raise exception 'Your application needs to be approved first'; end if;
end $$;

-- ---------- Admin functions ------------------------------------------

-- Remove a volunteer's account. Frees their spots on upcoming jobs; completed
-- jobs stay on record without their name. They can apply again later.
create or replace function public.admin_remove_volunteer(vid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare jids uuid[];
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if vid = auth.uid() then raise exception 'You can''t remove your own account'; end if;
  if exists (select 1 from profiles where id = vid and role = 'admin') then
    raise exception 'This person is an admin. Remove their admin rights first.';
  end if;
  perform set_config('oneyard.actor', 'remove', true);
  with d as (
    delete from job_signups s using jobs j
    where s.job_id = j.id and j.status in ('review', 'scheduled') and s.volunteer_id = vid
    returning s.job_id)
  select coalesce(array_agg(job_id), '{}') into jids from d;
  update jobs set told_at = null where id = any(jids);
  update jobs set dropout_at = now() where id = any(jids) and crewed_at is not null;
  update jobs set date = null, start_time = null, time_changed_at = null
  where id = any(jids) and crewed_at is null and not exists (select 1 from job_signups where job_id = jobs.id);
  delete from auth.users where id = vid;   -- profile goes with it
end $$;

-- ---------- Client functions (no login) ------------------------------

create or replace function public.submit_request(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := left(trim(coalesce(p->>'phone', '')), 40);
  v_key   text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g');
  v_email text := lower(left(trim(coalesce(p->>'email', '')), 200));
  wins    jsonb := coalesce(p->'windows', '[]');
  c clients; tok uuid;
begin
  if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'address'), '') = '' then
    raise exception 'Please fill in your name and address';
  end if;
  if length(v_key) < 10 and v_email = '' then raise exception 'Please give us a phone number or an email'; end if;
  if jsonb_array_length(coalesce(p->'services', '[]')) = 0 then raise exception 'Please pick what you need help with'; end if;
  if jsonb_array_length(wins) not between 2 and 4 then raise exception 'Please pick 2 to 4 days'; end if;
  if exists (select 1 from jsonb_array_elements(wins) x
             where (x->>'date')::date <= local_today() or (x->>'date')::date > local_today() + 21
                or coalesce(x->>'part', '') not in ('am', 'pm', 'any')) then
    raise exception 'Some of those days have passed. Please pick again.';
  end if;

  select * into c from clients
  where (length(v_key) >= 10 and phone_key = v_key) or (v_email <> '' and lower(email) = v_email)
  order by created_at limit 1;

  if c.id is not null then
    if exists (select 1 from jobs where client_id = c.id and status in ('review', 'scheduled')) then
      raise exception 'ACTIVE_REQUEST';
    end if;
    update clients set name = left(trim(p->>'name'), 120), phone = v_phone, phone_key = v_key, email = v_email,
      contact = coalesce(nullif(p->>'contact', ''), 'phone'), address = left(trim(p->>'address'), 200),
      postal = upper(left(trim(coalesce(p->>'postal', '')), 10)), area = coalesce(nullif(left(trim(p->>'area'), 80), ''), 'Kingston')
    where id = c.id;
  else
    insert into clients (name, phone, phone_key, email, contact, address, postal, area)
    values (left(trim(p->>'name'), 120), v_phone, v_key, v_email, coalesce(nullif(p->>'contact', ''), 'phone'),
      left(trim(p->>'address'), 200), upper(left(trim(coalesce(p->>'postal', '')), 10)),
      coalesce(nullif(left(trim(p->>'area'), 80), ''), 'Kingston'))
    returning * into c;
  end if;

  insert into jobs (client_id, services, tools, flags, notes, windows)
  values (c.id,
    array(select jsonb_array_elements_text(p->'services')),
    coalesce(p->'tools', '{}'),
    array(select jsonb_array_elements_text(coalesce(p->'flags', '[]'))),
    left(coalesce(p->>'notes', ''), 1000),
    wins)
  returning access_token into tok;
  return tok;
end $$;

-- What the client sees on their private status link.
create or replace function public.get_request(tok uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'client_name', split_part(c.name, ' ', 1), 'contact', c.contact,
    'services', j.services, 'tools', j.tools, 'windows', j.windows, 'status', j.status,
    'date', j.date, 'start_time', j.start_time, 'created_at', j.created_at,
    'needs_new_dates', needs_new_dates(j),
    'crewed', j.crewed_at is not null,
    'crew', coalesce((select jsonb_agg(split_part(p.name, ' ', 1) order by s.created_at)
                      from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = j.id), '[]'))
  from jobs j join clients c on c.id = j.client_id
  where j.access_token = tok
$$;

create or replace function public.cancel_request(tok uuid) returns void
language plpgsql security definer set search_path = public as $$
declare jid uuid;
begin
  update jobs set status = 'cancelled' where access_token = tok and status in ('review', 'scheduled') returning id into jid;
  if jid is null then raise exception 'This request can''t be cancelled'; end if;
  delete from job_signups where job_id = jid;
end $$;

-- ---------- Event triggers: bell + email ------------------------------
-- Everything below runs inside the database, so messages can't be skipped or faked
-- from the website.

-- New volunteer application.
create or replace function public.trg_profile_new() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'volunteer' and new.status = 'pending' then
    perform notify_admins('new_application', null,
      new.name || ' applied to volunteer' || coalesce(' (' || nullif(new.university, '') || ')', '') || '.', 'apps', false, 'app:' || new.id);
  end if;
  return null;
end $$;
drop trigger if exists profile_new on public.profiles;
create trigger profile_new after insert on public.profiles for each row execute function public.trg_profile_new();

-- Application approved / promoted to experienced.
create or replace function public.trg_profile_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'approved' then
    perform notify(new.id, 'approved', null, 'You''re approved! Next: read the training guides and upload your signed waiver.', 'vhome', false, 'approved:' || new.id);
    perform queue_email(new.email, 'You''re approved to volunteer with 1Yard', 'You''re approved!',
      array['Hi ' || first_name(new.name) || ',',
            'Thanks for applying. You''re approved to volunteer with 1Yard.',
            'Next steps: log in, read the two training guides, then download the waiver, sign it and upload it. After that you can pick jobs as a trainee.',
            'Your first 2 jobs are with an experienced volunteer, so you''re never on your own while you learn.'],
      'Log in to 1Yard', site_url() || '/?go=vhome', 'approved', null, 'approved:' || new.id);
  elsif old.status = 'trainee' and new.status = 'experienced' then
    perform notify(new.id, 'promoted', null, 'You''re now an experienced volunteer. You can take any open spot, including partnering with trainees.',
      'vhome', false, 'promoted:' || new.id || ':' || extract(epoch from now())::bigint);
  end if;
  return null;
end $$;
drop trigger if exists profile_status on public.profiles;
create trigger profile_status after update of status on public.profiles for each row execute function public.trg_profile_status();

-- New client request.
create or replace function public.trg_job_new() returns trigger
language plpgsql security definer set search_path = public as $$
declare c clients;
begin
  select * into c from clients where id = new.client_id;
  perform notify_admins('new_request', new.id, 'New request from ' || c.name || ': ' || svc_names(new.services) || '.', 'reqs', false, 'req:' || new.id);
  return null;
end $$;
drop trigger if exists job_new on public.jobs;
create trigger job_new after insert on public.jobs for each row execute function public.trg_job_new();

-- Cancellations, admin time changes and hours corrections.
create or replace function public.trg_job_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare c clients; v profiles; key text; addr text;
begin
  select * into c from clients where id = new.client_id;
  addr := job_address(c);

  if new.status = 'cancelled' and old.status in ('review', 'scheduled') then
    for v in select p.* from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = new.id loop
      perform notify(v.id, 'cancelled', new.id,
        svc_names(new.services) || ' on ' || fmt_when(new.date, new.start_time, false) || ' was cancelled. You don''t need to go.', 'vhome', false, 'cancel:' || new.id || ':' || v.id);
      perform queue_email(v.email, 'Cancelled: ' || svc_names(new.services) || ', ' || fmt_when(new.date, new.start_time, false), 'This job is cancelled',
        array['Hi ' || first_name(v.name) || ',',
              'The ' || lower(svc_names(new.services)) || ' job at ' || c.address || ' on ' || fmt_when(new.date, new.start_time) || ' has been cancelled.',
              'You don''t need to go. Thank you for signing up. There may be other jobs on the board.'],
        'See open jobs', site_url() || '/?go=vboard', 'cancelled', new.id, 'cancel:' || new.id);
    end loop;
    if is_admin() then
      perform queue_email(c.email, 'Your 1Yard yard help is cancelled', 'Your request is cancelled',
        array['Hello ' || first_name(c.name) || ',',
              'Your request for ' || lower(svc_names(new.services)) || case when new.date is not null then ' on ' || fmt_when(new.date, new.start_time) else '' end || ' has been cancelled.',
              'If this is a surprise, or you''d like help another time, call us at ' || office_phone() || '.'],
        'See your request', site_url() || '/?request=' || new.access_token, 'client_cancelled', new.id, 'cancel:' || new.id);
    else
      perform notify_admins('client_cancelled', new.id, c.name || ' cancelled their request (' || svc_names(new.services) || ').', 'jobs:' || new.id, false, 'ccancel:' || new.id);
    end if;
  end if;

  if new.status = 'scheduled' and is_admin() and old.date is not null and new.date is not null and new.start_time is not null
     and (old.date, old.start_time) is distinct from (new.date, new.start_time)
     and exists (select 1 from job_signups where job_id = new.id) then
    key := 'time:' || new.id || ':' || new.date || ':' || new.start_time;
    for v in select p.* from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = new.id loop
      perform notify(v.id, 'time_changed', new.id,
        'An admin moved ' || lower(svc_names(new.services)) || ' to ' || fmt_when(new.date, new.start_time, false) || '.', 'job:' || new.id, false, key || ':' || v.id);
      perform queue_email(v.email, 'Time changed: now ' || fmt_when(new.date, new.start_time, false), 'Your job has a new time',
        array['Hi ' || first_name(v.name) || ',',
              'An admin moved ' || lower(svc_names(new.services)) || ' at ' || addr || ' to:',
              fmt_when(new.date, new.start_time) || ' (about ' || new.hours || ' hour' || case when new.hours = 1 then '' else 's' end || ')',
              'If the new time doesn''t work for you, open the job and tap "I can''t make it".'],
        'Open the job', site_url() || '/?go=job:' || new.id, 'time_changed', new.id, key,
        job_ics(new, addr),
        '<p style="margin:0 0 14px;font-size:16px"><a href="' || h(gcal_link(new, addr)) || '" style="color:#1F4D2B">Add the new time to Google Calendar</a> · or open the attached calendar file.</p>');
    end loop;
    perform queue_email(c.email, 'New time for your yard help: ' || fmt_when(new.date, new.start_time), 'Your visit has a new time',
      array['Hello ' || first_name(c.name) || ',',
            'Your volunteers will now come on ' || fmt_when(new.date, new.start_time) || '.',
            'Questions? Call us at ' || office_phone() || '.'],
      'See your request', site_url() || '/?request=' || new.access_token, 'client_time', new.id, key);
  end if;

  if old.status = 'done' and new.status = 'done' and old.actual_hours is distinct from new.actual_hours then
    for v in select p.* from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = new.id loop
      perform notify(v.id, 'hours', new.id, 'An admin updated the hours for ' || lower(svc_names(new.services)) || ' on '
        || to_char(new.date, 'Dy, Mon FMDD') || ' to ' || trim_scale(new.actual_hours) || '.', 'vhours', false, null);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists job_change on public.jobs;
create trigger job_change after update on public.jobs for each row execute function public.trg_job_change();

-- Second volunteer joined: the crew is set.
create or replace function public.trg_signup_new() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from job_signups where job_id = new.job_id) = 2 then
    update jobs set crewed_at = coalesce(crewed_at, now()), told_at = null where id = new.job_id;
    perform on_crew_full(new.job_id);
  end if;
  return null;
end $$;
drop trigger if exists signup_new on public.job_signups;
create trigger signup_new after insert on public.job_signups for each row execute function public.trg_signup_new();

-- Volunteers taken off a job by an admin (repost or removal). Drop-outs ("I can't make
-- it") send their own messages from leave_job; cancellations from trg_job_change.
create or replace function public.trg_signup_gone() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor text := coalesce(current_setting('oneyard.actor', true), ''); j jobs; c clients; v profiles; gone text;
begin
  if actor = 'self' then return null; end if;
  for j in select * from jobs where id in (select distinct job_id from old_rows) and status = 'scheduled' loop
    select * into c from clients where id = j.client_id;
    select string_agg(first_name(p.name), ' and ') into gone from old_rows o join profiles p on p.id = o.volunteer_id where o.job_id = j.id;
    if actor <> 'remove' then
      for v in select p.* from old_rows o join profiles p on p.id = o.volunteer_id where o.job_id = j.id loop
        perform notify(v.id, 'released', j.id,
          'An admin took you off ' || lower(svc_names(j.services)) || ' at ' || c.address || '. You don''t need to go.', 'vboard', false, null);
        perform queue_email(v.email, 'You''re no longer on a job', 'Plans changed for this job',
          array['Hi ' || first_name(v.name) || ',',
                'An admin changed the plan for ' || lower(svc_names(j.services)) || ' at ' || c.address || ', so you''re no longer on it.',
                'You don''t need to go. Thank you for signing up. There may be other jobs on the board.'],
          'See open jobs', site_url() || '/?go=vboard', 'released', j.id,
          'release:' || j.id || ':' || v.id || ':' || extract(epoch from now())::bigint);
      end loop;
    end if;
    for v in select p.* from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = j.id loop
      perform notify(v.id, 'partner_dropped', j.id, coalesce(gone, 'Your partner') || ' is no longer on ' || lower(svc_names(j.services)) || ' on '
        || fmt_when(j.date, j.start_time, false) || '. The time stays the same while we find a new partner.', 'job:' || j.id, false, null);
      perform email_partner_dropped(v.id, j.id, coalesce(gone, 'Your partner'));
    end loop;
  end loop;
  return null;
end $$;
drop trigger if exists signup_gone on public.job_signups;
create trigger signup_gone after delete on public.job_signups
  referencing old table as old_rows for each statement execute function public.trg_signup_gone();

-- ---------- Scheduled tasks (pg_cron runs this hourly, see email.sql) ----
-- 6pm Kingston time: day-before reminders, and a heads-up to admins about
-- tomorrow's jobs that are still missing a volunteer. Every run: jobs that
-- just moved to "needs new dates".
create or replace function public.daily_tasks(p_force_reminders boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs; c clients; v record; addr text; tools text; names text; n int;
begin
  if p_force_reminders or extract(hour from now() at time zone 'America/Toronto') = 18 then
    for j in select * from jobs where status = 'scheduled' and date = local_today() + 1 loop
      select * into c from clients where id = j.client_id;
      select count(*) into n from job_signups where job_id = j.id;
      if n < 2 then
        perform notify_admins('short_crew', j.id, c.name || '''s job tomorrow (' || fmt_time(j.start_time) || ') still needs '
          || case when n = 0 then '2 volunteers' else 'a volunteer' end || '. Find someone or call the client.', 'calls', true, 'short:' || j.id || ':' || j.date);
        continue;
      end if;
      addr := job_address(c); tools := tool_names(j.tools);
      select string_agg(first_name(p.name), ' and ' order by s.created_at) into names
        from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = j.id;
      for v in select p.name, p.email,
                 (select pp.name from job_signups ss join profiles pp on pp.id = ss.volunteer_id where ss.job_id = j.id and ss.volunteer_id <> p.id limit 1) partner
               from job_signups s join profiles p on p.id = s.volunteer_id where s.job_id = j.id loop
        perform queue_email(v.email, 'Tomorrow: ' || svc_names(j.services) || ' at ' || fmt_time(j.start_time), 'See you tomorrow',
          array['Hi ' || first_name(v.name) || ',',
                'Reminder: you and ' || v.partner || ' are helping with ' || lower(svc_names(j.services)) || ' tomorrow, ' || fmt_when(j.date, j.start_time) || '.',
                'Where: ' || addr,
                'Bring your gloves. The client provides the tools.',
                'Running late or something came up? Text your partner and call the 1Yard admin.'],
          'Open the job', site_url() || '/?go=job:' || j.id, 'reminder', j.id, 'remind:' || j.id || ':' || j.date);
      end loop;
      perform queue_email(c.email, 'Reminder: your volunteers come tomorrow at ' || fmt_time(j.start_time), 'See you tomorrow',
        array['Hello ' || first_name(c.name) || ',',
              'Your volunteers ' || names || ' will come tomorrow, ' || fmt_when(j.date, j.start_time) || '.',
              coalesce('Please leave these out for them: ' || tools || '.', 'They will bring gloves and work outside only.'),
              'Need to change something? Call us at ' || office_phone() || '.'],
        'See your request', site_url() || '/?request=' || j.access_token, 'client_reminder', j.id, 'remind:' || j.id || ':' || j.date);
    end loop;
  end if;

  for j in select * from jobs where status = 'scheduled' loop
    if needs_new_dates(j) then
      select * into c from clients where id = j.client_id;
      perform notify_admins('needs_dates', j.id, c.name || '''s request has no full crew and no days left. Call them for new days.', 'calls', false,
        'nnd:' || j.id || ':' || coalesce(j.date::text, (select max(x->>'date') from jsonb_array_elements(j.windows) x), ''));
    end if;
  end loop;
end $$;

-- ---------- Email sender support (used only by the send-emails Edge Function) --
-- Grabs a batch of emails to send. "skip locked" means two senders never take the
-- same email; failed ones are retried a few times with a growing wait.
create or replace function public.claim_emails(n int default 20) returns setof public.email_outbox
language sql security definer set search_path = public as $$
  update email_outbox o set status = 'sending', locked_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from email_outbox
    where created_at > now() - interval '2 days' and attempts < 5
      and (status = 'queued'
        or (status = 'sending' and locked_at < now() - interval '10 minutes')
        or (status = 'failed' and locked_at < now() - make_interval(mins => 5 * attempts)))
    order by created_at limit n
    for update skip locked)
  returning o.* $$;

create or replace function public.mark_email(p_id uuid, p_ok boolean, p_error text default null, p_provider_id text default null) returns void
language sql security definer set search_path = public as $$
  update email_outbox set status = case when p_ok then 'sent' else 'failed' end,
    sent_at = case when p_ok then now() end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    provider_id = coalesce(p_provider_id, provider_id)
  where id = p_id $$;

-- ---------- Website helpers for the bell and admin notes --------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now()
  where recipient = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids)) $$;

create or replace function public.add_admin_note(p_job uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Type a note first'; end if;
  insert into admin_notes (job_id, author, author_name, body)
  select p_job, id, name, left(trim(p_body), 1000) from profiles where id = auth.uid();
end $$;

-- Used by the weekly keep-awake GitHub Action.
create or replace function public.ping() returns int language sql stable as $$ select 1 $$;

-- ---------- Explicit access grants ----------------------------------
-- Works whether or not "Automatically expose new tables" is on. RLS above
-- still decides which rows anyone can see.
grant usage on schema public to anon, authenticated;
revoke all on public.profiles, public.clients, public.jobs, public.job_signups from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.clients, public.jobs, public.job_signups to authenticated;

grant select on public.notifications, public.job_reports, public.email_outbox to authenticated;
grant select, delete on public.admin_notes to authenticated;
revoke all on public.notifications, public.job_reports, public.email_outbox, public.admin_notes from anon;

-- Functions the website calls. Clients (not logged in) only get these four.
grant execute on function public.submit_request(jsonb), public.get_request(uuid),
  public.cancel_request(uuid), public.ping() to anon, authenticated;
grant execute on function public.volunteer_board(), public.join_job(uuid, date, text),
  public.change_my_time(uuid, date, text), public.leave_job(uuid, text), public.finish_job(uuid, numeric, text, text, text),
  public.complete_training(text, boolean), public.admin_remove_volunteer(uuid),
  public.mark_notifications_read(uuid[]), public.add_admin_note(uuid, text) to authenticated;
-- Postgres lets everyone run new functions by default; logged-out visitors don't need these.
revoke execute on function public.volunteer_board(), public.join_job(uuid, date, text),
  public.change_my_time(uuid, date, text), public.leave_job(uuid, text), public.finish_job(uuid, numeric, text, text, text),
  public.complete_training(text, boolean), public.admin_remove_volunteer(uuid),
  public.mark_notifications_read(uuid[]), public.add_admin_note(uuid, text) from public, anon;

-- Internal helpers shouldn't be callable from the website.
revoke execute on function public.handle_new_user(), public.trg_profile_new(), public.trg_profile_status(),
  public.trg_job_new(), public.trg_job_change(), public.trg_signup_new(), public.trg_signup_gone(),
  public.notify(uuid, text, uuid, text, text, boolean, text), public.notify_admins(text, uuid, text, text, boolean, text),
  public.queue_email(text, text, text, text[], text, text, text, uuid, text, text, text), public.on_crew_full(uuid),
  public.email_partner_dropped(uuid, uuid, text), public.report_concern(uuid), public.daily_tasks(boolean),
  public.claim_emails(int), public.mark_email(uuid, boolean, text, text) from public, anon, authenticated;

-- ---------- Waiver storage -------------------------------------------
-- Private bucket, PDFs only, 5 MB max. Volunteers upload into their own
-- folder; only they and admins can read it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('waivers', 'waivers', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "volunteer uploads own waiver" on storage.objects;
create policy "volunteer uploads own waiver" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'waivers' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "admin deletes waiver" on storage.objects;
create policy "admin deletes waiver" on storage.objects
  for delete to authenticated
  using (bucket_id = 'waivers' and public.is_admin());

drop policy if exists "owner or admin reads waiver" on storage.objects;
create policy "owner or admin reads waiver" on storage.objects
  for select to authenticated
  using (bucket_id = 'waivers' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
