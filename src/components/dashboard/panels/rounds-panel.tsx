import { Gauge, Grid2X2 } from 'lucide-react'
import type { Config } from '#/lib/monitor.server'
import type { MetricRoundRow } from '#/lib/metrics-db'
import {
  avg,
  cacheStatus,
  compact,
  dayMs,
  durationFromMs,
  isMissLike,
  metricRangeLabel,
  metricRoundBase,
  relativeTime,
  roundStatusLabel,
  shortDate,
  unique,
} from '../helpers'
import type { MetricRow, RoundsPanelProps } from '../types'

export function RoundsPanel(props: RoundsPanelProps) {
  const rounds = roundsInSelectedRange(props.rounds, props.rangeDays)
  const stats = roundStats(rounds, props.rounds.length)
  const selected =
    rounds.find((round) => round.id === props.selectedRound?.id) ??
    rounds.at(0) ??
    props.selectedRound

  return (
    <section className="rounds-panel">
      <div className="rounds-hero">
        <div>
          <span aria-hidden="true" className="section-icon">
            <Grid2X2 size={16} />
          </span>
          <div>
            <h2>Round Stats</h2>
            <p>{roundsSubtitle(stats, props.rangeDays)}</p>
          </div>
        </div>
        <div className="rounds-hero-actions">
          <div
            className={`rounds-live ${props.status.busy ? 'active' : props.status.running ? 'armed' : ''}`}
          >
            <span aria-hidden="true" />
            <strong>{roundsLiveLabel(props.status)}</strong>
          </div>
        </div>
      </div>

      <div className="rounds-body">
        <div className="rounds-list-wrap">
          <div className="rounds-list-head">
            <h3>All Rounds</h3>
            <span>
              {rounds.length
                ? `${rounds.length} shown / ${props.rounds.length} retained`
                : 'Empty'}
            </span>
          </div>
          <div className="rounds-list">
            {rounds.length ? (
              rounds.map((round) => (
                <RoundItem
                  key={round.id}
                  onSelect={() => props.setSelectedRoundId(round.id)}
                  round={round}
                  selected={selected?.id === round.id}
                />
              ))
            ) : (
              <div className="empty-state">
                {props.rounds.length
                  ? `No rounds in ${metricRangeLabel(props.rangeDays).toLowerCase()}.`
                  : 'No rounds recorded yet.'}
              </div>
            )}
          </div>
        </div>

        <div className="rounds-insight">
          <div className="rounds-insight-head">
            <span aria-hidden="true" className="section-icon">
              <Gauge size={16} />
            </span>
            <div>
              <h3>Round Details</h3>
              <p>
                {selected
                  ? `Round ${selected.id} - ${roundStatusLabel(selected.status)}`
                  : 'Select a round to inspect the full result.'}
              </p>
            </div>
          </div>
          {selected ? (
            <RoundDetails
              config={props.config}
              maxRows={stats.maxRows}
              round={selected}
              rows={props.rows}
            />
          ) : (
            <div className="empty-state">
              Run the monitor once to populate round stats.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function RoundDetails({
  config,
  maxRows,
  round,
  rows,
}: {
  config: Config
  maxRows: number
  round: MetricRoundRow
  rows: MetricRow[]
}) {
  const details = roundDetailStats(round, rows)
  const profile = roundProfile(round)
  const rowPercent = maxRows
    ? Math.max(4, Math.round((round.total_rows / maxRows) * 100))
    : 0
  const pageCount = round.page_count || details.pages || config.pages.length
  const locationCount =
    round.proxy_country_count ||
    details.countries ||
    configuredLocationCount(config)
  const pageCountry = `${pageCount} URLs / ${locationCount} locations`

  return (
    <div className="latest-round-card round-detail-card">
      <div className="latest-round-top">
        <div>
          <span className="round-detail-eyebrow">Selected round</span>
          <strong>Round {round.id}</strong>
        </div>
        <div className="round-detail-actions">
          <RoundStatus status={round.status} />
        </div>
      </div>
      <dl className="round-detail-grid">
        <div>
          <dt>Started</dt>
          <dd>{round.started_at ? shortDate(round.started_at) : '-'}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{round.completed_at ? shortDate(round.completed_at) : '-'}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{durationFromMs(round.duration_ms)}</dd>
        </div>
        <div>
          <dt>Avg Response</dt>
          <dd>{details.avgResponseMs ? `${details.avgResponseMs} ms` : '-'}</dd>
        </div>
      </dl>
      <div className="round-breakdown">
        <div>
          <span>Hit Rate</span>
          <strong>{details.hitRate}%</strong>
        </div>
        <div>
          <span>Hits</span>
          <strong>{compact(details.hits)}</strong>
        </div>
        <div>
          <span>Issues</span>
          <strong>{compact(details.issues)}</strong>
        </div>
        <div>
          <span>Rechecks</span>
          <strong>{compact(round.recheck_rows)}</strong>
        </div>
      </div>
      <div className="round-load">
        <span>
          <b style={{ width: `${rowPercent}%` }} />
        </span>
        <small>
          {compact(round.total_rows)} rows captured - {pageCountry}
        </small>
      </div>
      <dl className="round-meta-list">
        <div>
          <dt>Reason</dt>
          <dd>{round.reason || 'scheduled'}</dd>
        </div>
        <div>
          <dt>Pages Seen</dt>
          <dd>{compact(details.pages)}</dd>
        </div>
        <div>
          <dt>Countries Seen</dt>
          <dd>{compact(details.countries)}</dd>
        </div>
        <div>
          <dt>Cloudflare Edges</dt>
          <dd>{compact(details.edges)}</dd>
        </div>
        <div>
          <dt>Timeout</dt>
          <dd>
            {profile.timeout ? `${profile.timeout}s` : `${config.timeout}s`}
          </dd>
        </div>
        <div>
          <dt>Delay</dt>
          <dd>{profile.delay ? `${profile.delay}s` : `${config.delay}s`}</dd>
        </div>
      </dl>
      {round.error ? <p className="round-error">{round.error}</p> : null}
    </div>
  )
}

function RoundItem({
  onSelect,
  round,
  selected,
}: {
  onSelect: () => void
  round: MetricRoundRow
  selected: boolean
}) {
  return (
    <button
      aria-pressed={selected}
      className={`round-item ${round.status} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      type="button"
    >
      <div aria-hidden="true" className="round-marker" />
      <div className="round-item-main">
        <div className="round-item-head">
          <strong>Round {round.id}</strong>
          <RoundStatus status={round.status} />
        </div>
        <p>
          {round.reason || 'scheduled'} -{' '}
          {round.started_at ? shortDate(round.started_at) : '-'}
        </p>
        {round.error ? (
          <small className="round-error">{round.error}</small>
        ) : null}
      </div>
      <div className="round-item-metrics">
        <span>{compact(round.total_rows)} rows</span>
        <span>{durationFromMs(round.duration_ms)}</span>
        <span>{compact(round.page_count)} URLs</span>
      </div>
    </button>
  )
}

function RoundStatus({ status }: { status: MetricRoundRow['status'] }) {
  return (
    <span className={`round-status ${status}`}>{roundStatusLabel(status)}</span>
  )
}

function roundsInSelectedRange(
  rounds: MetricRoundRow[],
  rangeDays: RoundsPanelProps['rangeDays'],
) {
  if (rangeDays === 'all') return rounds
  const cutoff = Date.now() - rangeDays * dayMs
  return rounds.filter((round) => {
    if (round.status === 'running') return true
    const time = roundTime(round)
    return time === null || time >= cutoff
  })
}

function roundTime(round: MetricRoundRow) {
  const value = round.started_at || round.completed_at || round.created_at
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : null
}

function roundStats(rounds: MetricRoundRow[], retained: number) {
  return {
    latest: rounds.at(0) || null,
    maxRows: Math.max(0, ...rounds.map((round) => round.total_rows)),
    retained,
    rows: rounds.reduce((sum, round) => sum + round.total_rows, 0),
    total: rounds.length,
  }
}

function roundsSubtitle(
  stats: ReturnType<typeof roundStats>,
  rangeDays: RoundsPanelProps['rangeDays'],
) {
  const range = metricRangeLabel(rangeDays).toLowerCase()
  if (!stats.retained)
    return 'No rounds yet. Start the monitor to build a run history.'
  if (rangeDays === 'all')
    return `${stats.total} rounds retained, ${compact(stats.rows)} rows`
  if (!stats.total)
    return `No rounds in ${range}; ${stats.retained} retained outside this window.`
  const latestText = stats.latest?.started_at
    ? `latest ${relativeTime(stats.latest.started_at)}`
    : 'latest saved'
  return `${stats.total} rounds in ${range}, ${compact(stats.rows)} rows, ${latestText}`
}

function roundsLiveLabel(status: RoundsPanelProps['status']) {
  if (status.busy)
    return status.round ? `Round ${status.round} running` : 'Round running'
  if (status.running)
    return status.nextRunAt
      ? `Armed - ${relativeTime(status.nextRunAt)}`
      : 'Armed'
  return 'Stopped'
}

function roundRows(round: MetricRoundRow, rows: MetricRow[]) {
  const id = String(round.id)
  return rows.filter(
    (row) => metricRoundBase(row.round_id || row.round || '') === id,
  )
}

function roundDetailStats(round: MetricRoundRow, rows: MetricRow[]) {
  const targetRows = roundRows(round, rows)
  const hits = targetRows.filter((row) => cacheStatus(row) === 'HIT').length
  const misses = targetRows.filter((row) => isMissLike(cacheStatus(row))).length
  const errors = targetRows.filter(
    (row) => row.error || cacheStatus(row) === 'FAIL',
  ).length
  const responseValues = targetRows
    .map((row) => Number(row.response_ms))
    .filter((value) => Number.isFinite(value) && value > 0)
  const pages = unique(
    targetRows.map((row) => row.page || row.url || ''),
  ).length
  const countries = unique(
    targetRows.map((row) => row.proxy_country || ''),
  ).length
  const edges = unique(targetRows.map((row) => row.cf_edge || '')).length
  const total = targetRows.length || round.total_rows

  return {
    avgResponseMs: avg(responseValues),
    countries,
    edges,
    hitRate: total ? Math.round((hits / total) * 100) : 0,
    hits,
    issues: misses + errors,
    pages,
  }
}

function roundProfile(round: MetricRoundRow) {
  try {
    return JSON.parse(round.config_json || '{}') as Partial<Config>
  } catch {
    return {}
  }
}

function configuredLocationCount(config: Config) {
  return (
    config.proxyCountries
      .split(',')
      .map((country) => country.trim())
      .filter(Boolean).length + (config.noDirect ? 0 : 1)
  )
}
