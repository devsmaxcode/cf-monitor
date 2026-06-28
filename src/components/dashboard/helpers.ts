import { metricRangeDayOptions, type MetricRangeDays } from '#/lib/metric-range'
import type { Config } from '#/lib/monitor.server'
import type { MetricFilters, MetricRow, UsedProxyRow } from './types'

export const rangeOptions = metricRangeDayOptions
export const dayMs = 24 * 60 * 60 * 1000
export const matrixUrlColWidth = 260
export const matrixCountryColWidth = 150
export const matrixTimeColWidth = 122
const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export type MetricTimeColumn = {
  key: string
  label: string
  meta: string
  sort: number
}

export type MetricTimeGroup = {
  key: string
  page: string
  url: string
  country: string
  countryLabel: string
  cells: Map<string, MetricRow>
}

export type CacheAgeBucket = {
  ageValues: number[]
  avgAge: number
  errors: number
  hitRate: number
  hits: number
  key: string
  label: string
  maxAge: number
  meta: string
  missLike: number
  noHeader: number
  sort: number
  total: number
  useful: number
}

export type TopHitUrl = {
  avgAge: number
  hitRate: number
  hits: number
  latestTimestamp: string
  maxAge: number
  total: number
  url: string
  useful: number
}

export function filterRows(rows: MetricRow[], filters: MetricFilters) {
  const q = filters.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.country && row.proxy_country !== filters.country) return false
    if (filters.page && row.page !== filters.page) return false
    const status = cacheStatus(row)
    if (filters.cacheStatus && status !== filters.cacheStatus) return false
    if (!q) return true
    return metricSearchText(row, status).includes(q)
  })
}

export function usedProxyRows(rows: MetricRow[], proxyText: string): UsedProxyRow[] {
  const local = new Set(normalizeList(proxyText).map(proxyKey))
  const seen = new Set<string>()
  const result: UsedProxyRow[] = []

  for (const row of [...rows].reverse()) {
    const proxy = row.proxy || ''
    if (!proxy) continue
    const country = row.proxy_country || '-'
    const key = `${country}|${proxy}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      country,
      error: row.error || '',
      page: row.page || '',
      proxy,
      responseMs: row.response_ms || '',
      source:
        proxy === 'direct'
          ? 'Direct'
          : country.toLowerCase() === 'local' || local.has(proxyKey(proxy))
            ? 'Local'
            : 'Fetched',
      status: cacheStatus(row),
      timestamp: row.timestamp_utc || '',
    })
    if (result.length >= 80) break
  }

  return result
}

export function normalizeDraft(config: Config): Config {
  return {
    ...config,
    pages: normalizeList(config.pages.join('\n')),
    proxyCountries: normalizeList(config.proxyCountries).join(','),
    hitIntervalSeconds: config.roundIntervalSeconds,
  }
}

export function normalizeList(value: string) {
  const seen = new Set<string>()
  return String(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase()
      if (!item || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function proxyKey(value: string) {
  if (value === 'direct') return value
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`)
    return `${url.protocol}//${url.username}${url.password ? ':***' : ''}${url.username ? '@' : ''}${url.host}`
  } catch {
    return value
  }
}

export function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

export function cacheStatus(row: MetricRow) {
  return (row.cf_cache_status || (row.error ? 'FAIL' : '-')).toUpperCase()
}

export function statusTone(row: MetricRow) {
  const status = cacheStatus(row)
  return row.error ? 'fail' : status === 'HIT' ? 'hit' : isMissLike(status) ? 'miss' : 'other'
}

export function statusToneFromValue(status: string, error = '') {
  const value = (status || (error ? 'FAIL' : '-')).toUpperCase()
  return error ? 'fail' : value === 'HIT' ? 'hit' : isMissLike(value) ? 'miss' : 'other'
}

export function metricSearchText(row: MetricRow, status = cacheStatus(row)) {
  return [
    row.page,
    row.url,
    row.proxy_country,
    countryName(row.proxy_country || ''),
    row.cf_edge,
    row.proxy,
    row.error,
    row.cf_ray,
    row.status_code,
    status,
  ]
    .join(' ')
    .toLowerCase()
}

