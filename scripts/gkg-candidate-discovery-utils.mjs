export function normalizeCandidateName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAllNameMention(value) {
  const entry = String(value ?? "").trim();
  if (!entry) return null;
  const separator = entry.lastIndexOf(",");
  if (separator < 0) return { name: entry, offset: null };
  const name = entry.slice(0, separator).trim();
  const rawOffset = entry.slice(separator + 1).trim();
  if (!name) return null;
  return /^\d+$/.test(rawOffset)
    ? { name, offset: Number(rawOffset) }
    : { name: entry, offset: null };
}

export function createCandidateAccumulator() {
  return new Map();
}

const GENERIC_PHRASE_PATTERNS = [
  /\bchief executive officer\b/i,
  /\btrusted news\b/i,
  /\bget free report\b/i,
  /\bstock advisor\b/i,
  /\bbreaking news\b/i,
  /\bnews update\b/i,
  /\bpress release\b/i,
  /\bsubscribe now\b/i,
  /\bmarket report\b/i
];

function domainTokens(domain) {
  return String(domain ?? "").toLowerCase()
    .replace(/^www\./, "")
    .split(".")[0]
    .split(/[-_]/)
    .filter(token => token.length >= 3);
}

function buildQualityDiagnostics(item, totalBatches) {
  const articleCount = item.documents.size;
  const domainRows = [...item.domainCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topDomain = domainRows[0] ?? null;
  const topDomainShare = articleCount ? (topDomain?.[1] ?? 0) / articleCount : 0;
  const batchCoverage = totalBatches ? item.batches.size / totalBatches : 0;
  const entitySignalArticles = new Set([...item.personDocuments, ...item.organizationDocuments]).size;
  const variantRows = [...item.nameVariants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const normalizedTokens = item.key.split(" ");
  const publisherNameOverlap = domainRows.some(([domain]) => {
    const tokens = domainTokens(domain);
    return tokens.length > 0 && tokens.some(token => normalizedTokens.includes(token));
  });
  const warnings = [];
  if (topDomainShare >= 0.5) warnings.push("domain_concentration_50pct_or_more");
  if (item.domains.size <= 3) warnings.push("low_domain_count_3_or_less");
  if (batchCoverage <= 0.3) warnings.push("low_sample_batch_coverage_30pct_or_less");
  if (entitySignalArticles === 0) warnings.push("no_person_or_organization_cross_signal");
  if (variantRows.length >= 3) warnings.push("multiple_name_variants");
  if (publisherNameOverlap) warnings.push("candidate_name_overlaps_source_domain");
  if (GENERIC_PHRASE_PATTERNS.some(pattern => pattern.test(item.key))) warnings.push("possible_generic_or_boilerplate_phrase");
  return {
    topDomain: topDomain ? { domain: topDomain[0], articles: topDomain[1] } : null,
    topDomainShare: Number(topDomainShare.toFixed(4)),
    batchCoverage: Number(batchCoverage.toFixed(4)),
    entitySignalArticles,
    nameVariantCount: variantRows.length,
    publisherNameOverlap,
    reviewFlags: warnings
  };
}

function buildReviewSample(candidates, limitPerStratum = 5) {
  const strata = [
    ["high_frequency", item => item.uniqueArticles >= 50],
    ["medium_frequency", item => item.uniqueArticles >= 10 && item.uniqueArticles < 50],
    ["low_frequency", item => item.uniqueArticles < 10],
    ["domain_concentrated", item => item.quality.topDomainShare >= 0.5],
    ["low_domain_diversity", item => item.uniqueDomains <= 3],
    ["no_entity_cross_signal", item => item.quality.entitySignalArticles === 0],
    ["variant_rich", item => item.quality.nameVariantCount >= 3],
    ["publisher_name_overlap", item => item.quality.publisherNameOverlap]
  ];
  const selected = new Map();
  for (const [stratum, predicate] of strata) {
    const matches = candidates.filter(predicate)
      .sort((a, b) => b.uniqueArticles - a.uniqueArticles || a.normalizedName.localeCompare(b.normalizedName))
      .slice(0, limitPerStratum);
    for (const candidate of matches) {
      const existing = selected.get(candidate.normalizedName);
      if (existing) existing.strata.push(stratum);
      else selected.set(candidate.normalizedName, {
        name: candidate.name,
        normalizedName: candidate.normalizedName,
        uniqueArticles: candidate.uniqueArticles,
        uniqueDomains: candidate.uniqueDomains,
        sampledBatches: candidate.sampledBatches,
        evidence: candidate.evidence,
        reviewFlags: candidate.quality.reviewFlags,
        strata: [stratum],
        manualAssessment: {
          relevance: null,
          identityResolution: null,
          syndicatedOrDuplicateCoverage: null,
          notes: ""
        }
      });
    }
  }
  return [...selected.values()].sort((a, b) =>
    b.uniqueArticles - a.uniqueArticles || a.normalizedName.localeCompare(b.normalizedName)
  );
}

function buildPossibleAliasPairs(candidates, limit = 100) {
  const rows = candidates
    .filter(item => item.uniqueArticles >= 3)
    .slice(0, 200);
  const pairs = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex++) {
    const left = rows[leftIndex];
    const leftTokens = new Set(left.normalizedName.split(" ").filter(Boolean));
    for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex++) {
      const right = rows[rightIndex];
      const rightTokens = new Set(right.normalizedName.split(" ").filter(Boolean));
      const sharedTokens = [...leftTokens].filter(token => rightTokens.has(token));
      const denominator = Math.min(leftTokens.size, rightTokens.size);
      const tokenOverlap = denominator ? sharedTokens.length / denominator : 0;
      if (!sharedTokens.length || tokenOverlap < 0.5) continue;
      const leftDocs = left._documents;
      const rightDocs = right._documents;
      let sharedArticleCount = 0;
      const sharedUrls = [];
      for (const url of leftDocs) {
        if (rightDocs.has(url)) {
          sharedArticleCount++;
          if (sharedUrls.length < 3) sharedUrls.push(url);
        }
      }
      if (sharedArticleCount < 3) continue;
      const unionCount = leftDocs.size + rightDocs.size - sharedArticleCount;
      pairs.push({
        first: left.name,
        second: right.name,
        sharedTokens,
        sharedArticleCount,
        tokenOverlap: Number(tokenOverlap.toFixed(4)),
        articleJaccard: Number((sharedArticleCount / unionCount).toFixed(4)),
        sharedEvidenceUrls: sharedUrls,
        assessment: null
      });
    }
  }
  return pairs
    .sort((a, b) => b.sharedArticleCount - a.sharedArticleCount ||
      b.tokenOverlap - a.tokenOverlap || a.first.localeCompare(b.first) || a.second.localeCompare(b.second))
    .slice(0, limit);
}

