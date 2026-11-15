const GENERIC_FLAGS = new Set(["possible_generic_or_boilerplate_phrase"]);

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function logScale(value, cap) {
  if (value <= 0) return 0;
  return clamp(Math.log1p(value) / Math.log1p(cap));
}

export function scoreLeagueCandidate(candidate, relevance = null, completeSamples = 30) {
  const articles = Number(candidate.uniqueArticles ?? 0);
  const domains = Number(candidate.uniqueDomains ?? 0);
  const batches = Number(candidate.sampledBatches ?? 0);
  const topDomainShare = clamp(Number(candidate.quality?.topDomainShare ?? 1));
  const sampleCoverage = clamp(batches / Math.max(1, completeSamples));
  const domainDiversity = clamp(domains / 10);
  const personSignal = Number(candidate.personSignalArticles ?? 0);
  const organizationSignal = Number(candidate.organizationSignalArticles ?? 0);
  const locationSignal = Number(candidate.locationSignalArticles ?? 0);
  const crossSignalCoverage = clamp(Math.max(personSignal, organizationSignal, locationSignal) / Math.max(1, articles));
  const candidateType = locationSignal >= personSignal && locationSignal >= organizationSignal && locationSignal > 0
    ? "place"
    : personSignal >= organizationSignal && personSignal > 0
      ? "person"
      : organizationSignal > 0 ? "organization" : "unclassified";
  const languageCoverage = clamp(Number(candidate.languageCoverage?.coverage ?? 0));
  const exact = relevance?.exactPhrase;
  const repeat = relevance?.repeat2;
  const relevanceQueriesSucceeded = exact?.status === "ok" || repeat?.status === "ok";
  const evidenceMatches = Number(exact?.gkgEvidenceUrlMatches ?? 0) + Number(repeat?.gkgEvidenceUrlMatches ?? 0);
  const headlineMatches = Number(exact?.headlineExactPhraseCount ?? 0) + Number(repeat?.headlineExactPhraseCount ?? 0);
  const relevanceSignal = evidenceMatches > 0 ? 1 : headlineMatches > 0 ? 0.5 : 0;

  const components = {
    frequency: 20 * logScale(articles, 100),
    sampleCoverage: 20 * sampleCoverage,
    domainDiversity: 20 * domainDiversity,
    sourceIndependence: 20 * (1 - topDomainShare),
    crossSignal: 10 * crossSignalCoverage,
    languageMetadata: 5 * languageCoverage,
    articleRelevance: 5 * relevanceSignal
  };
  const flags = new Set([
    ...(candidate.quality?.reviewFlags ?? []),
    ...(candidate.singleTokenName ? ["single_token_name_needs_identity_check"] : []),
    ...(domains < 4 ? ["limited_domain_diversity"] : []),
    ...(batches < Math.ceil(completeSamples * 0.2) ? ["limited_time_sample_coverage"] : []),
    ...(!relevanceQueriesSucceeded ? ["headline_audit_unavailable_or_failed"] : []),
    ...(relevanceQueriesSucceeded && relevanceSignal === 0 ? ["no_headline_or_gkg_url_confirmation"] : [])
  ]);
  const exclusionReasons = [];
  if (articles < 5) exclusionReasons.push("fewer_than_5_unique_articles");
  if (batches < 3) exclusionReasons.push("fewer_than_3_sample_batches");
  if (domains < 3) exclusionReasons.push("fewer_than_3_domains");
  if (topDomainShare > 0.75) exclusionReasons.push("one_domain_over_75_percent");
  for (const flag of flags) if (GENERIC_FLAGS.has(flag)) exclusionReasons.push("generic_or_boilerplate_name");
  if (candidate.singleTokenName && crossSignalCoverage < 0.25) exclusionReasons.push("ambiguous_single_token_without_entity_cross_signal");

  const score = Number(Object.values(components).reduce((sum, value) => sum + value, 0).toFixed(2));
  const eligibleForReview = exclusionReasons.length === 0;
  return {
    name: candidate.name,
    normalizedName: candidate.normalizedName,
    score,
    eligibleForReview,
    decision: eligibleForReview ? "REVIEW_CANDIDATE" : "HOLD",
    uniqueArticles: articles,
    uniqueDomains: domains,
    sampledBatches: batches,
    sampleCoverage: Number(sampleCoverage.toFixed(3)),
    topDomainShare: Number(topDomainShare.toFixed(3)),
    personSignalArticles: personSignal,
    organizationSignalArticles: organizationSignal,
    locationSignalArticles: locationSignal,
    candidateType,
    crossSignalCoverage: Number(crossSignalCoverage.toFixed(3)),
    languageCoverage: Number(languageCoverage.toFixed(3)),
    relevance: {
      queriesSucceeded: relevanceQueriesSucceeded,
      gkgEvidenceUrlMatches: evidenceMatches,
      exactHeadlineMatches: headlineMatches
    },
    scoreComponents: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Number(value.toFixed(2))])),
    reviewFlags: [...flags].sort(),
    exclusionReasons,
    evidence: candidate.evidence ?? []
  };
}

