# Optimization Audit - CF Monitor TanStack Start

Audit date: 2026-07-02
Auditor: GPT-5 Codex

Scope reviewed: TanStack Start routes/loaders, server functions, React dashboard data flow, SQLite/sql.js persistence, collector script, Bun start server, PM2 config, CI/CD workflow, dependencies, and current build/storage artifacts.

Observed current local baseline:

- `storage/cloudflare-cache-metrics.sqlite`: 823,296 bytes.
- Active rows: 1,329 `cache_metrics`, 10 `cache_rounds`.
- `getDashboard('all')`: 319 ms, 850,666 JSON bytes, 1,329 rows.
- `getRuntime('all')`: 282 ms, 849,747 JSON bytes, 1,329 rows.
- `getMetricRowsPage({ days: 'all', page: 1, pageSize: 50 })`: 35 ms, 272,397 JSON bytes, 522 rows.
- Largest built client asset: `dist/client/assets/index-B5oDvLM1.js`, 350,604 bytes raw, 109,609 bytes gzip, 94,494 bytes brotli.
- Query plans already use `idx_cache_metrics_deleted_at` and temp B-trees for group/distinct/order work, even on the small local DB.

## Opportunities

### 1. Replace `sql.js` with native server-side SQLite

File: `src/lib/metrics-db.ts:3`, `src/lib/metrics-db.ts:580`, `src/lib/metrics-db.ts:589`

Opportunity: The app loads the whole SQLite file into WASM memory with `new SQL.Database(await readFile(filename))` for each DB open and exports the whole database on each write with `db.export()`. This is the biggest database efficiency limit. It makes read cost proportional to database file size and write cost proportional to full database size, not changed rows.

Impact: High

Effort: High

Recommendation: Since production runs under Bun (`scripts/start-server.mjs:9`), use `bun:sqlite` for the server and collector, or `better-sqlite3` if Node compatibility becomes required. Enable WAL and a busy timeout, then keep queries statement-based.

