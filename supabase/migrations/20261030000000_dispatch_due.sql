-- GitHub's 30-minute schedule really runs every few hours, so posts went out late. Every 10 minutes, if a post is
-- due, start the publish workflow directly. Needs a fine-grained GitHub token (this repo, "Actions: read and
-- write") in Vault: select vault.create_secret('<token>', 'postpilot_github_token');  Without it this does nothing.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.dispatch_due() returns void
language plpgsql security definer set search_path = '' as $$
declare
  token text;
begin
  if not exists (
    select 1 from public.posts where status in ('scheduled', 'partial') and publish_at <= now()
  ) then
    return;
  end if;
  select decrypted_secret into token from vault.decrypted_secrets where name = 'postpilot_github_token';
  if token is null then
    return;
  end if;
  -- The workflow's concurrency group keeps one run at a time, so a dispatch while one runs just queues.
  perform net.http_post(
    url := 'https://api.github.com/repos/bitwindamountains/PostPilot/actions/workflows/publish.yml/dispatches',
    body := '{"ref": "main", "inputs": {"dry_run": "false"}}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'postpilot-cron',
      'Content-Type', 'application/json'
    )
  );
end;
$$;

revoke execute on function public.dispatch_due() from public, anon, authenticated;

select cron.schedule('postpilot-dispatch-due', '3-59/10 * * * *', 'select public.dispatch_due()');

-- One row per local day the "nothing posted today" Telegram nudge went out, so it is sent at most once a day.
-- Only the publisher (service role) uses it: RLS on with no policies.
create table public.nudges (
  day date primary key,
  sent_at timestamptz not null default now()
);
alter table public.nudges enable row level security;
revoke all on public.nudges from anon, authenticated;
