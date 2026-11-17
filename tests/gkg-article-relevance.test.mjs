import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRelevanceQueries,
  normalizeArticleUrl,
  scoreHeadline,
  summarizeArticleResults
} from "../scripts/gkg-article-relevance-utils.mjs";

test("builds exact phrase and proximity query for multi-token candidates", () => {
  assert.deepEqual(buildRelevanceQueries("Donald Trump"), {
    exactPhrase: '"Donald Trump"',
    repeatedToken: "donald",
    contextOperator: "near10",
    repeatQuery: '"Donald Trump" near10:"donald trump"'
  });
});

test("rejects an empty candidate name", () => {
  assert.throws(() => buildRelevanceQueries("  "), /Candidate name is required/);
});

test("normalizes article URLs for evidence matching", () => {
  assert.equal(
    normalizeArticleUrl("https://WWW.Example.com/story/?utm_source=x#top"),
    "https://example.com/story"
  );
  assert.equal(normalizeArticleUrl("not a URL"), null);
});

test("scores headline token coverage without making a relevance decision", () => {
  assert.deepEqual(scoreHeadline("New York City", "New York mayor visits Albany"), {
    exactPhraseInHeadline: false,
    matchedCandidateTokens: ["new", "york"],
    tokenCoverage: 0.6667
  });
});

test("matches GKG evidence URLs and leaves human assessment blank", () => {
  const result = summarizeArticleResults(
    "Donald Trump",
    ["https://www.example.com/story?ref=gkg"],
    [{ url: "https://example.com/story", title: "Donald Trump speaks", domain: "example.com" }],
    []
  );
  assert.equal(result.exactPhrase.gkgEvidenceUrlMatches, 1);
  assert.equal(result.exactPhrase.headlineExactPhraseCount, 1);
  assert.equal(result.manualAssessment.headlineFocus, null);
});


test("uses a repeated-token filter for ambiguous single-token candidates", () => {
  assert.deepEqual(buildRelevanceQueries("Paris"), {
    exactPhrase: '"Paris"',
    repeatedToken: "paris",
    contextOperator: "repeat3",
    repeatQuery: '"Paris" repeat3:"paris"'
  });
});