```ts
import { Database } from 'bun:sqlite'

function openNativeDb(filename: string) {
  const db = new Database(filename, { create: true })
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `)
  return db
}
```

This removes full-file read/export cycles, improves concurrent read/write behavior, and is required before any serious scale-out.

### 2. Stop opening the database multiple times per dashboard request

File: `src/lib/monitor.server.ts:361`, `src/lib/monitor.server.ts:364`, `src/lib/monitor.server.ts:366`, `src/lib/monitor.server.ts:367`, `src/lib/monitor.server.ts:877`, `src/lib/monitor.server.ts:882`

Opportunity: `getDashboard()` calls `readConfig()`, `buildMetrics()`, and `readProxies()`. `buildMetrics()` then calls both `readMetricRows()` and `readMetricRounds()`. With the current DB layer, one dashboard request can load the SQLite file four times: config, rows, rounds, proxies.

Impact: High

Effort: Medium

Recommendation: Use a single request-scoped DB handle and read dashboard data in one snapshot. At minimum, cache low-churn settings in memory and invalidate on save.

```ts
export async function getDashboard(days: MetricRangeDays) {
  return withMetricsDbHandle(async (db) => {
    const config = await readConfigFromDb(db)
    const range = metricRange(days)
    const [metrics, proxies] = await Promise.all([
      buildMetricsFromDb(db, config, range),
      readProxiesFromDb(db),
    ])
    return { config, metrics, proxies, status: await snapshotState(config, metrics.rounds) }
  })
}
```

### 3. Make runtime polling summary-only

File: `src/lib/monitor.server.ts:378`, `src/lib/monitor.server.ts:380`, `src/lib/monitor.server.ts:876`, `src/lib/monitor.server.ts:974`, `src/components/dashboard/dashboard-context.tsx:87`, `src/components/dashboard/dashboard-context.tsx:100`

Opportunity: `getRuntime()` calls `buildMetrics()` and returns nearly the same 850 KB payload as the full dashboard on every poll. While running, polling happens every 3 seconds.

Impact: High

Effort: Medium

Recommendation: Split runtime status from raw metric rows. Poll only `status`, `summary`, and a compact round list. Load raw rows only in route-specific paged endpoints.

```ts
export async function getRuntime(days: MetricRangeDays) {
  const config = await readConfig()
  const range = metricRange(days)
  const [summary, rounds] = await Promise.all([
    readMetricSummary(config.output, root, range),
    readMetricRounds(config.output, root, { sinceIso: range.sinceIso }),
  ])

  return {
    metrics: { summary, rounds, range },
    status: await snapshotState(config, rounds),
  }
}
```

### 4. Move heavy data loaders from the dashboard layout to section routes

File: `src/routes/_dashboard.tsx:7`, `src/routes/_dashboard.metrics.tsx:7`, `src/routes/_dashboard.logs.tsx:7`, `src/routes/_dashboard.config.tsx:7`

Opportunity: The layout route loads `getDashboardFn()` for every dashboard child. Opening `/logs`, `/config`, or `/proxies` still pays for all metrics rows and derived metrics.

Impact: High

Effort: Medium

Recommendation: Keep the layout loader small: config, status, summary only. Move metrics matrix loading to `/metrics`, age aggregates to `/age`, round detail aggregates to `/rounds`, and proxy usage to `/proxies`.

```tsx
export const Route = createFileRoute('/_dashboard')({
  loader: () => getDashboardChromeFn({ data: { days: defaultMetricRangeDays } }),
  component: DashboardRoute,
})
```

### 5. Avoid the duplicate initial dashboard fetch after hydration

File: `src/routes/_dashboard.tsx:7`, `src/components/dashboard/use-stored-range.ts:8`, `src/components/dashboard/dashboard-context.tsx:96`

Opportunity: The route loader always fetches `defaultMetricRangeDays`, then the provider immediately calls `loadDashboard(rangeDays)` on mount. If localStorage has the same range, this repeats the same request. If localStorage has a different range, SSR still fetched the default first, which is currently `all`.

Impact: Medium

Effort: Low

Recommendation: Put range in URL search params or a cookie so the loader and client agree. If keeping localStorage, skip the first client fetch when the initial payload matches.

```tsx
const firstLoad = useRef(true)

useEffect(() => {
  if (firstLoad.current) {
    firstLoad.current = false
    if (rangeDays === initial.metrics.range.days) return
  }
  void loadDashboard(rangeDays).catch(showError)
}, [loadDashboard, rangeDays, showError, initial.metrics.range.days])
```

### 6. Change the default range from `all` to a bounded window

File: `src/lib/metric-range.ts:3`, `src/routes/_dashboard.tsx:7`, `src/components/dashboard/use-stored-range.ts:8`

Opportunity: The default dashboard range is `all`, so the first load always scales with all retained history. This is why a two-day local DB already returns an 850 KB dashboard/runtime payload.

Impact: High

Effort: Low

Recommendation: Default to 7 or 30 days, and make all-time an explicit user choice.

```ts
export const defaultMetricRangeDays: MetricRangeDays = 7
```

### 7. Wire retention into completed monitor rounds

File: `src/lib/metrics-db.ts:447`, `src/lib/metrics-db.ts:774`, `src/lib/monitor.server.ts:721`, `src/lib/monitor.server.ts:734`

Opportunity: `applyMetricRoundRetention()` exists but has no caller outside its definition. Data growth is therefore unbounded unless the user manually deletes data.

Impact: High

Effort: Low

Recommendation: Add `retentionDays` to `Config`, default it to 30 or 90, and apply retention after any terminal round status.

```ts
await finalizeMetricRound(config.output, roundId, { status: 'completed' }, root)
await applyMetricRoundRetention(config.output, config.retentionDays ?? 90, root)
```

### 8. Use hard cleanup and vacuum/checkpoint after bulk deletion

File: `src/lib/metrics-db.ts:457`, `src/lib/metrics-db.ts:465`, `src/lib/metrics-db.ts:774`

Opportunity: `softDeleteMetricData()` only sets `deleted_at`. Queries filter out soft-deleted rows, but storage remains and indexes keep growing. Retention uses hard deletes, but there is no compaction strategy for a native SQLite future.

Impact: Medium

Effort: Low

Recommendation: For "Delete all metric data", use hard delete or add a "hide" action separately. After large deletes, run `VACUUM` in maintenance windows or `PRAGMA wal_checkpoint(TRUNCATE)` for WAL databases.

```sql
DELETE FROM cache_metrics;
DELETE FROM cache_rounds;
VACUUM;
```

### 9. Stop wrapping indexed timestamp columns in `datetime(...)`

File: `src/lib/metrics-db.ts:219`, `src/lib/metrics-db.ts:220`, `src/lib/metrics-db.ts:542`, `src/lib/metrics-db.ts:845`, `src/lib/metrics-db.ts:851`

Opportunity: Queries call `datetime(timestamp_utc)` in `WHERE` predicates. SQLite cannot use a simple timestamp index efficiently when every row is passed through a function. Current query plans confirm the timestamp index is not selected for range filters.

Impact: High

Effort: Medium

Recommendation: Store a normalized numeric timestamp such as `timestamp_ms` or `timestamp_epoch`. Query integers directly.

```sql
ALTER TABLE cache_metrics ADD COLUMN timestamp_ms INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_cache_metrics_active_time
  ON cache_metrics (deleted_at, timestamp_ms, id);
