import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js'
import { METRIC_RETENTION_DAYS } from './metric-range.ts'

export const DEFAULT_METRICS_DB = 'storage/cloudflare-cache-metrics.sqlite'
export { METRIC_RETENTION_DAYS } from './metric-range.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const projectRoot = resolve(process.env.APP_ROOT || process.cwd())
const SQL_READY = initSqlJs({
  locateFile: (file) => join(projectRoot, 'node_modules', 'sql.js', 'dist', file),
})

export const METRIC_FIELDS = [
  'round_id',
  'timestamp_utc',
  'round',
  'page',
  'url',
  'proxy',
  'proxy_country',
  'status_code',
  'cf_cache_status',
  'cf_ray',
  'cf_edge',
  'age_seconds',
  'response_ms',
  'content_length',
  'content_type',
  'cache_control',
  'server',
  'error',
] as const

export type MetricRow = Record<string, string>
export type MetricRoundStatus = 'running' | 'completed' | 'failed' | 'stopped'
export type MetricRoundRow = {
  id: number
  status: MetricRoundStatus
  reason: string
  started_at: string
  completed_at: string
  duration_ms: number
  total_rows: number
  recheck_rows: number
  page_count: number
  proxy_country_count: number
  config_json: string
  error: string
  created_at: string
}

type CreateMetricRoundInput = {
  reason?: string
  startedAt?: string
  pageCount?: number
  proxyCountryCount?: number
  configJson?: string
}

type FinalizeMetricRoundInput = {
  status: MetricRoundStatus
  completedAt?: string
  totalRows?: number
  recheckRows?: number
  error?: string
}

export type MetricDateRange = {
  sinceIso?: string
  untilIso?: string
}

export type MetricRowsQuery = MetricDateRange & {
  limit?: number
  order?: 'asc' | 'desc'
}

export type MetricRowFilters = {
  cacheStatus?: string
  country?: string
  page?: string
  query?: string
}

export type MetricColumnSummary = {
  completed_at: string
  round: string
  round_id: string
  started_at: string
}

export type MetricRowsPageInput = MetricDateRange & {
  filters?: MetricRowFilters
  page?: number
  pageSize?: number
}

export type MetricRowsPage = {
  availableFrom: string | null
  availableTo: string | null
  columns: MetricColumnSummary[]
  countries: string[]
  page: number
  pages: string[]
  pageSize: number
  rows: MetricRow[]
  statuses: string[]
  totalGroups: number
  totalRows: number
}

type DbHandle = {
  db: SqlJsDatabase
  filename: string
}

export function normalizeMetricsOutput(output?: string) {
  const value = String(output || DEFAULT_METRICS_DB).trim() || DEFAULT_METRICS_DB
  return value.replace(/\.csv$/i, '.sqlite')
}

export function resolveMetricsDbPath(output: string, baseDir = process.cwd()) {
  const normalized = normalizeMetricsOutput(output)
  return isAbsolute(normalized) ? normalized : join(baseDir, normalized)
}

