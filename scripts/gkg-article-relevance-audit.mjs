import fs from "node:fs/promises";
import path from "node:path";
import { buildRelevanceQueries, summarizeArticleResults } from "./gkg-article-relevance-utils.mjs";

const API = "https://api.gdeltproject.org/api/v2/doc/doc";
const INPUT = path.resolve("output/gkg-candidate-discovery.json");
const OUTPUT_DIR = path.resolve("output");
const TIMESPAN = process.env.GKG_RELEVANCE_TIMESPAN ?? "3days";
const MAX_RECORDS = Math.min(50, Math.max(1, Number(process.env.GKG_RELEVANCE_MAX_RECORDS ?? 20)));
const MIN_REQUEST_INTERVAL_MS = 6_000;
const MAX_ATTEMPTS = 3;
const USER_AGENT = "Trendsy-GKG-Article-Relevance-Audit/1.0 (research prototype)";
let lastRequestStartedAt = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
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
async function fetchArticles(query) {
  const params = new URLSearchParams({
    query,
    mode: "artlist",
    format: "json",
    maxrecords: String(MAX_RECORDS),
    timespan: TIMESPAN,
    sort: "datedesc"
  });
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForRequestSlot();
    try {
      const response = await fetch(API + "?" + params, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 400);
        lastError = new Error("HTTP " + response.status + ": " + detail);
        if (response.status === 429 && attempt < MAX_ATTEMPTS) {
          const delay = Math.max(retryAfterMs(response) ?? 12_000, 12_000) * attempt;
          await sleep(delay);
          continue;
        }
        if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
          await sleep(5_000 * attempt);
          continue;
        }
        break;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const bodyText = await response.text();
      if (contentType.includes("text/html") || bodyText.trimStart().startsWith("<")) {
        throw new Error("GDELT returned an HTML/API error: " + bodyText.slice(0, 300));
      }
      const body = JSON.parse(bodyText);
      return {
        status: "ok",
        articles: (Array.isArray(body.articles) ? body.articles : []).map(item => ({
          url: item.url ?? null,
          title: item.title ?? "",
          seendate: item.seendate ?? null,
          domain: item.domain ?? null,
          language: item.language ?? null,
          sourcecountry: item.sourcecountry ?? null
        })).filter(item => item.url && item.title)
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await sleep(5_000 * attempt);
    }
  }
  return { status: "error", error: String(lastError ?? "Unknown GDELT DOC API error") };
}

function renderMarkdown(report) {
  const lines = [
    "# GKG article relevance — headline evidence audit",
    "",
    "- Generated: " + report.generatedAt,
    "- Source: GDELT DOC 2.0 Article List API (" + report.timespan + ")",
    "- Candidates reviewed: " + report.summary.candidates,
    "- Successful candidate lookups: " + report.summary.successfulCandidates,
    "- Failed candidate lookups: " + report.summary.failedCandidates,
    "- Exact-phrase article results: " + report.summary.exactPhraseArticles,
    "- Repeat2 article results: " + report.summary.repeat2Articles,
    "",
    "## How to read this report",
    "",
    "- Each candidate has two independent searches: an exact-phrase search and the same phrase with GDELT's repeat2 operator applied to its longest token.",
    "- Headline phrase/token matches are mechanical signals only. A headline can mention a candidate without being about it, and an article can be about a candidate without naming it in the headline.",
    "- DOC API results are not the same fixed set of URLs as the GKG sample. Exact URL intersections are reported separately.",
    "- No candidate receives an automatic relevance label or popularity score. Human assessment fields remain blank.",
    "",
    "## Candidate evidence",
    ""
  ];
  for (const item of report.candidates) {
    lines.push(
      "### " + item.name,
      "",
      "- GKG sample: " + item.gkgUniqueArticles + " unique URLs / " + item.gkgUniqueDomains + " domains",
      "- Exact phrase: " + (item.exactPhrase.status === "ok" ? item.exactPhrase.returnedArticles + " articles" : "ERROR — " + item.exactPhrase.error),
      "- Repeat2: " + (item.repeat2.status === "ok" ? item.repeat2.returnedArticles + " articles" : "ERROR — " + item.repeat2.error)
    );
    for (const [label, group] of [["Exact phrase", item.exactPhrase], ["Repeat2", item.repeat2]]) {
      if (group.status !== "ok") continue;
      lines.push("", "**" + label + " headlines**", "");
      if (!group.articles.length) lines.push("- No articles returned");
      for (const article of group.articles.slice(0, 10)) {
        const flags = [
          article.headlineAssessment.exactPhraseInHeadline ? "exact phrase in headline" : null,
          article.matchesGkgEvidenceUrl ? "same URL as GKG evidence" : null
        ].filter(Boolean);
        const safeTitle = article.title.replaceAll("[", "\\[").replaceAll("]", "\\]");
        lines.push("- [" + safeTitle + "](" + article.url + ") — " + (article.domain ?? "unknown domain") + "; " + (article.language ?? "language unknown") + "; " + (article.sourcecountry ?? "country unknown") + (flags.length ? " (" + flags.join(", ") + ")" : ""));
      }
    }
    lines.push("", "- Manual headline-focus assessment: " + (item.manualAssessment.headlineFocus ?? "not assessed"), "- Manual evidence-relevance assessment: " + (item.manualAssessment.evidenceRelevance ?? "not assessed"), "");
  }
  lines.push(
    "## Interpretation limits",
    "",
    "- GDELT DOC searches full article text, but this audit only receives article-list metadata and headlines; it does not fetch or read full article bodies.",
    "- repeat2 is a heuristic for repeated mention, not proof of article focus.",
    "- Exact phrase matching can miss spelling variants, aliases, transliterations, and articles that discuss an event without naming the entity.",
    "- Search windows and indexing can change between runs. This is a reproducible procedure, not a frozen global sample.",
    "- The report is a review dataset. Do not use these counts directly as league points or automatically discard candidates.",
    ""
  );
  return lines.join("\n");
}

