-- dispatch_due is now the only thing that starts the publish workflow early: the `dispatch` Edge Function ("Post
-- now") calls it over RPC, so the GitHub token lives only in Vault ('postpilot_github_token').
-- It also stops poking GitHub for a post more than 3 hours past due: matches PP_LATE_GRACE_MINUTES (180); later than
-- that the publisher marks it missed anyway, and a publisher that keeps failing can't burn Actions minutes forever.
create or replace function public.dispatch_due() returns void
language plpgsql security definer set search_path = '' as $$
declare
  token text;
begin
  if not exists (
    select 1 from public.posts
    where status in ('scheduled', 'partial')
      and publish_at <= now()
      and publish_at > now() - interval '3 hours'
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
grant execute on function public.dispatch_due() to service_role;
