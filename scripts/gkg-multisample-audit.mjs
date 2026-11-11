import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { parseGkgLine, summarizeUrlJoin, webNgramsWindowFilenames } from "./gkg-audit-utils.mjs";
import { gkgSampleFilenames, summarizeMultiSample, summarizeDailyHistory, renderDailyHistoryMarkdown } from "./gkg-multisample-utils.mjs";

const LAST_UPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const GKG_BASE = "https://data.gdeltproject.org/gdeltv2";
const NGRAM_BASE = "https://data.gdeltproject.org/gdeltv3/webngrams";
const USER_AGENT = "Trendsy-GKG-Multisample-Audit/1.0 (research prototype)";
const SAMPLE_COUNT = Number(process.env.GKG_SAMPLE_COUNT ?? 10);
const SPACING_MINUTES = Number(process.env.GKG_SAMPLE_SPACING_MINUTES ?? 150);
const BEFORE_MINUTES = 20;
const AFTER_MINUTES = 5;
const CONCURRENCY = 4;

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { "User-Agent": USER_AGENT, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(options.timeout ?? 300_000)
  });
}

async function readGkg(zipPath) {
  const child = spawn("unzip", ["-p", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk.slice(0, 3000); });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const urls = new Set();
  const domains = new Set();
  let records = 0, validRecords = 0, webRecords = 0, recordsWithNames = 0, recordsWithThemes = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    records++;
    const row = parseGkgLine(line);
    if (!row.valid) continue;
    validRecords++;
    if (row.allNames.length) recordsWithNames++;
    if (row.themes.length) recordsWithThemes++;
    if (row.sourceCollectionId === "1" && row.url) {
      urls.add(row.url);
      try { domains.add(new URL(row.url).hostname.toLowerCase()); } catch {}
      webRecords++;
    }
  }
  const code = await closed;
  if (code !== 0) throw new Error(`unzip exited ${code}: ${stderr}`);
  return { records, validRecords, webRecords, recordsWithNames, recordsWithThemes, urls, domains };
}

async function readNgrams(url) {
  const response = await request(url);
  if (response.status === 404) return { status: "missing", records: 0, urls: new Set(), languages: {} };
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const lines = createInterface({ input: Readable.fromWeb(response.body).pipe(createGunzip()), crlfDelay: Infinity });
  const urls = new Set(), languages = {};
  let records = 0, parseErrors = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      records++;
      if (typeof record.url === "string" && record.url.trim()) urls.add(record.url.trim());
      const lang = String(record.lang ?? "unknown").toLowerCase();
      languages[lang] = (languages[lang] ?? 0) + 1;
    } catch { parseErrors++; }
  }
  if (parseErrors) throw new Error(`${parseErrors} invalid JSON lines in ${url}`);
  return { status: "ok", records, urls, languages };
}

async function probeFile(file) {
  const url = `${NGRAM_BASE}/${file.filename}`;
  const head = await request(url, { method: "HEAD", timeout: 45_000 });
  if (head.status === 404) return { ...file, status: "missing" };
  if (!head.ok && ![403, 405, 501].includes(head.status)) {
    throw new Error(`HEAD HTTP ${head.status} for ${url}`);
  }
  return { ...file, ...(await readNgrams(url)) };
}

