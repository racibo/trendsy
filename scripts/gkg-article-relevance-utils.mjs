export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRelevanceQueries(candidateName) {
  const name = String(candidateName ?? "").trim();
  if (!name) throw new Error("Candidate name is required");
  const tokens = normalizeText(name).split(" ").filter(Boolean);
  const repeatedToken = [...tokens].sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
  const phrase = '"' + name.replaceAll('"', '\\"') + '"';
  return {
    exactPhrase: phrase,
    repeatedToken,
    repeatQuery: phrase + ' repeat2:"' + repeatedToken + '"'
  };
}

export function normalizeArticleUrl(value) {
  try {
    const url = new URL(String(value));
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function scoreHeadline(candidateName, title) {
  const candidate = normalizeText(candidateName);
  const headline = normalizeText(title);
  const tokens = candidate.split(" ").filter(Boolean);
  const headlineTokens = new Set(headline.split(" ").filter(Boolean));
  const matchedTokens = tokens.filter(token => headlineTokens.has(token));
  return {
    exactPhraseInHeadline: candidate.length > 0 && headline.includes(candidate),
    matchedCandidateTokens: matchedTokens,
    tokenCoverage: tokens.length ? Number((matchedTokens.length / tokens.length).toFixed(4)) : 0
  };
}

export function summarizeArticleResults(candidateName, evidenceUrls, exactArticles, repeatArticles) {
  const evidence = new Set(evidenceUrls.map(normalizeArticleUrl).filter(Boolean));
  const decorate = articles => articles.map(article => ({
    ...article,
    headlineAssessment: scoreHeadline(candidateName, article.title),
    matchesGkgEvidenceUrl: evidence.has(normalizeArticleUrl(article.url))
  }));
  const exact = decorate(exactArticles);
  const repeat = decorate(repeatArticles);
  return {
    exactPhrase: {
      returnedArticles: exact.length,
      headlineExactPhraseCount: exact.filter(item => item.headlineAssessment.exactPhraseInHeadline).length,
      gkgEvidenceUrlMatches: exact.filter(item => item.matchesGkgEvidenceUrl).length,
      articles: exact
    },
    repeat2: {
      returnedArticles: repeat.length,
      headlineExactPhraseCount: repeat.filter(item => item.headlineAssessment.exactPhraseInHeadline).length,
      gkgEvidenceUrlMatches: repeat.filter(item => item.matchesGkgEvidenceUrl).length,
      articles: repeat
    },
    manualAssessment: {
      headlineFocus: null,
      evidenceRelevance: null,
      notes: ""
    }
  };
}
