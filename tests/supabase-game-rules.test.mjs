import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20261114120000_initial_game_backend.sql", import.meta.url), "utf8");
function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = sql.indexOf("$$;", start);
  assert.notEqual(end, -1, `unterminated function ${name}`);
  return sql.slice(start, end + 3);
}

test("holdings allow one unit per distinct topic and cap portfolio size in RPC", () => {
  assert.match(sql, /units integer not null default 1 check \(units = 1\)/);
  assert.match(sql, /unique \(user_id, instrument_id\)/);
  assert.match(functionBody("buy_instrument"), /holding_count >= 3/);
  assert.doesNotMatch(functionBody("buy_instrument"), /category|edition|national/i);
});

test("buy RPC rejects insufficient cash and is server-side only", () => {
  const body = functionBody("buy_instrument");
  assert.match(body, /portfolio_row\.cash < target\.price/);
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
  assert.match(sql, /grant execute on function public\.buy_instrument\(text\) to authenticated/);
});

test("exchange requires a full portfolio, enforces 24 hours and rejects duplicate topics", () => {
  const body = functionBody("exchange_instrument");
  assert.match(body, /holding_count <> 3/);
  assert.match(body, /interval '24 hours'/);
  assert.match(body, /Ten temat masz już w portfelu/);
  assert.doesNotMatch(body, /category|edition|national/i);
  assert.match(body, /security definer/);
  assert.match(body, /set search_path = ''/);
});

test("private game tables use RLS and clients cannot write directly", () => {
  for (const table of ["profiles","instruments","portfolios","holdings","transactions"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /revoke insert, update, delete on public\.profiles, public\.instruments, public\.portfolios,[\s\S]*public\.holdings, public\.transactions from anon, authenticated/);
});

test("frontend uses unrestricted topic selection and has unique DOM IDs", () => {
  const app = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(app, /activeFilter|hasNational|nationalLimit|needsNational|sameCategory/);
  assert.doesNotMatch(html, /data-filter|1 krajowy|różne kategorie|Edycja krajowa|Edycja światowa/);
  const ids = [...html.matchAll(/\\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");
  assert.equal((html.match(/<!doctype html>/gi) || []).length, 1);
  assert.equal((html.match(/<html lang=/g) || []).length, 1);
});
