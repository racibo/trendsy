import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parseGkgLine } from "./gkg-audit-utils.mjs";
import { gkgSampleFilenames } from "./gkg-multisample-utils.mjs";
import { addGkgDocument, createCandidateAccumulator, summarizeCandidateDiscovery } from "./gkg-candidate-discovery-utils.mjs";

const LAST_UPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt";
const GKG_BASE = "https://data.gdeltproject.org/gdeltv2";
const USER_AGENT = "Trendsy-GKG-Candidate-Discovery-Audit/1.0 (research prototype)";
const SAMPLE_COUNT = Number(process.env.GKG_DISCOVERY_SAMPLE_COUNT ?? 10);
const SPACING_MINUTES = Number(process.env.GKG_DISCOVERY_SPACING_MINUTES ?? 150);
const CANDIDATE_LIMIT = Number(process.env.GKG_DISCOVERY_CANDIDATE_LIMIT ?? 200);

async function request(url) {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(300_000)
  });
}

async function scanGkg(zipPath, filename, accumulator) {
  const child = spawn("unzip", ["-p", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr += chunk.slice(0, 3000); });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let records = 0, validRecords = 0, validWebDocuments = 0, documentsWithAllNames = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    records++;
    const row = parseGkgLine(line);
    if (!row.valid) continue;
    validRecords++;
    if (row.sourceCollectionId !== "1" || !row.url) continue;
    validWebDocuments++;
    if (row.allNames.length) documentsWithAllNames++;
    addGkgDocument(accumulator, row, filename);
  }
  const code = await closed;
  if (code !== 0) throw new Error(`unzip exited ${code}: ${stderr}`);
  return { records, validRecords, validWebDocuments, documentsWithAllNames };
}

function renderMarkdown(report) {
  const s = report.summary;
  const rows = report.candidates.slice(0, 50).map((item, index) =>
    `| ${index + 1} | ${item.name.replaceAll("|", "\\|")} | ${item.uniqueArticles} | ${item.independentDomains} | ${item.sampledBatches} | ${item.personSignalArticles} | ${item.organizationSignalArticles} |`
  );
  return [
    "# GKG ALLNAMES candidate discovery — research audit", "",
    `- Started: ${report.startedAt}`,
    `- Completed: ${report.completedAt}`,
    `- Sampling: ${s.requestedSamples} batches, ${report.spacingMinutes} minutes apart (approximately ${((s.requestedSamples - 1) * report.spacingMinutes / 60).toFixed(1)} hours)`,
    `- Complete GKG batches: ${s.completeSamples}/${s.requestedSamples}`,
    `- Valid WEB documents: ${s.validWebDocuments}`,
    `- Documents with ALLNAMES: ${s.documentsWithAllNames}`,
    `- Unique normalized names: ${s.uniqueCandidateNames}`,
    `- Names with at least 2 unique articles: ${s.candidatesWithAtLeastTwoArticles}`,
    "", "## Candidate frequency distribution", "",
    "| Unique articles per name | Number of names |", "|---|---:|",
    ...Object.entries(s.frequencyBuckets).map(([bucket, count]) => `| ${bucket.replaceAll("_", " ")} | ${count} |`),
    "", "## Top 50 name candidates", "",
    "| # | Name | Unique articles | Domains | Batches | Person signal | Organization signal |",
    "|---:|---|---:|---:|---:|---:|---:|", ...rows, "",
    "## Interpretation limits", "",
    "- ALLNAMES is intentionally inclusive: a detected name can be a passing mention, ambiguous string, or extraction false positive.",
    "- This report counts unique WEB article URLs, not raw name mentions or independently verified topic relevance.",
    "- Person/organization signals are cross-checks against GKG PERSONS and ORGANIZATIONS fields, not a definitive entity type.",
    "- Domain count is not publisher-country coverage and does not prove editorial independence.",
    "- The sample is sparse (150-minute spacing), not a continuous scan of all GKG batches.",
    "- This is a candidate-discovery audit only. It does not calculate popularity scores, change league membership, or alter game data.",
    "", "Full candidate evidence, language/theme distributions, and up to three URLs per candidate are in the JSON artifact.", ""
  ].join("\n");
}

async function main() {
  const startedAt = new Date().toISOString();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trendsy-gkg-discovery-"));
  try {
    const latestResponse = await request(LAST_UPDATE_URL);
    if (!latestResponse.ok) throw new Error(`lastupdate HTTP ${latestResponse.status}`);
    const line = (await latestResponse.text()).split(/\r?\n/).find(value => value.includes(".gkg.csv.zip"));
    if (!line) throw new Error("No GKG archive found in lastupdate.txt");
    const latestUrl = line.trim().split(/\s+/).at(-1).replace(/^http:/i, "https:");
    const latestFilename = new URL(latestUrl).pathname.split("/").at(-1);
    const samples = gkgSampleFilenames(latestFilename, SAMPLE_COUNT, SPACING_MINUTES);
    const accumulator = createCandidateAccumulator();
    const sampleStats = [];

    for (const sample of samples) {
      const item = { ...sample, status: "GKG_MISSING" };
      try {
        const response = await request(`${GKG_BASE}/${sample.filename}`);
        if (response.status === 404) {
          sampleStats.push(item);
          console.log(`[${sample.index}/${samples.length}] ${sample.filename}: GKG_MISSING`);
          continue;
        }
        if (!response.ok) throw new Error(`GKG HTTP ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const zipPath = path.join(tempDir, sample.filename);
        await fs.writeFile(zipPath, bytes);
        Object.assign(item, await scanGkg(zipPath, sample.filename, accumulator), {
          compressedBytes: bytes.length,
          status: "COMPLETE"
        });
      } catch (error) {
        item.status = "ERROR";
        item.error = String(error?.message ?? error);
      }
      sampleStats.push(item);
      console.log(`[${sample.index}/${samples.length}] ${sample.filename}: ${item.status}`);
    }

    const discovery = summarizeCandidateDiscovery(accumulator, sampleStats, CANDIDATE_LIMIT);
    const report = {
      schemaVersion: 1,
      status: discovery.summary.completeSamples === SAMPLE_COUNT ? "COMPLETE" : "PARTIAL",
      source: "GDELT GKG 2.1 V2.1ALLNAMES + V1PERSONS + V1ORGANIZATIONS + V1THEMES",
      startedAt,
      completedAt: new Date().toISOString(),
      latestGkgFilename: latestFilename,
      requestedSamples: SAMPLE_COUNT,
      spacingMinutes: SPACING_MINUTES,
      candidateLimit: CANDIDATE_LIMIT,
      ...discovery
    };
    await fs.mkdir("output", { recursive: true });
    await fs.writeFile("output/gkg-candidate-discovery.json", JSON.stringify(report, null, 2) + "\n");
    await fs.writeFile("output/gkg-candidate-discovery.md", renderMarkdown(report));
    console.log(JSON.stringify({
      status: report.status,
      summary: report.summary,
      json: "output/gkg-candidate-discovery.json",
      markdown: "output/gkg-candidate-discovery.md"
    }, null, 2));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
