# GDELT GKG technical audit — global topic discovery

**Status:** preliminary source/schema audit; no production discovery, ranking, or pricing changes.

**Scope:** evaluate whether GDELT GKG can support automatic discovery of candidates for the proposed single global 16-topic league. This document separates documented capabilities from assumptions that still require empirical tests.

## Executive conclusion

GDELT GKG 2.0 is a stronger discovery foundation than the current Trendsy Web NGrams matcher because it provides article-level extracted metadata: named people, organizations, locations, themes, and a broad proper-name field that includes named events and other entities. GKG records also identify the source document and publisher domain.

The most promising discovery input is **GKG `V2.1ALLNAMES`**, combined with `V1THEMES`, `V2ENHANCEDTHEMES`, article-level document identifiers, and independent evidence from Web NGrams or DOC.

This is not yet a validated production design. GKG entity extraction is deliberately inclusive; a name can be a passing mention, a false positive, or an ambiguous label. The current public codebook is dated 2015, so the current live file layout and field semantics must be checked against real recent records before implementing a parser.

## What is documented

### 1. Update cadence and access

- GDELT's official data page describes GKG 2.0 as updating every 15 minutes.
- GDELT makes the data available as raw files and through Google BigQuery.
- The official GDELT 2.0 announcement links the rolling master file lists and the last-15-minute file list.
- GDELT describes the underlying datasets as free and open; Trendsy should provide attribution and link to GDELT.

Official references:
- https://gdeltproject.org/data.html
- https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/
- https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf

### 2. Relevant GKG 2.1 fields

The GKG 2.1 codebook documents a tab-delimited, one-record-per-document format. The field names below are codebook names; the version prefixes are not necessarily included in the raw file header.

| Field | Meaning | Potential use in Trendsy |
|---|---|---|
| `GKGRECORDID` | Unique record ID; includes the 15-minute batch timestamp | Deduplication and provenance |
| `V2.1DATE` | Article publication date/time | Freshness and time windows |
| `V2SOURCECOLLECTIONIDENTIFIER` | Type of source collection; 1 means open-web URL | Exclude non-web records when URL joining |
| `V2SOURCECOMMONNAME` | Human-readable source name; for web documents, top-level domain | Publisher/domain concentration |
| `V2DOCUMENTIDENTIFIER` | External document identifier; for collection 1, a full URL | Candidate join key against Web NGrams URLs |
| `V1THEMES` | Themes detected in the document | Broad thematic context |
| `V2ENHANCEDTHEMES` | Theme occurrences with approximate character offsets | Context/proximity diagnostics |
| `V1PERSONS` | Person names extracted from the document | Person candidate discovery |
| `V2ENHANCEDPERSONS` | Person mentions with approximate character offsets | Mention-level diagnostics |
| `V1ORGANIZATIONS` | Company and organization names | Organization candidate discovery |
| `V2ENHANCEDORGANIZATIONS` | Organization mentions with approximate offsets | Mention-level diagnostics |
| `V1LOCATIONS` / `V2ENHANCEDLOCATIONS` | Extracted locations and geographic identifiers; enhanced form adds offsets | Place candidates and context |
| `V2.1ALLNAMES` | Broad proper-name list, including named events, movements, festivals, wars, dates and legislation, with offsets | Primary discovery candidate pool |
| `V2.1TRANSLATIONINFO` | Original source-language code and translation provenance when machine translated | Language coverage analysis |
| `V1.5TONE` | Document-level tone and related measures | Optional diagnostic only; not popularity |
| `V2GCAM` | High-dimensional content-analysis measures | Optional later research; not needed for first discovery prototype |

Important details:
- GKG 2.1 moved to one record per document rather than grouping documents with identical extracted metadata.
- The codebook says that `V2.1ALLNAMES` is designed to be maximally inclusive and errs toward including names in ambiguous cases. It must not be treated as a clean canonical entity catalogue.
- The codebook explicitly warns that person and organization extraction can contain false positives. For organization names, it recommends examining frequency distributions and filtering names that occur only once or twice.
- Enhanced entity/theme fields provide approximate character offsets. Proximity can improve context checks, but it is not full semantic role analysis.
- GKG 2.1 records may contain no geographic fields. The codebook explains that inclusion is based on any successfully extracted information, not a requirement to identify a location. A parser must not reject records just because location fields are empty.

### 3. Language and publisher geography are different dimensions

The GKG codebook documents `V2.1TRANSLATIONINFO` with `SRCLC`, the original source-language code, for machine-translated documents. The GKG record ID also distinguishes translated material with a `T` marker.

This helps measure language coverage, but language does not identify publisher geography. The documented GKG fields include the source common name/domain, but do not provide a simple, authoritative publisher-country field in the core record schema.

Therefore:
- retain original language as a separate dimension;
- retain source domain as a separate dimension;
- do not infer publisher country from article language or from locations mentioned in the article;
- test a separate source-country enrichment method before using geographic distribution in scoring.

GDELT DOC's article-list output can expose source country and language for returned articles, but its documented `MAXRECORDS` limit is 250 per request. That makes it useful for targeted validation, not automatically a complete source-country enrichment layer for the entire GKG stream.

### 4. What GKG does not solve

GKG provides article metadata, not a definitive article-primary-topic label.

