import fs from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

const BASE_URL = "https://data.gdeltproject.org/gdeltv3/webngrams";
const INPUT = new URL("../data/webngrams-candidates.json", import.meta.url);
const OUTPUT_DIR = path.resolve("output");
const SAMPLE_MINUTES = Math.min(10, Math.max(1, Number(process.env.WEBNGRAMS_SAMPLE_MINUTES ?? 3)));

function stamp(date) {
  return date.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "");
}
function previousMinute(offset) {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() - offset);
  return d;
}
function cleanToken(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}
function tokens(value) {
  return String(value ?? "").split(/\s+/u).map(cleanToken).filter(Boolean);
}
function containsSequence(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}
function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function languageAllowed(candidate, lang) {
  return !candidate.languages?.length || candidate.languages.includes(String(lang ?? "").toLowerCase());
}

const source = JSON.parse(await fs.readFile(INPUT, "utf8"));
const candidates = source.candidates.map(candidate => ({
  ...candidate,
  aliasTokens: candidate.aliases.map(alias => tokens(alias)).filter(alias => alias.length)
}));
const stats = new Map(candidates.map(candidate => [candidate.id, {
  id: candidate.id,
  label: candidate.label,
  category: candidate.category,
  locale: candidate.locale,
  aliases: candidate.aliases,
  matchedRecords: 0,
  uniqueArticleUrls: new Set(),
  languageCounts: {},
  sampleUrls: []
}]));
const files = [];

await fs.mkdir(OUTPUT_DIR, { recursive: true });

for (let offset = SAMPLE_MINUTES; offset >= 1; offset--) {
  const timestamp = stamp(previousMinute(offset));
  const filename = `${timestamp}.webngrams.json.gz`;
  const url = `${BASE_URL}/${filename}`;
  process.stdout.write(`Fetching ${filename} ... `);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Trendsy-WebNgrams-PoC/0.1 (research prototype)" }
    });
    if (!response.ok) {
      files.push({ filename, url, status: "http_error", httpStatus: response.status });
      console.log(`HTTP ${response.status}`);
      continue;
    }

    let records = 0;
    let parseErrors = 0;
    const gunzip = createGunzip();
    Readable.fromWeb(response.body).pipe(gunzip);
    const lines = createInterface({ input: gunzip, crlfDelay: Infinity });

    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        parseErrors++;
        continue;
      }
      records++;
      const urlValue = typeof record.url === "string" ? record.url : "";
      if (!urlValue) continue;
      const context = [...tokens(record.pre), ...tokens(record.ngram), ...tokens(record.post)];
      if (!context.length) continue;

      for (const candidate of candidates) {
        if (!languageAllowed(candidate, record.lang)) continue;
        if (!candidate.aliasTokens.some(alias => containsSequence(context, alias))) continue;
        const item = stats.get(candidate.id);
        item.matchedRecords++;
        item.uniqueArticleUrls.add(urlValue);
        const lang = String(record.lang ?? "unknown").toLowerCase();
        item.languageCounts[lang] = (item.languageCounts[lang] ?? 0) + 1;
        if (item.sampleUrls.length < 5 && !item.sampleUrls.includes(urlValue)) item.sampleUrls.push(urlValue);
      }
    }

    files.push({ filename, url, status: "ok", records, parseErrors });
    console.log(`${records.toLocaleString()} records; ${parseErrors} malformed lines`);
  } catch (error) {
    files.push({ filename, url, status: "error", error: String(error) });
    console.log(String(error));
  }
}

const results = candidates.map(candidate => {
  const item = stats.get(candidate.id);
  return {
    id: item.id,
    label: item.label,
    category: item.category,
    locale: item.locale,
    aliases: item.aliases,
    matchedRecords: item.matchedRecords,
    uniqueArticles: item.uniqueArticleUrls.size,
    languageCounts: item.languageCounts,
    sampleUrls: item.sampleUrls
  };
});
const successfulFiles = files.filter(file => file.status === "ok").length;
const snapshot = {
  schemaVersion: 1,
  source: "GDELT Web News NGrams 3.0",
  sourceUrl: BASE_URL,
  generatedAt: new Date().toISOString(),
  sampling: {
    requestedFiles: SAMPLE_MINUTES,
    successfulFiles,
    files,
    note: "This is a short sample of minute-level files, not a daily popularity measurement. Unique article URLs are deduplicated across the sampled files only."
  },
  summary: {
    totalCandidates: results.length,
    candidatesWithMatches: results.filter(item => item.uniqueArticles > 0).length,
    totalUniqueCandidateArticleMatches: results.reduce((sum, item) => sum + item.uniqueArticles, 0)
  },
  results
};

await fs.writeFile(path.join(OUTPUT_DIR, "webngrams-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
const csv = [
  "id,label,category,locale,aliases,matched_records,unique_articles,languages",
  ...results.map(item => [
    item.id, item.label, item.category, item.locale, item.aliases.join("|"),
    item.matchedRecords, item.uniqueArticles, Object.keys(item.languageCounts).join("|")
  ].map(csvCell).join(","))
].join("\n") + "\n";
await fs.writeFile(path.join(OUTPUT_DIR, "webngrams-snapshot.csv"), csv);

console.log(`\nCompleted: ${successfulFiles}/${SAMPLE_MINUTES} minute files downloaded.`);
console.log(`Candidates with at least one match: ${snapshot.summary.candidatesWithMatches}/${results.length}.`);
console.log("Counts are exploratory only: context matching, aliases and homonyms require manual review.");
