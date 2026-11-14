import test from "node:test";
import assert from "node:assert/strict";
import { validateDailySnapshot } from "../scripts/market-observations.mjs";

const base = {
  date: "2026-11-14",
  source: "GDELT Web News NGrams 3.0",
  sampling: { status: "COMPLETE", sampleHours: 24, successfulSampleHours: 24, coverageStartUtc: "20261113134600", coverageEndUtc: "20261114120100" },
  results: [{ id: "person-example", label: "Example Person", category: "global_people", matchedRecords: 20, uniqueArticles: 4, matchQuality: "multiword_phrase_candidate_review_required", reviewStatus: "manual_review_required", evidenceCount: 3, qualityFlags: ["evidence_is_capped_sample_not_full_article_list"] }]
};

test("maps a complete 24-hour sample to raw observation rows", () => {
  const [row] = validateDailySnapshot(base);
  assert.equal(row.candidate_id, "person-example");
  assert.equal(row.observation_date, "2026-11-14");
  assert.equal(row.unique_articles, 4);
  assert.equal(row.review_status, "manual_review_required");
  assert.deepEqual(row.quality_flags, ["evidence_is_capped_sample_not_full_article_list"]);
});

test("rejects partial samples instead of publishing incomplete data", () => {
  assert.throws(() => validateDailySnapshot({ ...base, sampling: { ...base.sampling, status: "PARTIAL" } }), /COMPLETE 24\/24-hour/);
});

test("rejects negative and non-integer counters", () => {
  assert.throws(() => validateDailySnapshot({ ...base, results: [{ ...base.results[0], uniqueArticles: -1 }] }), /invalid count/);
});

test("rejects an empty candidate list", () => {
  assert.throws(() => validateDailySnapshot({ ...base, results: [] }), /no candidate results/);
});
