# Supabase shadow observations

The daily Web NGrams archive can be copied into `public.market_observations` for audit and analysis.

This is deliberately a **shadow data path**:
- only a COMPLETE sample with exactly 24/24 successful UTC-hour samples is accepted;
- raw matched-record and unique-article counts are stored without converting them into a popularity score;
- every row retains the candidate's review status and quality flags;
- no values in `public.instruments` are changed, so game prices and existing portfolios remain untouched;
- client roles `anon` and `authenticated` have no table privileges; the workflow uses a GitHub Actions secret containing the Supabase service-role key.

## One-time setup

1. Apply `supabase/migrations/20261114210000_market_observations_shadow.sql` in the Supabase SQL Editor.
2. In GitHub repository Settings → Secrets and variables → Actions, add:
   - `SUPABASE_URL`: the project URL, e.g. `https://YOUR_PROJECT.supabase.co`;
   - `SUPABASE_SECRET_KEY`: the secret API key (`sb_secret_...`) from Supabase API Keys. Never put this key in `web/config.js`, commit it, or share it in chat.
3. The scheduled Web NGrams workflow will then upsert each complete daily archive into `market_observations`. If the secrets are absent, publishing is skipped without breaking the archive.

## Why prices remain unchanged

The current archive marks all candidates `manual_review_required`. Its capped evidence is a review sample, not complete article coverage. For example, the 2026-11-14 archive reports only 1 unique article for Gdańsk and 4 for Kraków, while Donald Trump has 1,108. These raw counts are not directly comparable and are not yet a validated price index.

Before enabling prices, candidate identity/relevance must be reviewed, a comparable normalized metric and price-movement rule must be approved, and at least several consecutive complete daily samples should be evaluated. The shadow table is intended to build that evidence without presenting experimental measurements as live market prices.
