function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function sortedCounts(counts) {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function parseDomain(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return sortedCounts(counts);
}

function share(count, total) {
  return total ? Number((count / total).toFixed(4)) : 0;
}

export function buildCandidateReview(item) {
  const evidence = [];
  const seenUrls = new Set();
  for (const record of Array.isArray(item.evidence) ? item.evidence : []) {
    const url = typeof record?.url === "string" ? record.url : "";
    const domain = parseDomain(url);
    if (!domain || seenUrls.has(url)) continue;
    seenUrls.add(url);
    evidence.push({
      url,
      domain,
      lang: String(record.lang ?? "unknown").toLowerCase(),
      matchType: record.matchType ?? "unknown",
      aliasMatches: Array.isArray(record.aliasMatches) ? record.aliasMatches : [],
      context: String(record.context ?? "").slice(0, 500),
      sampleHour: record.sampleHour ?? null,
      relevanceAssessment: "",
      entityResolutionAssessment: "",
      notes: ""
    });
  }

  const domainCounts = countBy(evidence, item => item.domain);
  const languageCounts = countBy(evidence, item => item.lang);
  const matchTypeCounts = countBy(evidence, item => item.matchType);
  const topDomains = Object.entries(domainCounts).slice(0, 3);
  const topDomainCount = topDomains[0]?.[1] ?? 0;
  const topThreeCount = topDomains.reduce((sum, [, count]) => sum + count, 0);
  const uniqueArticles = safeCount(item.uniqueArticles);
  const qualityFlags = [];
  if (!evidence.length) qualityFlags.push("no_evidence_in_sample");
  if (evidence.length < uniqueArticles) qualityFlags.push("evidence_is_capped_sample");
  if (evidence.length && topDomainCount / evidence.length >= 0.5) qualityFlags.push("evidence_sample_concentrated_in_one_domain");
  if (evidence.length && topThreeCount / evidence.length >= 0.8) qualityFlags.push("evidence_sample_concentrated_in_three_domains");
  if (safeCount(item.contextFilteredMatchedRecords) > 0) qualityFlags.push("single_token_context_filtering_used");
  if (safeCount(item.multiwordPhraseMatchedRecords) > 0 && safeCount(item.contextFilteredMatchedRecords) > 0) {
    qualityFlags.push("mixed_match_methods_require_separate_review");
  }

  return {
    id: String(item.id ?? ""),
    label: String(item.label ?? item.name ?? item.id ?? "Unnamed candidate"),
    category: String(item.category ?? ""),
    locale: String(item.locale ?? ""),
    matchedRecords: safeCount(item.matchedRecords),
    uniqueArticles,
    multiwordPhraseMatchedRecords: safeCount(item.multiwordPhraseMatchedRecords),
    contextFilteredMatchedRecords: safeCount(item.contextFilteredMatchedRecords),
    evidenceCount: evidence.length,
    evidenceCoverage: share(evidence.length, uniqueArticles),
    domainCount: Object.keys(domainCounts).length,
    domainCounts,
    topDomain: topDomains[0]?.[0] ?? null,
    topDomainShare: share(topDomainCount, evidence.length),
    topThreeDomainShare: share(topThreeCount, evidence.length),
    languageCounts,
    matchTypeCounts,
    qualityFlags,
    reviewStatus: "manual_review_required",
    evidence
  };
}

export function createWebNgramsReviewAudit(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.results) || snapshot.results.length === 0) {
    throw new Error("Snapshot contains no candidate results.");
  }
  const sampling = snapshot.sampling ?? {};
  const candidates = snapshot.results.map(buildCandidateReview);
  const evidenceRows = candidates.flatMap(candidate => candidate.evidence.map(evidence => ({
    candidateId: candidate.id,
    candidateLabel: candidate.label,
    category: candidate.category,
    locale: candidate.locale,
    ...evidence
  })));

  return {
    schemaVersion: 1,
    source: snapshot.source ?? "GDELT Web News NGrams 3.0",
    generatedAt: snapshot.generatedAt ?? null,
    sampling: {
      status: sampling.status ?? "unknown",
      sampleHours: safeCount(sampling.sampleHours),
      successfulSampleHours: safeCount(sampling.successfulSampleHours),
      coverageStartUtc: sampling.coverageStartUtc ?? null,
      coverageEndUtc: sampling.coverageEndUtc ?? null
    },
    interpretation: {
      purpose: "Manual evidence review only; no popularity score, candidate ranking, or automatic exclusion.",
      limitation: "Domain and language concentration describe only the capped evidence sample, not all matching articles or the full GDELT source population.",
      headlineAvailability: "Web NGrams evidence contains surrounding text snippets and URLs, not a verified article headline or full article body."
    },
    summary: {
      candidateCount: candidates.length,
      candidatesWithEvidence: candidates.filter(item => item.evidenceCount > 0).length,
      evidenceRows: evidenceRows.length,
      candidatesWithSingleDomainConcentration: candidates.filter(item => item.qualityFlags.includes("evidence_sample_concentrated_in_one_domain")).length,
      candidatesWithTopThreeDomainConcentration: candidates.filter(item => item.qualityFlags.includes("evidence_sample_concentrated_in_three_domains")).length
    },
    candidates,
    evidenceRows
  };
}

