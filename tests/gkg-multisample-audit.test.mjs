import test from "node:test";
import assert from "node:assert/strict";
import { gkgSampleFilenames, summarizeMultiSample, summarizeDailyHistory, renderDailyHistoryMarkdown, parseDailyHistoryJson, serializeDailyHistoryJson } from "../scripts/gkg-multisample-utils.mjs";

test("selects evenly spaced quarter-hour GKG batches backwards from latest", () => {
  const samples = gkgSampleFilenames("20261111200000.gkg.csv.zip", 10, 150);
  assert.equal(samples.length, 10);
  assert.equal(samples[0].filename, "20261111200000.gkg.csv.zip");
  assert.equal(samples[1].filename, "20261111173000.gkg.csv.zip");
  assert.equal(samples[9].filename, "20261110213000.gkg.csv.zip");
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


test("daily history requires three consecutive complete UTC days",()=>{
 const h=["2026-11-09","2026-11-10","2026-11-11"].map((date,i)=>({date,status:"COMPLETE",weightedMatchRate:[.9,.92,.94][i],completeSamples:10,requestedSamples:10,meanMatchRate:.91,totalGkgUniqueUrls:100}));
 const s=summarizeDailyHistory(h);
 assert.equal(s.threeDay.ready,true); assert.equal(s.threeDay.meanWeightedMatchRate,.92); assert.equal(s.sevenDay.ready,false);
 assert.match(renderDailyHistoryMarkdown({generatedAt:"2026-11-11",summary:s}),/3 dni: gotowe/);
});
test("partial or missing UTC days do not count toward consecutive windows",()=>{
 const h=[{date:"2026-11-08",status:"COMPLETE",weightedMatchRate:.9},{date:"2026-11-09",status:"PARTIAL",weightedMatchRate:.5},{date:"2026-11-10",status:"COMPLETE",weightedMatchRate:.92},{date:"2026-11-11",status:"COMPLETE",weightedMatchRate:.94}];
 const s=summarizeDailyHistory(h); assert.equal(s.completeDays,3); assert.equal(s.consecutiveCompleteDays,2); assert.equal(s.threeDay.ready,false);
});


test("repairs the legacy literal escaped newline and preserves existing history", () => {
  const legacy = '[{"date":"2026-11-11","status":"PARTIAL"}]\\n';
  assert.deepEqual(parseDailyHistoryJson(legacy), [{ date: "2026-11-11", status: "PARTIAL" }]);
});

test("writes valid JSON with a real trailing newline and round-trips", () => {
  const history = [{ date: "2026-11-11", status: "PARTIAL" }];
  const serialized = serializeDailyHistoryJson(history);
  assert.ok(serialized.endsWith("\n"));
  assert.ok(!serialized.endsWith("\\n"));
  assert.deepEqual(parseDailyHistoryJson(serialized), history);
});

test("rejects malformed or non-array history instead of silently resetting it", () => {
  assert.throws(() => parseDailyHistoryJson("{broken"));
  assert.throws(() => parseDailyHistoryJson('{"date":"2026-11-11"}'), /Invalid history array/);
});
