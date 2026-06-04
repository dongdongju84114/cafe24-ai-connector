create table if not exists public.cafe24_tokens (
  mall_id text primary key,
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cafe24_tokens enable row level security;

revoke all on table public.cafe24_tokens from anon;
revoke all on table public.cafe24_tokens from authenticated;

grant select, insert, update, delete on table public.cafe24_tokens to service_role;
