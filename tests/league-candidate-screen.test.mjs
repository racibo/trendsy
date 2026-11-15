import test from "node:test";
import assert from "node:assert/strict";
import { buildLeagueCandidateScreen, scoreLeagueCandidate } from "../scripts/league-candidate-screen-utils.mjs";

function candidate(name, overrides = {}) {
  return {
    name, normalizedName: name.toLowerCase(), uniqueArticles: 30, uniqueDomains: 8,
    sampledBatches: 12, singleTokenName: false, personSignalArticles: 15,
    organizationSignalArticles: 0, locationSignalArticles: 0, languageCoverage: { coverage: 0.8 },
    quality: { topDomainShare: 0.2, reviewFlags: [] },
    evidence: [{ url: "https://example.com/story" }],
    ...overrides
  };
}

test("scores a well-supported candidate and keeps it eligible for human review", () => {
  const result = scoreLeagueCandidate(candidate("Climate Change"), {
    exactPhrase: { status: "ok", gkgEvidenceUrlMatches: 1, headlineExactPhraseCount: 1 },
    repeat2: { status: "ok", gkgEvidenceUrlMatches: 0, headlineExactPhraseCount: 0 }
  }, 30);
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.decision, "REVIEW_CANDIDATE");
  assert.ok(result.score > 60);
});

test("holds generic, concentrated and weak single-token candidates", () => {
  const generic = scoreLeagueCandidate(candidate("Breaking News", {
    quality: { topDomainShare: 0.2, reviewFlags: ["possible_generic_or_boilerplate_phrase"] }
  }), null, 30);
  assert.ok(generic.exclusionReasons.includes("generic_or_boilerplate_name"));

  const concentrated = scoreLeagueCandidate(candidate("Local Topic", {
    quality: { topDomainShare: 0.9, reviewFlags: [] }
  }), null, 30);
  assert.ok(concentrated.exclusionReasons.includes("one_domain_over_75_percent"));

  const ambiguous = scoreLeagueCandidate(candidate("Mercury", {
    singleTokenName: true, personSignalArticles: 0, organizationSignalArticles: 0
  }), null, 30);
  assert.ok(ambiguous.exclusionReasons.includes("ambiguous_single_token_without_entity_cross_signal"));
});

test("does not treat missing language metadata as a disqualifier", () => {
  const result = scoreLeagueCandidate(candidate("Gdansk", {
    languageCoverage: { coverage: 0 }
  }), null, 30);
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.languageCoverage, 0);
});

test("builds at most 16 research candidates and never auto-admits them to the game", () => {
  const discovery = {
    status: "COMPLETE", summary: { completeSamples: 30 },
    candidates: Array.from({ length: 20 }, (_, i) => candidate("Topic " + i))
  };
  const report = buildLeagueCandidateScreen(discovery, { candidates: [] });
  assert.equal(report.top16ResearchShortlist.length, 16);
  assert.equal(report.summary.top16AreResearchShortlist, true);
  assert.equal(report.top16ResearchShortlist[0].decision, "REVIEW_CANDIDATE");
  assert.equal(report.methodology.purpose.includes("not a popularity index"), true);
});

test("refuses to create a final league shortlist from incomplete discovery", () => {
  const discovery = { status: "PARTIAL", summary: { completeSamples: 4 }, candidates: [] };
  assert.equal(discovery.status, "PARTIAL");
});


test("classifies candidates with location cross-signals as places", () => {
  const result = scoreLeagueCandidate(candidate("Gdańsk", {
    personSignalArticles: 0, organizationSignalArticles: 0, locationSignalArticles: 18
  }), null, 30);
  assert.equal(result.candidateType, "place");
  assert.equal(result.eligibleForReview, true);
});
