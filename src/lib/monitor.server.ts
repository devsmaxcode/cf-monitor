import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { dirname as fileDirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMetricRound,
  DEFAULT_METRICS_DB,
  finalizeMetricRound,
  normalizeMetricsOutput,
  readMetricRows,
  readMetricRounds,
  type MetricDateRange,
  type MetricRow,
} from './metrics-db'
import { METRIC_RETENTION_DAYS, type MetricRangeDays } from './metric-range'
export { metricRangeDayOptions, type MetricRangeDays } from './metric-range'

export type Config = {
  pages: string[]
  output: string
  proxyCountries: string
  maxProxiesPerCountry: number
  timeout: number
  delay: number
  roundIntervalSeconds: number
  hitIntervalSeconds: number
  missIntervalSeconds: number
  noDirect: boolean
  noProxySource: boolean
  noClarketmSource: boolean
  shuffleProxies: boolean
  userAgent: string
}

export type MetricTimeColumn = {
  key: string
  label: string
  meta: string
  sort: number
}

export type MonitorState = {
  running: boolean
  busy: boolean
  round: number
  crawl: CrawlProgress | null
  startedAt: string | null
  lastRunAt: string | null
  nextRunAt: string | null
  lastExitCode: number | null
  lastReason: string | null
  lastError: string | null
  logs: string[]
}

export type CrawlProgress = {
  round: number
  totalUrls: number
  requestedUrls: number
  activeUrl: string | null
}

export type MetricsPayload = Awaited<ReturnType<typeof buildMetrics>>

export type DashboardPayload = {
  config: Config
  metrics: MetricsPayload
  proxies: {
    text: string
    count: number
    proxies: string[]
  }
  status: MonitorState
}

const metricDayMs = 24 * 60 * 60 * 1000
const here = fileDirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const storageDir = join(root, 'storage')
const configPath = join(storageDir, 'dashboard-config.json')
const pagesPath = join(storageDir, 'pages.txt')
const proxiesPath = join(storageDir, 'proxies.txt')
const legacyDefaultBaseUrl = 'https://ummah.one'

const defaultPages = [
  'https://ummah.one/',
  'https://ummah.one/quran',
  'https://ummah.one/quran/al-fatihah',
  'https://ummah.one/quran/al-baqarah',
  'https://ummah.one/quran/juz/1',
  'https://ummah.one/quran/page/1',
  'https://ummah.one/hadith/books',
  'https://ummah.one/dua',
  'https://ummah.one/dua/categories',
  'https://ummah.one/dua/all-duas',
  'https://ummah.one/99-names-of-allah',
  'https://ummah.one/zakat-calculator',
  'https://ummah.one/tahakiks',
]

const defaultConfig: Config = {
  pages: defaultPages,
  output: DEFAULT_METRICS_DB,
  proxyCountries:
    'Bangladesh,India,United States,United Kingdom,Canada,Germany,France,Singapore,Japan,Australia',
  maxProxiesPerCountry: 8,
  timeout: 5,
  delay: 0,
  roundIntervalSeconds: 900,
  hitIntervalSeconds: 900,
  missIntervalSeconds: 120,
  noDirect: false,
  noProxySource: false,
  noClarketmSource: false,
  shuffleProxies: true,
  userAgent: 'UmmahOneCacheMonitor/1.0 (+https://ummah.one)',
}

const state: MonitorState = {
  running: false,
  busy: false,
  round: 0,
  crawl: null,
  startedAt: null,
  lastRunAt: null,
  nextRunAt: null,
  lastExitCode: null,
  lastReason: null,
  lastError: null,
  logs: [],
}

let scheduledJob: ReturnType<typeof setTimeout> | null = null
let activeMonitorProcess: ChildProcessWithoutNullStreams | null = null
let stopRequested = false
let requestedCrawlPages = new Set<string>()

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function readConfig(): Promise<Config> {
  if (!(await exists(configPath))) {
    await saveConfig(defaultConfig)
    return defaultConfig
  }

  const stored = JSON.parse(await readFile(configPath, 'utf8')) as Partial<Config>
  return sanitizeConfig({ ...defaultConfig, ...stored })
}

