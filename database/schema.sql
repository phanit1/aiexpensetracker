-- ExpenseAI tables for Supabase Auth + the Data API.
-- Run this once in Supabase Dashboard > SQL Editor before using the app.

create table if not exists public.expenseai_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create table if not exists public.expenseai_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  icon text not null default 'Tag',
  color text not null default '#8b5cf6',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, name, type)
);

create table if not exists public.expenseai_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.expenseai_categories(id) on delete set null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(12,2) not null check (amount > 0),
  description text not null,
  notes text not null default '',
  transaction_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.expenseai_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.expenseai_categories(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  period text not null default 'monthly' check (period in ('weekly', 'monthly')),
  created_at timestamptz not null default now(),
  unique(user_id, category_id, period)
);

create table if not exists public.expenseai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists expenseai_transactions_user_date_idx on public.expenseai_transactions(user_id, transaction_date desc);
create index if not exists expenseai_insights_user_created_idx on public.expenseai_insights(user_id, created_at desc);

-- Create/update the app profile whenever a Supabase Auth user is created or changed.
create or replace function public.expenseai_sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.expenseai_users (id, email, name, currency)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, 'friend@example.com'), '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'currency', ''), 'USD')
  )
  on conflict (id) do update set
    email = excluded.email,
    name = excluded.name,
    currency = excluded.currency;
  return new;
end;
$$;

drop trigger if exists expenseai_auth_user_profile on auth.users;
create trigger expenseai_auth_user_profile
  after insert or update on auth.users
  for each row execute function public.expenseai_sync_auth_user();

-- Also populate profiles for Auth users who registered before this SQL was run.
insert into public.expenseai_users (id, email, name, currency)
select id, email,
       coalesce(nullif(raw_user_meta_data ->> 'name', ''), split_part(coalesce(email, 'friend@example.com'), '@', 1)),
       coalesce(nullif(raw_user_meta_data ->> 'currency', ''), 'USD')
from auth.users
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  currency = excluded.currency;

alter table public.expenseai_users disable row level security;
alter table public.expenseai_categories disable row level security;
alter table public.expenseai_transactions disable row level security;
alter table public.expenseai_budgets disable row level security;
alter table public.expenseai_insights disable row level security;

grant select, insert, update, delete on public.expenseai_categories to authenticated;
grant select, insert, update, delete on public.expenseai_users to authenticated;
grant select, insert, update, delete on public.expenseai_transactions to authenticated;
grant select, insert, update, delete on public.expenseai_budgets to authenticated;
grant select, insert, update, delete on public.expenseai_insights to authenticated;

drop policy if exists "ExpenseAI users read own categories" on public.expenseai_categories;
drop policy if exists "ExpenseAI users create own categories" on public.expenseai_categories;
drop policy if exists "ExpenseAI users edit custom categories" on public.expenseai_categories;
drop policy if exists "ExpenseAI users delete custom categories" on public.expenseai_categories;
drop policy if exists "ExpenseAI users manage own transactions" on public.expenseai_transactions;
drop policy if exists "ExpenseAI users manage own budgets" on public.expenseai_budgets;
drop policy if exists "ExpenseAI users manage own insights" on public.expenseai_insights;

-- Make the new tables available through Supabase's PostgREST API.
notify pgrst, 'reload schema';
