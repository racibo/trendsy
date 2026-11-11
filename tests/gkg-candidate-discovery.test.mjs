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
  assert.deepEqual(parseAllNameMention("World Cup"), { name: "World Cup", offset: null });
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
  assert.equal(trump.independentDomains, 2);
  assert.equal(trump.mentionOccurrences, 3);
  assert.equal(trump.personSignalArticles, 2);
  assert.equal(trump.themes.find(item => item.label === "ELECTION").count, 2);
  assert.equal(report.summary.uniqueCandidateNames, 2);
  assert.equal(report.summary.candidatesWithAtLeastTwoArticles, 1);
});