export function sanitizeConfig(value: Partial<Config> & { baseUrl?: string }): Config {
  const { baseUrl: _baseUrl, ...configValue } = value
  const legacyBaseUrl = String(value.baseUrl || legacyDefaultBaseUrl).trim()
  const roundIntervalSeconds = clamp(
    Number(value.roundIntervalSeconds ?? value.hitIntervalSeconds),
    15,
    86400,
    defaultConfig.roundIntervalSeconds,
  )

  return {
    ...defaultConfig,
    ...configValue,
    pages: Array.isArray(value.pages)
      ? value.pages
          .map((page) => normalizeTargetUrl(String(page).trim(), legacyBaseUrl))
          .filter(Boolean)
      : defaultPages,
    maxProxiesPerCountry: clamp(Number(value.maxProxiesPerCountry), 1, 100, 8),
    timeout: clamp(Number(value.timeout), 1, 60, 5),
    delay: clamp(Number(value.delay), 0, 60, 0),
    roundIntervalSeconds,
    hitIntervalSeconds: roundIntervalSeconds,
    missIntervalSeconds: clamp(Number(value.missIntervalSeconds), 15, 86400, 120),
    output: normalizeMetricsOutput(String(value.output || defaultConfig.output).trim()),
    proxyCountries: String(value.proxyCountries || defaultConfig.proxyCountries).trim(),
    userAgent: String(value.userAgent || defaultConfig.userAgent).trim(),
    noDirect: Boolean(value.noDirect),
    noProxySource: Boolean(value.noProxySource),
    noClarketmSource: Boolean(value.noClarketmSource),
    shuffleProxies: Boolean(value.shuffleProxies),
  }
}

export async function saveConfig(config: Config) {
  await mkdir(storageDir, { recursive: true })
  const sanitized = sanitizeConfig(config)
  await writeFile(configPath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8')
  if (state.running && !state.busy) void scheduleNext(sanitized)
  return sanitized
}

export async function readProxies() {
  const text = await readProxyText()
  const proxies = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  return { text, count: proxies.length, proxies }
}

export async function saveProxies(text: string) {
  await mkdir(storageDir, { recursive: true })
  await writeFile(proxiesPath, text, 'utf8')
  return { ok: true }
}

export async function getDashboard(days: MetricRangeDays): Promise<DashboardPayload> {
  const config = await readConfig()
  const [metrics, proxies] = await Promise.all([
    buildMetrics(config, metricRange(days)),
    readProxies(),
  ])

  return {
    config,
    metrics,
    proxies,
    status: snapshotState(),
  }
}

export async function getRuntime(days: MetricRangeDays) {
  const config = await readConfig()
  return {
    metrics: await buildMetrics(config, metricRange(days)),
    status: snapshotState(),
  }
}

export async function startMonitor() {
  if (state.running) return snapshotState()
  state.running = true
  state.startedAt = new Date().toISOString()
  void runMonitorRound('start')
  return snapshotState()
}

export function stopMonitor() {
  state.running = false
  state.nextRunAt = null
  clearScheduledJob()
  stopActiveMonitor()
  pushLog(`[${new Date().toLocaleString()}] monitor stopped`)
  return snapshotState()
}

export function runOnce() {
  void runMonitorRound('manual')
  return snapshotState()
}

function normalizeTargetUrl(value: string, legacyBaseUrl = legacyDefaultBaseUrl) {
  if (!value) return ''
  try {
    return new URL(value).toString()
  } catch {
    try {
      return new URL(value.replace(/^\/+/, ''), legacyBaseUrl.replace(/\/?$/, '/')).toString()
    } catch {
      return value
    }
  }
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

async function ensureRunFiles(config: Config) {
  await mkdir(storageDir, { recursive: true })
  await writeFile(pagesPath, `${config.pages.join('\n')}\n`, 'utf8')
  if (!(await exists(proxiesPath))) await writeFile(proxiesPath, '', 'utf8')
  await mkdir(dirname(join(root, config.output)), { recursive: true })
}

async function readProxyText() {
  if (!(await exists(proxiesPath))) return ''
  return readFile(proxiesPath, 'utf8')
}

function pushLog(line: string) {
  state.logs.push(line)
  state.logs = state.logs.slice(-160)
}

function snapshotState(): MonitorState {
  return {
    ...state,
    crawl: state.crawl ? { ...state.crawl } : null,
    logs: [...state.logs],
  }
}

async function pipeProcessOutput(stream: NodeJS.ReadableStream | null, label = '') {
  if (!stream) return

  const decoder = new TextDecoder()
  let buffer = ''

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (value: Buffer | string) => {
      buffer += typeof value === 'string' ? value : decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          recordCrawlProgress(line)
          pushLog(label ? `${label}${line}` : line)
        }
      }
    })

    stream.on('error', reject)
    stream.on('end', () => {
    buffer += decoder.decode()
    if (buffer.trim()) {
      recordCrawlProgress(buffer)
      pushLog(label ? `${label}${buffer}` : buffer)
    }
      resolve()
    })
  })
}

