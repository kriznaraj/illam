-- migrate:up
-- The roles PostgREST and GoTrue expect, created only if missing, so this also runs against
-- an external Postgres (Neon, RDS, a local server) or a hosted Supabase project.
--
--   anon          requests with no session. Granted nothing (0003_security.sql).
--   authenticated a signed-in household member. Full access to the household's data.
--   service_role  the server's signed ingest routes (SUPABASE_SERVICE_ROLE_KEY).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT;
  END IF;
  -- GoTrue's own migrations grant to these by name. On a plain Postgres whose superuser is
  -- not called postgres, they would not exist.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
END
$$;

-- PostgREST connects as the migrating user and switches to the request's role per request,
-- which needs membership. Skipped where the user cannot grant it (hosted Supabase already has it).
DO $$
BEGIN
  EXECUTE format('GRANT anon, authenticated, service_role TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not grant API roles to %, assuming they are already set up', current_user;
END
$$;

-- GoTrue keeps its users and sessions here and creates its own tables on start.
CREATE SCHEMA IF NOT EXISTS auth;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- migrate:down
-- Not reversible: roles may be shared with other databases on the same server.
