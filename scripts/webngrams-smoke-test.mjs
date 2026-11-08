import fs from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

const BASE_URL = "https://data.gdeltproject.org/gdeltv3/webngrams";
const INPUT = new URL("../data/webngrams-candidates.json", import.meta.url);
const OUTPUT_DIR = path.resolve("output");
const LOOKBACK_MINUTES = Math.min(180, Math.max(1, Number(process.env.WEBNGRAMS_LOOKBACK_MINUTES ?? 60)));
const TARGET_FILES = Math.min(20, Math.max(1, Number(process.env.WEBNGRAMS_TARGET_FILES ?? 5)));
const REQUEST_GAP_MS = Math.max(0, Number(process.env.WEBNGRAMS_REQUEST_GAP_MS ?? 750));
const MAX_RETRIES = 2;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stamp(date) {
  return date.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "");
}
function cleanToken(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase()
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
async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt) await sleep(1500 * attempt);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Trendsy-WebNgrams-PoC/0.2 (research prototype)" },
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
const candidates = source.candidates.map(candidate => ({
  ...candidate,
  aliasTokens: candidate.aliases.map(alias => ({ alias, tokens: tokens(alias) })).filter(item => item.tokens.length)
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
  aliasCounts: {},
  ambiguousMatchedRecords: 0,
  precisePhraseMatchedRecords: 0,
  evidence: []
}]));

await fs.mkdir(OUTPUT_DIR, { recursive: true });
const scanStartedAt = new Date();
scanStartedAt.setUTCSeconds(0, 0);
const files = [];
let lastRequestAt = 0;

for (let offset = LOOKBACK_MINUTES; offset >= 1 && files.filter(file => file.status === "ok").length < TARGET_FILES; offset--) {
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
      const contextTokens = [...tokens(record.pre), ...tokens(record.ngram), ...tokens(record.post)];
      if (!contextTokens.length) continue;

      for (const candidate of candidates) {
        if (!languageAllowed(candidate, record.lang)) continue;
        const matchedAliases = candidate.aliasTokens.filter(item => containsSequence(contextTokens, item.tokens));
        if (!matchedAliases.length) continue;
        const item = stats.get(candidate.id);
        item.matchedRecords++;
        item.uniqueArticleUrls.add(articleUrl);
        const lang = String(record.lang ?? "unknown").toLowerCase();
        item.languageCounts[lang] = (item.languageCounts[lang] ?? 0) + 1;
        for (const match of matchedAliases) {
          item.aliasCounts[match.alias] = (item.aliasCounts[match.alias] ?? 0) + 1;
        }
        const ambiguous = matchedAliases.some(match => match.tokens.length === 1);
        if (ambiguous) item.ambiguousMatchedRecords++;
        else item.precisePhraseMatchedRecords++;
        if (item.evidence.length < 8 && !item.evidence.some(entry => entry.url === articleUrl)) {
          item.evidence.push({
            aliasMatches: matchedAliases.map(match => match.alias),
            matchType: ambiguous ? "ambiguous_single_token" : "multiword_phrase",
            lang,
            context: [record.pre, record.ngram, record.post].filter(Boolean).join(" "),
            url: articleUrl
          });
        }
      }
    }
    files.push({ filename, url, status: "ok", records, parseErrors, attempts: fetched.attempts });
    console.log(`${records.toLocaleString()} records; ${parseErrors} malformed lines`);
  } catch (error) {
    files.push({ filename, url, status: "processing_error", error: String(error) });
    console.log(`processing error: ${String(error)}`);
  }
}

const results = candidates.map(candidate => {
  const item = stats.get(candidate.id);
  const uniqueArticles = item.uniqueArticleUrls.size;
  const ambiguousAliasList = candidate.aliasTokens.filter(alias => alias.tokens.length === 1).map(alias => alias.alias);
  return {
    id: item.id,
    label: item.label,
    category: item.category,
    locale: item.locale,
    aliases: item.aliases,
    matchedRecords: item.matchedRecords,
    uniqueArticles,
    languageCounts: item.languageCounts,
    aliasCounts: item.aliasCounts,
    ambiguousMatchedRecords: item.ambiguousMatchedRecords,
    precisePhraseMatchedRecords: item.precisePhraseMatchedRecords,
    ambiguousAliasesConfigured: ambiguousAliasList,
    matchQuality: ambiguousAliasList.length ? "review_required_ambiguous_aliases" : "multiword_phrase_candidate",
    evidence: item.evidence
  };
});
const successfulFiles = files.filter(file => file.status === "ok").length;
const snapshot = {
  schemaVersion: 2,
  source: "GDELT Web News NGrams 3.0",
  sourceUrl: BASE_URL,
  generatedAt: new Date().toISOString(),
  sampling: {
    lookbackMinutes: LOOKBACK_MINUTES,
    targetSuccessfulFiles: TARGET_FILES,
    probedMinutes: files.length,
    successfulFiles,
    missingMinutes: files.filter(file => file.status === "missing").length,
    failedRequests: files.filter(file => !["ok", "missing"].includes(file.status)).length,
    files,
    note: "Scans backwards from the last completed UTC minute and stops after the target number of successful files or the lookback limit. Missing 404 minutes are normal and are not treated as transport failures."
  },
  summary: {
    totalCandidates: results.length,
    candidatesWithMatches: results.filter(item => item.uniqueArticles > 0).length,
    totalUniqueCandidateArticleMatches: results.reduce((sum, item) => sum + item.uniqueArticles, 0),
    totalAmbiguousMatchedRecords: results.reduce((sum, item) => sum + item.ambiguousMatchedRecords, 0),
    totalMultiwordPhraseMatchedRecords: results.reduce((sum, item) => sum + item.precisePhraseMatchedRecords, 0)
  },
  results
};

await fs.writeFile(path.join(OUTPUT_DIR, "webngrams-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");
const csv = [
  "id,label,category,locale,matched_records,unique_articles,multiword_phrase_records,ambiguous_records,match_quality,aliases",
  ...results.map(item => [
    item.id, item.label, item.category, item.locale, item.matchedRecords, item.uniqueArticles,
    item.precisePhraseMatchedRecords, item.ambiguousMatchedRecords, item.matchQuality, item.aliases.join("|")
  ].map(csvCell).join(","))
].join("\n") + "\n";
await fs.writeFile(path.join(OUTPUT_DIR, "webngrams-snapshot.csv"), csv);

console.log(`\nCompleted: ${successfulFiles}/${TARGET_FILES} target files downloaded after probing ${files.length}/${LOOKBACK_MINUTES} minutes.`);
console.log(`Candidates with at least one match: ${snapshot.summary.candidatesWithMatches}/${results.length}.`);
console.log(`Matched records: ${snapshot.summary.totalMultiwordPhraseMatchedRecords} multiword-phrase / ${snapshot.summary.totalAmbiguousMatchedRecords} ambiguous-single-token.`);
console.log("Phrase matches are higher-precision candidates, not verified entity resolution. Review evidence and aliases before using counts.");
