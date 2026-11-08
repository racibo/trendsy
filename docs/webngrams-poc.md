# Web NGrams 3.0 — exploratory proof of concept

## Why this test exists

The DOC 2.0 timeline test was heavily rate-limited. Web NGrams 3.0 is a separate GDELT dataset that publishes minute-level JSON-NL files and covers 152 monitored languages. It is not a query API: the consumer downloads files and searches their records.

Official dataset description:
- https://blog.gdeltproject.org/announcing-the-new-web-news-ngrams-3-0-dataset/
- https://gdeltproject.org/data.html

## What this PoC does

`scripts/webngrams-smoke-test.mjs` downloads a small configurable sample (1–10 most recent minute files), reads the gzip JSON-NL stream, and searches candidate aliases in the local `pre + ngram + post` context.

It records:
- number of downloaded files and parsed records;
- matched ngram records per candidate;
- unique article URLs per candidate across the sampled files;
- language counts and a few example URLs;
- download/HTTP errors.

Polish-city and Polish-media candidates are restricted to language codes `pl` and `pol`. Other candidates currently accept any language, but their aliases are English-only; translated/local name variants have not yet been added.

## Important limitations

1. This is a short sample, not a daily popularity measurement. A daily count would require processing all minute files for the day (up to 1,440 files), which may be too costly for a small GitHub Actions workflow.
2. Matching a phrase in the short context around any unigram is only a candidate detector. It can miss mentions and can match unrelated context.
3. Single-word names such as France, Japan, Paris, Tokyo, Gdańsk and Kraków are ambiguous. Context matching does not perform reliable entity resolution.
4. Duplicate article URLs can occur in the dataset. This PoC deduplicates URLs across sampled files, but a production pipeline would need durable daily deduplication and canonical URL rules.
5. A file's minute timestamp represents when GDELT saw the article, not a daily popularity score.
6. Do not use these counts for instrument prices or rankings until coverage, duplicate behavior, alias precision, language coverage and daily aggregation costs have been measured.

## Running locally or manually

```sh
npm run webngrams:test
```

Set `WEBNGRAMS_SAMPLE_MINUTES=1` through `10` to change sample size. The GitHub Actions workflow also supports manual runs and stores JSON/CSV artifacts.

## Attribution

Any public use of this dataset should credit and link to the GDELT Project: https://www.gdeltproject.org/.