export async function appendMetricRows(output: string, rows: MetricRow[], baseDir = process.cwd()) {
  if (!rows.length) return

  await withMetricsDb(output, baseDir, true, ({ db }) => {
    db.run('BEGIN')
    try {
      const stmt = db.prepare(`
        INSERT INTO cache_metrics (
          round_id, timestamp_utc, round, page, url, proxy, proxy_country, status_code,
          cf_cache_status, cf_ray, cf_edge, age_seconds, response_ms,
          content_length, content_type, cache_control, server, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      try {
        for (const row of rows) {
          stmt.run([
            metricRoundId(row),
            value(row.timestamp_utc),
            value(row.round),
            value(row.page),
            value(row.url),
            value(row.proxy),
            value(row.proxy_country),
            value(row.status_code),
            value(row.cf_cache_status),
            value(row.cf_ray),
            value(row.cf_edge),
            value(row.age_seconds),
            value(row.response_ms),
            value(row.content_length),
            value(row.content_type),
            value(row.cache_control),
            value(row.server),
            value(row.error),
          ])
        }
      } finally {
        stmt.free()
      }
      db.run('COMMIT')
    } catch (error) {
      db.run('ROLLBACK')
      throw error
    }
  })
}

export async function readMetricRows(
  output: string,
  baseDir = process.cwd(),
  dateRange: MetricRowsQuery = {},
) {
  return withMetricsDb(output, baseDir, false, ({ db }) => {
    const range = normalizeMetricDateRange(dateRange)
    const order = dateRange.order === 'desc' ? 'DESC' : 'ASC'
    const limit = boundedInteger(dateRange.limit, 0, 100000, 0)
    const params: unknown[] = [range.sinceIso, range.sinceIso, range.untilIso, range.untilIso]
    const limitSql = limit ? 'LIMIT ?' : ''
    if (limit) params.push(limit)
    const rows = selectRows(
      db,
      `
        SELECT
          round_id, timestamp_utc, round, page, url, proxy, proxy_country, status_code,
          cf_cache_status, cf_ray, cf_edge, age_seconds, response_ms,
          content_length, content_type, cache_control, server, error
        FROM cache_metrics
        WHERE
          (? IS NULL OR (timestamp_utc <> '' AND datetime(timestamp_utc) >= datetime(?)))
          AND (? IS NULL OR (timestamp_utc <> '' AND datetime(timestamp_utc) <= datetime(?)))
        ORDER BY id ${order}
        ${limitSql}
      `,
      params,
    )

    return rows.map(metricRowFromDb)
  })
}

export async function readMetricRowsPage(
  output: string,
  baseDir = process.cwd(),
  input: MetricRowsPageInput = {},
) {
  return withMetricsDb(output, baseDir, false, ({ db }) => {
    const range = normalizeMetricDateRange(input)
    const pageSize = boundedInteger(input.pageSize, 1, 200, 50)
    const page = boundedInteger(input.page, 1, 1000000, 1)
    const offset = (page - 1) * pageSize
    const filtered = metricQueryWhere(range, input.filters)
    const ranged = metricQueryWhere(range)
    const [totalRow] = selectRows(
      db,
      `SELECT COUNT(*) AS count FROM cache_metrics ${filtered.where}`,
      filtered.params,
    )
    const [groupCountRow] = selectRows(
      db,
      `
        SELECT COUNT(*) AS count
        FROM (
          SELECT 1
          FROM cache_metrics
          ${filtered.where}
          GROUP BY page, url, proxy_country
        )
      `,
      filtered.params,
    )
    const groupRows = selectRows(
      db,
      `
        SELECT page, url, proxy_country, MIN(id) AS first_id
        FROM cache_metrics
        ${filtered.where}
        GROUP BY page, url, proxy_country
        ORDER BY first_id ASC
        LIMIT ? OFFSET ?
      `,
      [...filtered.params, pageSize, offset],
    )
    const groupFilter = metricGroupWhere(groupRows)
    const pageFilter = metricQueryWhere(range, input.filters, [groupFilter.sql], groupFilter.params)
    const rows = groupRows.length
      ? selectRows(
          db,
          `
            SELECT
              round_id, timestamp_utc, round, page, url, proxy, proxy_country, status_code,
              cf_cache_status, cf_ray, cf_edge, age_seconds, response_ms,
              content_length, content_type, cache_control, server, error
            FROM cache_metrics
            ${pageFilter.where}
            ORDER BY id ASC
          `,
          pageFilter.params,
        ).map(metricRowFromDb)
      : []
    const columns = selectRows(
      db,
      `
        SELECT
          CAST(round_id AS TEXT) AS round_id,
          round,
          MIN(timestamp_utc) AS started_at,
          MAX(timestamp_utc) AS completed_at,
          MIN(id) AS first_id
        FROM cache_metrics
        ${filtered.where}
        GROUP BY COALESCE(NULLIF(round, ''), CAST(round_id AS TEXT), '')
        ORDER BY first_id ASC
      `,
      filtered.params,
    ).map((row) => ({
      completed_at: value(row.completed_at),
      round: value(row.round),
      round_id: value(row.round_id),
      started_at: value(row.started_at),
    }))
    const boundsFilter = metricQueryWhere(range, undefined, ["timestamp_utc <> ''"])
    const [bounds] = selectRows(
      db,
      `
        SELECT MIN(timestamp_utc) AS available_from, MAX(timestamp_utc) AS available_to
        FROM cache_metrics
        ${boundsFilter.where}
      `,
      boundsFilter.params,
    )

    return {
      availableFrom: value(bounds.available_from) || null,
      availableTo: value(bounds.available_to) || null,
      columns,
      countries: metricDistinctValues(db, 'proxy_country', ranged),
      page,
      pages: metricDistinctValues(db, 'page', ranged),
      pageSize,
      rows,
      statuses: metricStatusValues(db, ranged),
      totalGroups: integer(groupCountRow.count),
      totalRows: integer(totalRow.count),
    } satisfies MetricRowsPage
  })
}

export async function createMetricRound(
  output: string,
  input: CreateMetricRoundInput = {},
  baseDir = process.cwd(),
) {
  return withMetricsDb(output, baseDir, true, ({ db }) => {
    db.run(
      `
        INSERT INTO cache_rounds (
          status, reason, started_at, page_count, proxy_country_count, config_json
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        'running',
        value(input.reason),
        value(input.startedAt || nowIso()),
        integer(input.pageCount),
        integer(input.proxyCountryCount),
        value(input.configJson),
      ],
    )

    const [{ id }] = selectRows(db, 'SELECT last_insert_rowid() AS id')
    const [row] = selectRows(
      db,
      `
        SELECT
          id, status, reason, started_at, completed_at, duration_ms, total_rows,
          recheck_rows, page_count, proxy_country_count, config_json, error, created_at
        FROM cache_rounds
        WHERE id = ?
      `,
      [integer(id)],
    )
    return metricRoundFromDb(row)
  })
}

export async function finalizeMetricRound(
  output: string,
  roundId: number,
  input: FinalizeMetricRoundInput,
  baseDir = process.cwd(),
) {
  if (!roundId) return null

  return withMetricsDb(output, baseDir, true, ({ db }) => {
    const [existing] = selectRows(db, 'SELECT started_at FROM cache_rounds WHERE id = ? LIMIT 1', [
      roundId,
    ])
    if (!existing) return null

    const completedAt = input.completedAt || nowIso()
    const counts = metricRoundCounts(db, roundId)
    const totalRows = input.totalRows ?? counts.totalRows
    const recheckRows = input.recheckRows ?? counts.recheckRows
    const durationMs = durationMsBetween(value(existing.started_at), completedAt)

    db.run(
      `
        UPDATE cache_rounds
        SET
          status = ?,
          completed_at = ?,
          duration_ms = ?,
          total_rows = ?,
          recheck_rows = ?,
          error = ?
        WHERE id = ?
      `,
      [
        input.status,
        completedAt,
        durationMs,
        integer(totalRows),
        integer(recheckRows),
        value(input.error),
        roundId,
      ],
    )
    pruneOldMetricRounds(db, METRIC_RETENTION_DAYS)

    const [row] = selectRows(
      db,
      `
        SELECT
          id, status, reason, started_at, completed_at, duration_ms, total_rows,
          recheck_rows, page_count, proxy_country_count, config_json, error, created_at
        FROM cache_rounds
        WHERE id = ?
      `,
      [roundId],
    )
    return metricRoundFromDb(row)
  })
}

export async function applyMetricRoundRetention(
  output: string,
  keepDays = METRIC_RETENTION_DAYS,
  baseDir = process.cwd(),
) {
  await withMetricsDb(output, baseDir, true, ({ db }) => pruneOldMetricRounds(db, keepDays))
}

export async function readMetricRounds(
  output: string,
  baseDir = process.cwd(),
  dateRange: MetricDateRange = {},
) {
  return withMetricsDb(output, baseDir, false, ({ db }) => {
    const range = normalizeMetricDateRange(dateRange)
    const rows = selectRows(
      db,
      `
        SELECT
          id, status, reason, started_at, completed_at, duration_ms, total_rows,
          recheck_rows, page_count, proxy_country_count, config_json, error, created_at
        FROM cache_rounds
        WHERE
          (
            ? IS NULL
            OR status = 'running'
            OR datetime(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) >= datetime(?)
          )
          AND (
            ? IS NULL
            OR datetime(COALESCE(NULLIF(started_at, ''), NULLIF(created_at, ''), NULLIF(completed_at, ''))) <= datetime(?)
          )
        ORDER BY id DESC
      `,
      [range.sinceIso, range.sinceIso, range.untilIso, range.untilIso],
    )
    return rows.map(metricRoundFromDb)
  })
}

async function withMetricsDb<T>(
  output: string,
  baseDir: string,
  persist: boolean,
  callback: (handle: DbHandle) => T,
) {
  const handle = await openMetricsDb(output, baseDir)
  try {
    const result = callback(handle)
    if (persist) await persistDb(handle)
    return result
  } finally {
    handle.db.close()
  }
}

async function openMetricsDb(output: string, baseDir = process.cwd()): Promise<DbHandle> {
  const filename = resolveMetricsDbPath(output, baseDir)
  await mkdir(dirname(filename), { recursive: true })

  const SQL = await SQL_READY
  const db = new SQL.Database((await exists(filename)) ? await readFile(filename) : undefined)
  ensureMetricsSchema(db)
  await persistDb({ db, filename })
  return { db, filename }
}

async function persistDb({ db, filename }: DbHandle) {
  await writeFile(filename, Buffer.from(db.export()))
}

async function exists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function ensureMetricsSchema(db: SqlJsDatabase) {
  db.run(`
    CREATE TABLE IF NOT EXISTS cache_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'running',
      reason TEXT NOT NULL DEFAULT '',
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      total_rows INTEGER NOT NULL DEFAULT 0,
      recheck_rows INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER NOT NULL DEFAULT 0,
      proxy_country_count INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS cache_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL DEFAULT 0,
      timestamp_utc TEXT NOT NULL DEFAULT '',
      round TEXT NOT NULL DEFAULT '',
      page TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      proxy TEXT NOT NULL DEFAULT '',
      proxy_country TEXT NOT NULL DEFAULT '',
      status_code TEXT NOT NULL DEFAULT '',
      cf_cache_status TEXT NOT NULL DEFAULT '',
      cf_ray TEXT NOT NULL DEFAULT '',
      cf_edge TEXT NOT NULL DEFAULT '',
      age_seconds TEXT NOT NULL DEFAULT '',
      response_ms TEXT NOT NULL DEFAULT '',
      content_length TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT '',
      cache_control TEXT NOT NULL DEFAULT '',
      server TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  addRoundIdColumnIfMissing(db)
  backfillLegacyRound(db)
  db.run('CREATE INDEX IF NOT EXISTS idx_cache_rounds_status ON cache_rounds (status)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cache_rounds_started_at ON cache_rounds (started_at)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cache_metrics_round_id ON cache_metrics (round_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cache_metrics_timestamp ON cache_metrics (timestamp_utc)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cache_metrics_page_country ON cache_metrics (page, proxy_country)')
  db.run('CREATE INDEX IF NOT EXISTS idx_cache_metrics_status ON cache_metrics (cf_cache_status)')
}

function addRoundIdColumnIfMissing(db: SqlJsDatabase) {
  const columns = selectRows(db, 'PRAGMA table_info(cache_metrics)')
  if (columns.some((column) => value(column.name) === 'round_id')) return
  db.run('ALTER TABLE cache_metrics ADD COLUMN round_id INTEGER NOT NULL DEFAULT 0')
}

function backfillLegacyRound(db: SqlJsDatabase) {
  const [pending] = selectRows(db, 'SELECT COUNT(*) AS count FROM cache_metrics WHERE round_id = 0')
  if (!integer(pending?.count)) return

  const [existing] = selectRows(
    db,
    "SELECT id FROM cache_rounds WHERE reason = 'legacy-import' ORDER BY id ASC LIMIT 1",
  )

  let legacyRoundId = integer(existing?.id)
  if (!legacyRoundId) {
    const [bounds] = selectRows(
      db,
      `
        SELECT
          MIN(timestamp_utc) AS started_at,
          MAX(timestamp_utc) AS completed_at,
          COUNT(*) AS total_rows,
          SUM(CASE WHEN round LIKE '%-recheck' THEN 1 ELSE 0 END) AS recheck_rows
        FROM cache_metrics
        WHERE round_id = 0
      `,
    )
    const startedAt = value(bounds?.started_at) || nowIso()
    const completedAt = value(bounds?.completed_at) || startedAt
    db.run(
      `
        INSERT INTO cache_rounds (
          status, reason, started_at, completed_at, duration_ms, total_rows, recheck_rows
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        'completed',
        'legacy-import',
        startedAt,
        completedAt,
        durationMsBetween(startedAt, completedAt),
        integer(bounds?.total_rows),
        integer(bounds?.recheck_rows),
      ],
    )
    const [created] = selectRows(db, 'SELECT last_insert_rowid() AS id')
    legacyRoundId = integer(created?.id)
  }

  db.run('UPDATE cache_metrics SET round_id = ? WHERE round_id = 0', [legacyRoundId])
}

