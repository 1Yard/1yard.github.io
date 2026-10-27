-- =====================================================================
-- 1Yard portal — email sending (run AFTER schema.sql, once the
-- send-emails Edge Function is deployed). Safe to re-run.
--
-- What it does:
--   * When an email is queued, pokes the send-emails Edge Function right away.
--   * Every 5 minutes, pokes it again if anything is still waiting (retries).
--   * Every hour, runs daily_tasks(): day-before reminders at 6pm Kingston
--     time, and "needs new dates" alerts for admins.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- The Edge Function's address. Change it only if the Supabase project changes.
create or replace function public.email_sender_url() returns text language sql immutable as $$
  select 'https://ybjaifvfgparclbeliue.supabase.co/functions/v1/send-emails' $$;

create or replace function public.kick_email_sender() returns void
language sql security definer set search_path = public as $$
  select net.http_post(url := email_sender_url(), body := '{}'::jsonb,
                       headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 30000) $$;

create or replace function public.trg_email_queued() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform kick_email_sender();   -- async: doesn't slow down the action that queued the email
  return null;
end $$;
drop trigger if exists email_queued on public.email_outbox;
create trigger email_queued after insert on public.email_outbox
  for each statement execute function public.trg_email_queued();

revoke execute on function public.kick_email_sender(), public.trg_email_queued() from public, anon, authenticated;

-- Scheduled jobs (pg_cron uses UTC; daily_tasks() checks Kingston time itself).
select cron.unschedule(jobname) from cron.job where jobname in ('1yard-email-retry', '1yard-hourly');
select cron.schedule('1yard-email-retry', '*/5 * * * *',
  $$ select public.kick_email_sender() where exists (
       select 1 from public.email_outbox where status in ('queued', 'failed', 'sending') and created_at > now() - interval '2 days' and attempts < 5) $$);
select cron.schedule('1yard-hourly', '2 * * * *', $$ select public.daily_tasks() $$);
