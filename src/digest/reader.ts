import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

type Timestamp = { seconds: number; fraction: string };
type Job = { row: DigestRow; first: Timestamp; last: Timestamp; errorAt?: Timestamp };

function validDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function timestamp(value: string): Timestamp | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || match[0] !== value || !validDate(match[1])) return null;
  const [, date, hour, minute, second, fraction = '', offset] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null;
  const seconds = Date.parse(`${date}T${hour}:${minute}:${second}${offset}`) / 1000;
  return Number.isFinite(seconds) ? { seconds, fraction: fraction.replace(/0+$/, '') } : null;
}

// Compare fractional seconds without discarding precision beyond milliseconds.
function compareTime(a: Timestamp, b: Timestamp): number {
  if (a.seconds !== b.seconds) return a.seconds - b.seconds;
  return a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0;
}

function parseEvent(line: string): { event: RunEvent; time: Timestamp } | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (typeof event.at !== 'string' || typeof event.job !== 'string' || !event.job.trim()
    || (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail')
    || (event.owner !== null && typeof event.owner !== 'string')
    || ('error' in event && typeof event.error !== 'string')) return null;
  const time = timestamp(event.at);
  if (!time) return null;
  return {
    event: { at: event.at, job: event.job, status: event.status, owner: event.owner, error: event.error as string | undefined },
    time,
  };
}

function compareJobs(a: DigestRow, b: DigestRow): number {
  const left = Array.from(a.job, (char) => char.codePointAt(0)!);
  const right = Array.from(b.job, (char) => char.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validDate(night)) return null;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const digest: NightDigest = { night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, Job>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = parseEvent(line);
    if (!parsed) {
      digest.badLines++;
      continue;
    }
    const { event, time } = parsed;
    digest.counts[event.status]++;
    let job = jobs.get(event.job);
    if (!job) {
      job = {
        row: {
          job: event.job, owner: event.owner, runs: 0, retries: 0, failures: 0,
          lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
        },
        first: time,
        last: time,
      };
      jobs.set(event.job, job);
    }
    const { row } = job;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.failures++;
    if (compareTime(time, job.first) < 0) {
      job.first = time;
      row.firstAt = event.at;
    }
    // File order breaks ties: the last event at an instant wins.
    if (compareTime(time, job.last) >= 0) {
      job.last = time;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && (!job.errorAt || compareTime(time, job.errorAt) >= 0)) {
      job.errorAt = time;
      row.lastError = event.error;
    }
  }
  digest.rows = Array.from(jobs.values(), ({ row }) => row).sort(compareJobs);
  return digest;
};
