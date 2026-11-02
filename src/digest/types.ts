/** Shared contract for the morning digest; implemented in reader.ts. */
export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner of the latest event, including an explicit null owner. */
  owner: string | null;
  /** Total valid events for this job, including retries and failures. */
  runs: number;
  retries: number;
  failures: number;
  lastStatus: RunStatus;
  /** Most recent reported error, retained after a successful retry. */
  lastError: string | null;
  /** Chronological bounds, preserving each original timestamp and offset. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** Sorted by job using code point order, shared by HTML and JSON. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid log events, rather than counts of job outcomes. */
  counts: Record<RunStatus, number>;
};

/**
 * readNight(runsDir, night): null for missing files or invalid YYYY-MM-DD nights;
 * an empty file returns a digest with no rows and zero counts. Malformed lines
 * increment badLines. Other filesystem failures propagate to the caller.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
