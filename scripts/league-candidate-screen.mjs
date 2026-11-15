import fs from "node:fs/promises";
import path from "node:path";
import { buildLeagueCandidateScreen, renderLeagueCandidateScreen } from "./league-candidate-screen-utils.mjs";

const discoveryPath = path.resolve("output/gkg-candidate-discovery.json");
const relevancePath = path.resolve("output/gkg-article-relevance.json");
const outputDir = path.resolve("output");
const discovery = JSON.parse(await fs.readFile(discoveryPath, "utf8"));
let relevance = null;
try {
  relevance = JSON.parse(await fs.readFile(relevancePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.warn("Headline relevance report not found; candidate scores will mark this signal unavailable.");
}
if (discovery.status !== "COMPLETE") {
  throw new Error("Candidate discovery is not complete; refusing to produce a league shortlist from partial samples.");
}
const report = buildLeagueCandidateScreen(discovery, relevance);
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "league-candidate-screen.json"), JSON.stringify(report, null, 2) + "\n");
await fs.writeFile(path.join(outputDir, "league-candidate-screen.md"), renderLeagueCandidateScreen(report));
console.log(JSON.stringify({ summary: report.summary, top16: report.top16ResearchShortlist.map(item => ({ name: item.name, score: item.score })) }, null, 2));