function metricRoundCounts(db: SqlJsDatabase, roundId: number) {
  const [row] = selectRows(
    db,
    `
      SELECT
        COUNT(*) AS total_rows,
        SUM(CASE WHEN round LIKE '%-recheck' THEN 1 ELSE 0 END) AS recheck_rows
      FROM cache_metrics
      WHERE round_id = ?
    `,
    [roundId],
  )
  return {
    totalRows: integer(row?.total_rows),
    recheckRows: integer(row?.recheck_rows),
  }
}

function pruneOldMetricRounds(db: SqlJsDatabase, keepDays: number) {
  const keep = integer(keepDays, METRIC_RETENTION_DAYS)
  if (keep <= 0) return

  const cutoffIso = new Date(Date.now() - keep * DAY_MS).toISOString()
  db.run(
    `
      DELETE FROM cache_metrics
      WHERE round_id IN (
        SELECT id
        FROM cache_rounds
        WHERE status <> 'running'
          AND datetime(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) < datetime(?)
      )
    `,
    [cutoffIso],
  )
  db.run(
    `
      DELETE FROM cache_metrics
      WHERE timestamp_utc <> ''
        AND datetime(timestamp_utc) < datetime(?)
    `,
    [cutoffIso],
  )
  db.run(
    `
      DELETE FROM cache_rounds
      WHERE status <> 'running'
        AND datetime(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) < datetime(?)
    `,
    [cutoffIso],
  )
}

