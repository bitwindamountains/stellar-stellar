-- Connected logins (Facebook+Instagram, X, TikTok). Tokens live in Supabase Vault, never in a table the app can read:
-- only the service role (Edge Function `connect`, the publisher) can call the token functions below.

alter table public.posts
  add column x_post_id text not null default '',
  add column x_permalink text not null default '',
  -- 'telegram' when TikTok went out by hand: still counts as done, so connecting TikTok later never reposts it.
  add column tiktok_id text not null default '',
  add column tiktok_permalink text not null default '';

alter table public.posts drop constraint posts_platforms_check;
alter table public.posts add constraint posts_platforms_check
  check (platforms <@ array['facebook', 'instagram', 'x', 'fb_profile', 'tiktok', 'youtube', 'shopee']);

update public.posts set tiktok_id = 'telegram'
where tg_message_id <> '' and 'tiktok' = any (platforms);

create table public.connections (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  account_id bigint not null references public.accounts (id) on delete cascade,
  platform text not null check (platform in ('meta', 'x', 'tiktok')),
  handle text not null default '', -- who is connected, shown in the app
  secret_id uuid not null,         -- vault.secrets row holding the token JSON
  expires_at timestamptz,          -- null = doesn't expire (Facebook Page tokens)
  connected_at timestamptz not null default now(),
  unique (account_id, platform)
);
create index connections_owner_id_idx on public.connections (owner_id);

alter table public.connections enable row level security;
create policy connections_read_own on public.connections
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy connections_delete_own on public.connections
  for delete to authenticated using ((select auth.uid()) = owner_id);
revoke insert, update on public.connections from anon, authenticated;

-- OAuth state + PKCE verifier between "Connect" and the platform's redirect back. Service role only (no policies).
create table public.oauth_states (
  state text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  account_id bigint not null references public.accounts (id) on delete cascade,
  platform text not null check (platform in ('meta', 'x', 'tiktok')),
  verifier text not null default '',
  created_at timestamptz not null default now()
);
alter table public.oauth_states enable row level security;

create function public.save_connection(
  p_account bigint, p_platform text, p_handle text, p_tokens text, p_expires_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
  owner uuid;
begin
  select owner_id into owner from public.accounts where id = p_account;
  if owner is null then
    raise exception 'unknown account %', p_account;
  end if;
  select secret_id into existing from public.connections where account_id = p_account and platform = p_platform;
  if existing is null then
    insert into public.connections (owner_id, account_id, platform, handle, secret_id, expires_at)
    values (owner, p_account, p_platform, p_handle, vault.create_secret(p_tokens), p_expires_at);
  else
    perform vault.update_secret(existing, p_tokens);
    update public.connections
    set handle = coalesce(nullif(p_handle, ''), handle), expires_at = p_expires_at
    where account_id = p_account and platform = p_platform;
  end if;
end $$;

create function public.connection_tokens(p_account bigint, p_platform text)
returns table (tokens text, expires_at timestamptz)
language sql security definer set search_path = '' stable as $$
  select s.decrypted_secret, c.expires_at
  from public.connections c join vault.decrypted_secrets s on s.id = c.secret_id
  where c.account_id = p_account and c.platform = p_platform
$$;

create function public.drop_connection_secret() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end $$;
create trigger connections_drop_secret after delete on public.connections
  for each row execute function public.drop_connection_secret();

revoke execute on function public.save_connection(bigint, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.connection_tokens(bigint, text) from public, anon, authenticated;
revoke execute on function public.drop_connection_secret() from public, anon, authenticated;
grant execute on function public.save_connection(bigint, text, text, text, timestamptz) to service_role;
grant execute on function public.connection_tokens(bigint, text) to service_role;
