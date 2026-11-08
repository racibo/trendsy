# Data methodology — initial proposal

## Purpose

This proof of concept tests whether GDELT DOC 2.0 can produce repeatable daily popularity observations for a small, curated instrument list. It does not yet claim that the candidate queries are unambiguous or that all categories have adequate coverage.

## Measurement source

GDELT DOC 2.0 API, using the `timelinevolraw` mode. The query is submitted as authored in `data/candidates.json`. Each response is retained with the retrieval timestamp and the exact query so that results can be audited.

`timelinevolraw` returns the number of distinct matching articles for each time step. GDELT also documents a `norm` field: the total number of articles monitored in that time step. The prototype preserves both values; it does not yet assume a final popularity formula based on them.

Official references:

- https://www.gdeltproject.org/
- https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- https://gdeltproject.org/data.html

GDELT must be credited and linked in the public product.

## Request pacing and reliability

GDELT's API response observed during the first test explicitly requested a minimum interval of five seconds between requests. The prototype therefore spaces request starts by at least six seconds, including retries. HTTP 429 responses trigger a longer wait (using `Retry-After` when supplied, with a conservative fallback and exponential backoff). Retries are bounded so that a persistent failure does not create an uncontrolled request loop.

The JSON artifact contains a per-instrument status and an overall success/failure summary. A green GitHub Actions run only means the script completed and produced its artifact; it does not mean every instrument query succeeded.

## Locale and Polish-media scope

GDELT documents two query operators:

- `sourcecountry:` limits results to outlets located in a country.
- `sourcelang:` limits results to articles originally published in a language.

The four Polish candidates (Gdańsk, Kraków, Donald Tusk and Robert Lewandowski) now use both `sourcecountry:poland` and `sourcelang:polish`. This defines the prototype's scope as Polish-language coverage from Poland-based outlets. It is a deliberate, narrower interpretation of “Polish media”; it excludes, for example, English-language articles from Polish outlets and Polish-language outlets based abroad. The scope can be revisited if the game definition requires those sources.

## Important measurement caveats

1. A text query is not an entity identifier. It can match homonyms, quotations, unrelated uses and different spellings.
2. Raw article volume is affected by the total volume of monitored coverage. Do not compare raw counts directly between a person, a city and a country.
3. The `norm` denominator is retained for analysis, but no normalized popularity index or price formula has been approved yet.
4. DOC API history is rolling/limited to roughly the most recent three months. Trendsy must store its own daily snapshots if it needs a long-term chart or annual ranking.
5. A returned zero, an absent date and a failed request are different states. The pipeline preserves only returned observations, lists dates for which the API supplied no point, and never fills those dates with zero.
6. Recurring event families are not equivalent to a single named event. Event instruments need a concrete identity and date/context.
7. Query filters improve scope but do not prove that every matching article is actually about the intended person or place. Candidate identities and aliases still require manual review.

## Initial prototype output

The smoke test writes:

- `output/gdelt-snapshot.json`: source query, retrieval timestamp, raw daily values, `norm`, per-instrument status, missing-date list and overall summary.
- `output/gdelt-snapshot.csv`: flattened daily observations, including `norm`.

These outputs are generated artifacts and are not committed by default.

## Candidate acceptance criteria

Before an instrument enters the game catalogue, verify:

- stable identity and a documented canonical label;
- aliases and spelling variants;
- homonym risk and geographic/person disambiguation;
- adequate daily observations;
- query repeatability;
- category membership;
- a defensible locale/language scope.

Only after this review should we design a normalized popularity index and price formula.

## Web NGrams matching and sampling (experimental)

The Web NGrams matcher normalizes Unicode text (including Polish diacritics) and tokenizes words before checking aliases. Polish city candidates include common inflected forms (for example, Gdańsk, Gdańska, Gdańsku and Kraków, Krakowa, Krakowie).

A single-token place or country alias is not accepted on its own. It must also have at least one configured nearby context phrase; configured exclusion phrases reject known false-positive contexts such as “Paris Agreement” and “TV Tokyo”. Multiword aliases are matched as phrases. These rules reduce known collisions but are heuristic filters, not a substitute for article-level entity resolution. The JSON output labels the match type and retains example article URLs and context for manual review. By default it retains up to 25 distinct article examples per candidate (`WEBNGRAMS_EVIDENCE_LIMIT`, bounded to 8–100); this is an evidence sample, not a complete list of matched articles.

The manual Actions run defaults to one representative sample in each of the previous 24 complete UTC hours. It rotates through the observed quarter-hour publication slots (:01, :16, :31 and :46), and tries the following minute once if the selected file is missing. This reduces the number of large downloads from dozens of files to at most 24 while retaining coverage across the full day. The report records missing hourly samples separately from transport or processing failures. A 404 is a normal missing publication minute, not a failed request.

Each gzip file is processed transactionally in memory. Candidate counters are staged per file and merged into the snapshot only after the entire stream has been read and all non-empty lines have parsed as JSON. A truncated or malformed file is discarded as a whole, preventing partial results from contaminating totals.

Sampling completeness is explicit in every Web NGrams snapshot: `sampling.status` is `COMPLETE` only when every requested UTC-hour bucket has a fully parsed file; otherwise it is `PARTIAL`. The Actions workflow uploads the snapshot and writes the counts to the job summary before marking a partial sample as an unsuccessful run. This preserves partial evidence for diagnosis without presenting incomplete coverage as a successful full-day measurement. HTTP 404 probes remain normal publication gaps when the fallback minute succeeds; they do not by themselves make the sample partial.