```

```ts
clauses.push('timestamp_ms >= ?')
params.push(Date.parse(range.sinceIso))
```

### 10. Add composite indexes that match real query patterns

File: `src/lib/metrics-db.ts:663`, `src/lib/metrics-db.ts:669`, `src/lib/metrics-db.ts:672`, `src/lib/metrics-db.ts:675`, `src/lib/metrics-db.ts:678`, `src/lib/metrics-db.ts:681`

Opportunity: Existing indexes are mostly single-column. `readMetricRowsPage()` filters by `deleted_at`, date, page, country, status, then groups by `(page, url, proxy_country)`. The current plans use `idx_cache_metrics_deleted_at` and temp B-trees for group/distinct/order.

Impact: High

Effort: Low

Recommendation: Add composite and partial indexes after adding a numeric timestamp.

```sql
CREATE INDEX IF NOT EXISTS idx_cache_metrics_active_time_id
  ON cache_metrics (deleted_at, timestamp_ms, id);

CREATE INDEX IF NOT EXISTS idx_cache_metrics_active_group
  ON cache_metrics (deleted_at, page, url, proxy_country, id);

CREATE INDEX IF NOT EXISTS idx_cache_metrics_active_round
  ON cache_metrics (deleted_at, round_id, id);

CREATE INDEX IF NOT EXISTS idx_cache_metrics_active_status
  ON cache_metrics (deleted_at, cf_cache_status, timestamp_ms);
