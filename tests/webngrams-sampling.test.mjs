import test from "node:test";
import assert from "node:assert/strict";
import { buildHourlyTargets, summarizeHourlyCoverage, appendUniqueEvidence } from "../scripts/webngrams-sampling.mjs";

test("builds one timestamp per hour across the previous 24 complete UTC hours", () => {
  const now = new Date("2026-11-08T23:42:00.000Z");
  const targets = buildHourlyTargets(now, 24);
  assert.equal(targets.length, 24);
  assert.equal(targets[0].sampleHour, "2026-11-07T23:00:00.000Z");
  assert.equal(targets.at(-1).sampleHour, "2026-11-08T22:00:00.000Z");
  assert.equal(new Set(targets.map(item => item.sampleHour)).size, 24);
});

test("rotates probe times across the four quarter-hour publication slots", () => {
  const targets = buildHourlyTargets(new Date("2026-11-08T23:42:00.000Z"), 4);
  assert.deepEqual(targets.map(item => item.target.getUTCMinutes()), [46, 31, 16, 1]);
  assert.deepEqual(targets.map(item => item.fallback.getUTCMinutes()), [47, 32, 17, 2]);
});

test("limits the sample to at most 24 hours", () => {
  assert.equal(buildHourlyTargets(new Date(), 48).length, 24);
});


test("marks a complete hourly sample only when every requested hour succeeded", () => {
  const files = [
    { sampleHour: "2026-11-08T10:00:00.000Z", status: "ok" },
    { sampleHour: "2026-11-08T11:00:00.000Z", status: "ok" },
    { sampleHour: "2026-11-08T12:00:00.000Z", status: "ok" }
  ];
  assert.deepEqual(summarizeHourlyCoverage(3, files), {
    status: "COMPLETE",
    requestedSamples: 3,
    successfulSamples: 3,
    missingSamples: 0,
    failedFiles: 0,
    missingPublicationProbes: 0
  });
});

test("marks a sample with a timed-out hour as partial", () => {
  const files = [
    { sampleHour: "2026-11-08T10:00:00.000Z", status: "ok" },
    { sampleHour: "2026-11-08T11:00:00.000Z", status: "processing_error" },
    { sampleHour: "2026-11-08T12:00:00.000Z", status: "ok" }
  ];
  assert.deepEqual(summarizeHourlyCoverage(3, files), {
    status: "PARTIAL",
    requestedSamples: 3,
    successfulSamples: 2,
    missingSamples: 1,
    failedFiles: 1,
    missingPublicationProbes: 0
  });
});


test("uses a five-minute default file timeout and bounds configured values", async () => {
  const { getWebNgramsFileTimeoutMs } = await import("../scripts/webngrams-sampling.mjs");
  assert.equal(getWebNgramsFileTimeoutMs(undefined), 300000);
  assert.equal(getWebNgramsFileTimeoutMs("45000"), 45000);
  assert.equal(getWebNgramsFileTimeoutMs("1"), 30000);
  assert.equal(getWebNgramsFileTimeoutMs("900000"), 600000);
  assert.equal(getWebNgramsFileTimeoutMs("invalid"), 300000);
});


test("retains up to the configured evidence cap across multiple files", () => {
  const retained = [];
  const firstBatch = Array.from({ length: 8 }, (_, i) => ({ url: `https://example.com/${i}` }));
  const secondBatch = Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/${i + 8}` }));
  appendUniqueEvidence(retained, firstBatch, 25);
  appendUniqueEvidence(retained, secondBatch, 25);
  assert.equal(retained.length, 25);
  assert.equal(new Set(retained.map(item => item.url)).size, 25);
});

test("does not add duplicate article URLs and respects the evidence limit", () => {
  const retained = [{ url: "https://example.com/a" }];
  appendUniqueEvidence(retained, [
    { url: "https://example.com/a" },
    { url: "https://example.com/b" },
    { url: "https://example.com/c" }
  ], 2);
  assert.deepEqual(retained.map(item => item.url), [
    "https://example.com/a", "https://example.com/b"
  ]);
});
