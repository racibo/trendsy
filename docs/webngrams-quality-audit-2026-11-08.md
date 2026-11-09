# Web NGrams quality audit — 8 November 2026

## Scope and method

This review uses the successful 24-hour sample generated at `2026-11-08T22:34:38Z` (GitHub Actions run `42529455836`). All 24 of 24 hourly samples were downloaded and fully parsed. The snapshot contains 1,558 candidate/article matches across 11 of 12 candidates.

The audit inspected the eight distinct article-context examples retained by the then-current pipeline for each candidate (88 examples in total). These are short Web NGrams context windows plus URLs, not full article texts. The classifications below are therefore a screening assessment, not ground-truth entity resolution. The sample is also one day only; it cannot establish long-term coverage or price stability.

## Candidate-by-candidate findings

| Candidate | Matched records | Unique article URLs | Evidence review |
|---|---:|---:|---|
| Donald Trump | 23,767 | 1,196 | The eight examples consistently refer to the intended person. Strongest current candidate for a phrase-based popularity series. |
| Taylor Swift | 287 | 18 | Examples refer to the intended person, but some mentions are incidental and the unique-article sample is small. |
| 2026 Youth Olympic Games | 60 | 5 | All inspected examples refer to the Dakar 2026 event. Relevant but low-volume and too sparse for a dependable series yet. |
| COP31 | 1,862 | 73 | Inspected examples are about the 2026 UN climate conference or its Antalya preparations. Strong event identity; verify alias contribution separately. |
| France | 380 | 42 | Mixed signal: national team, government/history and country coverage are relevant, while some examples use “France” as a sports-title or bibliographic/geographic descriptor. Context filtering is not sufficient to establish country-level relevance. |
| Japan | 391 | 32 | Most examples are country, national-team, history, travel or cultural coverage. At least one is a media-catalogue metadata block; broad “Japanese” context can admit incidental references. |
| Paris, France | 1,016 | 87 | Inspected examples refer to Paris the city. One story appears twice under Express and AOL URLs, so URL uniqueness can overstate independent reporting. |
| Tokyo, Japan | 462 | 46 | Weakest city evidence: examples include Tokyo Bay, a company headquarters, and several “TOKYO (AP)” datelines for a story about an earthquake in central Japan. These are not necessarily articles about Tokyo city. |
| Gdańsk, Poland | 21 | 4 | All four inspected examples plausibly refer to Gdańsk, but the sample is too small to assess coverage. |
| Kraków, Poland | 450 | 25 | Inspected examples refer to Kraków, but most are clustered around one exceptional breaking-news incident. A single event can dominate a city's apparent popularity. |
| Donald Tusk | 839 | 30 | Inspected examples refer to the intended person, but many are tied to the same Kraków incident and some article URLs overlap with the Kraków coverage. |
| Robert Lewandowski | 0 | 0 | No match in this 24-hour sample. This is not proof of a broken matcher or absence of coverage; inspect a longer window and language/alias coverage before changing aliases. |

## Changes made in this stage

1. The evidence cap is now configurable through `WEBNGRAMS_EVIDENCE_LIMIT`. Default: 25 distinct article URLs per candidate; allowed range: 8–100. This makes subsequent reviews less dependent on the first eight matches encountered in file order.
2. Removed `Tokyo Bay` as a positive context for Tokyo city and added it as an explicit exclusion. A regression test covers the false-positive case and a positive Tokyo-city case.
3. Kept the other candidate policies unchanged. The current evidence does not justify broad alias expansion or aggressive exclusions for France, Japan, Paris, Gdańsk or Kraków.

## Follow-up verification — run #72, 9 November 2026

Run #72 completed all 24 hourly samples, but its JSON artifact retained only eight evidence URLs per candidate even though the configured default was 25. Inspection found a second, hard-coded cap of eight in the cross-file aggregation step. The initial per-file staging respected the configured cap, but the final snapshot aggregation truncated it. This did not affect aggregate match counters; it reduced the evidence available for manual quality review.

A follow-up code change replaces both evidence insertion paths with one deduplicating helper that applies the same configured cap. A regression test covers accumulation across multiple files, duplicate URLs and the configured limit. The next complete sample must verify that `sampling.evidenceLimitPerCandidate` and the actual per-candidate `evidence.length` agree (up to the number of available distinct matches).

## Interpretation and next gate

- A successful download/parse run establishes pipeline reliability, not measurement validity.
- Phrase candidates (Donald Trump, Taylor Swift, Youth Olympic Games, COP31 and Donald Tusk) still need a multi-day repeatability check.
- Single-token country/city candidates remain provisional. Context phrases are heuristic and can match incidental nearby words.
- Article URL count is not a count of independent publishers or unique stories. Syndication and alternate URLs can inflate it.
- Kraków and Donald Tusk require event-cluster checks so one breaking story does not masquerade as sustained popularity.
- Do not design a price formula from this snapshot. First collect a multi-day panel and compare candidate coverage, unique-story concentration, language mix and day-to-day volatility.

## Reproduction

Run the Web NGrams workflow manually with 24 hourly samples. The default evidence cap is 25; to retain a larger review sample, set `WEBNGRAMS_EVIDENCE_LIMIT` (maximum 100). The JSON artifact records the configured cap.
