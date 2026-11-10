import test from "node:test";
import assert from "node:assert/strict";
import { createDailyArchive } from "../scripts/archive-webngrams-daily.mjs";

function makeSnapshot(overrides = {}) {
  return {
    source: "GDELT Web News NGrams 3.0",
    generatedAt: "2026-11-09T10:16:48.143Z",
    sampling: {
      status: "COMPLETE",
      sampleHours: 24,
      successfulSampleHours: 24,
      missingSampleHours: 0,
      failedFiles: 0,
      coverageStartUtc: "20261108094700",
      coverageEndUtc: "20261109080100"
    },
    summary: { totalCandidates: 1, candidatesWithMatches: 1 },
    results: [{
      id: "person-example",
      label: "Example Person",
      category: "global_people",
      locale: "global",
      matchedRecords: 123,
      uniqueArticles: 12,
      multiwordPhraseMatchedRecords: 123,
      contextFilteredMatchedRecords: 0,
      languageCounts: { en: 123 },
      aliasCounts: { "Example Person": 123 },
      matchQuality: "multiword_phrase_candidate_review_required",
      evidence: [{ url: "https://example.com/story", context: "example context", lang: "en", matchType: "multiword_phrase", aliasMatches: ["Example Person"], sampleHour: "2026-11-09T08:00:00.000Z" }]
    }],
    ...overrides
  };
}

test("creates a compact daily archive from a complete 24-hour snapshot", () => {
  const archive = createDailyArchive(makeSnapshot());
  assert.equal(archive.date, "2026-11-09");
  assert.equal(archive.sampling.status, "COMPLETE");
  assert.equal(archive.results[0].uniqueArticles, 12);
  assert.deepEqual(archive.results[0].languageCounts, { en: 123 });
  assert.equal(archive.schemaVersion, 2);
  assert.equal(archive.results[0].evidenceCount, 1);
  assert.equal(archive.results[0].evidence[0].url, "https://example.com/story");
  assert.equal(archive.results[0].evidence[0].domain, "example.com");
  assert.equal(archive.results[0].evidence[0].context, "example context");
  assert.equal(archive.results[0].reviewStatus, "manual_review_required");
  assert.ok(archive.results[0].qualityFlags.includes("evidence_is_capped_sample_not_full_article_list"));
  assert.equal(archive.summary.totalArchivedEvidenceArticles, 1);
  assert.equal("files" in archive.sampling, false);
});

test("rejects partial or incomplete daily samples", () => {
  assert.throws(
    () => createDailyArchive(makeSnapshot({
      sampling: { ...makeSnapshot().sampling, status: "PARTIAL" }
    })),
    /incomplete/
  );
  assert.throws(
    () => createDailyArchive(makeSnapshot({
      sampling: { ...makeSnapshot().sampling, successfulSampleHours: 23 }
    })),
    /24 successful/
  );
});

test("rejects malformed coverage timestamps and empty candidate lists", () => {
  assert.throws(
    () => createDailyArchive(makeSnapshot({
      sampling: { ...makeSnapshot().sampling, coverageEndUtc: "invalid" }
    })),
    /coverageEndUtc/
  );
  assert.throws(
    () => createDailyArchive(makeSnapshot({ results: [] })),
    /no candidate/
  );
});


test("drops unsafe and duplicate evidence URLs and flags candidates with no evidence", () => {
  const snapshot = makeSnapshot();
  snapshot.results[0].uniqueArticles = 3;
  snapshot.results[0].evidence = [
    { url: "javascript:alert(1)", context: "unsafe" },
    { url: "https://example.com/story", context: "first" },
    { url: "https://example.com/story", context: "duplicate" }
  ];
  const archive = createDailyArchive(snapshot);
  assert.equal(archive.results[0].evidenceCount, 1);
  assert.equal(archive.results[0].evidence[0].context, "first");
  assert.equal(archive.results[0].evidenceCoverage, 0.3333);

  const empty = createDailyArchive(makeSnapshot({
    results: [{ ...makeSnapshot().results[0], uniqueArticles: 0, evidence: [] }]
  }));
  assert.ok(empty.results[0].qualityFlags.includes("no_unique_articles_in_sample"));
});
