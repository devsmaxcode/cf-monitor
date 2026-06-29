# Memory Audit - TanStack Start CF Monitor

Audit date: 2026-06-29
Auditor: GPT-5 Codex

Scope reviewed: TanStack Start routes, React dashboard provider/consumers, panels, server functions, monitor runtime, `sql.js` persistence layer, and collector script.

## Findings

### 1. Full metric history is loaded, serialized, and retained on every dashboard refresh

File: `src/lib/monitor.server.ts:786`

Issue: `buildMetrics()` calls `readMetricRows(...).reverse()` and then builds `latestRows`, `pageStats`, `matrix`, `timeColumns`, and `summary` from the complete selected range. The selected range defaults to `all` (`src/lib/metric-range.ts:3`), the dashboard loader uses that default (`src/routes/_dashboard.tsx:7`), and runtime polling refreshes this payload repeatedly (`src/components/dashboard/dashboard-context.tsx:88`). This keeps the full metric history in server memory, serializes it over the network, and stores it in React context (`src/components/dashboard/dashboard-context.tsx:63`). As the SQLite file grows, this path becomes the primary OOM risk.

Severity: Critical

Fix: Make runtime polling summary-only, keep rows out of the shared provider, and load rows only through bounded/paginated route-level endpoints. Also change the default range from `all` to a bounded range.

```ts
// src/lib/metric-range.ts
export const defaultMetricRangeDays: MetricRangeDays = 7
```

```ts
// src/lib/monitor.server.ts
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

### 2. Dashboard polling can overlap expensive full-history requests

File: `src/components/dashboard/dashboard-context.tsx:100`

Issue: The `setInterval` callback fires every 3 seconds while busy/running and calls `refreshRuntime()` without checking whether the previous request has finished (`src/components/dashboard/dashboard-context.tsx:103`). If `getRuntime()` takes longer than the interval because it is reading and deriving a large metric set, requests stack up. Each in-flight request can hold a loaded SQLite database, derived arrays, serialized JSON, and pending React state payloads.

Severity: High

Fix: Gate polling with an in-flight ref and skip ticks while one request is active. Prefer this together with the summary-only runtime endpoint from finding 1.

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

### 3. `sql.js` loads the entire database file into memory and exports it even for reads

File: `src/lib/metrics-db.ts:509`

Issue: `openMetricsDb()` constructs `new SQL.Database((await exists(filename)) ? await readFile(filename) : undefined)`, which loads the full SQLite file into WASM memory for every query. It then calls `await persistDb({ db, filename })` unconditionally at `src/lib/metrics-db.ts:513`, and `persistDb()` exports the complete database to a Buffer at `src/lib/metrics-db.ts:518`. Read-only dashboard requests therefore pay a full DB load plus a full DB export/write, which doubles peak memory and gets worse as the DB grows.

Severity: High

Fix: Do not persist after read-only opens. Longer term, replace `sql.js` with a native/server SQLite driver for this server workload.

```ts
async function openMetricsDb(
  output: string,
  baseDir = process.cwd(),
  ensureWritable = false,
): Promise<DbHandle> {
  const filename = resolveMetricsDbPath(output, baseDir)
  await mkdir(dirname(filename), { recursive: true })

  const SQL = await SQL_READY
  const db = new SQL.Database(
    (await exists(filename)) ? await readFile(filename) : undefined,
  )
  ensureMetricsSchema(db)
  if (ensureWritable) await persistDb({ db, filename })
  return { db, filename }
}
```

Then call `openMetricsDb(output, baseDir, persist)` from `withMetricsDb()`.

### 4. Metric retention exists but is not called, so storage and memory pressure grow without bound

File: `src/lib/metrics-db.ts:443`

Issue: `applyMetricRoundRetention()` and `pruneOldMetricRounds()` exist, but `rg` shows no callers outside their definition. Because `defaultMetricRangeDays` is `all`, every retained row can be loaded into memory by the dashboard. This is an unbounded storage growth problem that directly becomes an unbounded memory problem because the DB layer loads the whole SQLite file for queries.

Severity: High

Fix: Add a retention setting and apply it after each completed/stopped/failed round. Default to a sane value such as 30 or 90 days.

```ts
// after finalizeMetricRound(...) in runMonitorRound()
await applyMetricRoundRetention(config.output, config.retentionDays ?? 90, root)
```

Also expose `retentionDays` in the dashboard config schema if users need control.

### 5. The paged metrics endpoint still returns unbounded column and filter metadata

File: `src/lib/metrics-db.ts:291`

Issue: `readMetricRowsPage()` pages row groups, but it still computes `columns` for every matching round (`src/lib/metrics-db.ts:291`) plus all countries, pages, and statuses (`src/lib/metrics-db.ts:329` to `src/lib/metrics-db.ts:334`). On `all`, `columns` grows with every round ever collected. The metrics UI then creates a table column for every item (`src/components/dashboard/panels/metrics-panel.tsx:342`) and sets a min width from the full column count (`src/components/dashboard/panels/metrics-panel.tsx:84`).

Severity: High

Fix: Add a bounded round/window parameter to the page endpoint, or return only the columns represented in the current page. Load filter option lists via separate cached endpoints with explicit limits.

```ts
const maxColumns = boundedInteger(input.maxColumns, 1, 100, 50)

