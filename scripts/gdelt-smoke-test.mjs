import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.gdeltproject.org/api/v2/doc/doc";
const INPUT = new URL("../data/candidates.json", import.meta.url);
const OUTPUT_DIR = path.resolve("output");
const START = process.env.GDELT_START ?? dateDaysAgo(29);
const END = process.env.GDELT_END ?? dateToday();

function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10).replaceAll("-", "") + "000000";
}
function dateToday() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "") + "235959";
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function requestTimeline(candidate) {
  const params = new URLSearchParams({
    query: candidate.query,
    mode: "timelinevolraw",
    format: "json",
    startdatetime: START,
    enddatetime: END
  });
  const url = `${API}?${params.toString()}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Trendsy-GDELT-POC/0.1 (research prototype)" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const body = await response.json();
      const series = Array.isArray(body.timeline) ? body.timeline : [];
      const points = series.flatMap(s => Array.isArray(s.data) ? s.data : []);
      return {
        status: "ok",
        httpStatus: response.status,
        points: points.map(p => ({ date: String(p.date ?? ""), value: Number(p.value ?? 0) })),
        timelineSeries: series.length,
        rawPointCount: points.length
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  return { status: "error", error: String(lastError) };
}

const source = JSON.parse(await fs.readFile(INPUT, "utf8"));
await fs.mkdir(OUTPUT_DIR, { recursive: true });
const results = [];

for (const candidate of source.candidates) {
  process.stdout.write(`Testing ${candidate.id} ... `);
  const result = await requestTimeline(candidate);
  results.push({
    id: candidate.id,
    label: candidate.label,
    category: candidate.category,
    query: candidate.query,
    locale: candidate.locale,
    fetchedAt: new Date().toISOString(),
    ...result
  });
  console.log(result.status === "ok" ? `${result.rawPointCount} daily points` : result.error);
  await sleep(1200);
}

const snapshot = {
  schemaVersion: 1,
  source: "GDELT DOC 2.0 API — timelinevolraw",
  sourceUrl: API,
  requestedRange: { startdatetime: START, enddatetime: END },
  generatedAt: new Date().toISOString(),
  results
};
await fs.writeFile(path.join(OUTPUT_DIR, "gdelt-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");

const csv = [
  "id,label,category,query,locale,date,value,status",
  ...results.flatMap(r => r.points?.length
    ? r.points.map(p => [r.id, r.label, r.category, r.query, r.locale, p.date, p.value, r.status].map(csvCell).join(","))
    : [[r.id, r.label, r.category, r.query, r.locale, "", "", r.status].map(csvCell).join(",")])
].join("\n") + "\n";
await fs.writeFile(path.join(OUTPUT_DIR, "gdelt-snapshot.csv"), csv);

const ok = results.filter(r => r.status === "ok").length;
const withData = results.filter(r => r.status === "ok" && r.rawPointCount > 0).length;
console.log(`\nCompleted: ${ok}/${results.length} requests succeeded; ${withData} returned at least one data point.`);
console.log("Files written to output/. Inspect query precision and homonyms before treating any result as a valid instrument.");

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