function topEntries(counts, limit = 8) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export function addGkgDocument(accumulator, row, sampleFilename) {
  if (!row?.valid || row.sourceCollectionId !== "1" || !row.url) return;
  let domain;
  try { domain = new URL(row.url).hostname.toLowerCase(); } catch { return; }

  const mentions = (row.allNameMentions ?? row.allNames ?? [])
    .map(value => typeof value === "string" ? parseAllNameMention(value) : value)
    .filter(item => item?.name);
  const uniqueNames = new Map();
  for (const mention of mentions) {
    const key = normalizeCandidateName(mention.name);
    if (!key || key.length < 2 || !/\p{L}/u.test(key)) continue;
    const existing = uniqueNames.get(key);
    if (existing) existing.occurrences++;
    else uniqueNames.set(key, { name: mention.name.trim(), occurrences: 1 });
  }

  const personKeys = new Set((row.persons ?? []).map(normalizeCandidateName));
  const organizationKeys = new Set((row.organizations ?? []).map(normalizeCandidateName));
  for (const [key, item] of uniqueNames) {
    let candidate = accumulator.get(key);
    if (!candidate) {
      candidate = {
        key,
        nameVariants: new Map(),
        documents: new Set(),
        domains: new Set(),
        domainCounts: new Map(),
        languages: {},
        unknownLanguageArticles: 0,
        themes: {},
        batches: new Set(),
        personDocuments: new Set(),
        organizationDocuments: new Set(),
        mentionOccurrences: 0,
        evidence: []
      };
      accumulator.set(key, candidate);
    }
    candidate.batches.add(sampleFilename);
    if (candidate.documents.has(row.url)) continue;
    candidate.documents.add(row.url);
    candidate.nameVariants.set(item.name, (candidate.nameVariants.get(item.name) ?? 0) + 1);
    candidate.mentionOccurrences += item.occurrences;
    candidate.domains.add(domain);
    candidate.domainCounts.set(domain, (candidate.domainCounts.get(domain) ?? 0) + 1);
    const language = /^[a-z]{3}$/i.test(String(row.sourceLanguage ?? "")) ? row.sourceLanguage.toLowerCase() : null;
    if (language) candidate.languages[language] = (candidate.languages[language] ?? 0) + 1;
    else candidate.unknownLanguageArticles++;
    for (const theme of row.themes ?? []) {
      candidate.themes[theme] = (candidate.themes[theme] ?? 0) + 1;
    }
    if (personKeys.has(key)) candidate.personDocuments.add(row.url);
    if (organizationKeys.has(key)) candidate.organizationDocuments.add(row.url);
    if (candidate.evidence.length < 3) {
      candidate.evidence.push({
        url: row.url,
        domain,
        publishedAt: row.publishedAt || null,
        language,
        sample: sampleFilename
      });
    }
  }
}

