# Daily Web NGrams history

The scheduled Web NGrams workflow runs once per day at 06:35 UTC and samples the previous 24 complete UTC hours.

For each successful scheduled run, the workflow writes one compact file:

`data/history/webngrams-YYYY-MM-DD.json`

The date is derived from the final sampled UTC timestamp. If the same UTC date is archived again, the existing file is updated rather than creating a duplicate.

## Stored fields

Each daily record preserves:
- sample coverage and completeness;
- overall candidate counts;
- per-candidate matched-record and unique-article counts;
- phrase/context-filtered match totals;
- language and alias breakdowns;
- the current match-quality classification.

The repository history deliberately excludes article evidence URLs and context excerpts. Those remain available in the 30-day GitHub Actions artifact for manual review. This keeps the permanent history compact and avoids committing large review payloads every day.

Only a COMPLETE sample with exactly 24 successful hourly samples can be archived. Partial runs remain available as workflow artifacts when uploaded, but never enter the daily time series.

## Why this is not a popularity index yet

The archive preserves raw measurement diagnostics. It does not normalize counts, remove syndicated stories, adjust for source volume, or calculate prices. Those steps require a separate quality and repeatability analysis before the game uses the values.
