# GKG ALLNAMES candidate discovery audit

**Status:** read-only research prototype. It does not update the Trendsy catalogue, game, prices, rankings, or league membership.

## Purpose

The previous multi-sample audit established that GKG WEB document URLs can be joined to Web NGrams URLs at a stable rate of roughly 91–96% in the tested batches. The next question is whether GKG itself can surface a broad, unbiased pool of names without starting from the current 12 manually selected candidates.

This audit samples GKG 2.1 `V2.1ALLNAMES` across ten batches spaced 150 minutes apart (about 22.5 hours). It aggregates each normalized name by unique WEB article URL and reports source domains, sampled batches, source-language metadata coverage, GKG themes, person/organization cross-signals, quality diagnostics, and up to three evidence URLs.

## Important schema detail

The GKG 2.1 codebook defines `V2.1ALLNAMES` as semicolon-separated name references with the name followed by a character offset. It is deliberately inclusive and can contain passing mentions, ambiguous names, and extraction false positives. It does not provide a reliable entity type for every name.

The audit therefore:
- aggregates by normalized name and unique URL, not raw mention count;
- preserves common display variants;
- emits conservative possible-alias pairs only when two names share tokens and co-occur in at least three sampled article URLs; these pairs are review suggestions, never automatic merges;
- uses `V1PERSONS` and `V1ORGANIZATIONS` only as supporting signals;
- exposes `singleTokenName` as a review warning;
- reports GKG themes and source-language metadata as evidence, not as quotas or definitive classification;
- reports language coverage from GKG TranslationInfo `srclc` separately from missing values; it does not label missing metadata as a language;
- adds transparent review flags for domain concentration, low domain count, sparse batch coverage, missing person/organization cross-signals, multiple name variants, source-domain overlap, and a small explicit boilerplate phrase list;
- creates a deterministic stratified manual-review sample with blank human-assessment fields;
- does not assign a popularity score.

## Output

The JSON artifact contains up to 200 candidates with at least two unique article URLs, sorted by unique article count and then unique domain count. Each candidate includes:
- unique article count and unique source-domain count;
- number of sampled GKG batches in which it appeared;
- mention occurrences within unique sampled documents;
- person/organization cross-signals;
- common name variants;
- known-language article counts, missing-language article counts, language coverage, and theme distributions;
- quality diagnostics: top-domain share, batch coverage, entity cross-signal count, name-variant count, source-domain overlap, and review flags;
- up to three public evidence URLs;
- possible alias pairs with shared tokens, article co-occurrence counts, Jaccard overlap, and up to three shared evidence URLs.

The Markdown summary includes the candidate-frequency distribution and top 50 names. Names found in only one article are counted in the frequency histogram but are not emitted as candidate rows.

## Possible alias pairs

Possible alias pairs are generated from candidates in the top 200 by article count. A pair must share at least half of the tokens in the shorter name and co-occur in at least three unique sampled article URLs. The report includes shared-token overlap, article Jaccard overlap, and shared evidence URLs. This is a conservative review queue, not entity resolution: two distinct people or organizations can share a surname and appear in the same stories. No candidate names are merged or have their counts combined.

## Manual review sample

The JSON artifact includes a reproducible sample drawn from high-, medium-, and low-frequency candidates, domain-concentrated candidates, candidates with few domains, candidates without PERSON/ORGANIZATION cross-signals, variant-rich candidates, and candidates whose name overlaps a source domain. Strata can overlap. The sample is a review aid, not a representative probability sample. Human reviewers should record whether the name is a meaningful topic, whether aliases refer to the same entity, whether the evidence is actually about the candidate, and whether URLs appear syndicated or near-duplicated.

Review flags are diagnostic only. They must not automatically remove a candidate. In particular, a legitimate topic may be concentrated in a small number of sources, and an entity may lack a PERSON/ORGANIZATION cross-signal.

## Limitations and interpretation

- Ten samples spaced 150 minutes apart are a sparse snapshot, not a continuous 22.5-hour crawl.
- Unique domains are not necessarily independent publishers and do not reveal publisher country.
- Source-language metadata is extracted only from GKG TranslationInfo `srclc`. Coverage is explicitly measured; missing values are not language classifications. A zero-coverage sample means language distribution is unavailable from this extraction.
- A name appearing in an article does not mean the article is mainly about that name.
- Person/organization cross-signals are not authoritative identity resolution.
- URL deduplication does not detect syndication or near-duplicate stories under different URLs.
- Alias suggestions are based on token overlap and co-occurrence only; they do not prove that two names identify the same entity.
- A candidate appearing frequently may still be ambiguous or irrelevant. A stratified manual relevance audit is required before any scoring or league decisions.

## Next validation after the report

1. Inspect the highest-frequency names for ambiguous/common-word collisions and false positives.
2. Compare top names with GKG themes and person/organization signals.
3. Manually judge a stratified sample of evidence URLs, including high-volume, medium-volume, single-token, and multilingual candidates.
4. Measure whether the candidate ordering is stable across additional days and denser samples.
5. Only then design identity resolution, relevance filtering, deduplication beyond exact URLs, and a candidate-quality gate.
