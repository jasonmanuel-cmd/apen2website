-- =============================================================================
-- Aspen II Homes — website chat and appointments schema
-- =============================================================================
-- Safe to re-run (everything is `if not exists`). Run in the Supabase SQL editor, in the SAME project that holds `leads`.
-- Adds four tables next to `leads`; it does not change the leads table.
--
-- Security posture, same as leads / sessions / visits:
--   * RLS is ENABLED and NO policies exist, so the anon key can read and write
--     nothing. Only the service_role key (server-side only) can.
--   * A conversation id is a random value the browser generates. It is not a
--     credential: nothing public ever reads a conversation back.
-- =============================================================================

create table if not exists public.conversations (
  id               text primary key,            -- random id from the visitor's browser
  channel          text not null default 'web' check (channel in ('web','sms')),
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  message_count    integer not null default 0,  -- visitor messages, used for the per-chat cap
  lead_id          uuid,                        -- set once the bot has saved contact details
  needs_human      boolean not null default false,
  handoff_reason   text,
  resolved         boolean not null default false
);
create index if not exists conversations_last_idx  on public.conversations (last_message_at desc);
create index if not exists conversations_human_idx on public.conversations (needs_human) where needs_human and not resolved;

create table if not exists public.messages (
  id               bigserial primary key,
  conversation_id  text not null references public.conversations (id) on delete cascade,
  created_at       timestamptz not null default now(),
  role             text not null check (role in ('user','assistant')),
  content          text not null
);
create index if not exists messages_conv_idx on public.messages (conversation_id, id);

create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  conversation_id  text references public.conversations (id) on delete set null,
  lead_id          uuid,
  name             text not null,
  phone            text not null,
  email            text,
  kind             text not null check (kind in ('tour','call')),
  preferred_date   date not null,
  preferred_time   text not null,               -- 24h "HH:MM", Tehachapi local time
  notes            text,
  -- A request, not a booking, until staff confirm it.
  status           text not null default 'requested'
                     check (status in ('requested','confirmed','completed','cancelled','no_show')),
  staff_notes      text
);
create index if not exists appointments_status_idx on public.appointments (status, preferred_date);

-- A message left for the team to call the visitor back.
create table if not exists public.callbacks (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  conversation_id  text references public.conversations (id) on delete set null,
  lead_id          uuid,
  name             text not null,
  phone            text not null,
  email            text,
  message          text not null,
  best_time        text,
  status           text not null default 'requested'
                     check (status in ('requested','called','no_answer','closed')),
  staff_notes      text
);
create index if not exists callbacks_status_idx on public.callbacks (status, created_at desc);

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.appointments  enable row level security;
alter table public.callbacks     enable row level security;
