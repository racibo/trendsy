import fs from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { matchCandidate } from "./webngrams-matching.mjs";

const BASE_URL = "https://data.gdeltproject.org/gdeltv3/webngrams";
const INPUT = new URL("../data/webngrams-candidates.json", import.meta.url);
const OUTPUT_DIR = path.resolve("output");
const LOOKBACK_MINUTES = Math.min(1440, Math.max(1, Number(process.env.WEBNGRAMS_LOOKBACK_MINUTES ?? 1440)));
const TARGET_FILES = Math.min(30, Math.max(1, Number(process.env.WEBNGRAMS_TARGET_FILES ?? 30)));
const REQUEST_GAP_MS = Math.max(0, Number(process.env.WEBNGRAMS_REQUEST_GAP_MS ?? 750));
const MAX_RETRIES = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stamp(date) {
  return date.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "");
}
function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function languageAllowed(candidate, lang) {
  return !candidate.languages?.length || candidate.languages.includes(String(lang ?? "").toLowerCase());
}
async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Trendsy-WebNgrams-PoC/0.3 (research prototype)" },
        signal: AbortSignal.timeout(30000)
      });
      if (response.status === 404) return { kind: "missing", status: 404 };
      if (response.ok) return { kind: "ok", response, attempts: attempt + 1 };
      if (![429, 500, 502, 503, 504].includes(response.status)) {
        return { kind: "http_error", status: response.status, attempts: attempt + 1 };
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  return { kind: "error", error: String(lastError), attempts: MAX_RETRIES + 1 };
}

const source = JSON.parse(await fs.readFile(INPUT, "utf8"));
const candidates = source.candidates;
const stats = new Map(candidates.map(candidate => [candidate.id, {
  id: candidate.id,
  label: candidate.label,
  category: candidate.category,
  locale: candidate.locale,
  aliases: candidate.aliases,
  matchedRecords: 0,
  uniqueArticleUrls: new Set(),
  languageCounts: {},
  aliasCounts: {},
  contextFilteredMatchedRecords: 0,
  multiwordPhraseMatchedRecords: 0,
  evidence: []
}]));

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const scanStartedAt = new Date();
scanStartedAt.setUTCSeconds(0, 0);
const files = [];
let lastRequestAt = 0;

for (let offset = LOOKBACK_MINUTES; offset >= 1; offset--) {
  const minute = new Date(scanStartedAt.getTime() - offset * 60_000);
  const filename = `${stamp(minute)}.webngrams.json.gz`;
  const url = `${BASE_URL}/${filename}`;
  const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  process.stdout.write(`Checking ${filename} ... `);

  const fetched = await fetchWithRetry(url);
  if (fetched.kind === "missing") {
    files.push({ filename, url, status: "missing", httpStatus: 404 });
    console.log("not published (404)");
    continue;
  }
  if (fetched.kind !== "ok") {
    files.push({ filename, url, status: fetched.kind, httpStatus: fetched.status, error: fetched.error, attempts: fetched.attempts });
    console.log(fetched.error ?? `HTTP ${fetched.status}`);
    continue;
  }

  // Stage every candidate result locally. Nothing is merged into the snapshot until
  // the complete gzip stream has been read and every non-empty line parsed.
  const staged = new Map(candidates.map(candidate => [candidate.id, {
    matchedRecords: 0,
    articleUrls: new Set(),
    languageCounts: {},
    aliasCounts: {},
    contextFilteredMatchedRecords: 0,
    multiwordPhraseMatchedRecords: 0,
    evidence: []
  }]));

  try {
    let records = 0;
    let parseErrors = 0;
    const gunzip = createGunzip();
    Readable.fromWeb(fetched.response.body).pipe(gunzip);
    const lines = createInterface({ input: gunzip, crlfDelay: Infinity });

    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); }
      catch { parseErrors++; continue; }
      records++;
      const articleUrl = typeof record.url === "string" ? record.url : "";
      if (!articleUrl) continue;

      for (const candidate of candidates) {
        if (!languageAllowed(candidate, record.lang)) continue;
        const match = matchCandidate(candidate, record);
        if (!match) continue;

        const item = staged.get(candidate.id);
        item.matchedRecords++;
        item.articleUrls.add(articleUrl);
        const lang = String(record.lang ?? "unknown").toLowerCase();
        item.languageCounts[lang] = (item.languageCounts[lang] ?? 0) + 1;
        for (const alias of match.matchedAliases) {
          item.aliasCounts[alias] = (item.aliasCounts[alias] ?? 0) + 1;
        }
        if (match.matchType === "context_filtered_single_token") item.contextFilteredMatchedRecords++;
        else item.multiwordPhraseMatchedRecords++;
        if (item.evidence.length < 8 && !item.evidence.some(entry => entry.url === articleUrl)) {
          item.evidence.push({
            aliasMatches: match.matchedAliases,
            matchType: match.matchType,
            lang,
            context: match.context,
            url: articleUrl
          });
        }
      }
    }

    if (parseErrors > 0) {
      throw new Error(`Rejected file: ${parseErrors} malformed JSON lines; no partial results were merged.`);
    }

    let matchedCandidateCount = 0;
    let uniqueCandidateArticleMatches = 0;
    for (const candidate of candidates) {
      const delta = staged.get(candidate.id);
      const total = stats.get(candidate.id);
      if (delta.matchedRecords) matchedCandidateCount++;
      uniqueCandidateArticleMatches += delta.articleUrls.size;
      total.matchedRecords += delta.matchedRecords;
      for (const articleUrl of delta.articleUrls) total.uniqueArticleUrls.add(articleUrl);
      for (const [lang, count] of Object.entries(delta.languageCounts)) {
        total.languageCounts[lang] = (total.languageCounts[lang] ?? 0) + count;
      }
      for (const [alias, count] of Object.entries(delta.aliasCounts)) {
        total.aliasCounts[alias] = (total.aliasCounts[alias] ?? 0) + count;
      }
      total.contextFilteredMatchedRecords += delta.contextFilteredMatchedRecords;
      total.multiwordPhraseMatchedRecords += delta.multiwordPhraseMatchedRecords;
      for (const evidence of delta.evidence) {
        if (total.evidence.length < 8 && !total.evidence.some(entry => entry.url === evidence.url)) {
          total.evidence.push(evidence);
        }
      }
    }

    files.push({
      filename,
      url,
      status: "ok",
      records,
      parseErrors,
      matchedCandidateCount,
      uniqueCandidateArticleMatches,
      utcHour: minute.getUTCHours(),
      attempts: fetched.attempts
    });
    console.log(`${records.toLocaleString()} records; ${matchedCandidateCount} candidates matched`);
  } catch (error) {
    files.push({ filename, url, status: "processing_error", error: String(error), attempts: fetched.attempts });
    console.log(`processing error: ${String(error)}`);
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
    singleTokenPolicy: candidate.singleTokenPolicy ?? null,
    matchedRecords: item.matchedRecords,
    uniqueArticles: item.uniqueArticleUrls.size,
    languageCounts: item.languageCounts,
    aliasCounts: item.aliasCounts,
    contextFilteredMatchedRecords: item.contextFilteredMatchedRecords,
    multiwordPhraseMatchedRecords: item.multiwordPhraseMatchedRecords,
    matchQuality: candidate.singleTokenPolicy ? "context_filtered_candidate_review_required" : "multiword_phrase_candidate_review_required",
    evidence: item.evidence
  };
});