```

### 11. Avoid schema migration work on every read

File: `src/lib/metrics-db.ts:580`, `src/lib/metrics-db.ts:583`, `src/lib/metrics-db.ts:607`, `src/lib/metrics-db.ts:686`, `src/lib/metrics-db.ts:746`

Opportunity: `openMetricsDb()` calls `ensureMetricsSchema(db)` for every open, including read-only requests. That executes `CREATE TABLE`, `CREATE INDEX`, `PRAGMA table_info`, and legacy backfill checks repeatedly.

Impact: Medium

Effort: Medium

Recommendation: Run migrations once at app startup and before writes, not every read. Track schema version with `PRAGMA user_version`.

```ts
function ensureMetricsSchema(db: Database) {
  const version = db.query('PRAGMA user_version').get() as { user_version: number }
  if (version.user_version >= 2) return
  db.transaction(() => {
    // migrations...
    db.exec('PRAGMA user_version = 2')
  })()
}
```

### 12. Redesign `readMetricRowsPage()` around a bounded CTE

File: `src/lib/metrics-db.ts:241`, `src/lib/metrics-db.ts:245`, `src/lib/metrics-db.ts:251`, `src/lib/metrics-db.ts:261`, `src/lib/metrics-db.ts:273`, `src/lib/metrics-db.ts:295`, `src/lib/metrics-db.ts:333`

Opportunity: The paged endpoint does counts, group counts, group rows, a generated OR filter for selected groups, all columns, bounds, countries, pages, and statuses. It pages groups, but metadata and columns can still scan all matching rows.

Impact: High

Effort: Medium

Recommendation: Use a CTE for the selected groups and join back to metrics. Move filter option lists to separate cached endpoints.

```sql
WITH selected_groups AS (
  SELECT page, url, proxy_country, MIN(id) AS first_id
  FROM cache_metrics
  WHERE deleted_at = '' AND timestamp_ms >= ?
  GROUP BY page, url, proxy_country
  ORDER BY first_id
  LIMIT ? OFFSET ?
)
SELECT m.*
FROM cache_metrics m
JOIN selected_groups g
  ON g.page = m.page AND g.url = m.url AND g.proxy_country = m.proxy_country
WHERE m.deleted_at = ''
ORDER BY g.first_id, m.id;
```

### 13. Bound metrics matrix columns

File: `src/lib/metrics-db.ts:295`, `src/lib/metrics-db.ts:306`, `src/components/dashboard/panels/metrics-panel.tsx:101`, `src/components/dashboard/panels/metrics-panel.tsx:365`, `src/components/dashboard/panels/metrics-panel.tsx:378`

Opportunity: Matrix columns grow with every matching round. The UI then creates one table column per round and computes min width from all columns. Long retention makes the matrix huge even if row groups are paginated.

Impact: High

Effort: Medium

Recommendation: Add `maxColumns` or `roundLimit` to the endpoint. Default to the latest 50 to 100 rounds, with explicit navigation for older rounds.

```sql
SELECT *
FROM (
  SELECT CAST(round_id AS TEXT) AS round_id, round,
         MIN(timestamp_utc) AS started_at,
         MAX(timestamp_utc) AS completed_at,
         MIN(id) AS first_id
  FROM cache_metrics
  WHERE deleted_at = ''
  GROUP BY COALESCE(NULLIF(round, ''), CAST(round_id AS TEXT), '')
  ORDER BY first_id DESC
  LIMIT ?
)
ORDER BY first_id ASC;
```

### 14. Move age, round, and proxy aggregates server-side

File: `src/components/dashboard/dashboard-consumers.ts:173`, `src/components/dashboard/dashboard-consumers.ts:179`, `src/components/dashboard/dashboard-consumers.ts:227`, `src/components/dashboard/panels/age-panel.tsx:34`, `src/components/dashboard/panels/age-panel.tsx:47`, `src/components/dashboard/panels/age-panel.tsx:232`, `src/components/dashboard/panels/rounds-panel.tsx:123`, `src/components/dashboard/panels/rounds-panel.tsx:326`

Opportunity: Age, rounds, and proxies all derive UI data by scanning `metrics.rows` in the browser. This forces the app to keep raw rows in React context even when a route only needs aggregates.

Impact: High

Effort: Medium

Recommendation: Add server functions for:

- `getAgeSummaryFn({ days, link })`
- `getRoundDetailsFn({ days, roundId })`
- `getProxyUsageFn({ days })`

Return pre-aggregated arrays and small detail payloads. Keep raw rows out of `DashboardDataContext`.

### 15. Debounce metrics filters and prevent overlapping polling

File: `src/components/dashboard/dashboard-context.tsx:100`, `src/components/dashboard/dashboard-context.tsx:103`, `src/components/dashboard/dashboard-consumers.ts:68`, `src/components/dashboard/dashboard-consumers.ts:73`, `src/components/dashboard/dashboard-consumers.ts:97`

Opportunity: Polling does not check whether the previous request is still running. Metrics filtering sends a server request on every query/filter state change. The `active` flag prevents stale UI updates but does not cancel server work.

Impact: Medium

Effort: Low

Recommendation: Add an in-flight guard for polling and defer/debounce filter requests.

```tsx
const refreshInFlight = useRef(false)