const discovery = JSON.parse(await fs.readFile(INPUT, "utf8"));
const sample = Array.isArray(discovery.manualReviewSample) ? discovery.manualReviewSample : [];
if (!sample.length) throw new Error("GKG discovery report has no manualReviewSample rows");
const candidates = [];
for (const candidate of sample) {
  const queries = buildRelevanceQueries(candidate.name);
  console.log("Checking " + candidate.name);
  const exact = await fetchArticles(queries.exactPhrase);
  const repeat = await fetchArticles(queries.repeatQuery);
  const exactArticles = exact.status === "ok" ? exact.articles : [];
  const repeatArticles = repeat.status === "ok" ? repeat.articles : [];
  const summary = summarizeArticleResults(
    candidate.name,
    (candidate.evidence ?? []).map(item => item.url),
    exactArticles,
    repeatArticles
  );
  candidates.push({
    name: candidate.name,
    normalizedName: candidate.normalizedName,
    gkgUniqueArticles: candidate.uniqueArticles,
    gkgUniqueDomains: candidate.uniqueDomains,
    gkgReviewFlags: candidate.reviewFlags ?? [],
    gkgEvidence: candidate.evidence ?? [],
    exactPhrase: { status: exact.status, error: exact.error ?? null, ...summary.exactPhrase },
    repeat2: { status: repeat.status, error: repeat.error ?? null, ...summary.repeat2 },
    manualAssessment: summary.manualAssessment,
    queryDiagnostics: { exactPhrase: queries.exactPhrase, repeatQuery: queries.repeatQuery, repeatedToken: queries.repeatedToken }
  });
}
const report = {
  schemaVersion: 1,
  source: "GDELT DOC 2.0 API — artlist",
  generatedAt: new Date().toISOString(),
  timespan: TIMESPAN,
  maxRecordsPerQuery: MAX_RECORDS,
  requestedQueries: candidates.length * 2,
  summary: {
    candidates: candidates.length,
    successfulCandidates: candidates.filter(item => item.exactPhrase.status === "ok" || item.repeat2.status === "ok").length,
    failedCandidates: candidates.filter(item => item.exactPhrase.status !== "ok" && item.repeat2.status !== "ok").length,
    exactPhraseArticles: candidates.reduce((sum, item) => sum + item.exactPhrase.returnedArticles, 0),
    repeat2Articles: candidates.reduce((sum, item) => sum + item.repeat2.returnedArticles, 0)
  },
  candidates
};
await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUTPUT_DIR, "gkg-article-relevance.json"), JSON.stringify(report, null, 2) + "\n");
await fs.writeFile(path.join(OUTPUT_DIR, "gkg-article-relevance.md"), renderMarkdown(report));
console.log(JSON.stringify({ summary: report.summary, json: "output/gkg-article-relevance.json", markdown: "output/gkg-article-relevance.md" }, null, 2));
