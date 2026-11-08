# GDELT data feasibility — methodology draft

## Measurement

The prototype requests GDELT DOC 2.0 `timelinevolraw` series for manually curated search queries. Values are raw daily article-volume measurements returned by the API. This is a diagnostic experiment, not the final Trendsy popularity index or price formula.

## Six categories

| Key | Meaning |
| --- | --- |
| `global_people` | People prominent in global media |
| `global_events` | Named world events or recurring event families |
| `countries` | Countries discussed in global media |
| `global_cities` | Cities outside the Polish-city category |
| `polish_cities` | Cities in Poland |
| `people_in_polish_media` | People prominent in Polish media, regardless of nationality |

## Known risks

1. **Ambiguous names:** text search can match unrelated people, places or meanings.
2. **Aliases:** diacritics, transliterations, abbreviations and alternate spellings can split coverage.
3. **Event identity:** a recurring event family is not the same as one specific edition.
4. **Source-country filters:** publisher country is not the same as the geographic subject of an article.
5. **Volume comparability:** raw counts for different queries are not comparable. A future index should compare each instrument with its own baseline.
6. **Rolling window:** DOC API history is limited; Trendsy must persist daily snapshots for long-term rankings.

## Review criteria

For each candidate, inspect the number of daily observations, gaps and spikes, relevance of matches, alias recall/noise, and stability across repeated runs.

## Decision gate

Do not build production pricing on this sample until query quality, entity identity and daily-series stability have been reviewed. If DOC cannot distinguish entities reliably, test GDELT GKG for candidate discovery and validation.
