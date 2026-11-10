import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import {
  GKG_FIELD_COUNT,
  parseGkgLine,
  summarizeWebNgramsWindow,
  webNgramsWindowFilenames
} from "./gkg-audit-utils.mjs";

const LAST_UPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const WEBNGRAMS_BASE_URL = "https://data.gdeltproject.org/gdeltv3/webngrams";
const USER_AGENT = "Trendsy-GKG-Join-Audit/0.2 (research prototype)";
const OUTPUT_DIR = path.resolve("output");
const WINDOW_BEFORE_MINUTES = 20;
const WINDOW_AFTER_MINUTES = 5;
const PROBE_CONCURRENCY = 4;

async function fetchResponse(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

async function fetchWebNgrams(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(300_000)
  });
  if (response.status === 404) return { status: "missing", records: 0, urls: new Set(), languages: {} };
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

  const gunzip = createGunzip();
  const stream = Readable.fromWeb(response.body).pipe(gunzip);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const urls = new Set();
  const languages = {};
  let records = 0;
  let parseErrors = 0;

  for await (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); }
    catch { parseErrors++; continue; }
    records++;
    const articleUrl = typeof record.url === "string" ? record.url.trim() : "";
    if (articleUrl) urls.add(articleUrl);
    const lang = String(record.lang ?? "unknown").toLowerCase();
    languages[lang] = (languages[lang] ?? 0) + 1;
  }

  if (parseErrors) throw new Error(`Web NGrams JSON parse errors: ${parseErrors}`);
  return { status: "ok", records, urls, languages };
}

async function probeWebNgramsFile(file) {
  const url = `${WEBNGRAMS_BASE_URL}/${file.filename}`;
  const head = await fetch(url, {
    method: "HEAD",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(45_000)
  });

  if (head.status === 404) {
    return { ...file, status: "missing", records: 0, urls: new Set(), languages: {} };
  }
  // Some static-file frontends do not implement HEAD. In that case, use GET
  // as the authoritative existence check rather than treating it as missing.
  if (!head.ok && ![403, 405, 501].includes(head.status)) {
    throw new Error(`HTTP ${head.status} during HEAD for ${url}`);
  }

  const result = await fetchWebNgrams(url);
  return { ...file, ...result };
}

async function probeWindow(files) {
  const results = [];
  for (let index = 0; index < files.length; index += PROBE_CONCURRENCY) {
    const batch = files.slice(index, index + PROBE_CONCURRENCY);
    results.push(...await Promise.all(batch.map(probeWebNgramsFile)));
  }
  return results;
}