export function summarizeCandidateDiscovery(accumulator, sampleStats, limit = 200) {
  const all = [...accumulator.values()];
  const completeBatches = sampleStats.filter(item => item.status === "COMPLETE").length;
  const allCandidates = all
    .filter(item => item.documents.size >= 2)
    .sort((a, b) => b.documents.size - a.documents.size || b.domains.size - a.domains.size || a.key.localeCompare(b.key))
    .map(item => {
      const variants = [...item.nameVariants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const quality = buildQualityDiagnostics(item, completeBatches);
      const knownLanguageArticles = Object.values(item.languages).reduce((sum, value) => sum + value, 0);
      return {
        name: variants[0]?.[0] ?? item.key,
        normalizedName: item.key,
        singleTokenName: !item.key.includes(" "),
        uniqueArticles: item.documents.size,
        uniqueDomains: item.domains.size,
        sampledBatches: item.batches.size,
        mentionOccurrences: item.mentionOccurrences,
        personSignalArticles: item.personDocuments.size,
        organizationSignalArticles: item.organizationDocuments.size,
        nameVariants: variants.slice(0, 8).map(([name, occurrences]) => ({ name, occurrences })),
        languageCoverage: {
          knownLanguageArticles,
          unknownLanguageArticles: item.unknownLanguageArticles,
          coverage: Number((knownLanguageArticles / item.documents.size).toFixed(4))
        },
        languages: topEntries(item.languages, 12),
        themes: topEntries(item.themes, 12),
        quality,
        evidence: item.evidence,
        _documents: item.documents
      };
    });
  const candidates = allCandidates.slice(0, limit);
  const possibleAliasPairs = buildPossibleAliasPairs(candidates);
  for (const candidate of candidates) delete candidate._documents;

  const buckets = {
    "1_article": 0,
    "2_articles": 0,
    "3_to_4_articles": 0,
    "5_to_9_articles": 0,
    "10_to_24_articles": 0,
    "25_plus_articles": 0
  };
  for (const item of all) {
    const count = item.documents.size;
    if (count === 1) buckets["1_article"]++;
    else if (count === 2) buckets["2_articles"]++;
    else if (count <= 4) buckets["3_to_4_articles"]++;
    else if (count <= 9) buckets["5_to_9_articles"]++;
    else if (count <= 24) buckets["10_to_24_articles"]++;
    else buckets["25_plus_articles"]++;
  }

  const languageDocuments = sampleStats.reduce((sum, item) => sum + (item.documentsWithSourceLanguage ?? 0), 0);
  const unknownLanguageDocuments = sampleStats.reduce((sum, item) => sum + (item.documentsWithoutSourceLanguage ?? 0), 0);
  const languageTotal = languageDocuments + unknownLanguageDocuments;
  return {
    summary: {
      requestedSamples: sampleStats.length,
      completeSamples: completeBatches,
      missingSamples: sampleStats.filter(item => item.status !== "COMPLETE").length,
      validWebDocuments: sampleStats.reduce((sum, item) => sum + (item.validWebDocuments ?? 0), 0),
      documentsWithAllNames: sampleStats.reduce((sum, item) => sum + (item.documentsWithAllNames ?? 0), 0),
      uniqueCandidateNames: all.length,
      candidatesWithAtLeastTwoArticles: all.filter(item => item.documents.size >= 2).length,
      languageMetadata: {
        status: languageDocuments > 0 ? "PARTIAL_OR_AVAILABLE" : "UNAVAILABLE",
        documentsWithLanguage: languageDocuments,
        documentsWithoutLanguage: unknownLanguageDocuments,
        coverage: languageTotal ? Number((languageDocuments / languageTotal).toFixed(4)) : 0,
        note: languageDocuments > 0
          ? "GKG TranslationInfo source-language metadata was present for some WEB documents; this is not a complete language classification."
          : "No usable source-language code was present in the sampled GKG TranslationInfo fields."
      },
      frequencyBuckets: buckets
    },
    sampleStats,
    candidates,
    manualReviewSample: buildReviewSample(allCandidates)
  };
}
