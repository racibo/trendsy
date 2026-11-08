# Data methodology — initial proposal

## Purpose

This proof of concept tests whether GDELT DOC 2.0 can produce repeatable daily popularity observations for a small, curated instrument list. It does not yet claim that the candidate queries are unambiguous or that raw article counts are comparable across different instruments.

## Measurement source

GDELT DOC 2.0 API, using the `timelinevolraw` mode. The query is submitted as authored in `data/candidates.json`. Each response is retained with the retrieval timestamp and the exact query so that results can be audited.

Official references:

- https://www.gdeltproject.org/
- https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- https://gdeltproject.org/data.html

GDELT must be credited and linked in the public product.

## Important measurement caveats

1. A text query is not an entity identifier. It can match homonyms, quotations, unrelated uses and different spellings.
2. Raw article volume is affected by the total volume of monitored coverage. Do not compare raw counts directly between a person, a city and a country.
3. DOC API history is rolling/limited. Trendsy must store its own daily snapshots if it needs a long-term chart or annual ranking.
4. A zero or missing observation is not necessarily proof of zero real-world popularity. The pipeline must distinguish a returned zero from an absent/failed data point.
5. Recurring event families are not equivalent to a single named event. Event instruments need a concrete identity and date/context.
6. Polish-media queries require a language/source-country strategy. A global query for a Polish public figure is not automatically a measure of Polish-media popularity.

## Initial prototype output

The smoke test writes:

- `output/gdelt-snapshot.json`: raw API response summaries, query, timestamp and daily values.
- `output/gdelt-snapshot.csv`: flattened daily observations.

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
