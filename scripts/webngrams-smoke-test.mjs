import fs from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";
import { matchCandidate } from "./webngrams-matching.mjs";
import { buildHourlyTargets, summarizeHourlyCoverage, getWebNgramsFileTimeoutMs } from "./webngrams-sampling.mjs";

const BASE_URL = "https://data.gdeltproject.org/gdeltv3/webngrams";
const INPUT = new URL("../data/webngrams-candidates.json", import.meta.url);
const OUTPUT_DIR = path.resolve("output");
const SAMPLE_HOURS = Math.min(24, Math.max(1, Number(process.env.WEBNGRAMS_SAMPLE_HOURS ?? 24)));
const REQUEST_GAP_MS = Math.max(0, Number(process.env.WEBNGRAMS_REQUEST_GAP_MS ?? 750));
const MAX_RETRIES = 2;
const FILE_TIMEOUT_MS = getWebNgramsFileTimeoutMs();
const requestedEvidenceLimit = Number(process.env.WEBNGRAMS_EVIDENCE_LIMIT ?? 25);
const EVIDENCE_LIMIT = Number.isFinite(requestedEvidenceLimit)
  ? Math.min(100, Math.max(8, Math.floor(requestedEvidenceLimit)))
  : 25;

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
        signal: AbortSignal.timeout(FILE_TIMEOUT_MS)
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
const hourlyTargets = buildHourlyTargets(scanStartedAt, SAMPLE_HOURS);
const files = [];
let lastRequestAt = 0;

