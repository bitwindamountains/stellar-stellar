-- PostPilot schema. Rows belong to one owner (RLS); the publisher uses the service-role key, which bypasses RLS.
-- Meta tokens never live here: accounts.token_env names the GitHub secret that holds one.

create table public.accounts (
  id bigint generated always as identity primary key,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  fb_page_id text not null default '',
  ig_user_id text not null default '',
  token_env text not null default '' check (token_env = '' or token_env ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  timezone text not null default 'Asia/Manila',
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table public.posts (
  num bigint generated always as identity primary key, -- plays the role of the old sheet row number
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id bigint not null references public.accounts (id) on delete restrict,
  platforms text[] not null default '{}'
    check (platforms <@ array['facebook', 'instagram', 'fb_profile', 'tiktok', 'youtube']),
  publish_at timestamptz,
  caption text not null default '',
  media_type text not null default 'none' check (media_type in ('none', 'image', 'video')),
  media_urls text[] not null default '{}',
  link text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'posting', 'posted', 'partial', 'failed', 'missed')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  -- Filled by the publisher. A filled ID means: never publish that platform for this post again.
  fb_post_id text not null default '',
  fb_permalink text not null default '',
  ig_media_id text not null default '',
  ig_permalink text not null default '',
  tg_message_id text not null default '',
  assist_done_at timestamptz, -- set from the app when you've posted the by-hand platforms yourself
  last_error text not null default '',
  posted_at timestamptz,
  created_at timestamptz not null default now()
);

create index posts_owner_id_idx on public.posts (owner_id);
create index posts_account_id_idx on public.posts (account_id);
-- The publisher only ever scans these statuses.
create index posts_active_publish_at_idx on public.posts (publish_at)
  where status in ('scheduled', 'partial', 'posting');

create table public.runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  posted integer not null default 0,
  partial integer not null default 0,
  failed integer not null default 0,
  missed integer not null default 0,
  dry_run boolean not null default false
);

create index runs_ran_at_idx on public.runs (ran_at desc);

alter table public.accounts enable row level security;
alter table public.posts enable row level security;
alter table public.runs enable row level security;

create policy accounts_owner on public.accounts
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy posts_owner on public.posts
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and account_id in (select id from public.accounts where owner_id = (select auth.uid()))
  );

-- Run summaries hold counts only; any signed-in user may read them, only the publisher writes.
create policy runs_read on public.runs
  for select to authenticated
  using (true);

-- Media: public bucket because Meta and Telegram fetch by URL. Uploads only into the user's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
);

create policy media_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy media_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
