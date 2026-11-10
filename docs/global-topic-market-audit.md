# Global topic market — data audit and league proposal

**Status:** research/design; no production ranking, promotion or demotion is enabled by this document.

## Executive conclusion

A single global league of topics is a better product model than mandatory country or editorial-category quotas. The active market should be selected by measured global media attention, not by a requirement to include Poland, the United States, Europe, Asia, or a fixed number of topics from any category.

However, the current Web NGrams pipeline cannot yet discover the world's leading topics. It scans the sampled stream but only counts records matching a hand-curated list of 12 aliases. It is therefore a candidate-measurement experiment, not a global topic leaderboard. The current evidence archive also demonstrates that a name match is not proof that an article is about the named topic.

The recommended direction is:
- one active global league with 16 instruments;
- a visible waiting room containing both automatically discovered and user-proposed candidates;
- GDELT-based objective eligibility and ranking;
- community voting as a transparent supporting signal, not as a substitute for evidence;
- delayed, stability-aware promotion and demotion rather than a mechanical daily top-16 sort.

## What the current data actually says

The 10 November 2026 archive contains 24 successful hourly samples and 1,954 unique candidate/article URL matches across the 12 configured candidates. This is not 1,954 different articles across the whole GDELT stream: the same article can match more than one candidate. The archive retains 146 evidence URLs for 10 candidates; all 12 candidates still require manual review.

Selected candidate counts in that archive:
| Candidate | Unique matched URLs | Evidence sample | Main warning |
|---|---:|---:|---|
| Donald Trump | 1,481 | 24 | Some matches may be mentions, not the article's main subject |
| Taylor Swift | 99 | 21 | Mentions can be incidental |
| COP31 | 130 | 21 | Single-token/context filtering used |
| Paris | 110 | 22 | Context filter can still confuse city references |
| France | 53 | 19 | Country may be incidental or appear in a company/source name |
| Japan | 33 | 14 | Sample includes incidental references |
| Tokyo | 33 | 14 | Sample includes incidental references |
| Youth Olympic Games | 8 | 5 | Low volume |
| Kraków | 2 | 2 | Low volume |
| Donald Tusk | 5 | 4 | Low volume; sample domains concentrated |
| Gdańsk | 0 | 0 | No qualifying match in this sample |
| Robert Lewandowski | 0 | 0 | No qualifying match in this sample |

These are raw candidate-matching results, not validated popularity scores. The evidence is capped and selected across sampled hours; it is not a random, exhaustive list of all matching articles. For example, the Japan evidence includes articles where Japan appears in a travel route or a company/customer context. A Donald Trump evidence example points to a 2018 article even though the sample is dated 2026. These examples show why URL recency, article relevance and duplicate/syndication handling need explicit checks.

The 24 hourly samples are not necessarily 24 consecutive full hours. The 10 November archive spans 2026-11-09 21:46 UTC to 2026-11-10 20:01 UTC. Completeness currently means one successful sample in each of 24 UTC-hour buckets, not continuous 24-hour coverage.

The configured candidates are structurally biased by design: two people, two events, two countries, two global cities, two Polish cities and two people measured only in Polish-language media. This list cannot tell us whether politics, sport, technology, entertainment, conflict, business or climate are the most popular global topics. Its language counts describe only records matched by those candidates, not the language distribution of GDELT as a whole.

## Why a unified league makes sense

A single league has a clear rule users can understand: the active instruments are the topics with the strongest verified media attention during the measurement period. Topic labels (politics, sport, technology, culture, etc.) and entity types (person, event, organization, country, city) should be metadata and filters, not admission quotas.

This avoids arbitrary outcomes such as reserving slots for Poland or forcing a balance between editorial categories. It also lets a major event, person, company, scientific breakthrough or sporting competition compete on the same board.

There is one important caveat: a raw count is not automatically fair. GDELT coverage is a monitored-news corpus, not a census of all public opinion, social media or internet activity. Syndicated stories, high-output publishers, language availability, duplicate URLs, ambiguous names and repeated mentions can distort counts. The product should describe the metric as **attention in GDELT-monitored news**, not “what the whole world thinks” or “the most popular things on the internet”.

## Proposed measurement model

Do not rank by raw Web NGrams record count. Use article-level evidence and a reproducible score.

1. Discover candidate topics from GDELT-wide signals, not from a preselected list of Polish or English names.
2. Resolve each candidate to a canonical topic identity, with multilingual aliases, type, dates and disambiguation rules.
3. Link candidate mentions to article-level metadata (where available), including publication time, language, source/domain, GKG themes and locations.
4. Deduplicate exact URLs and, where feasible, syndicated/near-identical stories. Report unique articles and independent source domains separately.
5. Determine whether the candidate is a main subject or a passing mention. Use GKG themes and context plus a small, auditable manual sample. Do not assume that a keyword match is sufficient.
6. Calculate a daily score from relevant unique articles, with safeguards for source concentration, duplicate syndication, stale pages and data gaps.
7. Retain raw counts and all quality diagnostics alongside any normalized score. Never silently replace missing data with zero.

A sensible first ranking prototype should compare:
- relevant unique article count in the last 24 hours;
- relevant unique article count over a rolling 7-day window;
- number of independent source domains;
- source/language/region mix;
- proportion of audited evidence judged relevant;
- change versus the candidate's own recent baseline.

