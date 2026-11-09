# Trendsy — backend Supabase i logowanie e-mail

## Stan
Frontend korzysta z Supabase Auth przez jednorazowy link e-mail (Magic Link), pobiera katalog, portfel, historię i ranking z bazy oraz wykonuje zakupy/wymiany przez RPC. Google Cloud i Google OAuth nie są potrzebne.

## Konfiguracja frontendu
W pliku `web/config.js` ustaw:
- Project URL: `https://gczshjesskufedzwgoss.supabase.co`
- klucz `anon/public` lub nowy `publishable` z Supabase → Project Settings → API Keys.

Do przeglądarki wolno wkleić wyłącznie klucz publiczny anon/publishable. **Nigdy** nie używaj `service_role`, secret key ani hasła bazy danych.

## Konfiguracja Supabase Auth
1. Authentication → Sign In / Providers → Email: włącz Email.
2. Wyłącz Google, jeśli jest włączony.
3. Authentication → URL Configuration:
   - Site URL: `https://trends.racibo.pl`
   - Redirect URLs: `https://trends.racibo.pl/**`
   - adres Netlify Deploy Preview dodaj na czas testów, jeśli logowanie będzie testowane z preview.
4. Supabase domyślnie może ograniczać wysyłkę wiadomości testowych. Do szerszego użycia skonfigurujemy własny SMTP — nie jest do tego potrzebny Google Cloud.

## Ważne
Migracja SQL została już uruchomiona w projekcie. Konto i portfel 100 TR tworzy trigger po pierwszym logowaniu. Reguły zakupów i wymian są egzekwowane przez funkcje SQL, a nie przez przeglądarkę. Ceny instrumentów nadal mają źródło `demo`.
