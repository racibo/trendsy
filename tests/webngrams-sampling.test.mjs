import test from "node:test";
import assert from "node:assert/strict";
import { buildHourlyTargets } from "../scripts/webngrams-sampling.mjs";

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
