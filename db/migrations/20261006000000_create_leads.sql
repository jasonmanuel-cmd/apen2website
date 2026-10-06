-- Aspen II Homes: leads table.
-- Written to the field list in api/lead.js. Every site lead gets stored here
-- before any email goes out, so a lost email no longer means a lost lead.
-- Database: Neon Postgres (project aspen2-leads, aws-us-west-2).
-- Access: server only. The Neon connection string is the credential, so keep it in a
-- server-side Vercel env var (DATABASE_URL) and never expose it to the browser.

create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- contact
  name          text not null check (char_length(name) between 1 and 100),
  phone         text not null check (char_length(phone) between 1 and 40),
  phone_digits  text generated always as (regexp_replace(phone, '\D', '', 'g')) stored,
  email         text check (email is null or char_length(email) <= 150),

  -- what they asked for (api/lead.js: timeline = "Interested in")
  interest      text,
  plan          text,
  community     text,
  contact_pref  text,
  stage         text,
  buy_window    text,
  budget        text,
  first_time    boolean not null default false,
  military      boolean not null default false,
  notes         text check (notes is null or char_length(notes) <= 3000),

  -- where it came from
  source        text not null default 'Website',
  origin_domain text,
  raw           jsonb not null default '{}'::jsonb,

  -- delivery and follow-up
  email_sent    boolean not null default false,
  email_error   text,
  status        text not null default 'new'
                check (status in ('new','contacted','qualified','nurturing','won','lost','spam','test')),
  assigned_to   text,
  contacted_at  timestamptz,
  follow_up_at  timestamptz,
  staff_notes   text
);

comment on table public.leads is 'Aspen II Homes form and listing leads. Accessed server-side only via the Neon connection string.';
comment on column public.leads.origin_domain is 'Site that captured the lead, e.g. aspen2homes.com or aspen2bakersfield.store.';
comment on column public.leads.source is 'Channel: Website, Contact page, BuildZoom, Houzz, Open house, etc.';

create index leads_created_at_idx   on public.leads (created_at desc);
create index leads_status_idx       on public.leads (status) where status = 'new';
create index leads_email_idx        on public.leads (lower(email)) where email is not null;
create index leads_phone_digits_idx on public.leads (phone_digits);
create index leads_follow_up_idx    on public.leads (follow_up_at) where follow_up_at is not null;

create function public.leads_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger leads_updated_at
before update on public.leads
for each row execute function public.leads_set_updated_at();

