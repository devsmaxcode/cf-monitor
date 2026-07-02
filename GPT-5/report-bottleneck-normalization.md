# TanStack Start Bottleneck & Normalization Audit

Audit date: 2026-07-02

Scope: tracked application code, TanStack Start routes, server functions, React dashboard components, metric helpers, storage layer, scripts, static assets, and dependency usage.

Verification:

- `bun run lint`: passed.
- `bun run build`: passed. The production build reported that `@tanstack/devtools-vite` removed devtools code from `src/routes/__root.tsx`.
- `bun run test`: failed because no test files exist.

## Findings

### 1. Dashboard parent route loads all metric rows for every dashboard page

**File:** `src/routes/_dashboard.tsx:6-7`, `src/lib/metric-range.ts:3`, `src/lib/monitor.server.ts:361-374`, `src/lib/monitor.server.ts:872-885`

**Severity:** Critical

**Issue:** The parent dashboard route always runs `getDashboardFn` with `defaultMetricRangeDays`, which is currently `'all'`. `getDashboard` then calls `buildMetrics`, and `buildMetrics` reads every metric row in range plus every round before any child route renders. This means `/logs`, `/config`, `/proxies`, `/rounds`, `/age`, and `/metrics` all pay the all-time metrics cost, even when the screen does not need it.

**Fix:** Split the parent route into a small chrome loader and move metric-heavy data to child loaders or TanStack Query queries keyed by route search params. Make the metric range a route search param so SSR and hydration fetch the same range.

```ts
// src/routes/_dashboard.tsx
export const Route = createFileRoute('/_dashboard')({
  validateSearch: (search) => ({
    days: parseMetricRangeDays(String(search.days || defaultMetricRangeDays)),
  }),
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(dashboardChromeQuery()),
  component: DashboardRoute,
})

// src/routes/_dashboard.metrics.tsx
export const Route = createFileRoute('/_dashboard/metrics')({
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(metricPageQuery({ days: deps.days })),
})
```

### 2. Hydration immediately duplicates the dashboard loader request

**File:** `src/components/dashboard/dashboard-context.tsx:61`, `src/components/dashboard/dashboard-context.tsx:74-97`, `src/routes/_dashboard.tsx:6-12`

**Severity:** High

**Issue:** The route loader fetches initial dashboard data, but `DashboardProvider` immediately calls `loadDashboard(rangeDays)` in a mount effect. With the default range this duplicates the exact loader request after hydration. If localStorage contains a different range, the server still fetched all-time data first and the client fetches again with the stored range.

**Fix:** Do not refetch on mount when the loader data already matches the selected range. Prefer moving `rangeDays` into route search params and seeding TanStack Query with the loader result. If localStorage must remain, guard the effect by comparing the initial range to the stored range.

```ts
const didHydrate = useRef(false)

useEffect(() => {
  if (!didHydrate.current) {
    didHydrate.current = true
    if (rangeDays === initial.metrics.range.days) return
  }

  void loadDashboard(rangeDays).catch(showError)
}, [initial.metrics.range.days, loadDashboard, rangeDays, showError])
```

### 3. Runtime polling rebuilds full metrics and then causes an extra metrics-page fetch

**File:** `src/components/dashboard/dashboard-context.tsx:86-109`, `src/lib/monitor.server.ts:378-384`, `src/components/dashboard/dashboard-consumers.ts:68-102`

**Severity:** High

**Issue:** `refreshRuntime` calls `getRuntimeFn`, and `getRuntime` rebuilds the full metric payload. While running, this happens every 3 seconds. On the metrics page, the paged metrics effect also depends on `metrics.summary.lastTimestamp`, so every runtime poll can trigger another `getMetricRowsPageFn` request. The metrics screen can therefore do a full metrics read and a paged metrics read on each poll tick.

**Fix:** Split runtime status from metrics. A frequent poll should fetch only `MonitorState` and a lightweight metric version or last timestamp. Use that version to invalidate the visible metric page query only when it actually changes.

