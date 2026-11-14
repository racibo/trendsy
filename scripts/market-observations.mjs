export function validateDailySnapshot(snapshot) {
  const sampling = snapshot?.sampling ?? {};
  if (sampling.status !== "COMPLETE" || sampling.sampleHours !== 24 || sampling.successfulSampleHours !== 24) {
    throw new Error("Refusing to publish anything except a COMPLETE 24/24-hour daily sample.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(snapshot?.date ?? ""))) {
    throw new Error("Snapshot date is missing or invalid.");
  }
  if (!Array.isArray(snapshot.results) || snapshot.results.length === 0) {
    throw new Error("Snapshot has no candidate results.");
  }
  return snapshot.results.map(item => {
    if (!item?.id || !item?.label || !item?.category) throw new Error("Candidate is missing id, label or category.");
    const integer = value => {
      const n = Number(value ?? 0);
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("Candidate contains an invalid count.");
      return n;
    };
    return {
      candidate_id: String(item.id),
      label: String(item.label),
      category: String(item.category),
      locale: String(item.locale ?? "global"),
      observation_date: snapshot.date,
      matched_records: integer(item.matchedRecords),
      unique_articles: integer(item.uniqueArticles),
      match_quality: String(item.matchQuality ?? "unreviewed"),
      review_status: String(item.reviewStatus ?? "manual_review_required"),
      evidence_count: integer(item.evidenceCount),
      quality_flags: Array.isArray(item.qualityFlags) ? item.qualityFlags.map(String) : [],
      source: String(snapshot.source ?? "GDELT Web News NGrams 3.0"),
      coverage_start_utc: snapshot.sampling.coverageStartUtc ?? null,
      coverage_end_utc: snapshot.sampling.coverageEndUtc ?? null
    };
  });
}
