export const GKG_FIELD_COUNT = 27;

export const GKG_FIELD_INDEX = Object.freeze({
  recordId: 0,
  publishedAt: 1,
  sourceCollectionId: 2,
  sourceCommonName: 3,
  documentIdentifier: 4,
  themes: 7,
  enhancedThemes: 8,
  persons: 11,
  organizations: 13,
  allNames: 23,
  translationInfo: 25
});

export function parseGkgLine(line) {
  const columns = String(line ?? "").replace(/\\r$/, "").split("\\t");
  if (!columns[0] || columns.length < GKG_FIELD_COUNT) {
    return { valid: false, fieldCount: columns.length };
  }

  const get = key => columns[GKG_FIELD_INDEX[key]] ?? "";
  const translationInfo = get("translationInfo");
  const languageMatch = translationInfo.match(/(?:^|;)\\s*srclc:([a-z]{3})/i);
  const allNames = get("allNames").split(";").map(entry => {
    const separator = entry.lastIndexOf(",");
    return (separator >= 0 ? entry.slice(0, separator) : entry).trim();
  }).filter(Boolean);
  const themes = get("themes").split(";").map(value => value.trim()).filter(Boolean);

  return {
    valid: true,
    fieldCount: columns.length,
    recordId: get("recordId"),
    publishedAt: get("publishedAt"),
    sourceCollectionId: get("sourceCollectionId"),
    sourceCommonName: get("sourceCommonName"),
    url: get("documentIdentifier"),
    themes,
    persons: get("persons").split(";").map(value => value.trim()).filter(Boolean),
    organizations: get("organizations").split(";").map(value => value.trim()).filter(Boolean),
    allNames,
    sourceLanguage: languageMatch?.[1]?.toLowerCase() ?? null
  };
}

export function normalizeUrlForJoin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    if ((url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.href;
  } catch {
    return null;
  }
}

export function summarizeUrlJoin(gkgUrls, webNgramUrls) {
  const gkgOriginal = new Set(gkgUrls.filter(Boolean));
  const ngramOriginal = new Set(webNgramUrls.filter(Boolean));
  const exactMatches = [...gkgOriginal].filter(url => ngramOriginal.has(url)).length;
  const gkgNormalized = new Set([...gkgOriginal].map(normalizeUrlForJoin).filter(Boolean));
  const ngramNormalized = new Set([...ngramOriginal].map(normalizeUrlForJoin).filter(Boolean));
  const normalizedMatches = [...gkgNormalized].filter(url => ngramNormalized.has(url)).length;
  return {
    gkgUniqueUrls: gkgOriginal.size,
    webNgramUniqueUrls: ngramOriginal.size,
    exactMatches,
    normalizedMatches,
    normalizedOnlyMatches: Math.max(0, normalizedMatches - exactMatches),
    gkgToWebNgramMatchRate: gkgOriginal.size
      ? Number((normalizedMatches / gkgOriginal.size).toFixed(4))
      : 0
  };
}

export function nextWebNgramsFilename(gkgFilename, minuteOffset = 1) {
  const match = String(gkgFilename ?? "").match(/(\\d{14})\\.gkg\\.csv\\.zip$/);
  if (!match) throw new Error("Unrecognized GKG filename timestamp.");
  const stamp = match[1];
  const date = new Date(Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)),
    Number(stamp.slice(12, 14))
  ));
  date.setUTCMinutes(date.getUTCMinutes() + minuteOffset);
  return date.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "").replace("T", "") + ".webngrams.json.gz";
}