```ts
const runtime = useQuery({
  queryKey: ['runtime-status'],
  queryFn: getRuntimeStatusFn,
  refetchInterval: (query) => {
    const status = query.state.data
    return status?.busy || status?.running ? 3000 : 12000
  },
})

useEffect(() => {
  if (runtime.data?.metricVersion) {
    queryClient.invalidateQueries({ queryKey: ['metricRowsPage'] })
  }
}, [queryClient, runtime.data?.metricVersion])
```

### 4. The hot storage path loads the whole SQLite file and runs several queries per page request

**File:** `src/lib/metrics-db.ts:231-343`, `src/lib/metrics-db.ts:580-584`

**Severity:** High

**Issue:** `sql.js` opens the SQLite database by reading the database file into memory for every operation. The paged metrics endpoint then runs counts, grouping, selected rows, columns, bounds, distinct pages, distinct countries, and distinct statuses. Under the current polling pattern this multiplies file I/O, WASM SQLite startup work, and full-query scans.

**Fix:** Use a server-native SQLite driver for the production server path, such as Bun SQLite when the app is run with Bun, or keep a long-lived read connection behind a small repository layer. Also split static filter metadata from the paged rows query and cache metadata by `days`.

```ts
// shape only
export type MetricsRepository = {
  readMetricRowsPage(input: MetricRowsPageInput): Promise<MetricRowsPage>
  readMetricFilterOptions(range: MetricDateRange): Promise<MetricFilterOptions>
  readMetricSummary(range: MetricDateRange): Promise<MetricSummary>
}
```

### 5. Metrics matrix paginates rows but not columns

**File:** `src/lib/metrics-db.ts:295-315`, `src/components/dashboard/panels/metrics-panel.tsx:365-384`, `src/components/dashboard/panels/metrics-panel.tsx:236-291`

**Severity:** High

**Issue:** `readMetricRowsPage` returns every round column for the selected time range, and `MetricsPanel` renders a table cell for every visible row by every column. With the default all-time range, a long-running monitor can produce hundreds or thousands of round columns. Row pagination alone does not control DOM size, table model size, or CSV export cost.

**Fix:** Add a column window, cap the default round range, or use column virtualization. If the matrix is primarily chronological, load only the most recent N rounds by default and expose older rounds through a range selector.

```ts
type MetricRowsPageInput = {
  days: MetricRangeDays
  columnOffset?: number
  columnLimit?: number
  page?: number
  pageSize?: number
}
```

### 6. Cache Age computes all search indexes and aggregates on the client from full rows

**File:** `src/components/dashboard/dashboard-consumers.ts:173-176`, `src/components/dashboard/panels/age-panel.tsx:34-47`, `src/components/dashboard/panels/age-panel.tsx:162-220`, `src/components/dashboard/panels/age-panel.tsx:231-232`, `src/components/dashboard/helpers.ts:500-602`

**Severity:** High

**Issue:** The age panel receives `metrics.rows`, builds a link search index, filters rows, builds cache-age buckets, summarizes buckets, and computes top HIT URLs in React render paths. These are all O(n) over the selected row set, and the current route loader makes that row set all-time by default.

**Fix:** Move age aggregation to a server function backed by SQL aggregation. The client should request `cacheAgeSummary`, chart buckets, top URLs, and a small link search result set instead of full raw rows.

```ts
export const getCacheAgeFn = createServerFn({ method: 'GET' })
  .validator((input) => cacheAgeSchema.parse(input))
  .handler(({ data }) => getCacheAgeDashboard(data))
```

### 7. TanStack Query is wired but not used for application data

**File:** `src/integrations/tanstack-query/root-provider.tsx:1-10`, `src/router.tsx:18`, `src/lib/monitor.functions.ts:52-116`, `src/components/dashboard/dashboard-consumers.ts:68-94`

**Severity:** Medium

