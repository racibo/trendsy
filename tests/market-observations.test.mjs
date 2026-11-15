import test from "node:test";
import assert from "node:assert/strict";
import { validateDailySnapshot } from "../scripts/market-observations.mjs";
import { publishObservations } from "../scripts/publish-market-observations.mjs";
import { listDates } from "../scripts/backfill-market-observations.mjs";

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

test("confirms every observation returned by Supabase", async () => {
  const rows = validateDailySnapshot(base);
  let request;
  const confirmed = await publishObservations({
    baseUrl: "https://example.supabase.co/",
    secretKey: "test-secret",
    rows,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => rows.map(row => ({
          candidate_id: row.candidate_id,
          observation_date: row.observation_date
        }))
      };
    }
  });

  assert.equal(confirmed, 1);
  assert.equal(request.url, "https://example.supabase.co/rest/v1/market_observations?on_conflict=candidate_id,observation_date&select=candidate_id,observation_date");
  assert.equal(request.options.headers.apikey, "test-secret");
  assert.equal(request.options.headers.Prefer, "resolution=merge-duplicates,return=representation");
  assert.equal("Authorization" in request.options.headers, false);
});

test("rejects a successful HTTP response that confirms fewer rows than sent", async () => {
  const rows = validateDailySnapshot(base);
  await assert.rejects(
    publishObservations({
      baseUrl: "https://example.supabase.co",
      secretKey: "test-secret",
      rows,
      fetchImpl: async () => ({ ok: true, json: async () => [] })
    }),
    /confirmation mismatch: expected 1 observations, received 0/
  );
});

test("rejects an unreadable Supabase confirmation", async () => {
  const rows = validateDailySnapshot(base);
  await assert.rejects(
    publishObservations({
      baseUrl: "https://example.supabase.co",
      secretKey: "test-secret",
      rows,
      fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("invalid JSON"); } })
    }),
    /did not return a readable row confirmation/
  );
});


test("lists every UTC archive date in an inclusive backfill range", () => {
  assert.deepEqual(listDates("2026-11-09", "2026-11-11"), [
    "2026-11-09",
    "2026-11-10",
    "2026-11-11"
  ]);
});

test("rejects invalid or reversed backfill date ranges", () => {
  assert.throws(() => listDates("2026-02-30", "2026-03-01"), /valid start and end dates/);
  assert.throws(() => listDates("2026-11-12", "2026-11-09"), /must not be after/);
});
