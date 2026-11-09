export function buildHourlyTargets(now = new Date(), hours = 24) {
  const count = Math.min(24, Math.max(1, Math.floor(Number(hours) || 24)));
  const hourStart = new Date(now);
  hourStart.setUTCMinutes(0, 0, 0);
  const quarterHourSlots = [1, 16, 31, 46];

  return Array.from({ length: count }, (_, index) => {
    const hoursAgo = count - index;
    const bucketStart = new Date(hourStart.getTime() - hoursAgo * 60 * 60 * 1000);
    const target = new Date(bucketStart);
    target.setUTCMinutes(quarterHourSlots[(hoursAgo - 1) % quarterHourSlots.length], 0, 0);
    return {
      sampleHour: bucketStart.toISOString(),
      target,
      fallback: new Date(target.getTime() + 60_000)
    };
  });
}


export function summarizeHourlyCoverage(requestedHours, files) {
  const requested = Math.min(24, Math.max(1, Math.floor(Number(requestedHours) || 24)));
  const successfulHours = new Set(
    files.filter(file => file.status === "ok").map(file => file.sampleHour)
  );
  const successfulSamples = successfulHours.size;
  return {
    status: successfulSamples >= requested ? "COMPLETE" : "PARTIAL",
    requestedSamples: requested,
    successfulSamples,
    missingSamples: Math.max(0, requested - successfulSamples),
    failedFiles: files.filter(file => !["ok", "missing"].includes(file.status)).length,
    missingPublicationProbes: files.filter(file => file.status === "missing").length
  };
}


export function getWebNgramsFileTimeoutMs(value = process.env.WEBNGRAMS_FILE_TIMEOUT_MS) {
  const parsed = Number(value ?? 300000);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300000;
  return Math.min(600000, Math.max(30000, Math.floor(parsed)));
}


// Retain distinct article URLs up to the configured per-candidate evidence cap.
export function appendUniqueEvidence(target, incoming, limit = 25) {
  const max = Math.max(0, Math.floor(Number(limit) || 0));
  const seen = new Set(target.map(item => item.url));
  for (const item of incoming) {
    if (target.length >= max) break;
    if (!item?.url || seen.has(item.url)) continue;
    target.push(item);
    seen.add(item.url);
  }
  return target;
}
