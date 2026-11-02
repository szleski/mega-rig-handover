import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const tempDirs: string[] = [];
function runsDir(contents: string, date = night): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, `${date}.jsonl`), contents);
  return dir;
}
function event(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides });
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('run log reader', () => {
  it('reads the supplied night without changing the fixture', () => {
    expect(readNight('runs', night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, failures: 0, lastStatus: 'ok', lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, failures: 0, lastStatus: 'ok', lastError: 'lock held', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, failures: 1, lastStatus: 'fail', lastError: 'quota exceeded', firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, failures: 0, lastStatus: 'ok', lastError: null, firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('returns an empty digest for empty and whitespace-only files', () => {
    for (const contents of ['', '\n \r\n\t\n']) {
      expect(readNight(runsDir(contents), night)).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    }
  });

  it('returns null for missing files, impossible dates, and traversal names', () => {
    const dir = runsDir('');
    expect(readNight(dir, '2026-10-27')).toBeNull();
    expect(readNight(join(dir, 'missing'), night)).toBeNull();
    for (const date of ['../2026-10-28', '/2026-10-28', '2026-10-28/..', '2026-10-28\n', '2026-1-01', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00']) {
      // Existing files cannot make an invalid date admissible.
      if (/^[\d\s-]+$/.test(date)) writeFileSync(join(dir, `${date}.jsonl`), event());
      expect(readNight(dir, date)).toBeNull();
    }
    for (const date of ['2024-02-29', '2000-02-29']) {
      expect(readNight(runsDir('', date), date)?.rows).toEqual([]);
    }
  });

  it('counts malformed JSON and invalid schemas while retaining good lines', () => {
    const invalid = [
      '{', 'null', '[]', '42', '{}',
      event({ at: null }), event({ job: 4 }), event({ job: '' }), event({ job: '   ' }),
      event({ status: 'pending' }), event({ owner: undefined }), event({ owner: 4 }),
      event({ error: null }), event({ error: {} }),
      ...['2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-29', '2026-10-29T01:00:00', '2026-10-29T24:00:00Z', '2026-10-29T01:60:00Z', '2026-10-29T01:00:60Z', '2026-10-29T01:00:00+24:00', '2026-10-29T01:00:00+01:60', '2026-10-29T01:00:00Z\n'].map((at) => event({ at })),
    ];
    const digest = readNight(runsDir([event(), '', ...invalid, event({ owner: null, job: 'other' })].join('\r\n')), night);
    expect(digest?.badLines).toBe(invalid.length);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest?.rows).toHaveLength(2);
  });

  it('uses chronological bounds, owners and errors across offsets and unordered input', () => {
    const digest = readNight(runsDir([
      event({ at: '2026-10-29T01:10:00Z', owner: null }),
      event({ at: '2026-10-29T02:00:00+01:00', status: 'retry', error: 'new error' }),
      event({ at: '2026-10-29T03:30:00+03:00', status: 'fail', error: 'old error', owner: 'old owner' }),
      event({ at: '2026-10-28T23:20:00-01:00', status: 'retry' }),
    ].join('\n')), night);
    expect(digest?.rows).toEqual([{
      job: 'job', owner: null, runs: 4, retries: 2, failures: 1, lastStatus: 'ok', lastError: 'new error',
      firstAt: '2026-10-28T23:20:00-01:00', lastAt: '2026-10-29T01:10:00Z',
    }]);
    expect(digest?.counts).toEqual({ ok: 1, retry: 2, fail: 1 });
  });

  it('breaks equal-instant ties by line order and preserves empty reported errors', () => {
    const digest = readNight(runsDir([
      event({ at: '2026-10-29T01:00:00.100+01:00', status: 'fail', error: 'first' }),
      event({ at: '2026-10-29T00:00:00.1Z', status: 'retry', owner: null, error: '' }),
    ].join('\n')), night);
    expect(digest?.rows[0]).toMatchObject({ owner: null, lastStatus: 'retry', lastError: '', firstAt: '2026-10-29T01:00:00.100+01:00', lastAt: '2026-10-29T00:00:00.1Z' });
  });

  it('orders sub-millisecond timestamps without losing precision', () => {
    const digest = readNight(runsDir([
      event({ at: '2026-10-29T00:00:00.00011Z', owner: 'latest' }),
      event({ at: '2026-10-29T00:00:00.0001Z', owner: 'earliest' }),
    ].join('\n')), night);
    expect(digest?.rows[0]).toMatchObject({ owner: 'latest', firstAt: '2026-10-29T00:00:00.0001Z', lastAt: '2026-10-29T00:00:00.00011Z' });
  });

  it('sorts jobs by Unicode code points and handles object property names as jobs', () => {
    const names = ['𐀀', '\uE000', 'a', 'Z', '__proto__', 'constructor'];
    const digest = readNight(runsDir(names.map((job) => event({ job })).join('\n')), night);
    expect(digest?.rows.map(({ job }) => job)).toEqual(['Z', '__proto__', 'a', 'constructor', '\uE000', '𐀀']);
  });

  it('propagates filesystem errors other than missing files', () => {
    const dir = runsDir('');
    rmSync(join(dir, `${night}.jsonl`));
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
    const fileAsDir = join(runsDir(''), `${night}.jsonl`);
    expect(() => readNight(fileAsDir, night)).toThrow();
  });
});
