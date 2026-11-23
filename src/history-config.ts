export const MAX_HISTORY_RECORDS = 5000;
export const MIN_HISTORY_RECORDS = 1;

export function normalizeHistoryRecordLimit(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value)
    && value >= MIN_HISTORY_RECORDS && value <= MAX_HISTORY_RECORDS
    ? value : MAX_HISTORY_RECORDS;
}
