import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const baseConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
};

const night = '2026-10-30';
const emptyNight = '2026-10-29';
const missingNight = '2026-10-28';

const tempDirs: string[] = [];

function createRunsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  tempDirs.push(dir);
  return dir;
}

function writeNight(runsDir: string, name: string, contents: string): void {
  writeFileSync(join(runsDir, `${name}.jsonl`), contents, 'utf8');
}

function event(
  at: string,
  job: string,
  status: 'ok' | 'retry' | 'fail',
  owner: string | null,
  error?: string,
): string {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

function expectCount(item: string | undefined, label: string, count: number): void {
  expect(item).toBeDefined();
  expect(item).toMatch(new RegExp(`(?:${label}[^0-9]*${count}|${count}[^0-9]*${label})`));
}

function digestFixture(): string {
  const runsDir = createRunsDir();
  mkdirSync(runsDir, { recursive: true });
  writeNight(
    runsDir,
    night,
    [
      event('2026-10-30T01:00:00-04:00', 'zulu', 'fail', null, 'disk <full> & recovery'),
      event('2026-10-30T02:00:00+02:00', 'A & <job>', 'retry', 'ops'),
      event('2026-10-30T03:00:00+02:00', 'A & <job>', 'retry', 'ops'),
      event('2026-10-30T04:00:00+02:00', 'A & <job>', 'retry', 'ops'),
      event('2026-10-30T05:00:00+02:00', 'A & <job>', 'ok', 'ops'),
      'not valid json',
    ].join('\n'),
  );
  writeNight(runsDir, emptyNight, '');
  return runsDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('renders a night and reports malformed lines, null owners, warnings, escaped text, and original offsets', async () => {
    const runsDir = digestFixture();
    const app = createApp({ ...baseConfig, runsDir });

    const response = await app.request(`/digest/${night}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`<h1>digest · ${night}</h1>`);
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('warning: 3 or more retries');
    expect(html).toContain('warning: failures');
    expect(html).toContain('—');
    expect(html).toContain('A &amp; &lt;job&gt;');
    expect(html).toContain('disk &lt;full&gt; &amp; recovery');
    expect(html).not.toContain('A & <job>');
    expect(html).not.toContain('disk <full> & recovery');
    expect(html).toContain('2026-10-30T01:00:00-04:00');
    expect(html).toContain('2026-10-30T02:00:00+02:00');
    expect(html).toContain('2026-10-30T05:00:00+02:00');
    expect(html.indexOf('A &amp; &lt;job&gt;')).toBeLessThan(html.indexOf('zulu'));
  });

  it('returns the same sorted rows as the page in the JSON response', async () => {
    const runsDir = digestFixture();
    const app = createApp({ ...baseConfig, runsDir });

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(digest).toEqual({
      night,
      rows: [
        {
          job: 'A & <job>',
          owner: 'ops',
          runs: 4,
          retries: 3,
          failures: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-30T02:00:00+02:00',
          lastAt: '2026-10-30T05:00:00+02:00',
        },
        {
          job: 'zulu',
          owner: null,
          runs: 1,
          retries: 0,
          failures: 1,
          lastStatus: 'fail',
          lastError: 'disk <full> & recovery',
          firstAt: '2026-10-30T01:00:00-04:00',
          lastAt: '2026-10-30T01:00:00-04:00',
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 3, fail: 1 },
    });
    expect(html.indexOf('A &amp; &lt;job&gt;')).toBeLessThan(html.indexOf('zulu'));
    expect(digest.rows.map((row) => row.job)).toEqual(['A & <job>', 'zulu']);
  });

  it('returns 404 for a missing night on both routes', async () => {
    const runsDir = digestFixture();
    const app = createApp({ ...baseConfig, runsDir });

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${missingNight}`),
      app.request(`/api/digest/${missingNight}`),
    ]);

    expect(htmlResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
  });

  it('renders an empty night and returns an empty JSON digest', async () => {
    const runsDir = digestFixture();
    const app = createApp({ ...baseConfig, runsDir });

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${emptyNight}`),
      app.request(`/api/digest/${emptyNight}`),
    ]);
    const html = await htmlResponse.text();
    const digest = (await jsonResponse.json()) as NightDigest;

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(digest).toEqual({ night: emptyNight, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('links each temporary night from the board and shows its event counts', async () => {
    const runsDir = digestFixture();
    const app = createApp({ ...baseConfig, runsDir });

    const response = await app.request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    for (const date of [night, emptyNight]) {
      expect(html).toContain(`href="/digest/${date}"`);
    }
    const populatedItem = html.match(new RegExp(`<li>[^<]*<a href="/digest/${night}">[\\s\\S]*?<\\/li>`))?.[0];
    expectCount(populatedItem, 'ok', 1);
    expectCount(populatedItem, 'retry', 3);
    expectCount(populatedItem, 'fail', 1);

    const emptyItem = html.match(new RegExp(`<li>[^<]*<a href="/digest/${emptyNight}">[\\s\\S]*?<\\/li>`))?.[0];
    expectCount(emptyItem, 'ok', 0);
    expectCount(emptyItem, 'retry', 0);
    expectCount(emptyItem, 'fail', 0);
  });
});