async function readGkgZip(zipPath, summary) {
  const child = spawn("unzip", ["-p", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  const exitPromise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk.slice(0, 4000); });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const urls = [];
  const fieldCounts = {};
  const languages = {};
  const domains = {};
  const topNames = new Map();
  const topThemes = new Map();
  let records = 0;
  let validRecords = 0;
  let webRecords = 0;
  let recordsWithAllNames = 0;
  let recordsWithThemes = 0;
  let recordsWithTranslationInfo = 0;
  let recordsWithoutUrl = 0;

  for await (const line of lines) {
    if (!line.trim()) continue;
    records++;
    const parsed = parseGkgLine(line);
    fieldCounts[parsed.fieldCount] = (fieldCounts[parsed.fieldCount] ?? 0) + 1;
    if (!parsed.valid) continue;
    validRecords++;
    if (parsed.sourceCollectionId === "1") {
      webRecords++;
      if (parsed.url) urls.push(parsed.url);
      else recordsWithoutUrl++;
    }
    if (parsed.allNames.length) recordsWithAllNames++;
    if (parsed.themes.length) recordsWithThemes++;
    if (parsed.sourceLanguage) {
      recordsWithTranslationInfo++;
      languages[parsed.sourceLanguage] = (languages[parsed.sourceLanguage] ?? 0) + 1;
    }
    const domain = String(parsed.sourceCommonName ?? "").toLowerCase();
    if (domain) domains[domain] = (domains[domain] ?? 0) + 1;
    for (const name of new Set(parsed.allNames)) {
      topNames.set(name, (topNames.get(name) ?? 0) + 1);
    }
    for (const theme of new Set(parsed.themes)) {
      topThemes.set(theme, (topThemes.get(theme) ?? 0) + 1);
    }
  }

  const exitCode = await exitPromise;
  if (exitCode !== 0) throw new Error(`unzip exited with ${exitCode}: ${stderr}`);

  const top = map => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 30)
    .map(([name, documents]) => ({ name, documents }));

  return {
    records,
    validRecords,
    fieldCounts,
    webRecords,
    recordsWithoutUrl,
    recordsWithAllNames,
    recordsWithThemes,
    recordsWithTranslationInfo,
    urls,
    languages,
    domains,
    topNames: top(topNames),
    topThemes: top(topThemes)
  };
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trendsy-gkg-probe-"));
  const startedAt = new Date().toISOString();

  try {
    const lastUpdate = await (await fetchResponse(LAST_UPDATE_URL)).text();
    const gkgLine = lastUpdate.split(/\r?\n/).find(line => line.includes(".gkg.csv.zip"));
    if (!gkgLine) throw new Error("GDELT lastupdate.txt did not contain a GKG archive.");
    const gkgParts = gkgLine.trim().split(/\s+/);
    const gkgUrl = gkgParts.at(-1).replace(/^http:/i, "https:");
    const gkgFilename = new URL(gkgUrl).pathname.split("/").at(-1);
    const zipPath = path.join(tempDir, gkgFilename);

    console.log(`Downloading latest GKG batch: ${gkgFilename}`);
    const gkgResponse = await fetchResponse(gkgUrl);
    const zipBytes = Buffer.from(await gkgResponse.arrayBuffer());
    await fs.writeFile(zipPath, zipBytes);

    const gkg = await readGkgZip(zipPath);
    const candidateFiles = webNgramsWindowFilenames(
      gkgFilename,
      WINDOW_BEFORE_MINUTES,
      WINDOW_AFTER_MINUTES
    );
    console.log(
      `Probing ${candidateFiles.length} Web NGrams minute files ` +
      `(${-WINDOW_BEFORE_MINUTES} to +${WINDOW_AFTER_MINUTES} minutes around GKG timestamp)`
    );
    const fileResults = await probeWindow(candidateFiles);
    const windowSummary = summarizeWebNgramsWindow(gkg.urls, fileResults);
    const aggregate = windowSummary.aggregate;
    const hasNgrams = windowSummary.availableFileCount > 0;

    const output = {
      schemaVersion: 2,
      status: hasNgrams ? "COMPLETE" : "PARTIAL",
      source: "GDELT GKG 2.1 + Web NGrams 3.0",
      startedAt,
      completedAt: new Date().toISOString(),
      searchWindowMinutes: {
        before: WINDOW_BEFORE_MINUTES,
        after: WINDOW_AFTER_MINUTES
      },
      gkg: {
        filename: gkgFilename,
        url: gkgUrl,
        compressedBytes: zipBytes.length,
        recordCount: gkg.records,
        validRecordCount: gkg.validRecords,
        expectedFieldCount: GKG_FIELD_COUNT,
        observedFieldCounts: gkg.fieldCounts,
        webSourceRecords: gkg.webRecords,
        webRecordsWithoutUrl: gkg.recordsWithoutUrl,
        recordsWithAllNames: gkg.recordsWithAllNames,
        recordsWithThemes: gkg.recordsWithThemes,
        recordsWithTranslationInfo: gkg.recordsWithTranslationInfo,
        originalLanguageCounts: gkg.languages,
        sourceDomainCounts: gkg.domains,
        topNamesByDocumentCount: gkg.topNames,
        topThemesByDocumentCount: gkg.topThemes
      },
      webNgrams: {
        status: hasNgrams ? "ok" : "missing",
        probedFileCount: windowSummary.probedFileCount,
        availableFileCount: windowSummary.availableFileCount,
        missingFileCount: windowSummary.missingFileCount,
        files: windowSummary.files,
        recordCount: fileResults.reduce((sum, file) => sum + (file.records ?? 0), 0),
        uniqueUrlCount: aggregate.webNgramUniqueUrls,
        languageRecordCounts: fileResults.reduce((counts, file) => {
          for (const [language, count] of Object.entries(file.languages ?? {})) {
            counts[language] = (counts[language] ?? 0) + count;
          }
          return counts;
        }, {})
      },
      urlJoin: aggregate,
      notes: [
        "The scan checks every minute filename in a bounded window around the GKG archive timestamp; it does not assume a fixed +1/+2 minute offset.",
        "Missing minute files (HTTP 404) are expected between Web NGrams publication bursts and are reported separately from request or parsing failures.",
        "Per-file URL joins and the deduplicated union across all available files are both reported.",
        "The union can include URLs repeated across minute files; duplicate occurrences are reported and URLs are deduplicated before calculating the aggregate join rate.",
        "This is a diagnostic time window, not proof that all files correspond to the same GKG publication batch or a representative multi-day coverage estimate.",
        "Exact URL matching and conservative URL normalization are reported separately.",
        "URL normalization removes fragments and normalizes URL host/default-port formatting only; query parameters are retained.",
        "GKG entity/theme occurrence counts are discovery signals, not validated topic relevance or popularity scores.",
        "Source domains are not publisher-country metadata."
      ]
    };
    const outputPath = path.join(OUTPUT_DIR, "gkg-join-probe.json");
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n");
    console.log(JSON.stringify({
      status: output.status,
      gkgFilename,
      gkgRecords: gkg.records,
      validGkgRecords: gkg.validRecords,
      probedNgramFiles: windowSummary.probedFileCount,
      availableNgramFiles: windowSummary.availableFileCount,
      missingNgramFiles: windowSummary.missingFileCount,
      gkgUniqueUrls: aggregate.gkgUniqueUrls,
      webNgramUniqueUrls: aggregate.webNgramUniqueUrls,
      exactMatches: aggregate.exactMatches,
      normalizedMatches: aggregate.normalizedMatches,
      matchRate: aggregate.gkgToWebNgramMatchRate,
      outputPath
    }, null, 2));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
