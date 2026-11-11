import test from "node:test";
import assert from "node:assert/strict";
import {
  addGkgDocument,
  createCandidateAccumulator,
  normalizeCandidateName,
  parseAllNameMention,
  summarizeCandidateDiscovery
} from "../scripts/gkg-candidate-discovery-utils.mjs";

test("parses ALLNAMES name and trailing character offset", () => {
  assert.deepEqual(parseAllNameMention("Donald Trump,1234"), { name: "Donald Trump", offset: 1234 });
  assert.deepEqual(parseAllNameMention("ACME, Inc.,42"), { name: "ACME, Inc.", offset: 42 });
  assert.deepEqual(parseAllNameMention("World Cup"), { name: "World Cup", offset: null });\n  assert.deepEqual(parseAllNameMention("Miller, John"), { name: "Miller, John", offset: null });
  assert.equal(parseAllNameMention(""), null);
});

test("normalizes whitespace and Unicode without collapsing diacritics", () => {
  assert.equal(normalizeCandidateName("  GDAŃSK  "), "gdańsk");
  assert.equal(normalizeCandidateName("New   York"), "new york");
});

test("counts unique articles and domains rather than repeated mentions", () => {
  const accumulator = createCandidateAccumulator();
  const row = {
    valid: true,
    sourceCollectionId: "1",
    url: "https://news.example/story?id=1",
    sourceLanguage: "eng",
    publishedAt: "20261111090000",
    allNames: ["Donald Trump,10", "Donald Trump,80", "Taylor Swift,120"],
    persons: ["Donald Trump"],
    organizations: [],
    themes: ["POLITICAL_TURMOIL", "ELECTION"]
  };
  addGkgDocument(accumulator, row, "20261111090000.gkg.csv.zip");
  addGkgDocument(accumulator, row, "20261111091500.gkg.csv.zip");

  const second = {
    ...row,
    url: "https://other.example/story?id=2",
    allNames: ["Donald Trump,30"],
    themes: ["ELECTION"]
  };
  addGkgDocument(accumulator, second, "20261111091500.gkg.csv.zip");

  const report = summarizeCandidateDiscovery(accumulator, [
    { status: "COMPLETE", validWebDocuments: 2, documentsWithAllNames: 2 },
    { status: "COMPLETE", validWebDocuments: 1, documentsWithAllNames: 1 }
  ]);
  const trump = report.candidates.find(item => item.normalizedName === "donald trump");
  assert.equal(trump.uniqueArticles, 2);
  assert.equal(trump.uniqueDomains, 2);
  assert.equal(trump.sampledBatches, 2);
  assert.equal(trump.mentionOccurrences, 3);
  assert.equal(trump.personSignalArticles, 2);
  assert.equal(trump.themes.find(item => item.label === "ELECTION").count, 2);
  assert.equal(report.summary.uniqueCandidateNames, 2);
  assert.equal(report.summary.candidatesWithAtLeastTwoArticles, 1);
});


test("reports source-language coverage honestly instead of counting unknown as a language", () => {
  const accumulator = createCandidateAccumulator();
  const base = {
    valid: true, sourceCollectionId: "1", url: "https://news.example/a",
    allNames: ["Climate Change,1"], persons: [], organizations: [], themes: []
  };
  addGkgDocument(accumulator, { ...base, sourceLanguage: null }, "batch-1");
  addGkgDocument(accumulator, {
    ...base, url: "https://other.example/b", sourceLanguage: "eng"
  }, "batch-2");
  const report = summarizeCandidateDiscovery(accumulator, [
    { status: "COMPLETE", validWebDocuments: 1, documentsWithSourceLanguage: 0, documentsWithoutSourceLanguage: 1 },
    { status: "COMPLETE", validWebDocuments: 1, documentsWithSourceLanguage: 1, documentsWithoutSourceLanguage: 0 }
  ]);
  assert.deepEqual(report.summary.languageMetadata, {
    status: "PARTIAL_OR_AVAILABLE",
    documentsWithLanguage: 1,
    documentsWithoutLanguage: 1,
    coverage: 0.5,
    note: "GKG TranslationInfo source-language metadata was present for some WEB documents; this is not a complete language classification."
  });
  const candidate = report.candidates[0];
  assert.deepEqual(candidate.languages, [{ label: "eng", count: 1 }]);
  assert.deepEqual(candidate.languageCoverage, {
    knownLanguageArticles: 1, unknownLanguageArticles: 1, coverage: 0.5
  });
});

test("adds transparent quality flags and a stratified manual review sample", () => {
  const accumulator = createCandidateAccumulator();
  for (let index = 0; index < 10; index++) {
    addGkgDocument(accumulator, {
      valid: true, sourceCollectionId: "1",
      url: `https://same-publisher.example/story-${index}`,
      allNames: ["Chief Executive Officer,1", "CEO Name Variant,2"],
      persons: [], organizations: [], themes: ["BUSINESS"]
    }, `batch-${index < 2 ? 1 : 2}`);
  }
  const report = summarizeCandidateDiscovery(accumulator, [
    { status: "COMPLETE" }, { status: "COMPLETE" }, { status: "COMPLETE" }, { status: "COMPLETE" }
  ]);
  const candidate = report.candidates.find(item => item.normalizedName === "chief executive officer");
  assert.ok(candidate.quality.reviewFlags.includes("domain_concentration_50pct_or_more"));
  assert.ok(candidate.quality.reviewFlags.includes("low_domain_count_3_or_less"));
  assert.ok(candidate.quality.reviewFlags.includes("no_person_or_organization_cross_signal"));
  assert.ok(candidate.quality.reviewFlags.includes("possible_generic_or_boilerplate_phrase"));
  assert.ok(report.manualReviewSample.some(item =>
    item.normalizedName === "chief executive officer" && item.strata.includes("domain_concentrated")
  ));
  assert.equal(report.manualReviewSample[0].manualAssessment.relevance, null);
});


test("suggests possible aliases from shared tokens and repeated article co-occurrence without merging them", () => {
  const accumulator = createCandidateAccumulator();
  for (let index = 0; index < 4; index++) {
    const common = {
      valid: true, sourceCollectionId: "1",
      url: `https://news-${index}.example/story`,
      persons: ["Donald Trump"], organizations: [], themes: []
    };
    addGkgDocument(accumulator, {
      ...common,
      allNames: ["Donald Trump,1", "President Donald Trump,2"]
    }, `batch-${index}`);
  }
  addGkgDocument(accumulator, {
    valid: true, sourceCollectionId: "1", url: "https://extra.example/one",
    allNames: ["Donald Trump,1"], persons: ["Donald Trump"], organizations: [], themes: []
  }, "batch-extra");
  const report = summarizeCandidateDiscovery(accumulator, [
    { status: "COMPLETE" }, { status: "COMPLETE" }, { status: "COMPLETE" }, { status: "COMPLETE" }
  ]);
  const pair = report.possibleAliasPairs.find(item =>
    new Set([item.first, item.second]).has("Donald Trump") &&
    new Set([item.first, item.second]).has("President Donald Trump")
  );
  assert.ok(pair);
  assert.equal(pair.sharedArticleCount, 4);
  assert.deepEqual(pair.sharedTokens, ["donald", "trump"]);
  assert.equal(pair.assessment, null);
  assert.equal(report.candidates.length, 2);
});
