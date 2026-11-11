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
  return { name, offset: /^\d+$/.test(rawOffset) ? Number(rawOffset) : null };
}

export function createCandidateAccumulator() {
  return new Map();
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
    if (!key || key.length < 2 || !/[\p{L}]/u.test(key)) continue;
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
        languages: {},
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
    const language = row.sourceLanguage ?? "unknown";
    candidate.languages[language] = (candidate.languages[language] ?? 0) + 1;
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

function topEntries(counts, limit = 8) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

export function summarizeCandidateDiscovery(accumulator, sampleStats, limit = 200) {
  const all = [...accumulator.values()];
  const candidates = all
    .filter(item => item.documents.size >= 2)
    .sort((a, b) => b.documents.size - a.documents.size || b.domains.size - a.domains.size || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(item => {
      const variants = [...item.nameVariants.entries()].sort((a, b) => b[1] - a[1]);
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
        languages: topEntries(item.languages, 12),
        themes: topEntries(item.themes, 12),
        evidence: item.evidence
      };
    });

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

  return {
    summary: {
      requestedSamples: sampleStats.length,
      completeSamples: sampleStats.filter(item => item.status === "COMPLETE").length,
      missingSamples: sampleStats.filter(item => item.status !== "COMPLETE").length,
      validWebDocuments: sampleStats.reduce((sum, item) => sum + (item.validWebDocuments ?? 0), 0),
      documentsWithAllNames: sampleStats.reduce((sum, item) => sum + (item.documentsWithAllNames ?? 0), 0),
      uniqueCandidateNames: all.length,
      candidatesWithAtLeastTwoArticles: all.filter(item => item.documents.size >= 2).length,
      frequencyBuckets: buckets
    },
    sampleStats,
    candidates
  };
}