useEffect(() => {
  const timer = window.setInterval(() => {
    if (dirtyPanel || refreshInFlight.current) return
    refreshInFlight.current = true
    void refreshRuntime()
      .catch(showError)
      .finally(() => {
        refreshInFlight.current = false
      })
  }, status.busy || status.running ? 3000 : 12000)

  return () => window.clearInterval(timer)
}, [dirtyPanel, refreshRuntime, showError, status.busy, status.running])
```

### 16. Stop double-finalizing dashboard-managed rounds

File: `src/lib/monitor.server.ts:644`, `src/lib/monitor.server.ts:684`, `src/lib/monitor.server.ts:713`, `src/lib/monitor.server.ts:721`, `scripts/cloudflare_cache_monitor.ts:635`, `scripts/cloudflare_cache_monitor.ts:830`

Opportunity: The parent creates a round, passes `--round-id`, and finalizes after the child exits. The child script also finalizes the same existing round. With sql.js, that is an extra full database export/write per successful run.

Impact: Medium

Effort: Low

Recommendation: Let the parent own finalization when `--round-id` is provided. Let the CLI script finalize only rounds it creates itself.

```ts
const ownsRound = args.roundId <= 0

if (ownsRound) {
  await finalizeMetricRound(args.output, roundId, {
    status: 'completed',
    totalRows: rowCount,
    recheckRows: recheckCount,
  })
}
```

### 17. Store numeric metric fields as numeric columns

File: `src/lib/metrics-db.ts:643`, `src/lib/metrics-db.ts:647`, `src/lib/metrics-db.ts:648`, `src/lib/metrics-db.ts:649`, `src/lib/monitor.server.ts:933`, `src/lib/monitor.server.ts:967`

Opportunity: `status_code`, `age_seconds`, `response_ms`, and `content_length` are stored as text. The server and client repeatedly coerce them with `Number(...)`, and indexes cannot efficiently support numeric range/aggregate queries.

Impact: Medium

Effort: Medium

Recommendation: Add numeric columns for new writes and backfill old rows. Keep text only for fields that are inherently textual.

```sql
ALTER TABLE cache_metrics ADD COLUMN response_ms_int INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cache_metrics ADD COLUMN age_seconds_int INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_cache_metrics_response_ms
  ON cache_metrics (deleted_at, response_ms_int);
