import { readFile, mkdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { URL } from "node:url";

const candidates = JSON.parse(await readFile(new URL("../data/candidates.json", import.meta.url), "utf8")).candidates;
const timespan = process.env.GDELT_TIMESPAN || "30d";
const delayMs = Number(process.env.GDELT_DELAY_MS || 1200);
const maxRetries = Number(process.env.GDELT_MAX_RETRIES || 2);
const endpoint = "https://api.gdeltproject.org/api/v2/doc/doc";

async function fetchTimeline(candidate) {
  const url = new URL(endpoint);
  url.searchParams.set("query", candidate.query);
  url.searchParams.set("mode", "timelinevolraw");
  url.searchParams.set("format", "json");
  url.searchParams.set("timespan", timespan);
  url.searchParams.set("timelinesmooth", "0");

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Trendsy-GDELT-POC/0.1 (research prototype)" }
      });
      const body = await response.text();
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + body.slice(0, 300));
      let json;
      try { json = JSON.parse(body); }
      catch { throw new Error("Non-JSON response: " + body.slice(0, 300)); }

      const timeline = Array.isArray(json.timeline) ? json.timeline : [];
      const points = timeline.flatMap(series =>
        Array.isArray(series.data) ? series.data.map(point => ({
          date: point.date,
          value: Number(point.value)
        })) : []
      );
      return {
        id: candidate.id, label: candidate.label, category: candidate.category,
        query: candidate.query, status: points.length ? "ok" : "empty", points,
        totalRaw: points.reduce((sum, point) => sum + (Number.isFinite(point.value) ? point.value : 0), 0),
        error: null
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) await sleep(1500 * (attempt + 1));
    }
  }
  return {
    id: candidate.id, label: candidate.label, category: candidate.category,
    query: candidate.query, status: "error", points: [], totalRaw: 0,
    error: String(lastError)
  };
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return /[",\\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

const results = [];
for (const candidate of candidates) {
  console.log("Querying " + candidate.label + " (" + candidate.id + ")");
  results.push(await fetchTimeline(candidate));
  await sleep(delayMs);
}

const now = new Date();
const stamp = now.toISOString().replaceAll(":", "-");
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/gdelt-" + stamp + ".json", JSON.stringify({
  generatedAt: now.toISOString(), source: endpoint, timespan, results
}, null, 2));

const rows = ["id,label,category,date,raw_value,status"];
for (const result of results) {
  if (result.points.length) {
    for (const point of result.points) {
      rows.push([result.id, result.label, result.category, point.date, point.value, result.status].map(csvEscape).join(","));
    }
  } else {
    rows.push([result.id, result.label, result.category, "", "", result.status].map(csvEscape).join(","));
  }
}
await writeFile("artifacts/gdelt-" + stamp + ".csv", rows.join("\\n") + "\\n");

console.table(results.map(result => ({
  id: result.id, category: result.category, status: result.status,
  dailyPoints: result.points.length, totalRaw: result.totalRaw, error: result.error
})));
console.log("Saved " + results.length + " candidate results to artifacts/ (timespan: " + timespan + ").");

if (results.every(result => result.status === "error")) process.exitCode = 1;
