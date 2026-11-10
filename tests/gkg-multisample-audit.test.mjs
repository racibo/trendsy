import test from "node:test";
import assert from "node:assert/strict";
import { gkgSampleFilenames, summarizeMultiSample } from "../scripts/gkg-multisample-utils.mjs";

test("selects evenly spaced quarter-hour GKG batches backwards from latest", () => {
  const samples = gkgSampleFilenames("20261111200000.gkg.csv.zip", 10, 150);
  assert.equal(samples.length, 10);
  assert.equal(samples[0].filename, "20261111200000.gkg.csv.zip");
  assert.equal(samples[1].filename, "20261111173000.gkg.csv.zip");
  assert.equal(samples[9].filename, "20261110100000.gkg.csv.zip");
  assert.equal(samples[9].offsetMinutes, -1350);
});

test("rejects invalid sample plans", () => {
  assert.throws(() => gkgSampleFilenames("bad-name", 10, 150));
  assert.throws(() => gkgSampleFilenames("20261111200000.gkg.csv.zip", 0, 150));
  assert.throws(() => gkgSampleFilenames("20261111200000.gkg.csv.zip", 10, 20));
});

test("summarizes per-sample join stability and weighted coverage", () => {
  const summary = summarizeMultiSample([
    { status: "COMPLETE", urlJoin: { gkgToWebNgramMatchRate: 0.8, gkgUniqueUrls: 100, normalizedMatches: 80 }, availableNgramsFileCount: 2, availableFileOffsets: [-14, -13] },
    { status: "COMPLETE", urlJoin: { gkgToWebNgramMatchRate: 0.6, gkgUniqueUrls: 200, normalizedMatches: 120 }, availableNgramsFileCount: 1, availableFileOffsets: [-12] },
    { status: "GKG_MISSING" },
    { status: "NGRAMS_MISSING" }
  ]);
  assert.equal(summary.requestedSamples, 4);
  assert.equal(summary.completeSamples, 2);
  assert.equal(summary.missingGkgSamples, 1);
  assert.equal(summary.samplesWithoutNgrams, 1);
  assert.equal(summary.meanMatchRate, 0.7);
  assert.equal(summary.medianMatchRate, 0.7);
  assert.equal(summary.weightedMatchRate, 0.6667);
  assert.equal(summary.minNgramsOffsetMinutes, -14);
  assert.equal(summary.maxNgramsOffsetMinutes, -12);
});