**Issue:** The app creates a `QueryClient` and sets up router SSR query integration, but dashboard data is handled with local state, effects, and manual server-function calls. This loses request deduplication, stale-time control, SSR dehydration, cancellation, background refetch policy, mutation invalidation, and query-key normalization.

**Fix:** Define query option factories for dashboard chrome, runtime status, metric pages, age aggregates, proxy usage, and round details. Use route loaders with `ensureQueryData` and components with `useSuspenseQuery` or `useQuery`.

```ts
export const metricPageQuery = (input: MetricRowsPageInput) =>
  queryOptions({
    queryKey: ['metricRowsPage', input],
    queryFn: () => getMetricRowsPageFn({ data: input }),
    staleTime: 15_000,
  })
```

### 8. Dashboard payload still serializes unused legacy aggregates

**File:** `src/lib/monitor.server.ts:927-954`, `src/lib/monitor.server.ts:974-983`

**Severity:** Medium

**Issue:** `buildMetrics` computes and returns `pageStats` and `matrix`, but the current dashboard components do not consume either value. They are serialized through the dashboard loader and runtime polling anyway. `matrix` grows with pages times countries, and `pageStats` repeatedly filters `latestRows` per page.

**Fix:** Remove `pageStats` and `matrix` from `MetricsPayload` unless a route consumes them. If a summary view needs them later, expose a dedicated endpoint and loader for that view.

### 9. Dashboard context is split only into data/actions, so unrelated consumers still re-render together

**File:** `src/components/dashboard/dashboard-context.tsx:26-36`, `src/components/dashboard/dashboard-context.tsx:165-168`, `src/components/dashboard/dashboard-consumers.ts:12-20`, `src/components/dashboard/dashboard-consumers.ts:173-191`, `src/components/dashboard/dashboard-consumers.ts:227-233`

**Severity:** Medium

**Issue:** Any change to `config`, `metrics`, `proxyText`, `rangeDays`, or `status` creates a new data context object. Every consumer of `useDashboardData` is invalidated, even if it only needs logs or config. Polling metrics/status therefore pushes avoidable renders through unrelated route panels.

**Fix:** Split contexts by update frequency and domain, or replace broad context reads with TanStack Query selectors. Suggested contexts: `RuntimeStatusContext`, `ConfigContext`, `MetricRangeContext`, and route-local query data.

### 10. Proxies panel derives latest proxy usage by copying and reversing all metric rows

**File:** `src/components/dashboard/dashboard-consumers.ts:227-234`, `src/components/dashboard/helpers.ts:74-105`

**Severity:** Medium

**Issue:** `useProxiesConsumer` calls `usedProxyRows(metrics.rows, proxyText)`, and `usedProxyRows` copies the full array with `[...rows].reverse()` before stopping at 80 unique proxies. The proxies route therefore needs the full metric payload just to display recent proxy usage.

**Fix:** Add a `readRecentProxyUsage` SQL query using `ORDER BY id DESC` and stop after the unique proxy limit. Return exactly the `UsedProxyRow[]` needed by the panel.

```sql
SELECT page, proxy, proxy_country, response_ms, error, timestamp_utc, cf_cache_status
FROM cache_metrics
WHERE deleted_at = '' AND proxy <> ''
ORDER BY id DESC
LIMIT 500;
```

### 11. Rounds panel scans full rows repeatedly for selected-round details

**File:** `src/components/dashboard/dashboard-consumers.ts:179-191`, `src/components/dashboard/panels/rounds-panel.tsx:324-359`

**Severity:** Medium

**Issue:** `useRoundsConsumer` passes all metric rows into `RoundsPanel`. `roundDetailStats` filters rows for the selected round, then makes several additional passes for hits, misses, errors, response values, pages, countries, and edges. This repeats work on each selected round render.

**Fix:** Use the already-stored round summary fields for list-level rendering and fetch selected-round details through a server aggregate query keyed by round id. If the rows must stay client-side, pre-index once with `Map<roundId, MetricRow[]>`.

