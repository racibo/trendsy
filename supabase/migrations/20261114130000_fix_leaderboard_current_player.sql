-- Fix leaderboard identity without granting clients access to profiles.id.
-- PostgreSQL cannot change a function's TABLE return type in place, so recreate it.
drop function if exists public.get_leaderboard(integer);

create function public.get_leaderboard(p_limit integer default 50)
returns table (
  display_name text,
  portfolio_value numeric,
  profit numeric,
  is_current_user boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.display_name,
         round(p.cash + coalesce(sum(i.price * h.units), 0), 2) as portfolio_value,
         round(p.cash + coalesce(sum(i.price * h.units), 0) - 100.00, 2) as profit,
         (p.user_id = auth.uid()) as is_current_user
  from public.portfolios p
  join public.profiles pr on pr.id = p.user_id
  left join public.holdings h on h.user_id = p.user_id
  left join public.instruments i on i.id = h.instrument_id
  group by p.user_id, pr.display_name, p.cash
  order by portfolio_value desc, pr.display_name asc
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.get_leaderboard(integer) from public;
grant execute on function public.get_leaderboard(integer) to anon, authenticated;
