import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDailySnapshot } from "./market-observations.mjs";

export async function publishObservations({ baseUrl, secretKey, rows, fetchImpl = fetch }) {
  const normalizedUrl = String(baseUrl ?? "").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalizedUrl) || !secretKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("At least one observation row is required.");
  }

  const endpoint = normalizedUrl + "/rest/v1/market_observations?on_conflict=candidate_id,observation_date&select=candidate_id,observation_date";
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: secretKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error("Supabase import failed (HTTP " + response.status + "): " + detail);
  }

  let confirmedRows;
  try {
    confirmedRows = await response.json();
  } catch {
    throw new Error("Supabase accepted the request but did not return a readable row confirmation.");
  }
  if (!Array.isArray(confirmedRows)) {
    throw new Error("Supabase returned an unexpected confirmation format.");
  }

  const keyOf = row => String(row.candidate_id) + "|" + String(row.observation_date);
  const expected = new Set(rows.map(keyOf));
  const confirmed = new Set(confirmedRows.map(keyOf));
  const allRowsConfirmed = confirmedRows.length === rows.length
    && confirmed.size === expected.size
    && [...expected].every(key => confirmed.has(key));

  if (!allRowsConfirmed) {
    throw new Error(
      "Supabase confirmation mismatch: expected " + rows.length + " observations, received " + confirmedRows.length + "."
    );
  }
  return confirmedRows.length;
}

async function main() {
  const baseUrl = process.env.SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pass date as YYYY-MM-DD.");
  const input = path.resolve("data/history", "webngrams-" + date + ".json");
  const snapshot = JSON.parse(await fs.readFile(input, "utf8"));
  const rows = validateDailySnapshot(snapshot);
  const confirmed = await publishObservations({ baseUrl, secretKey, rows });
  console.log("Supabase confirmed " + confirmed + "/" + rows.length + " raw observations for " + date + "; game prices were not changed.");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