const successful = files.filter(file => file.status === "ok");
const successfulHours = {};
for (const file of successful) {
  const hour = String(file.utcHour).padStart(2, "0");
  successfulHours[hour] = (successfulHours[hour] ?? 0) + 1;
}
const successfulMinutes = successful.map(file => Number(file.filename.slice(0, 12)));
const snapshot = {
  schemaVersion: 3,
  source: "GDELT Web News NGrams 3.0",
  sourceUrl: BASE_URL,
  generatedAt: new Date().toISOString(),
  sampling: {
    lookbackMinutes: LOOKBACK_MINUTES,
    targetSuccessfulFiles: TARGET_FILES,
    probedMinutes: files.length,
    successfulFiles: successful.length,
    missingMinutes: files.filter(file => file.status === "missing").length,
    failedRequests: files.filter(file => !["ok", "missing"].includes(file.status)).length,
    successfulFilesByUtcHour: successfulHours,
    coverageStartUtc: successful.length ? successful[0].filename.slice(0, 14) : null,
    coverageEndUtc: successful.length ? successful[successful.length - 1].filename.slice(0, 14) : null,
    targetReached: successful.length >= TARGET_FILES,
    files,
    note: "Scans backwards across the full requested lookback window; targetSuccessfulFiles is a minimum coverage goal, not an early-stop condition. 404 minutes are normal publication gaps. Results from a file are merged only after its entire gzip stream parses successfully."
  },
  summary: {
    totalCandidates: results.length,
    candidatesWithMatches: results.filter(item => item.uniqueArticles > 0).length,
    totalUniqueCandidateArticleMatches: results.reduce((sum, item) => sum + item.uniqueArticles, 0),
    totalContextFilteredMatchedRecords: results.reduce((sum, item) => sum + item.contextFilteredMatchedRecords, 0),
    totalMultiwordPhraseMatchedRecords: results.reduce((sum, item) => sum + item.multiwordPhraseMatchedRecords, 0)
  },
  results
};

await fs.writeFile(path.join(OUTPUT_DIR, "webngrams-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
const csv = [
  "id,label,category,locale,matched_records,unique_articles,multiword_phrase_records,context_filtered_records,match_quality,aliases",
  ...results.map(item => [
    item.id, item.label, item.category, item.locale, item.matchedRecords, item.uniqueArticles,
    item.multiwordPhraseMatchedRecords, item.contextFilteredMatchedRecords, item.matchQuality, item.aliases.join("|")
  ].map(csvCell).join(","))
].join("\n") + "\n";
await fs.writeFile(path.join(OUTPUT_DIR, "webngrams-snapshot.csv"), csv);

console.log(`\nCompleted: ${successful.length} fully parsed files (minimum target ${TARGET_FILES}) after probing ${files.length}/${LOOKBACK_MINUTES} minutes.`);
console.log(`Successful-file UTC-hour coverage: ${JSON.stringify(successfulHours)}`);
console.log(`Candidates with at least one unique article: ${snapshot.summary.candidatesWithMatches}/${results.length}.`);
console.log(`Matched records: ${snapshot.summary.totalMultiwordPhraseMatchedRecords} multiword-phrase / ${snapshot.summary.totalContextFilteredMatchedRecords} context-filtered-single-token.`);
console.log("Record counts are not unique article counts. Review evidence and aliases before using any count as a popularity measure.");
