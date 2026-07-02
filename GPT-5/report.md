# CF Monitor Unified Report

Generated: 2026-07-02  
Sources merged: memory audit, optimization audit, redundancy audit, bottleneck/normalization audit.

This report keeps only the issues that materially affect performance, memory, maintainability, or production reliability. Repeated findings from the source reports have been merged into one prioritized plan.

## Current Baseline

- Local metrics DB: `storage/cloudflare-cache-metrics.sqlite`, 823,296 bytes.
- Active rows: 1,329 `cache_metrics`, 10 `cache_rounds`.
- `getDashboard('all')`: 319 ms, 850,666 JSON bytes, 1,329 rows.
- `getRuntime('all')`: 282 ms, 849,747 JSON bytes, 1,329 rows.
- `getMetricRowsPage({ days: 'all', page: 1, pageSize: 50 })`: 35 ms, 272,397 JSON bytes, 522 rows.
- Largest client asset: `dist/client/assets/index-B5oDvLM1.js`, 350,604 bytes raw, 109,609 gzip, 94,494 brotli.
- Query plans already use `idx_cache_metrics_deleted_at` and temporary B-trees for group, distinct, and order work, even on the small local DB.
- Verification from source reports: `bun run lint` passed, `bun run build` passed, `bun run test` failed because no test files exist.

## Executive Summary

The main problem is that the dashboard treats all metric history as shared app state. The `_dashboard` layout loads all metrics by default, the provider refetches after hydration, runtime polling rebuilds nearly the same payload every few seconds, and several child panels scan raw rows in the browser. This makes non-metrics pages pay for metrics data and makes growth in stored history directly increase memory, network payloads, and render cost.

The second major problem is the storage layer. `sql.js` loads the entire SQLite file into WASM memory for each open and exports the whole database on writes. Combined with repeated dashboard reads, polling, and unbounded retention, this becomes the primary scale limit.

The third problem is drift and redundancy: duplicate defaults, duplicated metric/time/status/country logic, old CSS, unused scaffold files, unused dependencies, and oversized components. These do not all need to be fixed first, but removing them will make the performance work easier and safer.

## Priority Action Plan




### 4. Add Retention and Bound Matrix Growth

Impact: high. Effort: low to medium.

- Wire `applyMetricRoundRetention()` after completed, stopped, and failed rounds.
- Add `retentionDays` to config, defaulting to 30 or 90.
- Bound metrics matrix columns with `roundLimit`, `columnLimit`, or column virtualization.
- Split filter metadata from paged rows and cache metadata by range.
- For delete-all metrics, prefer hard delete plus `VACUUM` or WAL checkpoint in maintenance paths.

Key files:

- `src/lib/metrics-db.ts`
- `src/lib/monitor.server.ts`
- `src/components/dashboard/panels/metrics-panel.tsx`


### 6. Fix Query Shape and Indexes

Impact: high. Effort: medium.

- Stop wrapping timestamp columns in `datetime(...)` in `WHERE` clauses.
- Add a numeric `timestamp_ms` or `timestamp_epoch` column.
- Store numeric metrics as numeric columns where they are used for sorting, filtering, or aggregation.
- Add composite indexes that match actual query patterns.
- Redesign `readMetricRowsPage()` around a bounded CTE for selected groups.
- Add FTS or a normalized `search_text` column for metrics search.

Important indexes after timestamp normalization:

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

Key files:

- `src/lib/metrics-db.ts`

### 7. Use TanStack Query for Application Data

Impact: medium to high. Effort: medium.

- The app already creates a `QueryClient`, but most data fetching is manual state/effect code.
- Define query option factories for dashboard shell, runtime status, metrics page, age summary, proxy usage, and round details.
- Use route loaders with `ensureQueryData`.
- Use query keys for dedupe, stale time, cancellation, and targeted invalidation.
- Set `defaultPreloadStaleTime` to a non-zero value for expensive routes.

Key files:

- `src/integrations/tanstack-query/root-provider.tsx`
- `src/router.tsx`
- `src/routes/_dashboard*.tsx`
- `src/lib/monitor.functions.ts`
- `src/components/dashboard/dashboard-consumers.ts`

### 8. Remove Drift and Duplicate Domain Logic

Impact: medium. Effort: low to medium.

- Move default monitored pages to one shared module.
- Move country names and Cloudflare status classification to shared modules.
- Consolidate metric time/batch column logic into one client-safe helper.
- Use SQL projection constants for repeated metric and round column lists.
- Co-locate config schema and config normalization so the `Config` type, zod schema, and sanitizer do not drift.

Key files:

- `src/lib/monitor.server.ts`
- `scripts/cloudflare_cache_monitor.ts`
- `src/components/dashboard/helpers.ts`
- `src/lib/metrics-db.ts`
- `src/lib/monitor.functions.ts`