export function buildLeagueCandidateScreen(discovery, relevance) {
  const completeSamples = Number(discovery.summary?.completeSamples ?? 0);
  const relevanceByName = new Map((relevance?.candidates ?? []).map(item => [item.normalizedName, item]));
  const scored = (discovery.candidates ?? []).map(candidate =>
    scoreLeagueCandidate(candidate, relevanceByName.get(candidate.normalizedName) ?? null, completeSamples)
  ).sort((a, b) => b.score - a.score || b.uniqueArticles - a.uniqueArticles || a.name.localeCompare(b.name));
  const eligible = scored.filter(item => item.eligibleForReview);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: discovery.status ?? "UNKNOWN",
    methodology: {
      purpose: "Transparent candidate triage for human review; not a popularity index and not automatic league admission.",
      maximumScore: 100,
      weights: {
        frequency: 20,
        sampleCoverage: 20,
        domainDiversity: 20,
        sourceIndependence: 20,
        crossSignal: 10,
        languageMetadata: 5,
        articleRelevance: 5
      },
      hardExclusions: [
        "fewer than 5 unique sampled articles",
        "fewer than 3 sampled time batches",
        "fewer than 3 distinct domains",
        "one domain contributes more than 75% of candidate articles",
        "explicit generic/boilerplate phrase flag",
        "single-token name without meaningful PERSON/ORGANIZATION cross-signal"
      ],
      cautions: [
        "A domain is not necessarily an independent publisher; syndication can inflate apparent diversity.",
        "GKG PERSONS/ORGANIZATIONS fields are corroborating signals, not definitive entity typing.",
        "Language metadata is incomplete; its score is a small positive signal only and missing metadata is not treated as a language.",
        "Headline and exact-URL evidence are weak corroboration, not proof of topical relevance.",
        "The discovery report is capped at its configured candidate limit; absence from this report does not mean a topic is unimportant."
      ]
    },
    summary: {
      discoveredCandidates: scored.length,
      eligibleForHumanReview: eligible.length,
      heldBack: scored.length - eligible.length,
      top16AreResearchShortlist: eligible.length >= 16,
      top16Count: Math.min(16, eligible.length)
    },
    top16ResearchShortlist: eligible.slice(0, 16),
    eligibleCandidates: eligible,
    heldCandidates: scored.filter(item => !item.eligibleForReview),
    allScoredCandidates: scored
  };
}

export function renderLeagueCandidateScreen(report) {
  const lines = [
    "# Trendsy — wstępna selekcja kandydatów do ligi",
    "",
    "- Wygenerowano: " + report.generatedAt,
    "- Kandydaci wykryci: " + report.summary.discoveredCandidates,
    "- Dopuszczeni do ręcznej weryfikacji: " + report.summary.eligibleForHumanReview,
    "- Wstrzymani: " + report.summary.heldBack,
    "",
    "## Jak czytać wynik",
    "",
    "To ranking priorytetu do ręcznej oceny, a nie automatyczny ranking popularności ani gotowa liga. Żaden kandydat nie trafia automatycznie do gry.",
    "",
    "| # | Kandydat | Punkty selekcyjne | Artykuły | Domeny | Próbki | Udział największej domeny | Typ sygnału | PERSON/ORG/LOCATION |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|",
    ...report.top16ResearchShortlist.map((item, index) =>
      "| " + (index + 1) + " | " + item.name.replaceAll("|", "\\|") + " | " + item.score +
      " | " + item.uniqueArticles + " | " + item.uniqueDomains + " | " + item.sampledBatches +
      " | " + Math.round(item.topDomainShare * 100) + "% | " + item.candidateType + " | " +
      (item.personSignalArticles + item.organizationSignalArticles + item.locationSignalArticles) + " |"
    ),
    "",
    "## Kryteria wstrzymania",
    "",
    "Kandydat jest wstrzymany, jeśli ma mniej niż 5 unikalnych artykułów, mniej niż 3 próbki czasowe, mniej niż 3 domeny, ponad 75% materiałów z jednej domeny, nazwę ogólną/boilerplate albo niejednoznaczną nazwę jednowyrazową bez potwierdzenia PERSON/ORGANIZATIONS/LOCATIONS.",
    "",
    "## Ograniczenia",
    "",
    ...report.methodology.cautions.map(item => "- " + item),
    "",
    "Pełne wyniki, flagi, przyczyny wstrzymania i rozbicie punktów znajdują się w pliku JSON.",
    ""
  ];
  return lines.join("\n");
}
