import test from "node:test";
import assert from "node:assert/strict";
import {
  GKG_FIELD_COUNT,
  parseGkgLine,
  normalizeUrlForJoin,
  summarizeUrlJoin,
  nextWebNgramsFilename
} from "../scripts/gkg-audit-utils.mjs";

function makeGkgLine(overrides = {}) {
  const fields = Array(GKG_FIELD_COUNT).fill("");
  fields[0] = "20261110223000-1";
  fields[1] = "20261110223000";
  fields[2] = "1";
  fields[3] = "example.com";
  fields[4] = "https://example.com/story";
  fields[7] = "POLITICS;ECON_STOCKMARKET";
  fields[11] = "Jane Doe";
  fields[13] = "Example Organization";
  fields[23] = "Climate Summit,120;World Cup,450";
  fields[25] = "srclc:pol; eng:Example translation model";
  for (const [index, value] of Object.entries(overrides)) fields[Number(index)] = value;
  return fields.join("\\t");
}

test("parses GKG document identity, themes, names and original language", () => {
  const parsed = parseGkgLine(makeGkgLine());
  assert.equal(parsed.valid, true);
  assert.equal(parsed.sourceCollectionId, "1");
  assert.equal(parsed.url, "https://example.com/story");
  assert.deepEqual(parsed.themes, ["POLITICS", "ECON_STOCKMARKET"]);
  assert.deepEqual(parsed.allNames, ["Climate Summit", "World Cup"]);
  assert.equal(parsed.sourceLanguage, "pol");
});

test("rejects rows shorter than the documented GKG 2.1 field set", () => {
  const parsed = parseGkgLine("only\\ttwo");
  assert.equal(parsed.valid, false);
  assert.equal(parsed.fieldCount, 2);
});

test("normalizes only URL host/default-port/fragment details", () => {
  assert.equal(
    normalizeUrlForJoin("HTTPS://Example.COM:443/story?a=1#top"),
    "https://example.com/story?a=1"
  );
  assert.notEqual(
    normalizeUrlForJoin("https://example.com/story?a=1"),
    normalizeUrlForJoin("https://example.com/story?a=2")
  );
  assert.equal(normalizeUrlForJoin("javascript:alert(1)"), null);
});

test("reports exact and conservative normalized URL joins separately", () => {
  const result = summarizeUrlJoin(
    ["https://example.com/a", "https://example.com/b#fragment"],
    ["https://example.com/a", "https://EXAMPLE.com/b"]
  );
  assert.equal(result.exactMatches, 1);
  assert.equal(result.normalizedMatches, 2);
  assert.equal(result.normalizedOnlyMatches, 1);
  assert.equal(result.gkgToWebNgramMatchRate, 1);
});

test("maps a GKG quarter-hour batch to the next Web NGrams publication minute", () => {
  assert.equal(
    nextWebNgramsFilename("20261110223000.gkg.csv.zip"),
    "20261110223100.webngrams.json.gz"
  );
});