const columns = selectRows(
  db,
  `
    SELECT *
    FROM (
      SELECT
        CAST(round_id AS TEXT) AS round_id,
        round,
        MIN(timestamp_utc) AS started_at,
        MAX(timestamp_utc) AS completed_at,
        MIN(id) AS first_id
      FROM cache_metrics
      ${filtered.where}
      GROUP BY COALESCE(NULLIF(round, ''), CAST(round_id AS TEXT), '')
      ORDER BY first_id DESC
      LIMIT ?
    )
    ORDER BY first_id ASC
  `,
  [...filtered.params, maxColumns],
)
```

### 6. Metrics search/filtering can fire many uncancelled server requests

File: `src/components/dashboard/dashboard-consumers.ts:68`

Issue: The metrics consumer calls `getMetricRowsPageFn()` whenever `filters`, `pageIndex`, `pageSize`, `rangeDays`, or `metrics.summary.lastTimestamp` changes. Typing in search changes `filters` on every keystroke. The `active` flag prevents stale `setState`, but it does not cancel the server work or release server-side memory early. Rapid input can leave multiple full SQLite queries and response payloads in flight.

Severity: Medium

Fix: Debounce or defer filter input before sending the server request, and use a monotonically increasing request id to ignore older responses.

```tsx
const deferredFilters = useDeferredValue(filters)
const requestId = useRef(0)

useEffect(() => {
  const id = ++requestId.current
  setLoading(true)

  void getMetricRowsPageFn({
    data: { days: rangeDays, filters: deferredFilters, page: pageIndex, pageSize },
  }).then((payload) => {
    if (id === requestId.current) setPagedMetrics(payload)
  }).finally(() => {
    if (id === requestId.current) setLoading(false)
  })
}, [deferredFilters, pageIndex, pageSize, rangeDays])
```

### 7. Metrics filter fallback maps the full context row set before paged metadata arrives

File: `src/components/dashboard/dashboard-consumers.ts:32`

Issue: `countries`, `pages`, and `statuses` fall back to scanning `metrics.rows` (`src/components/dashboard/dashboard-consumers.ts:32`, `src/components/dashboard/dashboard-consumers.ts:39`, `src/components/dashboard/dashboard-consumers.ts:46`). This defeats pagination during initial render or failed page loads and creates new arrays/sets from the full context payload.

Severity: Medium

Fix: Remove the full-row fallback and initialize these options from route loader metadata or a small endpoint. If a fallback is necessary, cap it.

```tsx
const countries = useMemo(() => pagedMetrics?.countries ?? [], [pagedMetrics])
const pages = useMemo(() => pagedMetrics?.pages ?? [], [pagedMetrics])
const statuses = useMemo(() => pagedMetrics?.statuses ?? [], [pagedMetrics])
```

### 8. Age view derives large bucket and top URL arrays during render

File: `src/components/dashboard/panels/age-panel.tsx:28`

Issue: `AgePanel` calls `cacheAgeBuckets(rows)` directly during render, and `AgeDashboard` calls `topHitUrls(rows)` at `src/components/dashboard/panels/age-panel.tsx:78`. Both functions scan the full `rows` array and allocate maps/arrays (`src/components/dashboard/helpers.ts:492` and `src/components/dashboard/helpers.ts:580`). This is not a permanent leak, but it causes repeated transient allocations whenever context updates from polling.

Severity: Medium

Fix: Memoize immediately, and preferably move age aggregates server-side so the browser never receives all raw rows for this view.

```tsx
const buckets = useMemo(() => cacheAgeBuckets(rows), [rows])
const urls = useMemo(() => topHitUrls(rows), [rows])
```

### 9. Round details filter the full row set on every render

File: `src/components/dashboard/panels/rounds-panel.tsx:123`

Issue: `RoundDetails` calls `roundDetailStats(round, rows)`, which calls `roundRows()` and filters the full row array at `src/components/dashboard/panels/rounds-panel.tsx:326`. With all-time rows in context, selecting a round or receiving a poll update scans all samples again and allocates a filtered array for one round.

Severity: Medium

Fix: Pre-index rows by round once per row payload, or load round details from SQL for the selected round.

```tsx
const rowsByRound = useMemo(() => {
  const map = new Map<string, MetricRow[]>()
  for (const row of rows) {
    const key = metricRoundBase(row.round_id || row.round || '')
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row)
  }
  return map
}, [rows])
```

### 10. Collector keeps all page results and flattened rows in memory before writing

File: `scripts/cloudflare_cache_monitor.ts:776`

Issue: `main()` collects `pageResults` from `mapLimit()`, then copies every result into `rows` and `rechecks` (`scripts/cloudflare_cache_monitor.ts:780` to `scripts/cloudflare_cache_monitor.ts:782`) before appending rows at `scripts/cloudflare_cache_monitor.ts:785`. At that point memory contains each page result, the flattened rows array, and the recheck target array. `mapLimit()` also preallocates a result array for all pages at `scripts/cloudflare_cache_monitor.ts:686`.

Severity: Medium

Fix: Append rows per page or in small chunks, and only retain recheck targets.

```ts
let rowCount = 0
const rechecks: RecheckTarget[] = []

