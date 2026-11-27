#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=haress_migrations}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGDATABASE PGUSER

command -v psql >/dev/null 2>&1 || {
  echo "psql is required to replay Supabase migrations" >&2
  exit 127
}
[[ -d "$MIGRATIONS_DIR" ]] || {
  echo "Migration directory not found: $MIGRATIONS_DIR" >&2
  exit 1
}

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)
(("${#migrations[@]}" > 0)) || {
  echo "No SQL migrations found in $MIGRATIONS_DIR" >&2
  exit 1
}

echo "Preparing isolated PostgreSQL compatibility schemas..."
psql --no-psqlrc --set ON_ERROR_STOP=1 <<'SQL'
DO $roles$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;
DO $roles$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;
DO $roles$
BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$roles$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$function$;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text
);
SQL

echo "Replaying ${#migrations[@]} migration files in filename order..."
for migration in "${migrations[@]}"; do
  echo "::group::$(basename "$migration")"
  psql --no-psqlrc --set ON_ERROR_STOP=1 --file "$migration"
  echo "::endgroup::"
done

echo "Verifying migration-created schema objects..."
psql --no-psqlrc --set ON_ERROR_STOP=1 --tuples-only --command="
  SELECT 'tables=' || count(*)
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  SELECT 'functions=' || count(*)
  FROM information_schema.routines
  WHERE routine_schema = 'public';
  SELECT 'migrations=' || ${#migrations[@]};
"

echo "PASS: all ${#migrations[@]} Supabase migration files replayed on isolated PostgreSQL."
