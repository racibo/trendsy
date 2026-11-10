import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_ARCHIVED_EVIDENCE = 25;

function buildEvidenceAudit(item) {
  const seen = new Set();
  const evidence = [];
  for (const record of Array.isArray(item.evidence) ? item.evidence : []) {
    const rawUrl = typeof record?.url === "string" ? record.url : "";
    let parsed;
    try { parsed = new URL(rawUrl); } catch { continue; }
    if (!["http:", "https:"].includes(parsed.protocol) || seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    evidence.push({
      url: parsed.href,
      domain: parsed.hostname.toLowerCase(),
      lang: String(record.lang ?? "unknown").toLowerCase(),
      matchType: record.matchType ?? "unknown",
      aliasMatches: Array.isArray(record.aliasMatches) ? record.aliasMatches.slice(0, 10) : [],
      context: String(record.context ?? "").slice(0, 500),
      sampleHour: record.sampleHour ?? null
    });
    if (evidence.length >= MAX_ARCHIVED_EVIDENCE) break;
  }

  const evidenceDomains = {};
  for (const record of evidence) {
    evidenceDomains[record.domain] = (evidenceDomains[record.domain] ?? 0) + 1;
  }
  const uniqueArticles = Math.max(0, Number(item.uniqueArticles) || 0);
  const qualityFlags = [];
  if (uniqueArticles === 0) qualityFlags.push("no_unique_articles_in_sample");
  else if (uniqueArticles < 10) qualityFlags.push("low_unique_article_volume");
  if ((Number(item.contextFilteredMatchedRecords) || 0) > 0) qualityFlags.push("single_token_context_filtering_used");
  if (evidence.length < uniqueArticles) qualityFlags.push("evidence_is_capped_sample_not_full_article_list");
  if (evidence.length >= MAX_ARCHIVED_EVIDENCE) qualityFlags.push("evidence_sample_cap_reached");

  return {
    evidence,
    evidenceCount: evidence.length,
    evidenceDomains,
    evidenceCoverage: uniqueArticles ? Number((evidence.length / uniqueArticles).toFixed(4)) : 0,
    reviewStatus: "manual_review_required",
    qualityFlags
  };
}

export function createDailyArchive(snapshot) {
  const sampling = snapshot?.sampling;
  if (sampling?.status !== "COMPLETE") {
    throw new Error("Refusing to archive an incomplete Web NGrams sample.");
  }
  if (sampling.sampleHours !== 24 || sampling.successfulSampleHours !== 24) {
    throw new Error("Daily archive requires exactly 24 successful hourly samples.");
  }

  const end = String(sampling.coverageEndUtc ?? "");
  const dateMatch = end.match(/^(\d{4})(\d{2})(\d{2})\d{6}$/);
  if (!dateMatch) throw new Error("Invalid sampling.coverageEndUtc timestamp.");

  const results = Array.isArray(snapshot.results) ? snapshot.results : [];
  if (!results.length) throw new Error("Snapshot contains no candidate results.");
  const auditedResults = results.map(item => ({ item, audit: buildEvidenceAudit(item) }));

  return {
    schemaVersion: 2,
    source: snapshot.source ?? "GDELT Web News NGrams 3.0",
    date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
    generatedAt: snapshot.generatedAt ?? null,
    sampling: {
      status: sampling.status,
      sampleHours: sampling.sampleHours,
      successfulSampleHours: sampling.successfulSampleHours,
      missingSampleHours: sampling.missingSampleHours,
      failedFiles: sampling.failedFiles,
      coverageStartUtc: sampling.coverageStartUtc,
      coverageEndUtc: sampling.coverageEndUtc
    },
    summary: {
      ...(snapshot.summary ?? {}),
      candidatesRequiringManualReview: results.length,
      candidatesWithEvidence: auditedResults.filter(entry => entry.audit.evidenceCount > 0).length,
      totalArchivedEvidenceArticles: auditedResults.reduce((sum, entry) => sum + entry.audit.evidenceCount, 0)
    },
    evidencePolicy: {
      maxArticlesPerCandidate: MAX_ARCHIVED_EVIDENCE,
      selection: "At most one representative article per successful sampled UTC hour; URLs deduplicated.",
      note: "Evidence is a review sample, not the complete list of matching articles or a popularity score."
    },
    results: auditedResults.map(({ item, audit }) => ({
      id: item.id,
      label: item.label,
      category: item.category,
      locale: item.locale,
      matchedRecords: item.matchedRecords ?? 0,
      uniqueArticles: item.uniqueArticles ?? 0,
      multiwordPhraseMatchedRecords: item.multiwordPhraseMatchedRecords ?? 0,
      contextFilteredMatchedRecords: item.contextFilteredMatchedRecords ?? 0,
      languageCounts: item.languageCounts ?? {},
      aliasCounts: item.aliasCounts ?? {},
      matchQuality: item.matchQuality ?? "unreviewed",
      ...audit
    }))
  };
}

async function main() {
  const inputPath = path.resolve("output/webngrams-snapshot.json");
  const snapshot = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const archive = createDailyArchive(snapshot);
  const outputDir = path.resolve("data/history");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `webngrams-${archive.date}.json`);
  await fs.writeFile(outputPath, JSON.stringify(archive, null, 2) + "\n");
  console.log(`Archived ${archive.results.length} candidates to ${outputPath}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