async function mapLimit(items, limit, fn) {
  const output = [];
  for (let i = 0; i < items.length; i += limit) {
    output.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return output;
}

function renderMarkdown(report) {
  const s = report.summary;
  const rows = report.samples.map(x =>
    `| ${x.filename} | ${x.status} | ${x.gkg?.validRecords ?? "—"} | ${x.gkg?.uniqueWebUrls ?? "—"} | ${x.availableNgramsFileCount ?? "—"} | ${x.urlJoin ? (x.urlJoin.gkgToWebNgramMatchRate * 100).toFixed(2) + "%" : "—"} | ${x.availableFileOffsets?.join(", ") ?? "—"} |`
  );
  return [
    "# GKG ↔ Web NGrams: 10-sample coverage audit", "",
    `- Started: ${report.startedAt}`,
    `- Completed: ${report.completedAt}`,
    `- Sample design: ${s.requestedSamples} batches, ${report.spacingMinutes} minutes apart (approximately ${((s.requestedSamples - 1) * report.spacingMinutes / 60).toFixed(1)} hours)`,
    `- Complete samples: ${s.completeSamples}/${s.requestedSamples}`,
    `- Mean / median URL match: ${(s.meanMatchRate * 100).toFixed(2)}% / ${(s.medianMatchRate * 100).toFixed(2)}%`,
    `- Weighted URL match: ${(s.weightedMatchRate * 100).toFixed(2)}%`,
    `- Range: ${(s.minMatchRate * 100).toFixed(2)}%–${(s.maxMatchRate * 100).toFixed(2)}%`,
    `- Mean available NGrams files per complete sample: ${s.meanAvailableNgramsFiles}`,
    `- Observed NGrams offsets: ${s.minNgramsOffsetMinutes ?? "—"} to ${s.maxNgramsOffsetMinutes ?? "—"} minutes relative to GKG filename timestamp`,
    "", "| GKG batch | Status | Valid GKG rows | Unique WEB URLs | NGrams files | URL join | Available NGrams offsets (min) |",
    "|---|---:|---:|---:|---:|---:|---:|", ...rows, "",
    "## Interpretation limits", "",
    "- URL join is a technical overlap measure, not a relevance or topic-quality score.",
    "- The weighted rate sums per-batch URL denominators; the same article can appear in different sampled batches.",
    "- NGrams files are selected by availability within a −20/+5 minute window; their offset is not proof of exact batch correspondence.",
    "- This audit measures exact URL deduplication within each sampled batch and URL domains; it does not detect semantic near-duplicates or syndicated copies under different URLs.",
    "- Source domains are not publisher-country metadata. GKG translation metadata is not a complete language census.",
    "- No ranking weights, candidate quotas, or live game data are changed.", ""
  ].join("\n");
}

async function main() {
  const startedAt = new Date().toISOString();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trendsy-gkg-multi-"));
  try {
    const lastUpdateResponse = await request(LAST_UPDATE_URL);
    if (!lastUpdateResponse.ok) throw new Error(`lastupdate HTTP ${lastUpdateResponse.status}`);
    const lastUpdate = await lastUpdateResponse.text();
    const line = lastUpdate.split(/\r?\n/).find(value => value.includes(".gkg.csv.zip"));
    if (!line) throw new Error("No GKG archive found in lastupdate.txt");
    const latestUrl = line.trim().split(/\s+/).at(-1).replace(/^http:/i, "https:");
    const latestFilename = new URL(latestUrl).pathname.split("/").at(-1);
    const sampleFiles = gkgSampleFilenames(latestFilename, SAMPLE_COUNT, SPACING_MINUTES);
    const samples = [];

    for (const sample of sampleFiles) {
      const gkgUrl = `${GKG_BASE}/${sample.filename}`;
      const item = {
        ...sample,
        status: "GKG_MISSING",
        gkgUrl,
        availableNgramsFileCount: 0,
        availableFileOffsets: []
      };
      try {
        const response = await request(gkgUrl);
        if (response.status === 404) {
          samples.push(item);
          continue;
        }
        if (!response.ok) throw new Error(`GKG HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const zipPath = path.join(tempDir, sample.filename);
        await fs.writeFile(zipPath, bytes);
        const gkg = await readGkg(zipPath);
        item.gkg = {
          compressedBytes: bytes.length,
          records: gkg.records,
          validRecords: gkg.validRecords,
          webRecords: gkg.webRecords,
          uniqueWebUrls: gkg.urls.size,
          uniqueSourceDomains: gkg.domains.size,
          recordsWithNames: gkg.recordsWithNames,
          recordsWithThemes: gkg.recordsWithThemes
        };

        const candidates = webNgramsWindowFilenames(sample.filename, BEFORE_MINUTES, AFTER_MINUTES);
        const probed = await mapLimit(candidates, CONCURRENCY, probeFile);
        const available = probed.filter(file => file.status === "ok");
        item.availableNgramsFileCount = available.length;
        item.availableFileOffsets = available.map(file => file.offsetMinutes);
        item.ngramsRecords = available.reduce((sum, file) => sum + file.records, 0);
        item.uniqueNgramsUrls = new Set(available.flatMap(file => [...file.urls])).size;
        item.uniqueNgramsDomains = new Set(available.flatMap(file => [...file.urls].flatMap(value => {
          try { return [new URL(value).hostname.toLowerCase()]; } catch { return []; }
        }))).size;
        item.ngramsLanguages = available.reduce((counts, file) => {
          for (const [language, count] of Object.entries(file.languages)) counts[language] = (counts[language] ?? 0) + count;
          return counts;
        }, {});
        if (!available.length) {
          item.status = "NGRAMS_MISSING";
        } else {
          const allUrls = new Set(available.flatMap(file => [...file.urls]));
          item.urlJoin = summarizeUrlJoin([...gkg.urls], [...allUrls]);
          item.duplicateUrlOccurrencesAcrossNgramsFiles =
            available.reduce((sum, file) => sum + file.urls.size, 0) - allUrls.size;
          item.status = "COMPLETE";
        }
      } catch (error) {
        item.status = "ERROR";
        item.error = String(error?.message ?? error);
      }
      samples.push(item);
      console.log(`[${samples.length}/${sampleFiles.length}] ${sample.filename}: ${item.status}`);
    }

    const summary = summarizeMultiSample(samples);
    const report = {
      schemaVersion: 1,
      status: summary.completeSamples === SAMPLE_COUNT ? "COMPLETE" : "PARTIAL",
      source: "GDELT GKG 2.1 + Web NGrams 3.0",
      startedAt,
      completedAt: new Date().toISOString(),
      latestGkgFilename: latestFilename,
      sampleCount: SAMPLE_COUNT,
      spacingMinutes: SPACING_MINUTES,
      searchWindowMinutes: { before: BEFORE_MINUTES, after: AFTER_MINUTES },
      summary,
      samples
    };
    await fs.mkdir("output", { recursive: true });
    await fs.writeFile("output/gkg-multisample-audit.json", JSON.stringify(report, null, 2) + "\n");
    await fs.writeFile("output/gkg-multisample-audit.md", renderMarkdown(report));
    const historyPath = "data/gkg-multisample-history.json";
    let history = [];
    try { history = JSON.parse(await fs.readFile(historyPath, "utf8")); if (!Array.isArray(history)) throw new Error("Invalid history array."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const entry = { date: report.completedAt.slice(0,10), startedAt: report.startedAt, completedAt: report.completedAt, status: report.status, requestedSamples: summary.requestedSamples, completeSamples: summary.completeSamples, weightedMatchRate: summary.weightedMatchRate, meanMatchRate: summary.meanMatchRate, totalGkgUniqueUrls: summary.totalGkgUniqueUrlsAcrossSamples, totalMatchedUrls: summary.totalMatchedUrlsAcrossSamples };
    history = history.filter(x=>x.date!==entry.date); history.push(entry); history.sort((a,b)=>a.date.localeCompare(b.date)); history=history.slice(-30);
    await fs.mkdir(path.dirname(historyPath),{recursive:true}); await fs.writeFile(historyPath,JSON.stringify(history,null,2)+"\\n");
    const historyReport={generatedAt:new Date().toISOString(),summary:summarizeDailyHistory(history)};
    await fs.writeFile("output/gkg-multiday-comparison.json",JSON.stringify(historyReport,null,2)+"\\n");
    await fs.writeFile("output/gkg-multiday-comparison.md",renderDailyHistoryMarkdown(historyReport));
    console.log(JSON.stringify({status:report.status,summary,history:{completeDays:historyReport.summary.completeDays,consecutiveCompleteDays:historyReport.summary.consecutiveCompleteDays,threeDayReady:historyReport.summary.threeDay.ready,sevenDayReady:historyReport.summary.sevenDay.ready}},null,2));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
