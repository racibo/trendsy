# Web NGrams 3.0 — exploratory proof of concept

## Why this test exists

The DOC 2.0 timeline test was heavily rate-limited. Web NGrams 3.0 is a separate GDELT dataset that publishes minute-level JSON-NL files. It is a file feed, not a query API.

Official dataset description:
- https://blog.gdeltproject.org/announcing-the-new-web-news-ngrams-3-0-dataset/
- https://gdeltproject.org/data.html

## What this PoC does

`scripts/webngrams-smoke-test.mjs` scans backwards over a configurable UTC lookback window (default 60 minutes), treating HTTP 404 as an unpublished/missing minute. It stops after collecting the target number of successfully processed files (default 5), or when the lookback limit is reached. Transient 429/5xx and network failures receive bounded retries and are reported separately.

It records:
- exact probed timestamps, successful files, missing minutes and failed requests;
- parsed record counts and malformed JSON-NL lines;
- matched ngram records and unique article URLs per candidate;
- language and alias counts;
- up to eight evidence snippets with matched alias, context and article URL;
- a basic ambiguity split: multiword phrase matches vs single-token alias matches.

## Match-quality interpretation

A multiword phrase match is a stronger lexical signal than a one-word match, but it is **not** verified entity resolution. Single-token aliases (for example "Paris", "Japan" or a surname) are explicitly flagged as ambiguous. The evidence snippets are intended for manual review and future alias tuning. Do not interpret the quality label as a machine-learning confidence score.

The PoC still has important limitations:
1. The sample is a handful of available minute files, not a daily popularity measurement.
2. Context matching can miss mentions and can match unrelated context.
3. Entity ambiguity, aliases, transliteration and language coverage need manual validation.
4. URLs are deduplicated per candidate within this run only. Durable daily deduplication and canonical URL rules remain future work.
5. A file's minute timestamp represents when GDELT saw the article, not a daily popularity score.
6. Do not use these counts for instrument prices or rankings until coverage, precision, deduplication, language coverage and aggregation costs have been measured.

## Running locally or manually

```sh
npm run webngrams:test
```

Environment variables:
- `WEBNGRAMS_LOOKBACK_MINUTES=60`: probe the last 60 completed UTC minutes (max 180).
- `WEBNGRAMS_TARGET_FILES=5`: stop after five successful files (max 20).
- `WEBNGRAMS_REQUEST_GAP_MS=750`: minimum spacing between request starts.

The GitHub Actions workflow exposes the lookback and target-file settings for manual runs and stores JSON/CSV artifacts.

## Attribution

Any public use of this dataset should credit and link to the GDELT Project: https://www.gdeltproject.org/.
