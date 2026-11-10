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
  summarizeUrlJoin,
  nextWebNgramsFilename
} from "./gkg-audit-utils.mjs";

const LAST_UPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const WEBNGRAMS_BASE_URL = "https://data.gdeltproject.org/gdeltv3/webngrams";
const USER_AGENT = "Trendsy-GKG-Join-Audit/0.1 (research prototype)";
const OUTPUT_DIR = path.resolve("output");

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
    const gkgLine = lastUpdate.split(/\\r?\\n/).find(line => line.includes(".gkg.csv.zip"));
    if (!gkgLine) throw new Error("GDELT lastupdate.txt did not contain a GKG archive.");
    const gkgParts = gkgLine.trim().split(/\\s+/);
    const gkgUrl = gkgParts.at(-1);
    const gkgFilename = new URL(gkgUrl).pathname.split("/").at(-1);
    const zipPath = path.join(tempDir, gkgFilename);

    console.log(`Downloading latest GKG batch: ${gkgFilename}`);
    const gkgResponse = await fetchResponse(gkgUrl);
    const zipBytes = Buffer.from(await gkgResponse.arrayBuffer());
    await fs.writeFile(zipPath, zipBytes);

    const gkg = await readGkgZip(zipPath);
    const ngramFilename = nextWebNgramsFilename(gkgFilename, 1);
    const ngramUrl = `${WEBNGRAMS_BASE_URL}/${ngramFilename}`;
    console.log(`Checking corresponding Web NGrams batch: ${ngramFilename}`);
    let ngrams = await fetchWebNgrams(ngramUrl);
    let actualNgramUrl = ngramUrl;
    if (ngrams.status === "missing") {
      const fallbackFilename = nextWebNgramsFilename(gkgFilename, 2);
      actualNgramUrl = `${WEBNGRAMS_BASE_URL}/${fallbackFilename}`;
      console.log(`First Web NGrams minute not published; trying ${fallbackFilename}`);
      ngrams = await fetchWebNgrams(actualNgramUrl);
    }

    const join = summarizeUrlJoin(gkg.urls, [...ngrams.urls]);
    const output = {
      schemaVersion: 1,
      status: ngrams.status === "ok" ? "COMPLETE" : "PARTIAL",
      source: "GDELT GKG 2.1 + Web NGrams 3.0",
      startedAt,
      completedAt: new Date().toISOString(),
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
        status: ngrams.status,
        filename: ngrams.status === "ok" ? new URL(actualNgramUrl).pathname.split("/").at(-1) : null,
        url: ngrams.status === "ok" ? actualNgramUrl : null,
        recordCount: ngrams.records,
        uniqueUrlCount: ngrams.urls.size,
        languageRecordCounts: ngrams.languages
      },
      urlJoin: join,
      notes: [
        "This is one matched publication batch, not a representative multi-day coverage estimate.",
        "Exact URL matching and conservative URL normalization are reported separately.",
        "URL normalization removes fragments and normalizes URL host/default-port formatting only; query parameters are retained.",
        "GKG entity/theme occurrence counts are discovery signals, not validated topic relevance or popularity scores.",
        "Source domains are not publisher-country metadata."
      ]
    };
    const outputPath = path.join(OUTPUT_DIR, "gkg-join-probe.json");
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\\n");
    console.log(JSON.stringify({
      status: output.status,
      gkgRecords: gkg.records,
      validGkgRecords: gkg.validRecords,
      fieldCounts: gkg.fieldCounts,
      webNgramsStatus: ngrams.status,
      gkgUniqueUrls: join.gkgUniqueUrls,
      webNgramUniqueUrls: join.webNgramUniqueUrls,
      exactMatches: join.exactMatches,
      normalizedMatches: join.normalizedMatches,
      matchRate: join.gkgToWebNgramMatchRate,
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
