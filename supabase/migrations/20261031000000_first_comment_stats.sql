-- First comment: text posted as a comment right after a Facebook/Instagram post goes out. The comment IDs are
-- the idempotency marker (a filled ID means never comment again), exactly like fb_post_id/ig_media_id.
-- stats: per-platform like/comment/view counts the publisher refreshes, {platform: {...}}.
alter table public.posts add column first_comment text not null default '';
alter table public.posts add column fb_comment_id text not null default '';
alter table public.posts add column ig_comment_id text not null default '';
alter table public.posts add column stats jsonb not null default '{}'::jsonb
  check (jsonb_typeof(stats) = 'object');
