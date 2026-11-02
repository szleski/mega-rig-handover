# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Morning digest

The board links each night to `/digest/<YYYY-MM-DD>` with its ok, retry and fail
event counts. `/api/digest/<YYYY-MM-DD>` returns the same sorted job rows as JSON,
alongside `night`, `badLines` and `counts`. Missing or invalid nights return 404;
an empty log renders "nothing ran". Invalid log records are counted and skipped.

Each job retains its latest owner and status, total runs, retries, failures, most
recent reported error, and first/last timestamps with their original offsets.
Rows with three or more retries or any failures carry visible warnings.

```sh
pnpm test
pnpm typecheck
```

The lane service binds to localhost. For review, start it with the supplied
`LANE_MARKER` in the ignored `.env`, then export one self-contained HTML file
**outside this repository**:

```sh
mkdir -p ../preview
curl --fail --silent --show-error http://127.0.0.1:8787/digest/2026-10-28 --output ../preview/index.html
```

Publish that file only after human approval. After review, restart rig with
`LANE_MARKER` empty, export the page again, and obtain separate approval before
replacing the file at the same public URL. Confirm that the page says "no marker
set", then archive `plan.md` with its issue links. Keep preview HTML out of git.

This plan is tracked in [issues #1–#8](https://github.com/szleski/mega-rig-handover/issues?q=label%3Aplan%3Amorning-digest).
