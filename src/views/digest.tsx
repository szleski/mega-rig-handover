import type { NightDigest } from '../digest/types.js';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>bad lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? (
        <p>nothing ran</p>
      ) : (
        <>
          <p class="digest-scroll-hint">On a narrow screen, scroll sideways to read the full table.</p>
          <div class="digest-scroll" role="region" aria-label="Digest jobs" tabIndex={0}>
            <table class="digest-table">
              <thead>
                <tr>
                  <th>job</th>
                  <th>owner</th>
                  <th>runs</th>
                  <th>retries</th>
                  <th>failures</th>
                  <th>last status</th>
                  <th>last error</th>
                  <th>first at</th>
                  <th>last at</th>
                </tr>
              </thead>
              <tbody>
                {digest.rows.map((row) => (
                  <tr>
                    <td>{row.job}</td>
                    <td class="digest-nowrap">{row.owner ?? '—'}</td>
                    <td class="digest-number">{row.runs}</td>
                    <td>
                      {row.retries}
                      {row.retries >= 3 && <span class="warn"> · warning: 3 or more retries</span>}
                    </td>
                    <td>
                      {row.failures}
                      {row.failures > 0 && <span class="warn"> · warning: failures</span>}
                    </td>
                    <td class="digest-nowrap">{row.lastStatus}</td>
                    <td>{row.lastError ?? '—'}</td>
                    <td class="digest-nowrap">
                      <time datetime={row.firstAt}>{row.firstAt}</time>
                    </td>
                    <td class="digest-nowrap">
                      <time datetime={row.lastAt}>{row.lastAt}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
