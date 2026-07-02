# CF Monitor Resource Benchmark: Before vs After Optimization

Date: 2026-07-02

## Compared Versions

| Label | Git reference | Notes |
| --- | --- | --- |
| Before | `HEAD~2` / `e1a89c7` | Dashboard default range was all-time and runtime polling rebuilt/sent full metrics. |
| After | `HEAD` / `ca8a194` | Default range is 7 days, range is routed through search params, runtime polling is summary-only. |

Current uncommitted workspace changes were not included in this benchmark.

## Test Data

| Item | Value |
| --- | ---: |
| SQLite file size before schema migration | 1,241,088 bytes |
| Active metric rows | 2,340 |
| Rows inside 7 days | 2,340 |
| Active rounds | 16 |
| Oldest metric timestamp | 2026-06-29T10:11:49+00:00 |
| Newest metric timestamp | 2026-07-02T06:24:57+00:00 |

Important context: all current rows are already inside the new 7-day default range. Because of that, the initial dashboard payload does not shrink yet. The main win is the repeated runtime polling request.

## Main Runtime Poll Result

Median of 5 isolated Bun process runs.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Server function call time | 632.4 ms | 60.0 ms | 90.5% faster |
| Process wall time | 767.7 ms | 163.6 ms | 78.7% faster |
| Process CPU time | 1,171.9 ms | 312.5 ms | 73.3% less |
| Peak process RSS | 270.4 MB | 108.1 MB | 60.0% less |
| JSON payload, raw | 1,351.2 KB | 4.8 KB | 281x smaller |
| JSON payload, gzip | 86.0 KB | 1.0 KB | 86x smaller |
| JSON payload, brotli | 58.7 KB | 0.9 KB | 65x smaller |
| Raw metric rows sent | 2,340 | 0 | fixed |
| Round rows sent | 16 | 16 | unchanged |

## Practical Polling Cost

The dashboard polls runtime every 3 seconds while running, which is about 20 polls per minute per open dashboard tab.

| Estimate per open dashboard tab | Before | After |
| --- | ---: | ---: |
| CPU time per minute | ~23.4 CPU-sec/min | ~6.3 CPU-sec/min |
| Server call time per minute | ~12.6 wall-sec/min | ~1.2 wall-sec/min |
| Raw transfer per minute | ~26.4 MB/min | ~96 KB/min |
| Gzip transfer per minute | ~1.68 MB/min | ~20 KB/min |

The after version is much cheaper during continuous monitoring because runtime polling no longer ships the full metric history.

## Initial Dashboard Loader

Median of 5 isolated Bun process runs.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Loader call time | 700.9 ms | 541.0 ms | 22.8% faster |
| Process wall time | 838.8 ms | 654.0 ms | 22.0% faster |
| Peak process RSS | 269.0 MB | 276.4 MB | slightly higher |
| Raw JSON payload | 1,352.1 KB | 1,352.2 KB | no real change |
| Gzip JSON payload | 86.4 KB | 86.5 KB | no real change |
| Metric rows sent | 2,340 | 2,340 | unchanged |

The first dashboard load is still heavy because the parent dashboard loader still sends raw rows. Since this DB only contains recent rows, changing the default range from all-time to 7 days does not reduce the current initial payload.

## Metrics Page API

Median of 5 isolated Bun process runs for page 1, page size 50.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Call time | 116.7 ms | 115.0 ms | about the same |
| Peak process RSS | 142.5 MB | 145.1 MB | about the same |
| Raw payload | 467.7 KB | 467.8 KB | about the same |
| Rows in payload | 916 | 916 | unchanged |
| Columns in payload | 12 | 12 | unchanged |

The metrics page still sends a large matrix page. The after code adds better timestamp/index structure, but this small data set does not show a large visible improvement for that endpoint.

## Live Production Server Check

One built server per version, three `GET /metrics` requests each. Response compression was disabled for size clarity.

| Metric | Before | After |
| --- | ---: | ---: |
| Idle server RSS | 162.6 MB | 154.3 MB |
| Peak RSS after requests | 326.3 MB | 337.0 MB |
| Median `/metrics` response time | 2,423.6 ms | 1,513.5 ms |
| `/metrics` response size | 1,234.1 KB | 1,234.2 KB |
| HTTP statuses | 200, 200, 200 | 200, 200, 200 |

The live route became faster, but the HTML/data response is still about 1.2 MB because the initial dashboard payload still embeds the raw metric rows.

## Build Cost

One production build per version.

| Metric | Before | After |
| --- | ---: | ---: |
| Build time | 4.07 s | 4.74 s |
| Peak build RSS | 459.1 MB | 444.9 MB |
| Dist size | 745.1 KB | 755.9 KB |
| Largest JS asset | 342.4 KB | 343.7 KB |
| Largest JS gzip | 106.9 KB | 107.4 KB |

Build resource usage is effectively unchanged.

## Storage Cost

The after schema/index migration increases the SQLite file size in the benchmark copy.

| Item | Size |
| --- | ---: |
| Before DB copy | 1,241,088 bytes |
| After migrated DB copy | 1,777,664 bytes |
| Increase | 536,576 bytes |
| Increase percent | ~43% |

This is expected because the after code adds `timestamp_ms` plus composite indexes. It spends a small amount of disk to make runtime queries cheaper and more scalable.

## Practical VPS Recommendation

For the current DB size:

| Version | Practical host size |
| --- | --- |
| Before | 1 vCPU / 1 GB RAM minimum if the dashboard stays open while monitoring. 512 MB is risky because live page requests peaked around 326 MB before collector, PM2, OS, and filesystem cache overhead. |
| After | 1 vCPU / 512 MB RAM can run this data size, but 1 GB RAM is still the realistic safe choice when the collector and web dashboard run on the same VPS. |

## Bottom Line

The optimization materially reduces continuous runtime cost:

- Runtime poll latency drops from 632.4 ms to 60.0 ms.
- Runtime poll memory peak drops from 270.4 MB to 108.1 MB.
- Runtime poll payload drops from 1,351.2 KB to 4.8 KB.

The first dashboard load is still the next bottleneck. To reduce that, the dashboard parent loader should stop embedding raw rows and move raw metric data to route-level paginated or aggregated endpoints.