function recordCrawlProgress(line: string) {
  const match = line.match(/^requesting\s+round=(\d+)\s+page=(.+)$/)
  if (!match || !state.crawl) return

  const round = Number(match[1])
  const page = match[2].trim()
  if (!page || !state.busy || round !== state.round) return

  requestedCrawlPages.add(page)
  state.crawl = {
    ...state.crawl,
    activeUrl: page,
    requestedUrls: Math.min(state.crawl.totalUrls, requestedCrawlPages.size),
  }
}

async function runMonitorRound(reason: string) {
  if (state.busy) return { skipped: true, reason: 'monitor is already running' }

  state.busy = true
  state.crawl = null
  state.lastReason = reason
  state.lastError = null
  state.nextRunAt = null

  let config: Config | null = null
  let proc: ChildProcessWithoutNullStreams | null = null
  let roundId = 0
  stopRequested = false

  try {
    config = await readConfig()
    requestedCrawlPages = new Set<string>()
    state.crawl = {
      round: 0,
      totalUrls: config.pages.length,
      requestedUrls: 0,
      activeUrl: null,
    }
    await ensureRunFiles(config)
    const round = await createMetricRound(
      config.output,
      {
        reason,
        pageCount: config.pages.length,
        proxyCountryCount: configuredProxyLocationCount(config),
        configJson: JSON.stringify(config),
      },
      root,
    )
    roundId = round.id
    state.round = roundId
    state.crawl = { ...state.crawl, round: roundId }

    if (stopRequested) {
      pushLog(`[${new Date().toLocaleString()}] round ${roundId} stopped before collector start`)
      await finalizeMetricRound(
        config.output,
        roundId,
        { status: 'stopped', error: 'stopped before collector start' },
        root,
      )
      return { skipped: false }
    }

    const args = monitorProcessArgs(config, roundId, reason)
    const started = new Date()
    state.lastRunAt = started.toISOString()
    pushLog(`[${started.toLocaleString()}] round ${roundId} started (${reason})`)
    pushLog(
      `collector args: ${args
        .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
        .join(' ')}`,
    )

    proc = spawn(process.execPath, args, {
      cwd: root,
    })
    activeMonitorProcess = proc

    const [exitCode] = await Promise.all([
      new Promise<number>((resolve) => proc?.once('exit', (code) => resolve(code ?? 1))),
      pipeProcessOutput(proc.stdout),
      pipeProcessOutput(proc.stderr, 'stderr: '),
    ])

    state.lastExitCode = exitCode

    if (exitCode !== 0) {
      if (stopRequested) {
        pushLog(`[${new Date().toLocaleString()}] round ${roundId} stopped`)
        await finalizeMetricRound(
          config.output,
          roundId,
          { status: 'stopped', error: 'stopped by user' },
          root,
        )
      } else {
        state.lastError = `collector exited with code ${exitCode}`
        pushLog(state.lastError)
        await finalizeMetricRound(
          config.output,
          roundId,
          { status: 'failed', error: state.lastError },
          root,
        )
      }
    } else {
      await finalizeMetricRound(config.output, roundId, { status: 'completed' }, root)
      pushLog(`[${new Date().toLocaleString()}] round ${roundId} finished`)
    }
  } catch (error) {
    state.lastExitCode = 1
    state.lastError = errorMessage(error)
    pushLog(state.lastError)
    if (config && roundId) {
      await finalizeMetricRound(
        config.output,
        roundId,
        { status: 'failed', error: state.lastError },
        root,
      ).catch((finalizeError) =>
        pushLog(`round finalize failed: ${errorMessage(finalizeError)}`),
      )
    }
  } finally {
    if (activeMonitorProcess === proc) activeMonitorProcess = null
    stopRequested = false
    state.busy = false
  }

  if (state.running) void scheduleNextFromSavedConfig()
  return { skipped: false }
}