```

### 18. Add FTS or a normalized search column for metrics search

File: `src/lib/metrics-db.ts:877`

Opportunity: Search builds `LOWER(page || ' ' || url || ...) LIKE ?`, which scans matching rows and cannot use normal indexes. It will get expensive with longer retention.

Impact: Medium

Effort: Medium

Recommendation: Add an FTS5 virtual table if using native SQLite, or maintain a lowercase `search_text` column and index selected exact filters.

```sql
CREATE VIRTUAL TABLE cache_metrics_fts USING fts5(
  page, url, proxy_country, cf_edge, proxy, error, cf_ray, status_code,
  content='cache_metrics',
  content_rowid='id'
);
```

### 19. Cache external proxy source downloads with TTL and size guards

File: `scripts/cloudflare_cache_monitor.ts:13`, `scripts/cloudflare_cache_monitor.ts:15`, `scripts/cloudflare_cache_monitor.ts:247`, `scripts/cloudflare_cache_monitor.ts:253`, `scripts/cloudflare_cache_monitor.ts:397`, `scripts/cloudflare_cache_monitor.ts:433`

Opportunity: Every collector round fetches public proxy lists again and reads whole response bodies into memory. A large or malformed upstream response can waste CPU/RAM and slow each run.

Impact: Medium

Effort: Medium

Recommendation: Cache fetched proxy source payloads or normalized selected proxies for 30 to 60 minutes, and enforce a max response size.

```ts
async function fetchText(url: string, timeout: number, maxBytes = 5_000_000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'UmmahOneCacheMonitor/1.0 (+https://ummah.one)' },
    signal: AbortSignal.timeout(timeout * 1000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const text = await response.text()
  if (Buffer.byteLength(text) > maxBytes) throw new Error(`response too large: ${url}`)
  return text
}
```

### 20. Reduce collector process startup cost

File: `src/lib/monitor.server.ts:684`, `src/lib/monitor.server.ts:764`, `src/lib/monitor.server.ts:766`, `src/lib/monitor.server.ts:774`, `scripts/cloudflare_cache_monitor.ts:184`

Opportunity: Each round spawns a TypeScript collector with `--experimental-strip-types`. Process startup and TypeScript stripping are paid every round.

Impact: Medium

Effort: Medium

Recommendation: Build the collector to JS during `bun run build`, or expose a `runCollector(args)` function and run it in a worker/child process without runtime TS stripping.

```json
{
  "scripts": {
    "build:collector": "bun build scripts/cloudflare_cache_monitor.ts --target=node --outdir=dist/scripts"
  }
}
```

### 21. Stream collector rows into one write transaction

File: `scripts/cloudflare_cache_monitor.ts:686`, `scripts/cloudflare_cache_monitor.ts:750`, `scripts/cloudflare_cache_monitor.ts:757`, `scripts/cloudflare_cache_monitor.ts:776`, `scripts/cloudflare_cache_monitor.ts:781`, `scripts/cloudflare_cache_monitor.ts:785`

Opportunity: `mapLimit()` stores all page results, then `main()` flattens them into `rows` and `rechecks`. Large page/proxy counts duplicate metric row arrays before writing.

Impact: Medium

Effort: Medium

Recommendation: After moving to native SQLite, open one transaction for the round and insert rows as each page completes. Keep only recheck targets in memory.

```ts
await db.transaction(async () => {
  await mapLimit(pages, args.pageConcurrency, async (page) => {
    const result = await checkPage(page, proxies, roundId, args)
    insertMetricRows(result.rows)
    rechecks.push(...result.rechecks)
  })
})()
```

Do not implement this by calling the current `appendMetricRows()` per page under sql.js, because each call would export the full DB again.

### 22. Add a collector resource budget

File: `scripts/cloudflare_cache_monitor.ts:82`, `scripts/cloudflare_cache_monitor.ts:83`, `scripts/cloudflare_cache_monitor.ts:500`, `scripts/cloudflare_cache_monitor.ts:750`, `scripts/cloudflare_cache_monitor.ts:776`

Opportunity: Defaults allow up to `pageConcurrency * countryConcurrency` active proxy groups. Each request spawns `curl`, so a run can create many short-lived processes under load.

Impact: Medium

Effort: Low

Recommendation: Add a global max active request/process budget and make dashboard config expose safe limits. For example, cap active curl processes to 8 or 12 on small VPS hosts.

```ts
const globalRequestLimit = positiveInteger(args.globalConcurrency, 8)
```

### 23. Keep the web process and collector as separate scalable roles

File: `src/lib/monitor.server.ts:146`, `src/lib/monitor.server.ts:171`, `src/lib/monitor.server.ts:419`, `src/lib/monitor.server.ts:849`, `ecosystem.config.cjs:16`, `ecosystem.config.cjs:17`

Opportunity: Runtime scheduler state lives in module globals. PM2 runs one forked instance. Scaling the web process to multiple instances would duplicate schedulers and active monitor state unless coordination is added.

Impact: Medium

Effort: High

Recommendation: Split roles:

- Web process: TanStack Start server, read-only dashboard, mutations.
- Worker process: one collector scheduler, controlled through DB state or a queue.

If keeping one process, add a DB-backed lock before each scheduled run.

```sql
CREATE TABLE IF NOT EXISTS app_locks (
  key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

### 24. Move devtools packages and rendering behind development-only boundaries

File: `src/routes/__root.tsx:6`, `src/routes/__root.tsx:7`, `src/routes/__root.tsx:51`, `vite.config.ts:13`, `package.json:24`, `package.json:26`, `package.json:28`, `package.json:47`

Opportunity: The root imports TanStack devtools and package.json keeps devtools packages in production dependencies. Even if the current production build tree-shakes most devtools UI, production installs still pay dependency size and risk accidental inclusion.

Impact: Low

Effort: Low

Recommendation: Move devtools packages to `devDependencies` and import/render only in development.

```tsx
{import.meta.env.DEV ? (
  <TanStackDevtools
    config={{ position: 'bottom-right' }}
    plugins={[
      { name: 'Tanstack Router', render: <TanStackRouterDevtoolsPanel /> },
      TanStackQueryDevtools,
    ]}
  />
) : null}
```

### 25. Remove unused dependencies and helper modules

File: `package.json:20`, `package.json:23`, `package.json:33`, `package.json:39`, `package.json:41`, `src/lib/utils.ts:1`, `src/env.ts:1`

Opportunity: `rg` found no app usage for `@faker-js/faker`, `@tanstack/match-sorter-utils`, `class-variance-authority`, `tw-animate-css`, or the `cn()` helper stack. `src/env.ts` is also not imported by the app.

Impact: Low

Effort: Low

Recommendation: Remove unused dependencies and files, or move truly planned tooling to `devDependencies`. Re-run build after removal.

```bash
bun remove @faker-js/faker @tanstack/match-sorter-utils class-variance-authority tw-animate-css clsx tailwind-merge
```

Keep `zod` if server function validation remains, and keep React Query only if the router SSR integration or future query caching is actually used.

### 26. Pin TanStack/package versions instead of using `latest`

File: `package.json:23`, `package.json:24`, `package.json:25`, `package.json:26`, `package.json:27`, `package.json:28`, `package.json:29`, `package.json:30`, `package.json:31`, `package.json:47`, `package.json:48`

Opportunity: Many dependencies use `latest`. The lockfile pins current installs, but future installs/upgrades can shift large framework packages unexpectedly and change bundle/runtime behavior.

Impact: Medium

Effort: Low

Recommendation: Replace `latest` with exact versions already resolved in `bun.lock`, then upgrade intentionally.

```json
"@tanstack/react-start": "1.x.y",
"@tanstack/react-router": "1.x.y"
```

### 27. Use TanStack Router loader deps/search params for range

File: `src/router.tsx:14`, `src/router.tsx:15`, `src/routes/_dashboard.tsx:7`, `src/components/dashboard/use-stored-range.ts:10`

Opportunity: Range is stored in localStorage instead of route state. The server loader cannot know it during SSR, so it fetches default data first. `defaultPreloadStaleTime: 0` also makes preloaded data immediately stale.

Impact: Medium

Effort: Medium

Recommendation: Put `days` in route search params and use loader deps. Set a non-zero stale time for expensive loaders.

```tsx
export const Route = createFileRoute('/_dashboard/metrics')({
  validateSearch: (search) => ({
    days: parseMetricRangeDays(String(search.days || defaultMetricRangeDays)),
  }),
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ deps }) => getMetricRowsPageFn({ data: { days: deps.days } }),
})
```

### 28. Add stronger HTTP caching and conditional static responses

File: `scripts/start-server.mjs:21`, `scripts/start-server.mjs:41`, `scripts/start-server.mjs:45`, `scripts/start-server.mjs:49`

Opportunity: Only hashed `/assets/` files get a cache-control header. Public icons, manifest, robots, and static file conditional requests do not get ETag or Last-Modified handling in this server.

Impact: Low

Effort: Low

Recommendation: Set cache headers for public immutable files and add `ETag`/`Last-Modified` or delegate all static serving to Nginx/Caddy.

```js
if (pathname.startsWith('/assets/')) {
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
} else if (/\.(png|ico|webmanifest|json|txt)$/.test(pathname)) {
  headers.set('Cache-Control', 'public, max-age=3600')
}
```

Also ensure the reverse proxy compresses JS, CSS, HTML, and server function JSON.

### 29. Self-host or remove the Google Fonts import

File: `src/styles.css:1`

Opportunity: CSS imports Inter from Google Fonts. This adds an external blocking dependency and connection setup for a dashboard app.

Impact: Low

Effort: Low

Recommendation: Use a system font stack or self-host a subsetted Inter file with `font-display: swap`.

```css
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

### 30. Add CI/deploy dependency caching and avoid unnecessary production installs

File: `.github/workflows/deploy.yml:31`, `.github/workflows/deploy.yml:37`, `.github/workflows/deploy.yml:59`, `.github/workflows/deploy.yml:198`

Opportunity: CI installs dependencies for build, uploads only `dist/`, then the server runs `bun install --production` on every deploy. This is simple but slower and consumes deploy CPU/network every release.

Impact: Low

Effort: Medium

Recommendation: Cache Bun dependencies in GitHub Actions. For the server, either keep a persistent Bun install cache or deploy a release artifact that includes the exact production dependency set. If using native SQLite and removing unused deps, production install gets smaller anyway.

### 31. Avoid PM2 delete/start downtime

File: `.github/workflows/deploy.yml:207`, `.github/workflows/deploy.yml:208`

Opportunity: The workflow deletes and starts the PM2 process, causing avoidable downtime. This is small for an internal monitor but unnecessary.

Impact: Low

Effort: Low

Recommendation: Use `pm2 reload`/`restart --update-env` where possible, and keep the old process until health passes if the host setup supports it.

### 32. Add query performance tests around DB growth

File: `package.json:12`, `src/lib/metrics-db.ts:231`, `src/lib/monitor.server.ts:872`

Opportunity: There are no visible performance or regression tests for large metric sets. The current implementation behaves fine at 1,329 active rows but has O(file size), O(rows), and O(rounds) paths.

Impact: Medium

Effort: Medium

Recommendation: Add synthetic DB fixtures with 100k and 1M metric rows. Assert max payload size and query time for summary, matrix page, age summary, and round details.

```ts
expect(Buffer.byteLength(JSON.stringify(await getRuntime(7)))).toBeLessThan(50_000)
expect(result.rows.length).toBeLessThanOrEqual(600)
```

## Prioritized Top 10 Action Plan

1. Default to a bounded range and move range into route search params.
   Impact: High. Effort: Low. Best immediate impact/effort because it stops `all` from being the first load.

2. Make `getRuntime()` summary-only and add an in-flight polling guard.
   Impact: High. Effort: Low to Medium. This removes the repeated 850 KB polling payload.

3. Move heavy loaders out of `_dashboard` and into section routes.
   Impact: High. Effort: Medium. `/logs` and `/config` should not load metric rows.

4. Wire metric retention with a 30 or 90 day default.
   Impact: High. Effort: Low. Prevents storage and query cost from growing forever.

5. Stop double-finalizing dashboard-managed collector rounds.
   Impact: Medium. Effort: Low. Removes one full DB write per dashboard-run round under the current persistence model.

6. Add numeric `timestamp_ms` and composite indexes, then remove `datetime(...)` predicates.
   Impact: High. Effort: Medium. This directly fixes the query plan problems.

7. Bound matrix columns and split filter metadata into cached endpoints.
   Impact: High. Effort: Medium. Prevents the metrics table from growing with every historical round.

8. Collapse dashboard DB reads into one request-scoped snapshot and cache app settings.
   Impact: High. Effort: Medium. Cuts repeated full DB loads even before replacing sql.js.

9. Replace `sql.js` with native SQLite/WAL.
   Impact: High. Effort: High. This is the architectural fix for database efficiency and scale.

10. Move age, round, and proxy aggregates server-side.
    Impact: High. Effort: Medium. Lets the browser stop receiving and scanning raw metric history for non-metrics views.

