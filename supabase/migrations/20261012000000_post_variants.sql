-- Per-platform overrides: {platform: {caption?, hashtags?, title?}}. Empty object = every platform uses the base caption.
alter table public.posts
  add column variants jsonb not null default '{}'::jsonb
  check (jsonb_typeof(variants) = 'object');
