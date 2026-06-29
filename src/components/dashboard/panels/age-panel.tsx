import { Clock3 } from 'lucide-react'
import type { MetricRangeDays } from '#/lib/monitor.server'
import {
  ageBucketTitle,
  ageSegmentHeight,
  cacheAgeBuckets,
  cacheAgeSummary,
  compact,
  compactUrl,
  duration,
  metricRangeLabel,
  parseMetricRangeDays,
  rangeOptions,
  topHitUrls,
} from '../helpers'
import type { CacheAgeBucket } from '../helpers'
import type { MetricRow } from '../types'

export function AgePanel({
  rangeDays,
  rows,
  setRangeDays,
}: {
  rangeDays: MetricRangeDays
  rows: MetricRow[]
  setRangeDays: (value: MetricRangeDays) => void
}) {
  const buckets = cacheAgeBuckets(rows)

  return (
    <section className="side-panel cache-age-panel">
      <div className="section-head">
        <h2>
          <span aria-hidden="true" className="section-icon">
            <Clock3 size={16} />
          </span>
          Cache Age
        </h2>
        <span>{rows.length} samples</span>
      </div>
      <div className="table-filters age-filters">
        <label className="metric-range-control">
          <span>Timeframe</span>
          <select
            aria-label="Cache age timeframe"
            onChange={(event) =>
              setRangeDays(parseMetricRangeDays(event.target.value))
            }
            value={rangeDays}
          >
            {rangeOptions.map((days) => (
              <option key={days} value={days}>
                {metricRangeLabel(days)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="cache-age-dashboard">
        {rows.length && buckets.length ? (
          <AgeDashboard buckets={buckets} rows={rows} />
        ) : (
          <div className="empty-state">No cache age data yet.</div>
        )}
      </div>
    </section>
  )
}

function AgeDashboard({
  buckets,
  rows,
}: {
  buckets: CacheAgeBucket[]
  rows: MetricRow[]
}) {
  const summary = cacheAgeSummary(buckets)
  const urls = topHitUrls(rows)

  return (
    <>
      <div className="age-summary-grid">
        <AgeStat
          label="HIT Rate"
          meta={`${compact(summary.hits)} HIT / ${compact(summary.useful)} useful`}
          tone="hit"
          value={`${summary.hitRate}%`}
        />
        <AgeStat
          label="Max Age"
          meta={`${duration(summary.avgAge)} average`}
          tone="age"
          value={duration(summary.maxAge)}
        />
        <AgeStat
          label="MISS-like"
          meta="BYPASS, MISS, EXPIRED and similar"
          tone="miss"
          value={compact(summary.missLike)}
        />
        <AgeStat
          label="No Header / Errors"
          meta={`${compact(summary.noHeader)} no header, ${compact(summary.errors)} errors`}
          tone="warn"
          value={compact(summary.noHeader + summary.errors)}
        />
      </div>

      <div className="age-chart-grid">
        <section className="age-chart-card">
          <div className="age-chart-head">
            <h3>Cache Status Over Time</h3>
            <span>{buckets.length} time points</span>
          </div>
          <CacheStatusBars buckets={buckets} />
          <AgeLegend />
        </section>

        <section className="age-chart-card">
          <div className="age-chart-head">
            <h3>Cache Age Trend</h3>
            <span>Peak {duration(summary.maxAge)}</span>
          </div>
          <AgeLineChart buckets={buckets} />
        </section>
      </div>

      <section className="age-chart-card age-top-card">
        <div className="age-chart-head">
          <h3>Top HIT URLs</h3>
          <span>{urls.length ? `${urls.length} URLs` : 'No HIT data'}</span>
        </div>
        <TopHitUrlChart rows={urls} />
      </section>
    </>
  )
}

function AgeStat(props: {
  label: string
  meta: string
  tone: string
  value: string
}) {
  return (
    <div className={`age-stat ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.meta}</small>
    </div>
  )
}

function CacheStatusBars({ buckets }: { buckets: CacheAgeBucket[] }) {
  const visible = buckets.slice(-40)
  const maxTotal = Math.max(1, ...visible.map((bucket) => bucket.total))

  return (
    <div className="age-status-chart">
      {visible.map((bucket) => {
        const height = Math.max(10, Math.round((bucket.total / maxTotal) * 100))
        return (
          <div
            className="age-status-column"
            key={bucket.key}
            title={ageBucketTitle(bucket)}
          >
            <div className="age-status-stack" style={{ height: `${height}%` }}>
              <i
                className="hit"
                style={{
                  height: `${ageSegmentHeight(bucket.hits, bucket.total)}%`,
                }}
              />
              <i
                className="miss"
                style={{
                  height: `${ageSegmentHeight(bucket.missLike, bucket.total)}%`,
                }}
              />
              <i
                className="warn"
                style={{
                  height: `${ageSegmentHeight(bucket.noHeader, bucket.total)}%`,
                }}
              />
              <i
                className="fail"
                style={{
                  height: `${ageSegmentHeight(bucket.errors, bucket.total)}%`,
                }}
              />
            </div>
            <span>{bucket.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function AgeLegend() {
  return (
    <div className="age-legend">
      <span>
        <i className="hit" />
        HIT
      </span>
      <span>
        <i className="miss" />
        MISS-like
      </span>
      <span>
        <i className="warn" />
        No header
      </span>
      <span>
        <i className="fail" />
        Error
      </span>
    </div>
  )
}

function AgeLineChart({ buckets }: { buckets: CacheAgeBucket[] }) {
  const visible = buckets.slice(-40)
  const width = 720
  const height = 190
  const pad = 24
  const maxAge = Math.max(1, ...visible.map((bucket) => bucket.maxAge))
  const points = visible.map((bucket, index) => {
    const x =
      visible.length === 1
        ? width / 2
        : pad + (index / (visible.length - 1)) * (width - pad * 2)
    const y = height - pad - (bucket.maxAge / maxAge) * (height - pad * 2)
    return { bucket, x: Math.round(x), y: Math.round(y) }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  const last = points[points.length - 1]
  const area = points.length
    ? `M ${points[0].x} ${height - pad} L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${last.x} ${height - pad} Z`
    : ''

  return (
    <div className="age-line-wrap">
      <svg
        aria-label="Cache age over time"
        className="age-line-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <path
          className="age-line-grid"
          d={`M ${pad} ${height - pad} H ${width - pad} M ${pad} ${pad} H ${width - pad}`}
        />
        {area ? <path className="age-line-area" d={area} /> : null}
        {line ? <polyline className="age-line" points={line} /> : null}
        {points.map((point) => (
          <circle cx={point.x} cy={point.y} key={point.bucket.key} r="4">
            <title>{`${point.bucket.label}: ${duration(point.bucket.maxAge)} max age`}</title>
          </circle>
        ))}
      </svg>
      <div className="age-line-meta">
        <span>{visible[0]?.meta || '-'}</span>
        <strong>{duration(maxAge)}</strong>
        <span>{visible[visible.length - 1]?.meta || '-'}</span>
      </div>
    </div>
  )
}

function TopHitUrlChart({ rows }: { rows: ReturnType<typeof topHitUrls> }) {
  if (!rows.length)
    return (
      <div className="empty-state compact">
        No HIT rows found in this timeframe.
      </div>
    )

  const maxHits = Math.max(1, ...rows.map((row) => row.hits))
  return (
    <div className="top-hit-chart">
      {rows.map((row) => {
        const width = Math.max(3, Math.round((row.hits / maxHits) * 100))
        return (
          <div className="top-hit-row" key={row.url} title={row.url}>
            <div className="top-hit-copy">
              <strong>{compactUrl(row.url)}</strong>
              <span>
                {compact(row.hits)} HIT / {compact(row.useful)} useful -{' '}
                {row.hitRate}% HIT - max age {duration(row.maxAge)}
              </span>
            </div>
            <b>{row.hitRate}%</b>
            <div className="top-hit-bar">
              <i style={{ width: `${width}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