Do not impose a language or geographic quota. Do measure and disclose the distribution by article language and publisher geography so that coverage bias is visible. Language is not publisher location: an English article may come from India, Nigeria, Singapore, the UK or the US.

## League mechanics: recommended version

A fixed 16-slot active league is attractive and easy to explain. A strict “two out, two in every day” rule is not yet recommended.

Problems with strict daily turnover:
- it forces changes even when the bottom two topics remain strong and the waiting room has weak candidates;
- short-lived spikes or noisy measurements can cause churn;
- a topic may leave after one quiet sampling window and return the next day;
- users may interpret frequent changes as arbitrary, especially if their portfolio is affected.

Recommended rules for a first live season:
- Keep 16 active topics.
- Review eligibility daily, but make promotion/demotion decisions on a rolling 3-day score or a 7-day trend with a 24-hour freshness component.
- Normally promote the two strongest eligible waiting-room candidates and demote the two weakest active candidates only when each replacement beats the outgoing candidate by a defined margin.
- Add a minimum data-quality gate: adequate relevant-article volume, more than one independent source domain, acceptable evidence relevance, recent observations and no unresolved identity collision.
- If fewer than two waiting-room candidates pass the gate, leave the relevant active slots unchanged. Do not force a transfer just to satisfy a quota.
- Add a short re-entry cooldown for recently demoted topics to prevent immediate yo-yo movement, except where a major verified surge justifies an override.
- Publish the score, rank, change, evidence volume and reason for every move.

This preserves the league metaphor while making the system stable and explainable. Once historical simulations show that daily two-up/two-down produces acceptable stability, it can be enabled as a stricter rule.

## Waiting room and user proposals

The waiting room should be visible and have two clearly labelled sources:

**1. Automatically discovered**
- Candidates surfaced by broad GDELT topic discovery (for example, GKG theme/entity co-occurrence).
- Ranked by measured attention and quality.
- A candidate can remain in the waiting room across multiple days; it does not need to be promoted immediately.

**2. Proposed by users**
- A user submits a name or topic plus an optional short explanation.
- The system resolves the canonical identity and searches for matching evidence across supported aliases/languages.
- The candidate enters a “verification” state for at least one full measurement cycle (24 hours is a reasonable minimum, not proof of eligibility).
- If the evidence passes the published quality gate, it joins the ranked waiting room. It does not automatically enter the active league.

A user proposal must not directly create a tradable instrument. Otherwise users could flood the system with aliases, obscure topics or coordinated proposals.

## Who decides: admin or community?

Use a hybrid process, with objective evidence as the gate:

- **GDELT + automatic checks:** decide whether the candidate has enough recent, relevant, independent coverage to qualify.
- **Community:** can support, oppose or flag a candidate's identity/relevance. Votes are advisory and visible; they do not manufacture media popularity.
- **Admin:** handles disputed identity, abusive submissions, taxonomy/alias corrections and exceptional data-quality decisions. Admin decisions should include a public reason and an audit trail.

Do not let a simple majority vote decide promotion. Votes are vulnerable to brigading, popularity contests and the preferences of the current player base. They also measure user interest, not global media attention. A community vote is useful for identifying false matches and gauging whether an instrument is understandable, but the measured media signal should determine its ranking.

Suggested voting prompt: “Czy te przykładowe artykuły rzeczywiście dotyczą tego tematu?” This is more useful than “Czy chcesz, żeby temat wszedł do ligi?”. It asks users to evaluate evidence rather than vote for their favourite subject.

## Public criteria users should see

For every active and waiting-room topic, show:
- canonical name and a one-sentence definition;
- topic/entity type and aliases used;
- GDELT measurement window and last successful update;
- relevant unique articles, independent domains and trend;
- language and publisher-region distribution;
- a small sample of source links;
- data-quality status and any warnings;
- current rank and reason for promotion/demotion or waiting-room status.

Explain clearly that the market measures attention in GDELT-monitored news, not all social media or the entire world's population.

## Audit work required before implementing automatic discovery

The current Web NGrams job is candidate-driven: it scans hourly files but only counts records matching the configured aliases. It does not classify the entire stream into editorial topics. Web NGrams context snippets alone are not sufficient to reliably determine the leading global subjects.

Next technical audit:
1. Inspect GDELT GKG and other article-level feeds available for a broad sample, and document their schemas, update cadence, coverage and licensing/attribution requirements.
2. Establish whether Web NGrams URLs can be reliably joined to GKG/article metadata. Do not assume a URL join is complete or stable without measuring match rates.
3. Sample multiple days, not just one. Measure article language, publisher domains/geography, themes, source concentration, duplicate/syndicated content and missing metadata.
4. Build a transparent mapping from GKG themes to a small user-facing taxonomy (politics, conflict/security, economy/business, technology/science, health, climate/environment, sport, entertainment/culture, society). Preserve original theme codes so the mapping can be revised.
5. Compare the global top topics with the top topics by language and publisher region. This reveals whether the global result is dominated by one media ecosystem.
6. Manually audit a stratified sample of high-ranking and borderline candidates to estimate false-positive rates.
7. Simulate league movement over historical days before choosing promotion margins, cooldowns and the exact score formula.

## Decision

Proceed with the single global league concept and a visible waiting room. Do not yet remove the old candidate file or switch production pricing/ranking to automatically discovered topics. First build and validate a broad GDELT discovery/audit pipeline. The current 12-candidate Web NGrams experiment remains useful as a test of matching and evidence quality, but it must not define the future market catalogue.
