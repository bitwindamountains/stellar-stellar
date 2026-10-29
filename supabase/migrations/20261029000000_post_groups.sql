-- One post sent to several accounts is stored as one row per account sharing a group_id. Each row keeps its
-- own platform IDs, so idempotency stays per row and the publisher needs no change.
alter table public.posts add column group_id uuid;
create index posts_group_id_idx on public.posts (group_id) where group_id is not null;

-- Live Queue updates (Realtime honours RLS: posts stay owner-only, runs readable by signed-in users).
alter publication supabase_realtime add table public.posts, public.runs;
