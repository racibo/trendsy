import fs from "node:fs/promises";
import path from "node:path";

const API = "https://api.gdeltproject.org/api/v2/doc/doc";
const INPUT = new URL("../data/candidates.json", import.meta.url);
const OUTPUT_DIR = path.resolve("output");
const START = process.env.GDELT_START ?? dateDaysAgo(29);
const END = process.env.GDELT_END ?? dateToday();

// GDELT asks clients to send no more than one request every five seconds.
// Keep a small margin and apply this globally, including retries.
const MIN_REQUEST_INTERVAL_MS = 6_000;
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_FALLBACK_MS = 12_000;
let lastRequestStartedAt = 0;

function dateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10).replaceAll("-", "") + "000000";
}
function dateToday() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "") + "235959";
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function compactDate(value) {
  return String(value).slice(0, 8);
}
function dateCalendar(start, end) {
  const first = new Date(Date.UTC(
    Number(start.slice(0, 4)),
    Number(start.slice(4, 6)) - 1,
    Number(start.slice(6, 8))
  ));
  const last = new Date(Date.UTC(
    Number(end.slice(0, 4)),
    Number(end.slice(4, 6)) - 1,
    Number(end.slice(6, 8))
  ));
  const dates = [];
  for (const d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10).replaceAll("-", ""));
  }
  return dates;
}
function retryAfterMs(response) {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
async function waitForRequestSlot() {
  const elapsed = Date.now() - lastRequestStartedAt;
  if (lastRequestStartedAt && elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestStartedAt = Date.now();
}

async function requestTimeline(candidate, expectedDates) {
  const params = new URLSearchParams({
    query: candidate.query,
    mode: "timelinevolraw",
    format: "json",
    startdatetime: START,
    enddatetime: END
  });
  const url = `${API}?${params.toString()}`;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForRequestSlot();
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Trendsy-GDELT-POC/0.2 (research prototype)" }
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        const error = new Error(`HTTP ${response.status}: ${detail}`);
        lastError = error;

        if (response.status === 429 && attempt < MAX_ATTEMPTS) {
          const serverDelay = retryAfterMs(response);
          const delay = Math.max(
            serverDelay ?? RATE_LIMIT_FALLBACK_MS,
            RATE_LIMIT_FALLBACK_MS
          ) * 2 ** (attempt - 1);
          console.warn(`  GDELT rate limit (429); retry ${attempt + 1}/${MAX_ATTEMPTS} in ${Math.ceil(delay / 1000)}s.`);
          await sleep(delay);
          continue;
        }

        if (attempt < MAX_ATTEMPTS && response.status >= 500) {
          await sleep(5_000 * attempt);
          continue;
        }
        break;
      }

      const body = await response.json();
      const series = Array.isArray(body.timeline) ? body.timeline : [];
      const points = series.flatMap(s => Array.isArray(s.data) ? s.data : [])
        .map(p => ({
          date: compactDate(p.date),
          value: Number(p.value),
          norm: p.norm == null ? null : Number(p.norm)
        }))
        .filter(p => /^\d{8}$/.test(p.date) && Number.isFinite(p.value));
      const returnedDates = new Set(points.map(p => p.date));

      return {
        status: "ok",
        httpStatus: response.status,
        points,
        timelineSeries: series.length,
        rawPointCount: points.length,
        missingDates: expectedDates.filter(date => !returnedDates.has(date)),
        observationNote: points.length === 0
          ? "API returned no daily observations; this is not treated as confirmed zero popularity."
          : "Only dates returned by the API are stored; absent dates are not filled with zero."
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const delay = 5_000 * attempt;
        console.warn(`  Request failed; retry ${attempt + 1}/${MAX_ATTEMPTS} in ${Math.ceil(delay / 1000)}s: ${String(error).slice(0, 180)}`);
        await sleep(delay);
      }
    }
  }

  return { status: "error", error: String(lastError ?? "Unknown request failure") };
}

const source = JSON.parse(await fs.readFile(INPUT, "utf8"));
await fs.mkdir(OUTPUT_DIR, { recursive: true });
const expectedDates = dateCalendar(START, END);
const results = [];

for (const candidate of source.candidates) {
  process.stdout.write(`Testing ${candidate.id} ... `);
  const result = await requestTimeline(candidate, expectedDates);
  results.push({
    id: candidate.id,
    label: candidate.label,
    category: candidate.category,
    query: candidate.query,
    locale: candidate.locale,
    fetchedAt: new Date().toISOString(),
    ...result
  });
  console.log(result.status === "ok"
    ? `${result.rawPointCount} observations; ${result.missingDates.length} dates not returned`
    : result.error);
}

const ok = results.filter(r => r.status === "ok").length;
const failed = results.length - ok;
const withData = results.filter(r => r.status === "ok" && r.rawPointCount > 0).length;
const snapshot = {
  schemaVersion: 2,
  source: "GDELT DOC 2.0 API — timelinevolraw",
  sourceUrl: API,
  requestedRange: { startdatetime: START, enddatetime: END },
  generatedAt: new Date().toISOString(),
  summary: {
    totalInstruments: results.length,
    successfulRequests: ok,
    failedRequests: failed,
    successfulWithObservations: withData,
    successfulWithoutObservations: ok - withData
  },
  results
};
await fs.writeFile(path.join(OUTPUT_DIR, "gdelt-snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n");

const csv = [
  "id,label,category,query,locale,date,value,norm,status",
  ...results.flatMap(r => r.points?.length
    ? r.points.map(p => [r.id, r.label, r.category, r.query, r.locale, p.date, p.value, p.norm, r.status].map(csvCell).join(","))
    : [[r.id, r.label, r.category, r.query, r.locale, "", "", "", r.status].map(csvCell).join(",")])
].join("\n") + "\n";
await fs.writeFile(path.join(OUTPUT_DIR, "gdelt-snapshot.csv"), csv);

console.log(`\nCompleted: ${ok}/${results.length} requests succeeded; ${failed} failed; ${withData} returned observations.`);
console.log("Missing dates are listed per instrument in JSON and are not converted to zero.");
console.log("Inspect query precision and homonyms before treating any result as a valid instrument.");

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
