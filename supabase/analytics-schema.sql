-- =============================================================================
-- Aspen II Homes — site analytics schema
-- =============================================================================
-- Run this in the Supabase SQL editor (Dashboard > SQL > New query), in the SAME
-- project that already holds the `leads` table (the one behind SUPABASE_URL).
-- This adds two tables next to `leads`; it does not change anything about leads.
--
-- Security posture, matching the Harbison Standard implementation:
--   * RLS is ENABLED on both tables and NO public policies are created, so the
--     anon key cannot read or write anything. Only the service_role key can,
--     and that key is server-side only.
--   * No raw IP addresses are stored. Unique visitors are counted with a daily
--     rotating salted hash of the edge IP, which cannot be reversed to an IP
--     and cannot be followed across days.
--   * Referrers are stored as host only ("google.com"), never the full URL,
--     which would otherwise carry search terms.
--   * No age or other personal characteristics are collected or inferred.
-- =============================================================================

create table if not exists public.sessions (
  session_id      text primary key,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),

  visitor_hash    text,                    -- daily-rotating hash, never an IP
  referrer_host   text,                    -- e.g. "google.com" (no full URL)
  referrer_type   text check (referrer_type in
                    ('direct','search','social','referral','email','other')),
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,

  entry_path      text,
  exit_path       text,
  page_views      integer not null default 0,

  -- Derived from the user-agent string on the server.
  device_type     text check (device_type in ('desktop','mobile','tablet','bot','other')),
  browser         text,
  os              text,

  -- Coarse location from Vercel edge headers. The IP behind these is discarded.
  country         text,
  region          text,                    -- state / province
  city            text,

  -- Engaged time in seconds, accumulated in the browser and flushed on exit.
  duration_seconds integer not null default 0
);

create index if not exists sessions_created_at_idx on public.sessions (created_at desc);
create index if not exists sessions_visitor_idx    on public.sessions (visitor_hash);
create index if not exists sessions_device_idx    on public.sessions (device_type);
create index if not exists sessions_country_idx   on public.sessions (country);

-- One row per page view, so per-page analysis and drop-off are possible.
create table if not exists public.visits (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  session_id    text not null,
  path          text not null,
  title         text,
  referrer_host text,
  duration_seconds integer
);

create index if not exists visits_session_idx  on public.visits (session_id);
create index if not exists visits_path_idx     on public.visits (path);
create index if not exists visits_created_at_idx on public.visits (created_at desc);

-- One token per page view, generated in the browser. The dwell flush filters on
-- it so a heartbeat updates the existing row instead of appending one per beat.
alter table public.visits add column if not exists page_token text;
create unique index if not exists visits_page_token_idx
  on public.visits (page_token) where page_token is not null;

-- Optional: tie a lead back to the visit that produced it. Existing leads keep
-- working with a null session_id; this only adds attribution where we have it.
alter table public.leads add column if not exists session_id text;
create index if not exists leads_session_idx on public.leads (session_id);

-- -----------------------------------------------------------------------------
-- Atomic session counter.
--
-- Page views, dwell time and exit path accumulate. PostgREST cannot express
-- `page_views = page_views + n`, and a read-modify-write from the app drops
-- concurrent updates, which happens constantly on a fast multi-page visit.
-- Doing the addition inside the database avoids losing them.
--
-- SECURITY DEFINER because `sessions` has RLS enabled with no policies: the
-- function still has to write, and only service_role may call it. The execute
-- grant is revoked from everyone else.
-- -----------------------------------------------------------------------------
create or replace function public.bump_session(
  p_session_id       text,
  p_page_views       integer default 0,
  p_duration_seconds integer default 0,
  p_exit_path        text   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.sessions
     set page_views       = coalesce(page_views, 0) + coalesce(p_page_views, 0),
         duration_seconds = coalesce(duration_seconds, 0) + coalesce(p_duration_seconds, 0),
         exit_path        = coalesce(p_exit_path, exit_path),
         last_seen_at     = now()
   where session_id = p_session_id;
end;
$$;

revoke all on function public.bump_session(text, integer, integer, text) from public;
grant  execute on function public.bump_session(text, integer, integer, text) to service_role;

-- Lock it down. No policies means anon and authenticated get nothing.
alter table public.sessions enable row level security;
alter table public.visits   enable row level security;