export function toReviewCsv(audit) {
  const columns = [
    "candidate_id", "candidate_label", "category", "locale", "domain", "lang",
    "match_type", "matched_aliases", "context", "url", "sample_hour",
    "relevance_assessment", "entity_resolution_assessment", "notes"
  ];
  const cell = value => '"' + String(value ?? "").replaceAll('"', '""') + '"';
  const rows = audit.evidenceRows.map(item => [
    item.candidateId, item.candidateLabel, item.category, item.locale, item.domain,
    item.lang, item.matchType, item.aliasMatches.join(" | "), item.context, item.url,
    item.sampleHour, item.relevanceAssessment, item.entityResolutionAssessment, item.notes
  ].map(cell).join(","));
  return [columns.join(","), ...rows].join("\n") + "\n";
}

export function toReviewMarkdown(audit) {
  const lines = [
    "# Web NGrams evidence review",
    "",
    `- Generated: ${audit.generatedAt ?? "unknown"}`,
    `- Sampling: ${audit.sampling.status}; ${audit.sampling.successfulSampleHours}/${audit.sampling.sampleHours} successful hourly samples`,
    `- Candidates: ${audit.summary.candidateCount}`,
    `- Evidence rows: ${audit.summary.evidenceRows}`,
    "",
    "## How to use this report",
    "",
    "- Review each context snippet and open the URL when needed. Decide whether the mention refers to the intended candidate and whether the article is substantively about it.",
    "- Treat domain concentration as a diagnostic of this capped evidence sample only; it is not a measure of the complete source distribution.",
    "- Record decisions in the CSV columns `relevance_assessment`, `entity_resolution_assessment` and `notes`.",
    "- Do not convert these diagnostics into prices, league points, or automatic exclusions.",
    "",
    "## Candidate diagnostics",
    "",
    "| Candidate | Unique articles | Evidence | Domains | Top domain share | Top 3 domain share | Languages | Flags |",
    "|---|---:|---:|---:|---:|---:|---:|---|"
  ];
  for (const item of audit.candidates) {
    lines.push(`| ${item.label.replaceAll("|", "\\|")} | ${item.uniqueArticles} | ${item.evidenceCount} | ${item.domainCount} | ${(item.topDomainShare * 100).toFixed(0)}% | ${(item.topThreeDomainShare * 100).toFixed(0)}% | ${Object.keys(item.languageCounts).length} | ${item.qualityFlags.join(", ") || "—"} |`);
  }
  lines.push(
    "",
    "## Limitations",
    "",
    audit.interpretation.limitation,
    audit.interpretation.headlineAvailability,
    "The report is a review worksheet, not a validated popularity index."
  );
  return lines.join("\n") + "\n";
}