function selectRows(db: SqlJsDatabase, sql: string, params: unknown[] = []) {
  const stmt = db.prepare(sql)
  const rows: Record<string, unknown>[] = []
  try {
    stmt.bind(params as SqlValue[])
    while (stmt.step()) rows.push(stmt.getAsObject())
  } finally {
    stmt.free()
  }
  return rows
}

function metricRowFromDb(row: Record<string, unknown>): MetricRow {
  return Object.fromEntries(METRIC_FIELDS.map((field) => [field, value(row[field])]))
}

type MetricSqlFilter = {
  params: unknown[]
  where: string
}

function metricQueryWhere(
  range: ReturnType<typeof normalizeMetricDateRange>,
  filters: MetricRowFilters = {},
  extraClauses: string[] = [],
  extraParams: unknown[] = [],
): MetricSqlFilter {
  const clauses: string[] = []
  const params: unknown[] = []

  if (range.sinceIso) {
    clauses.push("timestamp_utc <> '' AND datetime(timestamp_utc) >= datetime(?)")
    params.push(range.sinceIso)
  }
  if (range.untilIso) {
    clauses.push("timestamp_utc <> '' AND datetime(timestamp_utc) <= datetime(?)")
    params.push(range.untilIso)
  }

  const country = value(filters.country).trim()
  if (country) {
    clauses.push('proxy_country = ?')
    params.push(country)
  }

  const page = value(filters.page).trim()
  if (page) {
    clauses.push('page = ?')
    params.push(page)
  }

  const cacheStatus = value(filters.cacheStatus).trim().toUpperCase()
  if (cacheStatus) {
    clauses.push(`${metricStatusSql()} = ?`)
    params.push(cacheStatus)
  }

  const query = value(filters.query).trim().toLowerCase()
  if (query) {
    clauses.push(
      `LOWER(page || ' ' || url || ' ' || proxy_country || ' ' || cf_edge || ' ' || proxy || ' ' || error || ' ' || cf_ray || ' ' || status_code || ' ' || ${metricStatusSql()}) LIKE ?`,
    )
    params.push(`%${query}%`)
  }

  clauses.push(...extraClauses)
  params.push(...extraParams)

  return {
    params,
    where: clauses.length ? `WHERE ${clauses.map((clause) => `(${clause})`).join(' AND ')}` : '',
  }
}

