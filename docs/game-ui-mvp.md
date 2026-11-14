# Trendsy — pierwsza wersja interfejsu gry

Frontend znajduje się w katalogu `web/`. Netlify publikuje bez procesu kompilacji: `netlify.toml` wskazuje katalog `web`.

## Co działa w tej wersji

- saldo startowe 100 TR;
- lista przykładowych instrumentów i demonstracyjne ceny;
- katalog tematów bez obowiązkowych edycji krajowych/światowych;
- zakup maksymalnie trzech różnych tematów, także z tej samej kategorii;
- brak obowiązkowej kategorii, limitu geograficznego i wymogu instrumentu krajowego;
- wycena portfela, wolne środki i wynik względem 100 TR;
- wymiana jednej pozycji na inną, z blokadą kolejnej wymiany przez 24 godziny;
- lokalny zapis stanu w przeglądarce (`localStorage`);
- przykładowy ranking i historia transakcji.

## Ograniczenia — celowo

To jest lokalny prototyp demonstracyjny. Ceny, zmiany procentowe i ranking nie pochodzą z rzeczywistych danych. Stan konta zapisuje się tylko w danej przeglądarce i nie jest synchronizowany między urządzeniami. Nie ma jeszcze logowania, Supabase, wspólnej bazy graczy ani serwerowej walidacji transakcji.

## Reguła wymiany

Początkowe budowanie portfela pozwala kupić do trzech instrumentów. Po zapełnieniu portfela zmianę składu wykonuje się przez jedną operację wymiany: sprzedaż jednej pozycji i zakup innej. Wymiana uruchamia 24-godzinny limit. Nie można wykonać samej sprzedaży, która pozwoliłaby obejść limit lub wymóg edycji krajowej. Portfel może zawierać maksymalnie jeden instrument edycji krajowej; jeśli ma już taki instrument, nie ma ograniczeń geograficznych ani obowiązkowych kategorii.

## Podgląd Netlify

Pull request z gałęzi `feat/game-ui-mvp` do `main` powinien otrzymać osobny Deploy Preview z Netlify. Podgląd służy do testowania prototypu bez publikowania go na adresie produkcyjnym. Produkcyjna gałąź pozostaje ustawiona na `main`; PR należy scalać dopiero po sprawdzeniu podglądu.
