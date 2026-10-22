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
           when j.date is not null and exists (select 1 from job_signups where job_id = j.id)
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

-- Everything a trained volunteer's job board needs. Full address, client
-- contact, notes and partner contact only appear on jobs they're crew on.
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
        'needs_new_dates', needs_new_dates(j),
        'area', c.area,
        'client_name',  case when m.mine then c.name end,
        'client_phone', case when m.mine then c.phone end,
        'address',      case when m.mine then c.address end,
        'postal',       case when m.mine then c.postal end,
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
  if n = 0 then
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
  if p_date <= local_today() or not time_fits(j.windows, p_date, p_start, j.hours) then
    raise exception 'Pick a time inside the client''s days';
  end if;
  update jobs set date = p_date, start_time = p_start where id = p_job;
end $$;

create or replace function public.leave_job(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from job_signups where job_id = p_job and volunteer_id = auth.uid();
  if not found then raise exception 'You''re not on this job'; end if;
  update jobs set told_at = null where id = p_job;
  if not exists (select 1 from job_signups where job_id = p_job) then
    update jobs set date = null, start_time = null, time_changed_at = null where id = p_job;
  end if;
end $$;

-- Crew member or admin marks a full job done and logs how long it took
-- (counts as volunteer hours for both crew members). Trainees who now have
-- enough shadow shifts are promoted. Returns the names of anyone promoted.
drop function if exists public.finish_job(uuid);
create or replace function public.finish_job(p_job uuid, p_hours numeric default null) returns text[]
language plpgsql security definer set search_path = public as $$
declare promoted text[];
begin
  if p_hours is not null and (p_hours < 0.5 or p_hours > 12) then raise exception 'Hours should be between 0.5 and 12'; end if;
  if not (is_admin() or exists (select 1 from job_signups where job_id = p_job and volunteer_id = auth.uid())) then
    raise exception 'Only the crew or an admin can finish this job';
  end if;
  if (select count(*) from job_signups where job_id = p_job) < 2 then raise exception 'The job needs a full crew first'; end if;
  update jobs set status = 'done', done_at = now(), actual_hours = coalesce(p_hours, hours) where id = p_job and status = 'scheduled';
  if not found then raise exception 'This job is not open'; end if;
  with up as (
    update profiles set status = 'experienced', promoted_at = now()
    where status = 'trainee'
      and id in (select volunteer_id from job_signups where job_id = p_job and as_trainee)
      and shadow_count(id) >= 2
    returning name)
  select coalesce(array_agg(name), '{}') into promoted from up;
  return promoted;
end $$;

-- Approved volunteer has done the training and uploaded the signed waiver.
create or replace function public.complete_training(p_path text) returns void
language plpgsql security definer set search_path = public as $$
begin
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
  with d as (
    delete from job_signups s using jobs j
    where s.job_id = j.id and j.status in ('review', 'scheduled') and s.volunteer_id = vid
    returning s.job_id)
  select coalesce(array_agg(job_id), '{}') into jids from d;
  update jobs set told_at = null where id = any(jids);
  update jobs set date = null, start_time = null, time_changed_at = null
  where id = any(jids) and not exists (select 1 from job_signups where job_id = jobs.id);
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

-- Used by the weekly keep-awake GitHub Action.
create or replace function public.ping() returns int language sql stable as $$ select 1 $$;

-- ---------- Explicit access grants ----------------------------------
-- Works whether or not "Automatically expose new tables" is on. RLS above
-- still decides which rows anyone can see.
grant usage on schema public to anon, authenticated;
revoke all on public.profiles, public.clients, public.jobs, public.job_signups from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.clients, public.jobs, public.job_signups to authenticated;

-- Functions the website calls. Clients (not logged in) only get these four.
grant execute on function public.submit_request(jsonb), public.get_request(uuid),
  public.cancel_request(uuid), public.ping() to anon, authenticated;
grant execute on function public.volunteer_board(), public.join_job(uuid, date, text),
  public.change_my_time(uuid, date, text), public.leave_job(uuid), public.finish_job(uuid, numeric),
  public.complete_training(text), public.admin_remove_volunteer(uuid) to authenticated;

-- Internal helpers shouldn't be callable from the website.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

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