### 9. Simplify Dead Code, CSS, and Dependencies

Impact: medium. Effort: low.

- Delete unused scaffold files if they remain unused: `src/env.ts`, `src/lib/utils.ts`.
- Remove unused dashboard components/exports: `SummaryStats`, `Stat`, `StatusPill`, stale helper exports.
- Delete obsolete first-generation dashboard CSS and scope table styles to `.sample-table`.
- Remove unused dependencies after verification: `@faker-js/faker`, `@tanstack/match-sorter-utils`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, and unused testing packages if no tests are being added now.
- Move devtools packages to `devDependencies` and keep devtools imports/rendering development-only.
- Remove stale template PWA assets or update and link them properly.
- Remove `deploy-error.text` from the repository if it is only a captured deploy log.

Key files:

- `package.json`
- `bun.lock`
- `src/styles.css`
- `src/env.ts`
- `src/lib/utils.ts`
- `src/components/dashboard/summary-stats.tsx`
- `src/components/dashboard/ui.tsx`
- `public/manifest.json`
- `src/routes/__root.tsx`

### 10. Tighten Collector and Deployment Reliability

Impact: medium. Effort: low to medium.

- Stop double-finalizing dashboard-managed rounds. If the parent passes `--round-id`, the parent should own finalization.
- Stream collector rows into a transaction after moving to native SQLite; under current `sql.js`, avoid per-page writes because each write exports the DB.
- Add max response size guards and TTL caching for external proxy sources.
- Add a global collector concurrency budget to cap active `curl` processes.
- Build the collector to JS or run a reusable collector worker instead of spawning TypeScript with `--experimental-strip-types` every round.
- Keep web and collector roles separate if the app is ever scaled beyond one PM2 instance.
- Pin package versions instead of using `latest`.
- Add CI dependency caching and use PM2 reload/restart instead of delete/start when practical.

Key files:

- `scripts/cloudflare_cache_monitor.ts`
- `src/lib/monitor.server.ts`
- `ecosystem.config.cjs`
- `.github/workflows/deploy.yml`
- `package.json`

## Consolidated Findings

| Priority | Area | What Matters | Main Fix |
| --- | --- | --- | --- |
| P0 | Dashboard loader | All pages load all metric history by default | Split shell and route loaders; default to bounded range |
| P0 | Runtime polling | Polling returns nearly full dashboard payload every 3s while running | Poll only status/summary/version; guard overlapping requests |
| P0 | Storage | `sql.js` full-file load/export dominates growth path | Move to native SQLite or stop read-only exports immediately |
| P1 | Retention | Metric history grows without bound | Wire retention after terminal rounds |
| P1 | Metrics matrix | Row paging exists, column/history paging does not | Add round/column window and cached filter metadata |
| P1 | Client aggregates | Age, rounds, and proxies scan raw rows in React | Move aggregates to SQL-backed endpoints |
| P1 | Query performance | Timestamp functions and weak indexes force scans/temp B-trees | Add numeric timestamps and composite indexes |
| P2 | Data fetching | TanStack Query exists but manual effects bypass dedupe/cancellation | Add query factories and route loader integration |
| P2 | Domain drift | Defaults, country names, status groups, time columns are duplicated | Move to shared modules |
| P2 | Dead weight | Old CSS, unused files, unused packages, stale PWA/log artifacts | Delete or update after build verification |
| P2 | Collector | Rows/results and proxy responses are buffered too broadly | Add budgets, size guards, TTL cache, and streaming writes after native DB |

## Suggested Implementation Order

1. Default range to 7 or 30 days and add route search params for `days`.
2. Make `getRuntime()` summary-only and add the polling in-flight guard.
3. Split `_dashboard` shell data from metrics, age, rounds, and proxy route data.
4. Wire metric retention with a 30 or 90 day default.
5. Stop read-only DB exports and stop double-finalizing dashboard-owned rounds.
6. Add numeric timestamps plus composite indexes, then remove `datetime(...)` predicates.
7. Bound metrics matrix columns and split/cached filter metadata.
8. Move age, round detail, and proxy usage aggregates to SQL endpoints.
9. Replace `sql.js` with native SQLite/WAL behind a repository layer.
10. Delete redundant code, obsolete CSS, unused dependencies, stale assets, and deploy logs.

## Acceptance Checks

- `/logs`, `/config`, `/proxies`, `/rounds`, and `/age` no longer load raw all-time metrics from the dashboard layout.
- Runtime polling payload stays small, ideally under 50 KB for normal operation.
- Metrics matrix payload is bounded by both rows and round columns.
- The app can retain months of data without first load scaling with all retained rows.
- `bun run lint` and `bun run build` pass after each cleanup phase.
- Performance fixtures or tests cover at least 100k metric rows for runtime summary, metrics page, age summary, and round details.
