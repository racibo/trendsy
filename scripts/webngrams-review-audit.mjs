import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebNgramsReviewAudit, toReviewCsv, toReviewMarkdown } from "./webngrams-review-audit-utils.mjs";

async function main() {
  const inputPath = path.resolve(process.argv[2] ?? "output/webngrams-snapshot.json");
  const snapshot = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const audit = createWebNgramsReviewAudit(snapshot);
  const outputDir = path.resolve("output");
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, "webngrams-review-audit.json"), JSON.stringify(audit, null, 2) + "\n"),
    fs.writeFile(path.join(outputDir, "webngrams-review-audit.csv"), toReviewCsv(audit)),
    fs.writeFile(path.join(outputDir, "webngrams-review-audit.md"), toReviewMarkdown(audit))
  ]);
  console.log(`Prepared ${audit.summary.evidenceRows} evidence rows for manual review across ${audit.summary.candidateCount} candidates.`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
