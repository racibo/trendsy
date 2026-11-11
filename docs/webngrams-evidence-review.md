# Web NGrams evidence review worksheet

The daily Web NGrams sample can produce a review worksheet with one row per retained evidence URL. This is a diagnostic layer over the raw snapshot; it does not alter matching, candidate discovery, daily archives, game state, or prices.

Run:

```sh
npm run webngrams:review-audit
```

Outputs:

- `output/webngrams-review-audit.json`: structured candidate and evidence diagnostics;
- `output/webngrams-review-audit.csv`: editable evidence-level worksheet;
- `output/webngrams-review-audit.md`: compact candidate summary and review instructions.

The worksheet reports unique evidence URLs, domains, language counts, match methods, evidence coverage and the share of the capped evidence sample represented by the largest one and three domains. The concentration metrics describe only the retained sample (up to the configured evidence cap), not the complete set of matching articles or the overall GDELT source population.

Each CSV evidence row has blank fields for a human relevance assessment, entity-resolution assessment and notes. The Web NGrams feed provides context snippets and URLs, not verified headlines or full article bodies; reviewers should open the linked article when a snippet is insufficient.

No candidate receives an automatic quality label, league score, price, promotion or exclusion. This worksheet is intended to make the next manual validation step concrete and repeatable.