for (const sample of hourlyTargets) {
  let fetched = null;
  let minute = sample.target;
  let filename = "";
  let url = "";

  // GDELT Web NGrams publishes files on quarter-hour slots. Probe one slot per
  // hour, rotating through :01/:16/:31/:46, then try the following minute once.
  for (const candidateMinute of [sample.target, sample.fallback]) {
    minute = candidateMinute;
    filename = `${stamp(minute)}.webngrams.json.gz`;
    url = `${BASE_URL}/${filename}`;
    const wait = REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    process.stdout.write(`Checking ${filename} ... `);

    fetched = await fetchWithRetry(url);
    if (fetched.kind === "missing") {
      files.push({ filename, url, status: "missing", httpStatus: 404, sampleHour: sample.sampleHour });
      console.log("not published (404)");
      continue;
    }
    if (fetched.kind !== "ok") {
      files.push({ filename, url, status: fetched.kind, httpStatus: fetched.status, error: fetched.error, attempts: fetched.attempts, sampleHour: sample.sampleHour });
      console.log(fetched.error ?? `HTTP ${fetched.status}`);
      break;
    }
    console.log("available; processing");
    break;
  }

  if (!fetched || fetched.kind !== "ok") continue;

  // Retry the complete file operation (fresh HTTP response + fresh gzip stream).
  // Every attempt has isolated staged counters; only a fully parsed file is committed.
  let fileCompleted = false;
  let processingAttempts = 0;
  let lastProcessingError = null;

  for (let processingAttempt = 1; processingAttempt <= MAX_RETRIES + 1; processingAttempt++) {
    processingAttempts = processingAttempt;
    const attemptStartedAt = Date.now();
    let processingStage = "stream_setup";
    let records = 0;
    let parseErrors = 0;
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
      if (processingAttempt > 1) {
        await sleep(1500 * (processingAttempt - 1));
        const retryFetch = await fetchWithRetry(url);
        if (retryFetch.kind !== "ok") {
          throw new Error(`Retry fetch failed: ${retryFetch.error ?? `HTTP ${retryFetch.status}`}`);
        }
        fetched = retryFetch;
        console.log(`retrying complete file operation (attempt ${processingAttempt}/${MAX_RETRIES + 1})`);
      }
    processingStage = "gzip_stream";
    const gunzip = createGunzip();
    const streamDone = pipeline(Readable.fromWeb(fetched.response.body), gunzip);
    // Attach a rejection handler immediately; the awaited pipeline is still checked below.
    streamDone.catch(() => {});
    const lines = createInterface({ input: gunzip, crlfDelay: Infinity });

    processingStage = "json_parse_and_match";
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
        if (item.evidence.length < EVIDENCE_LIMIT && !item.evidence.some(entry => entry.url === articleUrl)) {
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

    await streamDone;
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
      sampleHour: sample.sampleHour,
      attempts: fetched.attempts,
      processingAttempts,
      processingElapsedMs: Date.now() - attemptStartedAt
    });
    console.log(`${records.toLocaleString()} records; ${matchedCandidateCount} candidates matched; processing attempt ${processingAttempt}`);
    fileCompleted = true;
    break;
    } catch (error) {
      lastProcessingError = error;
      console.log(`processing attempt ${processingAttempt}/${MAX_RETRIES + 1} failed at ${processingStage} after ${((Date.now() - attemptStartedAt) / 1000).toFixed(1)}s: ${String(error)}`);
      // Abort the response body before starting a fresh request. A retry must never
      // continue from a partially consumed stream.
      try { await fetched.response?.body?.cancel(); } catch {}
      if (processingAttempt === MAX_RETRIES + 1) break;
    }
  }

  if (!fileCompleted) {
    files.push({
      filename,
      url,
      status: "processing_error",
      error: String(lastProcessingError),
      attempts: fetched.attempts,
      processingAttempts,
      sampleHour: sample.sampleHour
    });
    console.log(`processing error after ${processingAttempts} full-file attempts: ${String(lastProcessingError)}`);
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
const coverage = summarizeHourlyCoverage(SAMPLE_HOURS, files);
const successfulHours = {};
for (const file of successful) {
  const hour = String(file.utcHour).padStart(2, "0");
  successfulHours[hour] = (successfulHours[hour] ?? 0) + 1;
}
const snapshot = {
  schemaVersion: 3,
  source: "GDELT Web News NGrams 3.0",
  sourceUrl: BASE_URL,
  generatedAt: new Date().toISOString(),
  sampling: {
    status: coverage.status,
    sampleHours: SAMPLE_HOURS,
    targetSampleHours: SAMPLE_HOURS,
    probedMinutes: files.length,
    successfulFiles: successful.length,
    successfulSampleHours: coverage.successfulSamples,
    missingSampleHours: coverage.missingSamples,
    failedFiles: coverage.failedFiles,
    missingPublicationProbes: coverage.missingPublicationProbes,
    missingMinutes: files.filter(file => file.status === "missing").length,
    failedRequests: files.filter(file => !["ok", "missing"].includes(file.status)).length,
    successfulFilesByUtcHour: successfulHours,
    coverageStartUtc: successful.length ? successful[0].filename.slice(0, 14) : null,
    coverageEndUtc: successful.length ? successful[successful.length - 1].filename.slice(0, 14) : null,
    targetReached: new Set(successful.map(file => file.sampleHour)).size >= SAMPLE_HOURS,
    evidenceLimitPerCandidate: EVIDENCE_LIMIT,
    files,
    note: "Samples one representative GDELT publication slot in each requested UTC hour, rotating across :01, :16, :31 and :46. If that minute is missing, the following minute is tried once. 404 minutes are normal publication gaps. Results from a file are merged only after its entire gzip stream parses successfully."
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

console.log(`\n${coverage.status}: ${coverage.successfulSamples}/${SAMPLE_HOURS} hourly samples using ${successful.length} fully parsed files after ${files.length} file probes.`);
console.log(`Successful-file UTC-hour coverage: ${JSON.stringify(successfulHours)}`);
console.log(`Candidates with at least one unique article: ${snapshot.summary.candidatesWithMatches}/${results.length}.`);
console.log(`Matched records: ${snapshot.summary.totalMultiwordPhraseMatchedRecords} multiword-phrase / ${snapshot.summary.totalContextFilteredMatchedRecords} context-filtered-single-token.`);
console.log("Record counts are not unique article counts. Review evidence and aliases before using any count as a popularity measure.");
