import test from "node:test";
import assert from "node:assert/strict";
import { createWebNgramsReviewAudit, toReviewCsv, toReviewMarkdown } from "../scripts/webngrams-review-audit-utils.mjs";

function snapshot() {
  return {
    source: "GDELT Web News NGrams 3.0",
    generatedAt: "2026-11-11T11:00:00.000Z",
    sampling: { status: "COMPLETE", sampleHours: 24, successfulSampleHours: 24 },
    results: [{
      id: "person-example",
      label: "Example Person",
      category: "people",
      locale: "global",
      matchedRecords: 100,
      uniqueArticles: 3,
      multiwordPhraseMatchedRecords: 100,
      contextFilteredMatchedRecords: 0,
      evidence: [
        { url: "https://www.example.com/a", lang: "en", matchType: "multiword_phrase", aliasMatches: ["Example Person"], context: "Example Person spoke today", sampleHour: "2026-11-11T01:00:00Z" },
        { url: "https://example.com/b", lang: "en", matchType: "multiword_phrase", aliasMatches: ["Example Person"], context: "A second mention", sampleHour: "2026-11-11T02:00:00Z" },
        { url: "https://other.test/c", lang: "fr", matchType: "multiword_phrase", aliasMatches: ["Example Person"], context: "Un troisième contexte", sampleHour: "2026-11-11T03:00:00Z" },
        { url: "javascript:alert(1)", lang: "en", context: "unsafe" },
        { url: "https://example.com/a", lang: "en", context: "duplicate URL" }
      ]
    }]
  };
}

test("builds a review worksheet with sample-only source concentration diagnostics", () => {
  const audit = createWebNgramsReviewAudit(snapshot());
  const candidate = audit.candidates[0];
  assert.equal(audit.summary.evidenceRows, 3);
  assert.equal(candidate.domainCount, 2);
  assert.equal(candidate.domainCounts["example.com"], 2);
  assert.equal(candidate.topDomain, "example.com");
  assert.equal(candidate.topDomainShare, 0.6667);
  assert.equal(candidate.topThreeDomainShare, 1);
  assert.ok(candidate.qualityFlags.includes("evidence_sample_concentrated_in_one_domain"));
  assert.equal(candidate.evidence[0].relevanceAssessment, "");
  assert.equal(candidate.evidence[0].entityResolutionAssessment, "");
  assert.match(audit.interpretation.limitation, /capped evidence sample/);
});

test("exports a usable CSV with blank human assessment fields and a concise Markdown report", () => {
  const audit = createWebNgramsReviewAudit(snapshot());
  const csv = toReviewCsv(audit);
  const markdown = toReviewMarkdown(audit);
  assert.match(csv, /relevance_assessment,entity_resolution_assessment,notes/);
  assert.match(csv, /Example Person/);
  assert.match(markdown, /Candidate diagnostics/);
  assert.match(markdown, /Top domain share/);
  assert.match(markdown, /not a validated popularity index/);
});

test("rejects snapshots without candidate results", () => {
  assert.throws(() => createWebNgramsReviewAudit({ results: [] }), /no candidate results/);
});
