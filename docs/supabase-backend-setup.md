# Etap backendu Trendsy — Supabase

## Co dodaje ta migracja

Migracja `supabase/migrations/20261109190000_initial_game_backend.sql` przygotowuje wspólny backend gry:

- logowanie obsługiwane przez Supabase Auth (Google będzie jedynym włączonym dostawcą w konfiguracji projektu);
- automatyczne utworzenie profilu i portfela z kapitałem 100 TR po pierwszym logowaniu;
- wspólny katalog instrumentów z przykładowymi cenami;
- portfele, pozycje i historia transakcji w PostgreSQL;
- ranking oparty na rzeczywistej wartości portfeli;
- reguły zakupów i wymian sprawdzane atomowo po stronie bazy;
- RLS: gracz odczytuje wyłącznie swój portfel, pozycje i transakcje; nie ma bezpośredniego zapisu z przeglądarki.

**Ważne:** to jest fundament backendu, a nie jeszcze podłączona wersja produkcyjna strony. Frontend pozostaje w trybie demo do czasu skonfigurowania projektu Supabase i dodania bezpiecznych ustawień publicznych. Klucz `service_role` nigdy nie może trafić do przeglądarki ani repozytorium.

## Konfiguracja projektu — do wykonania raz

1. Wejdź na https://supabase.com/dashboard i utwórz projekt o nazwie `trendsy` (region Frankfurt, jeśli jest dostępny).
2. Wybierz silne hasło bazy i zachowaj je poza repozytorium.
3. W **Authentication → Providers → Google** włącz Google. Konfiguracja OAuth wymaga Client ID i Client Secret z Google Cloud; wpisz je wyłącznie w panelu Supabase.
4. W **Authentication → URL Configuration** dodaj:
   - Site URL: `https://trends.racibo.pl` (po uruchomieniu domeny produkcyjnej);
   - Redirect URL: `https://trends.racibo.pl/**`;
   - na czas testów dodaj także adres Deploy Preview, jeśli test logowania ma odbywać się z podglądu Netlify.
5. Otwórz **SQL Editor → New query**, wklej całą zawartość migracji i uruchom ją.
6. W **Project Settings → API** skopiuj Project URL oraz klucz `anon/public`. To jedyne wartości, które później mogą być użyte w publicznym froncie. Nie wysyłaj klucza `service_role`.

## Kontrola po migracji

W SQL Editor można sprawdzić tabele:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Oczekiwane: `holdings`, `instruments`, `portfolios`, `profiles`, `transactions`.

Kontrola katalogu:

```sql
select id, name, category, edition, price, price_source
from public.instruments
order by id;
```

## Co będzie w następnym kroku kodowania

Po utworzeniu projektu i zastosowaniu migracji podłączymy frontend do Supabase:

1. ekran logowania Google i obsługa sesji;
2. pobieranie katalogu, portfela i rankingu z bazy;
3. wywołania RPC `buy_instrument` i `exchange_instrument` zamiast lokalnej modyfikacji `localStorage`;
4. stan ładowania, błędy i wylogowanie;
5. test dwóch niezależnych kont i test wymiany z blokadą 24 h.

Dopiero po tych testach wyłączymy tryb demo. Ceny w tej migracji są oznaczone jako `demo`; nie są jeszcze cenami wyliczonymi z GDELT/Web NGrams.
