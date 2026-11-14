-- Trendsy: initial shared-game backend.
-- Apply with the Supabase SQL Editor or: supabase db push
-- All monetary values are TR. Client-side writes to game state are intentionally forbidden.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Gracz',
  created_at timestamptz not null default now()
);

create table if not exists public.instruments (
  id text primary key,
  name text not null,
  category text not null,
  edition text not null check (edition in ('national', 'world')),
  icon text not null default '',
  price numeric(12,2) not null check (price > 0),
  is_active boolean not null default true,
  price_source text not null default 'demo',
  updated_at timestamptz not null default now()
);

create table if not exists public.portfolios (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  cash numeric(12,2) not null default 100.00 check (cash >= 0),
  last_exchange_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.holdings (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.portfolios(user_id) on delete cascade,
  instrument_id text not null references public.instruments(id),
  units integer not null default 1 check (units = 1),
  acquired_at timestamptz not null default now(),
  unique (user_id, instrument_id)
);

create table if not exists public.transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.portfolios(user_id) on delete cascade,
  transaction_type text not null check (transaction_type in ('buy', 'exchange')),
  sold_instrument_id text references public.instruments(id),
  bought_instrument_id text not null references public.instruments(id),
  cash_delta numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_created_idx
  on public.transactions(user_id, created_at desc);
create index if not exists holdings_user_idx on public.holdings(user_id);

-- Seed the same catalogue as the UI prototype. These prices are explicitly demo values.
insert into public.instruments (id, name, category, edition, icon, price, price_source)
values
  ('poland', 'Polska', 'Kraj', 'national', '🇵🇱', 12.40, 'demo'),
  ('tusk', 'Donald Tusk', 'Osoba', 'national', '👤', 9.80, 'demo'),
  ('gdansk', 'Gdańsk', 'Miejsce', 'national', '🏙️', 7.20, 'demo'),
  ('cop31', 'COP31', 'Wydarzenie', 'world', '🌍', 14.60, 'demo'),
  ('taylor', 'Taylor Swift', 'Osoba', 'world', '🎤', 18.30, 'demo'),
  ('japan', 'Japonia', 'Kraj', 'world', '🇯🇵', 11.10, 'demo'),
  ('youth-olympics', 'Młodzieżowe Igrzyska', 'Wydarzenie', 'world', '🏅', 8.90, 'demo'),
  ('paris', 'Paryż', 'Miejsce', 'world', '🗼', 10.50, 'demo'),
  ('lewandowski', 'Robert Lewandowski', 'Osoba', 'national', '⚽', 13.70, 'demo')
on conflict (id) do nothing;

-- Create a profile and a 100 TR portfolio automatically after email sign-in
-- (or any other enabled Supabase Auth provider).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_name text;
begin
  chosen_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, 'gracz'), '@', 1), ''),
    'Gracz'
  );

  insert into public.profiles (id, display_name)
  values (new.id, left(chosen_name, 40))
  on conflict (id) do nothing;

  insert into public.portfolios (user_id, cash)
  values (new.id, 100.00)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_trendsy on auth.users;
create trigger on_auth_user_created_trendsy
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.instruments enable row level security;
alter table public.portfolios enable row level security;
alter table public.holdings enable row level security;
alter table public.transactions enable row level security;

-- Authenticated users may see public display names and the instrument catalogue.
drop policy if exists "Authenticated users can read profiles" on public.profiles;
create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);

drop policy if exists "Anyone can read active instruments" on public.instruments;
create policy "Anyone can read active instruments"
  on public.instruments for select to anon, authenticated using (is_active = true);

-- A player can read only their own private game state.
drop policy if exists "Players read own portfolio" on public.portfolios;
create policy "Players read own portfolio"
  on public.portfolios for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Players read own holdings" on public.holdings;
create policy "Players read own holdings"
  on public.holdings for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Players read own transactions" on public.transactions;
create policy "Players read own transactions"
  on public.transactions for select to authenticated using (auth.uid() = user_id);

-- SQL privileges are separate from RLS policies: grant reads explicitly,
-- then let RLS restrict private rows to the current player.
grant select on public.instruments to anon, authenticated;
-- Profile rows are public for leaderboard names, but internal user UUIDs are not.
-- Use a column-level grant so the Data API cannot expose profiles.id.
revoke select on public.profiles from anon, authenticated;
grant select (display_name) on public.profiles to authenticated;
grant select on public.portfolios, public.holdings, public.transactions to authenticated;

-- No INSERT/UPDATE/DELETE policies are granted to clients for game-state tables.
-- All writes go through the SECURITY DEFINER RPCs below, with auth.uid() checks.

