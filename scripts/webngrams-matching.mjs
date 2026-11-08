export function normalizeTokens(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
}

export function containsSequence(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

export function matchCandidate(candidate, record) {
  const context = [
    record?.pre,
    record?.ngram,
    record?.post
  ].filter(Boolean).join(" ");
  const contextTokens = normalizeTokens(context);
  if (!contextTokens.length) return null;

  const aliases = (candidate.aliases ?? []).map(alias => ({
    alias,
    tokens: normalizeTokens(alias)
  })).filter(item => item.tokens.length);

  const matchedAliases = aliases.filter(item => {
    if (!containsSequence(contextTokens, item.tokens)) return false;
    if (item.tokens.length > 1) return true;

    const policy = candidate.singleTokenPolicy;
    if (!policy) return false;
    const required = (policy.requiredAny ?? []).map(normalizeTokens);
    const excluded = (policy.excludeAny ?? []).map(normalizeTokens);
    if (excluded.some(phrase => containsSequence(contextTokens, phrase))) return false;
    return required.some(phrase => containsSequence(contextTokens, phrase));
  });

  if (!matchedAliases.length) return null;
  return {
    matchedAliases: matchedAliases.map(item => item.alias),
    matchType: matchedAliases.every(item => item.tokens.length > 1)
      ? "multiword_phrase"
      : "context_filtered_single_token",
    context
  };
}