### 12. Metric and country domain logic is duplicated across client, server, and script

**File:** `src/components/dashboard/helpers.ts:189-207`, `src/components/dashboard/helpers.ts:285-427`, `src/lib/monitor.server.ts:1026-1129`, `scripts/cloudflare_cache_monitor.ts:42-59`, `scripts/cloudflare_cache_monitor.ts:582-593`

**Severity:** Medium

**Issue:** Cache status categories, country naming, average calculations, round column labels, batch key generation, and time-range labels exist in multiple places. This makes behavior drift likely: the server can produce a column key or country value that the client formats differently, and the collector can use a different country map from the dashboard.

**Fix:** Extract shared pure domain helpers into `src/lib/metrics-domain.ts` and import them from server, client, and script code. Keep React-only formatting in component helpers.

### 13. Default monitored pages are duplicated and already divergent

**File:** `src/lib/monitor.server.ts:112-126`, `scripts/cloudflare_cache_monitor.ts:21-41`

**Severity:** Medium

**Issue:** The dashboard default config has 13 pages, while the standalone collector script has 19 default pages. Running the collector directly and running it through the dashboard will monitor different URL sets.

**Fix:** Export a single `DEFAULT_PAGES` constant from a shared module and import it in both places.

### 14. Intent preloads are configured to become stale immediately

**File:** `src/router.tsx:14-15`

**Severity:** Medium

**Issue:** `defaultPreload: 'intent'` is useful, but `defaultPreloadStaleTime: 0` makes preloaded route data stale immediately. Combined with the heavy parent dashboard loader, tab hover/focus intent can amplify unnecessary loader work.

**Fix:** Set a non-zero preload stale time for dashboard data, and disable or narrow preloading on routes whose loaders are expensive.

```ts
const router = createTanStackRouter({
  routeTree,
  context,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 30_000,
})
```

### 15. CSS imports Google Fonts from the render-blocking stylesheet

**File:** `src/styles.css:1`, `src/styles.css:40-47`

**Severity:** Low

**Issue:** The main stylesheet imports a remote Google Fonts CSS file before the app CSS. This adds an external request to the critical rendering path. For an operational dashboard, the system font fallback is already acceptable and cheaper.

**Fix:** Remove the `@import url(...)` and use the existing system stack, or self-host the font files if Inter is a hard requirement.

### 16. Metrics panel intentionally hides loader data until after mount

**File:** `src/components/dashboard/panels/metrics-panel.tsx:65-68`, `src/components/dashboard/panels/metrics-panel.tsx:106-112`, `src/components/dashboard/panels/metrics-panel.tsx:232`

**Severity:** Low

**Issue:** `mounted` forces `matrixRows` and `columns` to be empty for SSR and the first client render, then triggers another render after `useEffect`. This delays table rendering and weakens the value of the route loader.

**Fix:** Render from deterministic loader/query data directly. If there is a hydration mismatch, isolate the exact non-deterministic value instead of gating the full matrix.

### 17. Confirmed unused files, exports, and dependencies

**File:** `package.json:20-23`, `package.json:33-39`, `src/env.ts:1-39`, `src/lib/utils.ts:1-7`, `src/components/dashboard/summary-stats.tsx:6`, `src/components/dashboard/helpers.ts:62`, `src/components/dashboard/helpers.ts:209`, `src/components/dashboard/helpers.ts:247`, `src/components/dashboard/helpers.ts:311`, `src/components/dashboard/types.ts:15-18`, `src/components/dashboard/ui.tsx:156-160`, `src/lib/metrics-db.ts:447`, `deploy-error.text:1`

**Severity:** Low