export function countryName(code: string) {
  const names: Record<string, string> = {
    AU: 'Australia',
    BD: 'Bangladesh',
    CA: 'Canada',
    DE: 'Germany',
    FR: 'France',
    GB: 'United Kingdom',
    IN: 'India',
    JP: 'Japan',
    LOCAL: 'Local',
    local: 'Local',
    SG: 'Singapore',
    UK: 'United Kingdom',
    US: 'United States',
    direct: 'Direct',
  }
  return names[code] || code
}

export function shortUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname}`
  } catch {
    return value || '-'
  }
}

export function compactUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.hostname}${url.pathname === '/' ? '/' : url.pathname}`
  } catch {
    return value || '-'
  }
}

export function shortDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return `${dateLabel(date)}, ${timeLabel(date)}`
}

export function compact(value: number) {
  return new Intl.NumberFormat([], {
    maximumFractionDigits: 1,
    notation: value >= 10000 ? 'compact' : 'standard',
  }).format(value)
}

export function avg(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

export function percent(value: number, total: number) {
  if (!total) return 0
  return Math.round((value / total) * 100)
}

export function countdown(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes) return `${minutes}m ${String(rest).padStart(2, '0')}s`
  return `${rest}s`
}

export function duration(seconds: number) {
  if (!seconds) return '0s'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m`
  return `${seconds}s`
}

export function durationFromMs(ms: number) {
  if (!ms) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return duration(Math.round(ms / 1000))
}

export function relativeTime(value: string) {
  const diff = Date.parse(value) - Date.now()
  const abs = Math.abs(Math.round(diff / 1000))
  const label = duration(abs)
  return diff >= 0 ? `in ${label}` : `${label} ago`
}

export function isMissLike(status: string) {
  return ['MISS', 'BYPASS', 'DYNAMIC', 'EXPIRED', 'REVALIDATED', 'STALE', 'UPDATING'].includes(
    status,
  )
}

export function isMetricRangeDays(value: number): value is MetricRangeDays {
  return metricRangeDayOptions.includes(value as MetricRangeDays)
}

export function metricRangeLabel(days: MetricRangeDays) {
  return days === 1 ? '1 day' : `${days} days`
}

export function ageRangeLabel(days: MetricRangeDays, availableFrom?: string, availableTo?: string) {
  if (!availableTo) return `${metricRangeLabel(days)} - No data`
  const available = availableFrom ? `${shortDate(availableFrom)} to ${shortDate(availableTo)}` : shortDate(availableTo)
  return `${metricRangeLabel(days)} - ${available}`
}

export function metricRoundBase(value: string | number) {
  return String(value || '').replace(/-recheck$/, '')
}

export function metricTimeColumns(rows: MetricRow[]) {
  const columns = new Map<string, MetricTimeColumn & { start: number; end: number }>()

  for (const row of rows) {
    const column = metricBatchColumn(row)
    const time = Date.parse(row.timestamp_utc || '')
    const point = Number.isNaN(time) ? column.sort : time
    const existing = columns.get(column.key)

    if (!existing) {
      columns.set(column.key, { ...column, start: point, end: point })
      continue
    }

    existing.start = Math.min(existing.start, point)
    existing.end = Math.max(existing.end, point)
    existing.sort = existing.start
    existing.meta = batchTimeRange(existing.start, existing.end)
  }

  return [...columns.values()]
    .sort((a, b) => a.sort - b.sort)
    .map(({ start: _start, end: _end, ...column }) => column)
}

export function metricTimeGroups(rows: MetricRow[], columns: MetricTimeColumn[]) {
  const validColumns = new Set(columns.map((column) => column.key))
  const groups = new Map<string, MetricTimeGroup>()

  for (const row of rows) {
    const country = row.proxy_country || '-'
    const key = [row.page || '-', row.url || '-', country].join('|')
    let group = groups.get(key)
    if (!group) {
      group = {
        cells: new Map<string, MetricRow>(),
        country,
        countryLabel: countryName(country),
        key,
        page: row.page || '-',
        url: row.url || '-',
      }
      groups.set(key, group)
    }

    const columnKey = metricBatchColumn(row).key
    if (validColumns.has(columnKey) && !group.cells.has(columnKey)) {
      group.cells.set(columnKey, row)
    }
  }

  return [...groups.values()]
}

export function metricBatchColumn(row: MetricRow): MetricTimeColumn {
  const column = metricTimeColumn(row.timestamp_utc || '')
  const roundValue = row.round || row.round_id
  if (!roundValue) return column

  const roundText = String(roundValue)
  const recheck = roundText.endsWith('-recheck')
  const round = recheck ? roundText.replace(/-recheck$/, '') : roundText
  return {
    ...column,
    key: `batch-${roundText}`,
    label: recheck ? `Recheck ${round}` : `Round ${round}`,
  }
}

export function metricTimeColumn(value: string): MetricTimeColumn {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { key: 'unknown', label: '-', meta: 'No time', sort: Number.MAX_SAFE_INTEGER }
  }

  const key = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('-')

  return {
    key,
    label: timeLabel(date),
    meta: dateLabel(date),
    sort:
      date.getFullYear() * 100000000 +
      (date.getMonth() + 1) * 1000000 +
      date.getDate() * 10000 +
      date.getHours() * 100 +
      date.getMinutes(),
  }
}

export function batchTimeRange(start: number, end: number) {
  if (start === Number.MAX_SAFE_INTEGER) return 'No time'
  const middleDate = new Date(start + (end - start) / 2)
  return `${timeLabel(middleDate)} ${dateLabel(middleDate)}`
}

export function metricMatrixMinWidth(columns: MetricTimeColumn[]) {
  return matrixUrlColWidth + matrixCountryColWidth + columns.length * matrixTimeColWidth
}

export function statusMeta(row: MetricRow) {
  if (row.error) return row.status_code || 'fail'
  if (row.response_ms) return `${row.response_ms}ms`
  if (row.cf_edge) return row.cf_edge
  return row.status_code || '-'
}

export function sampleStage(row: MetricRow) {
  const round = String(row.round || row.round_id || '')
  if (!round) return 'Sample'
  if (round.endsWith('-recheck')) return 'Recheck after MISS interval'
  return 'First check'
}

export function metricStatusDetails(row: MetricRow) {
  const status = cacheStatus(row)
  const response = row.response_ms ? `${row.response_ms} ms` : '-'
  const age = Number(row.age_seconds) || 0
  const details = [
    ['Round', String(row.round_id || row.round || '-')],
    ['Sample', sampleStage(row)],
    ['Status', status],
    ['Age', duration(age)],
    ['Edge', row.cf_edge || '-'],
    ['Response', response],
    ['HTTP', row.status_code || '-'],
    ['Fetched', row.timestamp_utc ? shortDate(row.timestamp_utc) : '-'],
    ['Country', countryName(row.proxy_country || '-')],
    ['Proxy', row.proxy || '-'],
    ['CF-Ray', row.cf_ray || '-'],
  ]

  if (row.error) details.push(['Error', row.error])
  return details
}

export function cacheAgeBuckets(rows: MetricRow[]) {
  const buckets = new Map<string, CacheAgeBucket>()

  for (const row of rows) {
    const time = Date.parse(row.timestamp_utc || '')
    const round = metricRoundBase(row.round_id || row.round || '')
    const fallbackKey = Number.isNaN(time) ? 'unknown' : new Date(time).toISOString().slice(0, 13)
    const key = round ? `round-${round}` : fallbackKey
    let bucket = buckets.get(key)

    if (!bucket) {
      const date = Number.isNaN(time) ? null : new Date(time)
      bucket = {
        ageValues: [],
        avgAge: 0,
        errors: 0,
        hitRate: 0,
        hits: 0,
        key,
        label: round
          ? `R${round}`
          : date
            ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            : '-',
        maxAge: 0,
        meta: date ? shortDate(date.toISOString()) : 'No time',
        missLike: 0,
        noHeader: 0,
        sort: Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time,
        total: 0,
        useful: 0,
      }
      buckets.set(key, bucket)
    }

    const status = cacheStatus(row)
    const age = Number(row.age_seconds) || 0
    bucket.total += 1
    bucket.sort = Math.min(bucket.sort, Number.isNaN(time) ? bucket.sort : time)

    if (row.error || status === 'FAIL') {
      bucket.errors += 1
    } else if (!row.cf_cache_status) {
      bucket.noHeader += 1
    } else {
      bucket.useful += 1
      if (status === 'HIT') bucket.hits += 1
      else if (isMissLike(status)) bucket.missLike += 1
    }

    if (status === 'HIT' && age > 0) bucket.ageValues.push(age)
  }

  return [...buckets.values()]
    .map(finalizeAgeBucket)
    .sort((a, b) => a.sort - b.sort)
}

function finalizeAgeBucket(bucket: CacheAgeBucket) {
  bucket.maxAge = Math.max(0, ...bucket.ageValues)
  bucket.avgAge = avg(bucket.ageValues)
  bucket.hitRate = bucket.useful ? Math.round((bucket.hits / bucket.useful) * 100) : 0
  return bucket
}

export function cacheAgeSummary(buckets: CacheAgeBucket[]) {
  const ageValues = buckets.flatMap((bucket) => bucket.ageValues)
  const hits = buckets.reduce((sum, bucket) => sum + bucket.hits, 0)
  const useful = buckets.reduce((sum, bucket) => sum + bucket.useful, 0)
  return {
    avgAge: avg(ageValues),
    errors: buckets.reduce((sum, bucket) => sum + bucket.errors, 0),
    hitRate: useful ? Math.round((hits / useful) * 100) : 0,
    hits,
    maxAge: Math.max(0, ...ageValues),
    missLike: buckets.reduce((sum, bucket) => sum + bucket.missLike, 0),
    noHeader: buckets.reduce((sum, bucket) => sum + bucket.noHeader, 0),
    useful,
  }
}

export function topHitUrls(rows: MetricRow[]) {
  const urls = new Map<string, TopHitUrl & { ageValues: number[] }>()

  for (const row of rows) {
    const url = row.url || row.page || '-'
    const status = cacheStatus(row)
    const age = Number(row.age_seconds) || 0
    let item = urls.get(url)
    if (!item) {
      item = {
        ageValues: [],
        avgAge: 0,
        hitRate: 0,
        hits: 0,
        latestTimestamp: '',
        maxAge: 0,
        total: 0,
        url,
        useful: 0,
      }
      urls.set(url, item)
    }

    item.total += 1
    if (row.cf_cache_status) item.useful += 1
    if (status === 'HIT') {
      item.hits += 1
      if (age > 0) item.ageValues.push(age)
    }
    if (!item.latestTimestamp || Date.parse(row.timestamp_utc || '') > Date.parse(item.latestTimestamp)) {
      item.latestTimestamp = row.timestamp_utc || ''
    }
  }

  return [...urls.values()]
    .map(({ ageValues, ...item }) => ({
      ...item,
      avgAge: avg(ageValues),
      hitRate: item.useful ? Math.round((item.hits / item.useful) * 100) : 0,
      maxAge: Math.max(0, ...ageValues),
    }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.hitRate - a.hitRate || b.maxAge - a.maxAge)
    .slice(0, 10)
}

export function ageSegmentHeight(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0
}

export function ageBucketTitle(bucket: CacheAgeBucket) {
  return [
    `${bucket.label} (${bucket.meta})`,
    `${bucket.hitRate}% HIT`,
    `${bucket.hits} HIT`,
    `${bucket.missLike} MISS-like`,
    `${bucket.noHeader} no header`,
    `${bucket.errors} errors`,
  ].join(' - ')
}

function timeLabel(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function dateLabel(date: Date) {
  return `${date.getDate()} ${monthLabels[date.getMonth()] ?? ''}`.trim()
}

export function roundStatusLabel(status: string) {
  const labels: Record<string, string> = {
    completed: 'Completed',
    failed: 'Failed',
    running: 'Running',
    stopped: 'Stopped',
  }
  return labels[status] || status
}
