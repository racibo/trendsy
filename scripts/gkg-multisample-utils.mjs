export function gkgSampleFilenames(latestFilename, sampleCount = 10, spacingMinutes = 150) {
  const match = String(latestFilename ?? "").match(/^(\\d{14})\\.gkg\\.csv\\.zip$/);
  if (!match) throw new Error("Unrecognized GKG filename timestamp.");
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 48) {
    throw new Error("sampleCount must be an integer between 1 and 48.");
  }
  if (!Number.isInteger(spacingMinutes) || spacingMinutes < 15 || spacingMinutes % 15 !== 0) {
    throw new Error("spacingMinutes must be a multiple of 15 and at least 15.");
  }
  const stamp = match[1];
  const latest = new Date(Date.UTC(
    Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)), Number(stamp.slice(8, 10)),
    Number(stamp.slice(10, 12)), Number(stamp.slice(12, 14))
  ));
  return Array.from({ length: sampleCount }, (_, index) => {
    const date = new Date(latest.getTime() - index * spacingMinutes * 60_000);
    const filename = date.toISOString().slice(0, 19)
      .replaceAll("-", "").replaceAll(":", "").replace("T", "") + ".gkg.csv.zip";
    return { index: index + 1, offsetMinutes: -index * spacingMinutes, filename };
  });
}

export function summarizeMultiSample(samples) {
  const available = samples.filter(sample => sample.status === "COMPLETE" && sample.urlJoin);
  const rates = available.map(sample => sample.urlJoin.gkgToWebNgramMatchRate).sort((a, b) => a - b);
  const mean = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : 0;
  const median = rates.length
    ? rates.length % 2
      ? rates[(rates.length - 1) / 2]
      : (rates[rates.length / 2 - 1] + rates[rates.length / 2]) / 2
    : 0;
  const totalGkgUrls = available.reduce((sum, sample) => sum + sample.urlJoin.gkgUniqueUrls, 0);
  const totalMatches = available.reduce((sum, sample) => sum + sample.urlJoin.normalizedMatches, 0);
  const offsets = available.flatMap(sample => sample.availableFileOffsets ?? []);
  return {
    requestedSamples: samples.length,
    completeSamples: available.length,
    missingGkgSamples: samples.filter(sample => sample.status === "GKG_MISSING").length,
    samplesWithoutNgrams: samples.filter(sample => sample.status === "NGRAMS_MISSING").length,
    meanMatchRate: Number(mean.toFixed(4)),
    medianMatchRate: Number(median.toFixed(4)),
    minMatchRate: rates.length ? rates[0] : 0,
    maxMatchRate: rates.length ? rates.at(-1) : 0,
    weightedMatchRate: totalGkgUrls ? Number((totalMatches / totalGkgUrls).toFixed(4)) : 0,
    totalGkgUniqueUrlsAcrossSamples: totalGkgUrls,
    totalMatchedUrlsAcrossSamples: totalMatches,
    meanAvailableNgramsFiles: available.length
      ? Number((available.reduce((sum, sample) => sum + sample.availableNgramsFileCount, 0) / available.length).toFixed(2))
      : 0,
    minNgramsOffsetMinutes: offsets.length ? Math.min(...offsets) : null,
    maxNgramsOffsetMinutes: offsets.length ? Math.max(...offsets) : null
  };
}
