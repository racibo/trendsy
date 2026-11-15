import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDailySnapshot } from "./market-observations.mjs";

async function main() {
  const baseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl) || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  }
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pass date as YYYY-MM-DD.");
  const input = path.resolve("data/history", `webngrams-${date}.json`);
  const snapshot = JSON.parse(await fs.readFile(input, "utf8"));
  const rows = validateDailySnapshot(snapshot);
  const response = await fetch(`${baseUrl}/rest/v1/market_observations?on_conflict=candidate_id,observation_date`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`Supabase import failed (HTTP \${response.status}): \${detail}`);
  }
  console.log(`Published ${rows.length} raw observations for ${date}; game prices were not changed.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