async function scheduleNextFromSavedConfig() {
  try {
    await scheduleNext(await readConfig())
  } catch (error) {
    pushLog(`schedule config read failed: ${errorMessage(error)}`)
  }
}

function monitorProcessArgs(config: Config, roundId: number, reason: string) {
  return [
    '--experimental-strip-types',
    '--disable-warning=ExperimentalWarning',
    ...monitorArgs(config, roundId, reason),
  ]
}

function monitorArgs(config: Config, roundId: number, reason: string) {
  const args = [
    join(root, 'scripts', 'cloudflare_cache_monitor.ts'),
    '--pages',
    pagesPath,
    '--proxies',
    proxiesPath,
    '--output',
    config.output,
    '--round-id',
    String(roundId),
    '--round-reason',
    reason,
    '--rounds',
    '1',
    '--miss-recheck-delay',
    '0',
    '--timeout',
    String(config.timeout),
    '--delay',
    String(config.delay),
    '--proxy-countries',
    config.proxyCountries,
    '--max-proxies-per-country',
    String(config.maxProxiesPerCountry),
    '--user-agent',
    config.userAgent,
  ]

  if (config.noDirect) args.push('--no-direct')
  if (config.noProxySource) args.push('--no-proxy-source')
  if (config.noClarketmSource) args.push('--no-clarketm-source')
  if (config.shuffleProxies) args.push('--shuffle-proxies')
  return args
}

function configuredProxyLocationCount(config: Config) {
  const countries = config.proxyCountries
    .split(',')
    .map((country) => country.trim())
    .filter(Boolean).length
  return countries + (config.noDirect ? 0 : 1)
}

function stopActiveMonitor() {
  stopRequested = true
  if (!activeMonitorProcess) return
  try {
    activeMonitorProcess.kill()
  } catch (error) {
    pushLog(`failed to stop collector: ${errorMessage(error)}`)
  }
}

function clearScheduledJob() {
  if (!scheduledJob) return
  clearTimeout(scheduledJob)
  scheduledJob = null
}

async function scheduleNext(config: Config) {
  if (!state.running) return
  clearScheduledJob()

  const delay = config.roundIntervalSeconds
  const next = new Date(Date.now() + delay * 1000)
  state.nextRunAt = next.toISOString()
  pushLog(`[${new Date().toLocaleString()}] next run in ${delay}s`)

  scheduledJob = setTimeout(() => {
    scheduledJob = null
    void runMonitorRound('schedule')
  }, Math.max(0, next.getTime() - Date.now()))
}