await mapLimit(pages, args.pageConcurrency, async (page) => {
  const result = await checkPage(page, proxies, roundId, args)
  await appendRows(args.output, result.rows)
  rowCount += result.rows.length
  rechecks.push(...result.rechecks)
})
```

### 11. External proxy source loading has no size guard

File: `scripts/cloudflare_cache_monitor.ts:308`

Issue: `loadProxifly()` parses the entire fetched JSON response with `JSON.parse(await fetchText(...))`. `loadClarketm()` also fetches complete text bodies and builds a `Set` of successful hosts (`scripts/cloudflare_cache_monitor.ts:363` to `scripts/cloudflare_cache_monitor.ts:366`). A large upstream response or accidental HTML/error body can create avoidable memory spikes.

Severity: Low

Fix: Add a max response size to `fetchText()` and fail closed when a source exceeds it. Cache known-good proxy lists locally if source size is expected to fluctuate.

```ts
async function fetchText(url: string, timeout: number, maxBytes = 5_000_000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'UmmahOneCacheMonitor/1.0 (+https://ummah.one)' },
    signal: AbortSignal.timeout(timeout * 1000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const text = await response.text()
  if (Buffer.byteLength(text) > maxBytes) {
    throw new Error(`response too large: ${url}`)
  }
  return text
}
```

### 12. TanStack devtools are mounted unconditionally

File: `src/routes/__root.tsx:51`

Issue: `TanStackDevtools`, router devtools, and query devtools are rendered in the root document for every build. Devtools attach observers and can retain route/query inspection state. This is usually small, but it is unnecessary in production and can amplify memory use when route loader payloads are large.

Severity: Low

Fix: Render devtools only in development.

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

## Bounded Areas Reviewed

- `src/lib/monitor.server.ts:421` bounds runtime logs with `state.logs = state.logs.slice(-160)`.
- `src/lib/monitor.server.ts:563` resets `requestedCrawlPages` for each round.
- `src/components/dashboard/dashboard-context.tsx:108` clears the polling interval on unmount/effect replacement.
- `src/lib/metrics-db.ts:179` and `src/lib/metrics-db.ts:722` free prepared SQL statements.
- `src/lib/metrics-db.ts:497` closes each `sql.js` database handle in `finally`.

These areas look intentionally bounded and are not the primary memory risk.

## Summary Table

| Severity | Count |
| --- | ---: |
| Critical | 1 |
| High | 4 |
| Medium | 5 |
| Low | 2 |
| Total | 12 |

## Top 5 Highest-Impact Fixes

1. Replace full-history `getRuntime()`/dashboard context payloads with summary-only data and route-level paginated raw row endpoints.
2. Prevent overlapping dashboard polling requests with an in-flight guard.
3. Stop exporting/writing the full `sql.js` database during read-only requests; plan a move to a native SQLite driver.
4. Wire metric retention into completed monitor rounds and default retention to 30-90 days.
5. Bound metrics matrix columns/filter metadata so the paged endpoint does not still grow with every historical round.
