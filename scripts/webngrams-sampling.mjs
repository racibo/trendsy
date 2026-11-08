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
