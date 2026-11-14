export function gkgSampleFilenames(latestFilename, sampleCount = 10, spacingMinutes = 150) {
  const match = String(latestFilename ?? "").match(/^(\d{14})\.gkg\.csv\.zip$/);
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


export function parseDailyHistoryJson(content) {
  let source = String(content ?? "").trimEnd();
  // Repair the literal backslash+n suffix written by earlier versions of the audit.
  if (source.endsWith("\\n")) source = source.slice(0, -2).trimEnd();
  const history = JSON.parse(source);
  if (!Array.isArray(history)) throw new Error("Invalid history array.");
  return history;
}

export function serializeJsonWithNewline(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

export function serializeDailyHistoryJson(history) {
  if (!Array.isArray(history)) throw new Error("History must be an array.");
  return serializeJsonWithNewline(history);
}

export function summarizeDailyHistory(history) {
  const byDate = new Map();
  for (const entry of history ?? []) {
    if (entry?.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)) byDate.set(entry.date, entry);
  }
  const entries = [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const complete = entries.filter(x=>x.status==="COMPLETE");
  const consecutive=[];
  for(let i=complete.length-1;i>=0;i--){
    if(consecutive.length && (Date.parse(consecutive.at(-1).date+"T00:00:00Z")-Date.parse(complete[i].date+"T00:00:00Z"))/86400000!==1) break;
    consecutive.push(complete[i]);
  }
  consecutive.reverse();
  const window3=consecutive.slice(-3), window7=consecutive.slice(-7);
  const avg=rows=>rows.length?Number((rows.reduce((n,x)=>n+x.weightedMatchRate,0)/rows.length).toFixed(4)):null;
  const window=rows=>({ready:rows.length===(rows===window3?3:7),dates:rows.map(x=>x.date),meanWeightedMatchRate:avg(rows),minWeightedMatchRate:rows.length?Math.min(...rows.map(x=>x.weightedMatchRate)):null,maxWeightedMatchRate:rows.length?Math.max(...rows.map(x=>x.weightedMatchRate)):null});
  return {retainedDays:entries.length,completeDays:complete.length,consecutiveCompleteDays:consecutive.length,threeDay:window(window3),sevenDay:window(window7),entries};
}

export function renderDailyHistoryMarkdown(report) {
 const s=report.summary;
 const line=(name,w,required)=>w.ready?`- ${name}: gotowe (${w.dates.join(", ")}); średnia ${(w.meanWeightedMatchRate*100).toFixed(2)}%, zakres ${(w.minWeightedMatchRate*100).toFixed(2)}–${(w.maxWeightedMatchRate*100).toFixed(2)}%.`:`- ${name}: oczekiwanie na ${required} pełnych kolejnych dni; obecnie ${w.dates.length}.`;
 return ["# GKG daily history: multi-day coverage comparison","",`- Wygenerowano: ${report.generatedAt}`,`- Pełne dni: ${s.completeDays}; kolejne pełne dni: ${s.consecutiveCompleteDays}`,line("3 dni",s.threeDay,3),line("7 dni",s.sevenDay,7),"","| Dzień UTC | Status | Próbki | Ważony URL join | Średni URL join | GKG URL |","|---|---|---:|---:|---:|---:|",...s.entries.map(x=>`| ${x.date} | ${x.status} | ${x.completeSamples}/${x.requestedSamples} | ${(x.weightedMatchRate*100).toFixed(2)}% | ${(x.meanMatchRate*100).toFixed(2)}% | ${x.totalGkgUniqueUrls} |`),"","## Interpretacja","- To techniczne pokrycie URL między GKG i Web NGrams, nie ranking popularności tematów.","- Każdy dzienny pomiar obejmuje 10 partii GKG z około 22,5 godziny.","- Okna wymagają kolejnych pełnych dni UTC; niepełne dni nie są wliczane.","- Historia przechowuje maksymalnie 30 dni.","- Wyniki nie zmieniają automatycznie kandydatów, ligi ani cen.",""].join("\n");
}