create or replace function public.buy_instrument(p_instrument_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  portfolio_row public.portfolios%rowtype;
  target public.instruments%rowtype;
  holding_count integer;
begin
  if player_id is null then
    raise exception 'Musisz się zalogować.' using errcode = '28000';
  end if;

  select * into portfolio_row
  from public.portfolios where user_id = player_id for update;
  if not found then
    raise exception 'Nie znaleziono portfela gracza.';
  end if;

  select * into target from public.instruments
  where id = p_instrument_id and is_active = true;
  if not found then raise exception 'Instrument jest niedostępny.'; end if;

  select count(*) into holding_count
  from public.holdings where user_id = player_id;

  if holding_count >= 3 then raise exception 'Portfel jest pełny.'; end if;
  if portfolio_row.cash < target.price then raise exception 'Masz za mało wolnych środków.'; end if;

  update public.portfolios
  set cash = cash - target.price, updated_at = now()
  where user_id = player_id;

  insert into public.holdings (user_id, instrument_id) values (player_id, target.id);
  insert into public.transactions (user_id, transaction_type, bought_instrument_id, cash_delta)
  values (player_id, 'buy', target.id, -target.price);

  return jsonb_build_object('ok', true, 'cash', portfolio_row.cash - target.price);
end;
$$;

create or replace function public.exchange_instrument(p_sell_instrument_id text, p_buy_instrument_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_id uuid := auth.uid();
  portfolio_row public.portfolios%rowtype;
  sold public.instruments%rowtype;
  bought public.instruments%rowtype;
  holding_count integer;
  new_cash numeric(12,2);
begin
  if player_id is null then
    raise exception 'Musisz się zalogować.' using errcode = '28000';
  end if;
  if p_sell_instrument_id = p_buy_instrument_id then
    raise exception 'Wybierz inny instrument.';
  end if;

  select * into portfolio_row
  from public.portfolios where user_id = player_id for update;
  if not found then raise exception 'Nie znaleziono portfela gracza.'; end if;

  select count(*) into holding_count from public.holdings where user_id = player_id;
  if holding_count <> 3 then raise exception 'Wymiana jest dostępna dopiero po zapełnieniu portfela.'; end if;
  if portfolio_row.last_exchange_at is not null
     and portfolio_row.last_exchange_at > now() - interval '24 hours' then
    raise exception 'Kolejna wymiana będzie możliwa po upływie 24 godzin.';
  end if;

  select i.* into sold
  from public.instruments i
  join public.holdings h on h.instrument_id = i.id
  where h.user_id = player_id and h.instrument_id = p_sell_instrument_id;
  if not found then raise exception 'Nie masz tego instrumentu w portfelu.'; end if;

  select * into bought from public.instruments
  where id = p_buy_instrument_id and is_active = true;
  if not found then raise exception 'Nowy instrument jest niedostępny.'; end if;

  if exists (
    select 1 from public.holdings
    where user_id = player_id
      and instrument_id = p_buy_instrument_id
      and instrument_id <> p_sell_instrument_id
  ) then
    raise exception 'Ten temat masz już w portfelu.';
  end if;

  new_cash := portfolio_row.cash + sold.price - bought.price;
  if new_cash < 0 then raise exception 'Po sprzedaży nadal zabraknie środków.'; end if;

  delete from public.holdings
  where user_id = player_id and instrument_id = p_sell_instrument_id;
  insert into public.holdings (user_id, instrument_id)
  values (player_id, p_buy_instrument_id);

  update public.portfolios
  set cash = new_cash, last_exchange_at = now(), updated_at = now()
  where user_id = player_id;

  insert into public.transactions (
    user_id, transaction_type, sold_instrument_id, bought_instrument_id, cash_delta
  ) values (
    player_id, 'exchange', sold.id, bought.id, sold.price - bought.price
  );

  return jsonb_build_object('ok', true, 'cash', new_cash, 'last_exchange_at', now());
end;
$$;

-- Leaderboard exposes only display names and aggregate values, never emails or transaction details.
create or replace function public.get_leaderboard(p_limit integer default 50)
returns table (
  display_name text,
  portfolio_value numeric,
  profit numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.display_name,
         round(p.cash + coalesce(sum(i.price * h.units), 0), 2) as portfolio_value,
         round(p.cash + coalesce(sum(i.price * h.units), 0) - 100.00, 2) as profit
  from public.portfolios p
  join public.profiles pr on pr.id = p.user_id
  left join public.holdings h on h.user_id = p.user_id
  left join public.instruments i on i.id = h.instrument_id
  group by p.user_id, pr.display_name, p.cash
  order by portfolio_value desc, pr.display_name asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.buy_instrument(text) from public;
revoke all on function public.exchange_instrument(text, text) from public;
revoke all on function public.get_leaderboard(integer) from public;
grant execute on function public.buy_instrument(text) to authenticated;
grant execute on function public.exchange_instrument(text, text) to authenticated;
grant execute on function public.get_leaderboard(integer) to anon, authenticated;

-- Prevent direct client-side writes even if a broad grant is added later.
revoke insert, update, delete on public.profiles, public.instruments, public.portfolios,
  public.holdings, public.transactions from anon, authenticated;
