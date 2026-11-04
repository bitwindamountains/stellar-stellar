-- The clip's length (seconds) and size (pixels), read in the browser at upload; null = unknown.
-- The publisher re-checks the video limits with them (validation.py mirrors validation.ts).
alter table posts
  add column video_seconds real,
  add column video_width integer,
  add column video_height integer;
