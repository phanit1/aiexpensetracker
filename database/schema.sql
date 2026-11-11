-- ExpenseAI Postgres schema. Run this manually if you prefer; the API also
-- creates these tables on startup when DATABASE_URL is configured.
create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  icon text not null default 'Tag',
  color text not null default '#8b5cf6',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, name, type)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(12,2) not null check (amount > 0),
  description text not null,
  notes text not null default '',
  transaction_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  period text not null default 'monthly' check (period in ('weekly', 'monthly')),
  created_at timestamptz not null default now(),
  unique(user_id, category_id, period)
);

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions(user_id, transaction_date desc);
create index if not exists insights_user_created_idx on public.insights(user_id, created_at desc);
