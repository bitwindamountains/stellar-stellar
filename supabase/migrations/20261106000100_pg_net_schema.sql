-- The security advisor flagged pg_net installed in the public schema. pg_net can't be moved with
-- `alter extension ... set schema`, so it is dropped and re-created in `extensions`. Its functions stay in schema
-- `net` either way, so dispatch_due() (net.http_post) is unchanged. Pending requests and stored responses are lost.
drop extension if exists pg_net;
create extension pg_net with schema extensions;
