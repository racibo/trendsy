import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  return {
    schemaVersion: 1,
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
    summary: snapshot.summary ?? {},
    results: results.map(item => ({
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
      matchQuality: item.matchQuality ?? "unreviewed"
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