Examples of failure modes:
- a celebrity, politician, country or company is mentioned once in an unrelated article;
- a broad proper name is ambiguous across people, places, products or events;
- a theme appears in the article but is not its central subject;
- an entity extractor includes a false positive;
- syndicated copies inflate the apparent number of articles;
- publisher domains are not independent editorial sources;
- a source's language, domain and physical publisher location are not interchangeable.

Consequently, raw counts of GKG name occurrences must never be used as the league ranking.

## Relationship to the existing Trendsy pipelines

### Web NGrams

The current `scripts/webngrams-smoke-test.mjs`:
- samples one representative Web NGrams file in each requested UTC hour;
- reads each record's `url`, `lang`, `pre`, `ngram` and `post`;
- tests only the 12 configured candidate identities and aliases;
- stores candidate matches and a capped evidence sample.

It does not discover all names or classify the complete stream. It also does not provide publisher country in the record fields currently consumed by Trendsy.

### DOC 2.0

The current `scripts/gdelt-smoke-test.mjs`:
- submits a query for each manually configured candidate;
- requests `timelinevolraw`;
- stores raw distinct-article counts and the `norm` denominator;
- uses a rolling history of roughly three months.

DOC 2.0 is useful for checking candidate coverage and independent volume trends. Its article-list mode can return article URLs, titles, dates, language and source country, but the documented result cap makes it unsuitable as the only global article ingestion pipeline.

### Proposed division of responsibilities

1. **GKG:** discover and count candidate names and themes across article-level records.
2. **Web NGrams:** provide multilingual phrase/context evidence and an independent URL stream where useful.
3. **DOC 2.0:** validate selected candidates with full-text query timelines and targeted article lists.
4. **Independent audit sample:** assess whether matched documents are genuinely about the candidate, rather than merely mentioning it.

These feeds overlap but are not interchangeable. Any combined score must count a source article once, not once per feed.

## URL join: hypothesis, not yet proven

There is a documented basis for a join:
- Web NGrams records consumed by Trendsy contain a `url` field.
- GKG uses `V2DOCUMENTIDENTIFIER`; for source collection 1 (WEB), the codebook says this is a fully qualified document URL.

This suggests an exact or normalized URL join is possible for at least part of the web-news corpus. It does **not** establish that the join is complete or stable.

The next empirical test must measure:
- exact URL match rate;
- normalized URL match rate after safe normalization (host casing, default ports, fragments, tracking parameters only where justified);
- unmatched rates by domain and language;
- multiple GKG records or NGrams records per URL;
- redirect, canonical URL, AMP/mobile URL and URL-encoding differences;
- whether one feed contains documents absent from the other;
- join rate over several days, not a single snapshot.

Do not silently merge URLs using aggressive transformations. Keep original URLs and report each normalization rule's incremental match gain and collision risk.

## Recommended first empirical audit

Run a read-only research experiment before changing application code or the catalogue.

### Sample design

- Collect at least three non-consecutive days, including weekdays and a weekend day.
- Prefer complete 15-minute GKG update batches for each selected day; record missing batches and ingestion delays.
- Sample the corresponding Web NGrams stream using the existing proven downloader/parser where feasible.
- Preserve raw source timestamps, filenames, record counts, and checksums.
- Use a fixed, documented sample budget so the experiment can be repeated.

### Measurements

1. GKG file availability, size, parse success, records per batch and field-count consistency.
2. Share of records with WEB source collection and usable URLs.
3. Presence rates for `ALLNAMES`, persons, organizations, themes, enhanced fields and translation info.
4. Number of unique names, documents per name, and frequency distribution (including singleton/two-document names).
5. URL join coverage between GKG and Web NGrams, split by language and source domain.
6. Duplicate URL and near-duplicate/syndication rates.
7. Domain concentration and source diversity for candidate names.
8. Language distribution using original-language metadata where available; do not treat translation markers as complete language coverage without validating blanks and special collections.
9. Manual relevance review of a stratified sample: high-frequency names, medium-frequency names, borderline candidates, and common ambiguous names.
10. Stability of the candidate ranking across days and against DOC 2.0 spot checks.

### Candidate discovery approach to test

- Extract `V2.1ALLNAMES` from GKG records, retaining the source record and document URL.
- Aggregate by canonicalized name candidate and **unique document URL**, not raw mention count.
- Keep entity type uncertain until supported by other GKG fields or evidence; do not infer a type from the name string alone.
- Use `V1THEMES` and enhanced-theme proximity as contextual features, not hard editorial admission quotas.
- Exclude or quarantine low-frequency names and identity collisions for review rather than silently promoting them.
- Apply duplicate/syndication controls before calculating attention.
- Produce a ranked discovery report with evidence URLs, domains, languages, themes, date coverage and confidence warnings.

## Decisions pending empirical results

Do not yet:
- remove `data/candidates.json` or `data/webngrams-candidates.json`;
- switch the active game catalogue to automatic discovery;
- define final popularity weights or market prices;
- treat a GKG entity occurrence as proof of relevance;
- use source-country quotas or editorial category quotas;
- implement automatic promotion/demotion.

The next implementation step, after the schema and join tests, should be a standalone GKG ingestion and discovery prototype that writes auditable JSON/CSV artifacts. It should not change the live game or its current candidate list.

## Attribution

Trendsy should visibly credit the GDELT Project and link to https://www.gdeltproject.org/. The data page describes GDELT's datasets as free and open. This audit does not replace a review of any specific downstream source, article, image or publisher rights.
