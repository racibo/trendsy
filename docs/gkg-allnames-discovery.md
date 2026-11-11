# GKG ALLNAMES candidate discovery audit

**Status:** read-only research prototype. It does not update the Trendsy catalogue, game, prices, rankings, or league membership.

## Purpose

The previous multi-sample audit established that GKG WEB document URLs can be joined to Web NGrams URLs at a stable rate of roughly 91–96% in the tested batches. The next question is whether GKG itself can surface a broad, unbiased pool of names without starting from the current 12 manually selected candidates.

This audit samples GKG 2.1 `V2.1ALLNAMES` across ten batches spaced 150 minutes apart (about 22.5 hours). It aggregates each normalized name by unique WEB article URL and reports source domains, sampled batches, language metadata, GKG themes, person/organization cross-signals, and up to three evidence URLs.

## Important schema detail

The GKG 2.1 codebook defines `V2.1ALLNAMES` as semicolon-separated name references with the name followed by a character offset. It is deliberately inclusive and can contain passing mentions, ambiguous names, and extraction false positives. It does not provide a reliable entity type for every name.

The audit therefore:
- aggregates by normalized name and unique URL, not raw mention count;
- preserves common display variants;
- uses `V1PERSONS` and `V1ORGANIZATIONS` only as supporting signals;
- exposes `singleTokenName` as a review warning;
- reports GKG themes and language metadata as evidence, not as quotas or definitive classification;
- does not assign a popularity score.

## Output

The JSON artifact contains up to 200 candidates with at least two unique article URLs, sorted by unique article count and then unique domain count. Each candidate includes:
- unique article count and unique source-domain count;
- number of sampled GKG batches in which it appeared;
- mention occurrences within unique sampled documents;
- person/organization cross-signals;
- common name variants;
- language and theme distributions;
- up to three public evidence URLs.

The Markdown summary includes the candidate-frequency distribution and top 50 names. Names found in only one article are counted in the frequency histogram but are not emitted as candidate rows.

## Limitations and interpretation

- Ten samples spaced 150 minutes apart are a sparse snapshot, not a continuous 22.5-hour crawl.
- Unique domains are not necessarily independent publishers and do not reveal publisher country.
- GKG language metadata is incomplete; missing values remain `unknown`.
- A name appearing in an article does not mean the article is mainly about that name.
- Person/organization cross-signals are not authoritative identity resolution.
- URL deduplication does not detect syndication or near-duplicate stories under different URLs.
- A candidate appearing frequently may still be ambiguous or irrelevant. A stratified manual relevance audit is required before any scoring or league decisions.

## Next validation after the report

1. Inspect the highest-frequency names for ambiguous/common-word collisions and false positives.
2. Compare top names with GKG themes and person/organization signals.
3. Manually judge a stratified sample of evidence URLs, including high-volume, medium-volume, single-token, and multilingual candidates.
4. Measure whether the candidate ordering is stable across additional days and denser samples.
5. Only then design identity resolution, relevance filtering, deduplication beyond exact URLs, and a candidate-quality gate.