function metricGroupWhere(rows: Record<string, unknown>[]) {
  const clauses: string[] = []
  const params: unknown[] = []

  for (const row of rows) {
    clauses.push('(page = ? AND url = ? AND proxy_country = ?)')
    params.push(value(row.page), value(row.url), value(row.proxy_country))
  }

  return {
    params,
    sql: clauses.length ? `(${clauses.join(' OR ')})` : '0',
  }
}

function metricDistinctValues(
  db: SqlJsDatabase,
  field: 'page' | 'proxy_country',
  base: MetricSqlFilter,
) {
  const filtered = appendMetricWhere(base, `${field} <> ''`)
  const rows = selectRows(
    db,
    `
      SELECT DISTINCT ${field} AS value
      FROM cache_metrics
      ${filtered.where}
      ORDER BY value COLLATE NOCASE ASC
    `,
    filtered.params,
  )
  return rows.map((row) => value(row.value)).filter(Boolean)
}

function metricStatusValues(db: SqlJsDatabase, base: MetricSqlFilter) {
  const rows = selectRows(
    db,
    `
      SELECT DISTINCT ${metricStatusSql()} AS value
      FROM cache_metrics
      ${base.where}
      ORDER BY value COLLATE NOCASE ASC
    `,
    base.params,
  )
  return rows.map((row) => value(row.value)).filter(Boolean)
}

