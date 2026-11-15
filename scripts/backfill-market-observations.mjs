import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDailySnapshot } from "./market-observations.mjs";
import { publishObservations } from "./publish-market-observations.mjs";

export function listDates(startDate, endDate) {
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const parsed = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validDate(startDate) || !validDate(endDate)) {
    throw new Error("Pass valid start and end dates as YYYY-MM-DD.");
  }
  if (startDate > endDate) throw new Error("Start date must not be after end date.");

  const dates = [];
  for (let time = Date.parse(startDate + "T00:00:00.000Z"); time <= Date.parse(endDate + "T00:00:00.000Z"); time += 86400000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

async function main() {
  const [startDate, endDate] = process.argv.slice(2);
  const dates = listDates(startDate, endDate);
  let total = 0;

  for (const date of dates) {
    const input = path.resolve("data/history", "webngrams-" + date + ".json");
    const snapshot = JSON.parse(await fs.readFile(input, "utf8"));
    if (snapshot.date !== date) throw new Error("Archive date mismatch in " + input + ".");
    const rows = validateDailySnapshot(snapshot);
    const confirmed = await publishObservations({
      baseUrl: process.env.SUPABASE_URL ?? "",
      secretKey: process.env.SUPABASE_SECRET_KEY ?? "",
      rows
    });
    total += confirmed;
    console.log("Supabase confirmed " + confirmed + "/" + rows.length + " observations for " + date + ".");
  }

  console.log("Backfill complete: " + total + " observations confirmed across " + dates.length + " days.");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
