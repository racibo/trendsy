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

Each candidate also stores a capped evidence sample of up to 25 distinct article URLs, with the source domain, language, matched alias, match type, short surrounding context and sampled UTC hour. Collection is spread across the hourly files (at most one representative URL per candidate per sampled hour), so the evidence is not dominated by the first file in the run. The archive rejects non-HTTP(S) URLs and deduplicates URLs.

The evidence is deliberately a review sample, not the full article list. Each candidate includes an evidence count, domain breakdown, evidence-to-unique-article coverage ratio, a `manual_review_required` status and diagnostic quality flags. A low article count or zero evidence is a warning for review, not proof that the candidate is irrelevant.

Only a COMPLETE sample with exactly 24 successful hourly samples can be archived. Partial runs remain available as workflow artifacts when uploaded, but never enter the daily time series.

## Why this is not a popularity index yet

The archive preserves raw measurement diagnostics. It does not normalize counts, remove syndicated stories, adjust for source volume, or calculate prices. Those steps require a separate quality and repeatability analysis before the game uses the values.


## Manual audit protocol

Before a candidate can be used for game pricing, inspect the archived URLs and context snippets. Check whether each result actually refers to the intended person, place, country or event; note homonyms, syndicated copies, irrelevant mentions and alias-specific false positives. Compare the evidence domains and language mix across consecutive daily samples. Do not treat matched-record counts as article counts, and do not treat unique-URL counts as a validated popularity index. Record the decision separately from the raw archive so that the original measurements remain reproducible.
