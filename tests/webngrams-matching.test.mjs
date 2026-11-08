import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTokens, matchCandidate } from "../scripts/webngrams-matching.mjs";

test("normalization ignores Polish diacritics and preserves word boundaries", () => {
  assert.deepEqual(normalizeTokens("Gdańsk, Kraków!"), ["gdansk", "krakow"]);
});

test("single-token city alias accepts an inflected alias only with geographic context", () => {
  const candidate = {
    aliases: ["Gdańsk", "Gdańska", "Gdańsku", "Gdańskiem"],
    singleTokenPolicy: { requiredAny: ["Poland", "Polish", "Pomerania"], excludeAny: [] }
  };
  assert.equal(matchCandidate(candidate, { pre: "w", ngram: "Gdańsku", post: "Poland" })?.matchType,
    "context_filtered_single_token");
  assert.equal(matchCandidate(candidate, { pre: "w", ngram: "Gdańsku", post: "nowym projekcie" }), null);
});

test("country single-token aliases require country-related context", () => {
  const france = {
    aliases: ["France"],
    singleTokenPolicy: { requiredAny: ["French", "Lyon", "Marseille"], excludeAny: [] }
  };
  assert.equal(matchCandidate(france, { pre: "agreement with", ngram: "France", post: "and Germany" }), null);
  assert.ok(matchCandidate(france, { pre: "the", ngram: "French", post: "government announced" }) === null);
  assert.ok(matchCandidate(france, { pre: "in", ngram: "France", post: "the French government said" }));
});

test("Paris Agreement and TV Tokyo are rejected as single-token city false positives", () => {
  const paris = {
    aliases: ["Paris"],
    singleTokenPolicy: {
      requiredAny: ["France", "French", "Seine", "Eiffel Tower"],
      excludeAny: ["Paris Agreement", "Paris climate agreement"]
    }
  };
  const tokyo = {
    aliases: ["Tokyo"],
    singleTokenPolicy: {
      requiredAny: ["Japan", "Japanese", "Shibuya", "Shinjuku"],
      excludeAny: ["TV Tokyo", "Tokyo Broadcasting"]
    }
  };
  assert.equal(matchCandidate(paris, { pre: "the", ngram: "Paris", post: "Agreement was signed" }), null);
  assert.equal(matchCandidate(tokyo, { pre: "watch", ngram: "TV Tokyo", post: "tonight" }), null);
  assert.ok(matchCandidate(paris, { pre: "in", ngram: "Paris", post: "France near the Seine" }));
  assert.ok(matchCandidate(tokyo, { pre: "in", ngram: "Tokyo", post: "Japan near Shibuya" }));
});

test("specific multiword event aliases do not need single-token context policy", () => {
  const event = { aliases: ["2026 Youth Olympic Games"] };
  assert.ok(matchCandidate(event, { pre: "the", ngram: "2026 Youth Olympic Games", post: "opened in Dakar" }));
});