**Issue:** Repository searches found no in-repo consumers for `src/env.ts`, `src/lib/utils.ts`, `SummaryStats`, `filterRows`, `shortUrl`, `percent`, `ageRangeLabel`, `DashboardRouteProps`, `StatusPill`, or `applyMetricRoundRetention`. Those files/exports also keep dependencies around: `@t3-oss/env-core`, `clsx`, and `tailwind-merge`. Additional package dependencies with no source usage are `@faker-js/faker`, `@tanstack/match-sorter-utils`, and `class-variance-authority`. `deploy-error.text` is a tracked CI log artifact.

**Fix:** Delete unused exports/files and remove unused dependencies from `package.json` and `bun.lock`. Keep `env.ts` only if the app actually imports it during boot. Move deploy logs out of the repository.

### 18. Static PWA assets are template-branded and not linked from the app shell

**File:** `public/manifest.json:2-24`, `src/routes/__root.tsx:33-38`

**Severity:** Low

**Issue:** `manifest.json` still says "TanStack App" / "Create TanStack App Sample", and the root head only links the stylesheet. The manifest and logo assets are not connected to the app shell, so they are either stale template files or incomplete PWA support.

**Fix:** If PWA support is not a goal, delete `manifest.json`, `logo192.png`, and `logo512.png`. If it is a goal, update the manifest branding and add `rel: 'manifest'` in the root head.

### 19. Saving proxies performs an unnecessary follow-up read

**File:** `src/components/dashboard/dashboard-context.tsx:150-154`, `src/lib/monitor.server.ts:354-358`

**Severity:** Low

**Issue:** `saveProxyDraft` posts the text, then calls `getProxiesFn` to read it back. The server already has the text and can return the normalized proxy payload from `saveProxies`.

**Fix:** Have `saveProxies` return `readProxies()` after writing, and remove the extra client round trip.

```ts
export async function saveProxies(text: string) {
  await mkdir(storageDir, { recursive: true })
  await writeAppSetting(proxyListSetting, text, appSettingsDbOutput, root)
  await writeFile(proxiesPath, text, 'utf8')
  return readProxies()
}
```

### 20. MetricsPanel is oversized and mixes multiple responsibilities

**File:** `src/components/dashboard/panels/metrics-panel.tsx:65-552`

**Severity:** Low

**Issue:** The metrics panel owns filtering UI, pagination UI, table construction, skeleton UI, CSV export, matrix rendering, status detail popovers, and class-name helpers in one file. This makes performance work harder because data, presentation, and actions are tightly coupled.

**Fix:** Split it into focused units: `MetricFiltersBar`, `MetricMatrixTable`, `MetricPagination`, `MetricMatrixSkeleton`, and `exportMetricMatrix`. Keep the route/query consumer responsible for data and mutations.

## Severity Summary

- Critical: 1
- High: 5
- Medium: 8
- Low: 6
- Total: 20

## Top 5 Highest-Impact Improvements

1. Split dashboard data loading by route and move metric range into route search params. This removes the all-time parent loader bottleneck and prevents SSR/client range mismatch.
2. Replace manual dashboard effects with TanStack Query query/mutation factories and lightweight runtime-status polling. This adds dedupe, stale-time control, cancellation, and targeted invalidation.
3. Replace the `sql.js` full-file hot path or isolate it behind cached/native repository methods. This directly reduces polling and metrics-page I/O cost.
4. Move age, proxy usage, and selected-round details to server aggregate endpoints. This prevents non-metrics routes from requiring full raw metric rows.
5. Window or virtualize the metrics matrix columns and remove unused dashboard payload aggregates. This controls DOM size and payload size as round history grows.

## Ponytail Complexity Cuts

- delete: unused template/dead code and dependencies. Replacement: remove `env.ts`, `utils.ts`, unused exports, unused packages, stale PWA assets if not needed, and `deploy-error.text`.
- shrink: duplicated metric/country helpers. Replacement: one shared domain helper module.
- yagni: route-wide all-data dashboard context. Replacement: route-scoped queries and small context for chrome-only state.
- net: approximately -250 to -500 lines and -5 to -8 dependencies possible after cleanup, plus larger runtime savings from loader/query/storage changes.