async function buildMetrics(config: Config, range = metricRange(METRIC_RETENTION_DAYS)) {
  const rows = await readMetricRows(config.output, root, { sinceIso: range.sinceIso })
  const rounds = await readMetricRounds(config.output, root, { sinceIso: range.sinceIso })
  const timeColumns = metricTimeColumns(rows)
  const latest = new Map<string, MetricRow>()

  for (const row of rows) {
    const normalizedRow: MetricRow = {
      ...row,
      proxy_country: normalizeCountry(row.proxy_country || 'unknown'),
    }
    const key = `${normalizedRow.page}|${normalizedRow.proxy_country}`
    const existing = latest.get(key)
    if (!existing || Date.parse(normalizedRow.timestamp_utc) >= Date.parse(existing.timestamp_utc)) {
      latest.set(key, normalizedRow)
    }
  }

  const latestRows = [...latest.values()].sort((a, b) =>
    `${a.page}|${a.proxy_country}`.localeCompare(`${b.page}|${b.proxy_country}`),
  )
  const configuredCountries = config.proxyCountries
    .split(',')
    .map((country) => normalizeCountry(country))
    .filter(Boolean)
  const countries = [
    ...new Set([
      ...(!config.noDirect ? ['direct'] : []),
      ...configuredCountries,
      ...latestRows.map((row) => row.proxy_country || 'unknown'),
    ]),
  ].sort((a, b) => (a === 'direct' ? -1 : b === 'direct' ? 1 : a.localeCompare(b)))
  const pages = [...new Set([...config.pages, ...latestRows.map((row) => row.page)].filter(Boolean))]
  const pageStats = pages.map((page) => {
    const pageRows = latestRows.filter((row) => row.page === page)
    const hitCount = pageRows.filter((row) => row.cf_cache_status === 'HIT').length
    const missLike = pageRows.filter((row) => isMissLike(row)).length
    const errors = pageRows.filter((row) => row.error).length
    const maxAge = Math.max(0, ...pageRows.map((row) => Number(row.age_seconds) || 0))
    const avgMs = average(pageRows.map((row) => Number(row.response_ms)).filter(Number.isFinite))
    return { page, hitCount, missLike, errors, maxAge, avgMs, total: pageRows.length }
  })
  const matrix = pages.map((page) => ({
    page,
    cells: countries.map((country) => latest.get(`${page}|${country}`) || null),
  }))

  const summary = {
    totalRounds: rounds.length,
    totalRows: rows.length,
    latestCells: latestRows.length,
    latestHits: latestRows.filter((row) => row.cf_cache_status === 'HIT').length,
    latestMissLike: latestRows.filter(isMissLike).length,
    latestErrors: latestRows.filter((row) => row.error).length,
    maxAge: Math.max(0, ...latestRows.map((row) => Number(row.age_seconds) || 0)),
    avgResponseMs: average(latestRows.map((row) => Number(row.response_ms)).filter(Number.isFinite)),
    lastTimestamp: rows.at(-1)?.timestamp_utc || null,
  }

  return {
    rows,
    rounds,
    latestRows,
    countries,
    pages,
    pageStats,
    matrix,
    timeColumns,
    summary,
    range: {
      ...range,
      availableFrom: rows[0]?.timestamp_utc || rounds.at(-1)?.started_at || null,
      availableTo: rows.at(-1)?.timestamp_utc || rounds[0]?.completed_at || rounds[0]?.started_at || null,
    },
  }
}

function metricRange(days: MetricRangeDays) {
  return {
    days,
    sinceIso: new Date(Date.now() - days * metricDayMs).toISOString(),
  } satisfies MetricDateRange & { days: MetricRangeDays; sinceIso: string }
}

function metricTimeColumns(rows: MetricRow[]) {
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

function metricTimeColumn(value: string): MetricTimeColumn {
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
    label: date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    meta: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
    sort:
      date.getFullYear() * 100000000 +
      (date.getMonth() + 1) * 1000000 +
      date.getDate() * 10000 +
      date.getHours() * 100 +
      date.getMinutes(),
  }
}

function metricBatchColumn(row: MetricRow): MetricTimeColumn {
  const column = metricTimeColumn(row.timestamp_utc || '')
  const round = row.round || row.round_id
  if (!round) return column
  return { ...column, key: `batch-${round}`, label: `Batch ${round}` }
}

function batchTimeRange(start: number, end: number) {
  if (start === Number.MAX_SAFE_INTEGER) return 'No time'
  const middleDate = new Date(start + (end - start) / 2)
  const middleLabel = middleDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${middleLabel}, ${middleDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

function isMissLike(row: MetricRow) {
  const status = (row.cf_cache_status || '').toUpperCase()
  return ['MISS', 'BYPASS', 'DYNAMIC', 'EXPIRED', 'REVALIDATED', 'STALE', 'UPDATING'].includes(
    status,
  )
}

function normalizeCountry(country: string) {
  const value = country.trim()
  const names: Record<string, string> = {
    AUSTRALIA: 'AU',
    BANGLADESH: 'BD',
    CANADA: 'CA',
    FRANCE: 'FR',
    GERMANY: 'DE',
    INDIA: 'IN',
    JAPAN: 'JP',
    SINGAPORE: 'SG',
    'UNITED KINGDOM': 'GB',
    'UNITED STATES': 'US',
  }
  const upper = value.toUpperCase()
  if (upper === 'DIRECT') return 'direct'
  return names[upper] || upper
}

function average(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
