-- Recovered verbatim from Production PostgreSQL statement logs.
-- Applied at 2026-11-18 23:21:54 UTC; SQLSTATE 00000.
-- Preserve original semantics; do not reapply to Production.
CREATE SCHEMA IF NOT EXISTS agents_hub AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA agents_hub FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA agents_hub TO service_role;
