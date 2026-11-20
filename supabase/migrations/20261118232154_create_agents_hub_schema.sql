CREATE SCHEMA IF NOT EXISTS agents_hub AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA agents_hub FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA agents_hub TO service_role;