function appendMetricWhere(base: MetricSqlFilter, clause: string, params: unknown[] = []) {
  return {
    params: [...base.params, ...params],
    where: base.where ? `${base.where} AND (${clause})` : `WHERE (${clause})`,
  }
}

function metricStatusSql() {
  return "UPPER(CASE WHEN cf_cache_status <> '' THEN cf_cache_status WHEN error <> '' THEN 'FAIL' ELSE '-' END)"
}

function metricRoundFromDb(row: unknown): MetricRoundRow {
  const valueRow = row as Record<string, unknown>
  return {
    id: integer(valueRow.id),
    status: metricRoundStatus(valueRow.status),
    reason: value(valueRow.reason),
    started_at: value(valueRow.started_at),
    completed_at: value(valueRow.completed_at),
    duration_ms: integer(valueRow.duration_ms),
    total_rows: integer(valueRow.total_rows),
    recheck_rows: integer(valueRow.recheck_rows),
    page_count: integer(valueRow.page_count),
    proxy_country_count: integer(valueRow.proxy_country_count),
    config_json: value(valueRow.config_json),
    error: value(valueRow.error),
    created_at: value(valueRow.created_at),
  }
}

function metricRoundStatus(input: unknown): MetricRoundStatus {
  const status = value(input)
  return ['running', 'completed', 'failed', 'stopped'].includes(status)
    ? (status as MetricRoundStatus)
    : 'running'
}

function metricRoundId(row: MetricRow) {
  return integer(row.round_id)
}

function normalizeMetricDateRange(range: MetricDateRange) {
  return {
    sinceIso: isoOrNull(range.sinceIso),
    untilIso: isoOrNull(range.untilIso),
  }
}

function isoOrNull(input: unknown) {
  const raw = value(input).trim()
  if (!raw) return null
  const time = Date.parse(raw)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

function integer(input: unknown, fallback = 0) {
  const number = Math.round(Number(input))
  return Number.isFinite(number) ? number : fallback
}

function boundedInteger(input: unknown, min: number, max: number, fallback: number) {
  const number = integer(input, fallback)
  return Math.min(max, Math.max(min, number))
}

function nowIso() {
  return new Date().toISOString()
}

function durationMsBetween(startedAt: string, completedAt: string) {
  const start = Date.parse(startedAt)
  const end = Date.parse(completedAt)
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0
  return Math.round(end - start)
}

function value(input: unknown) {
  return input == null ? '' : String(input)
}
