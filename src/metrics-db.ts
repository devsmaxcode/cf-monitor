import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { SQL } from "bun";

export const DEFAULT_METRICS_DB = "storage/cloudflare-cache-metrics.sqlite";

// Keep enough history for the largest dashboard timeframe.
export const METRIC_RETENTION_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export const METRIC_FIELDS = [
  "round_id",
  "timestamp_utc",
  "round",
  "page",
  "url",
  "proxy",
  "proxy_country",
  "status_code",
  "cf_cache_status",
  "cf_ray",
  "cf_edge",
  "age_seconds",
  "response_ms",
  "content_length",
  "content_type",
  "cache_control",
  "server",
  "error",
] as const;

export type MetricRow = Record<string, string>;
export type MetricRoundStatus = "running" | "completed" | "failed" | "stopped";
export type MetricRoundRow = {
  id: number;
  status: MetricRoundStatus;
  reason: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  total_rows: number;
  recheck_rows: number;
  page_count: number;
  proxy_country_count: number;
  config_json: string;
  error: string;
  created_at: string;
};

type CreateMetricRoundInput = {
  reason?: string;
  startedAt?: string;
  pageCount?: number;
  proxyCountryCount?: number;
  configJson?: string;
};

type FinalizeMetricRoundInput = {
  status: MetricRoundStatus;
  completedAt?: string;
  totalRows?: number;
  recheckRows?: number;
  error?: string;
};

export type MetricDateRange = {
  sinceIso?: string;
  untilIso?: string;
};

export function normalizeMetricsOutput(output?: string) {
  const value = String(output || DEFAULT_METRICS_DB).trim() || DEFAULT_METRICS_DB;
  return value.replace(/\.csv$/i, ".sqlite");
}

export function resolveMetricsDbPath(output: string, baseDir = process.cwd()) {
  const normalized = normalizeMetricsOutput(output);
  return isAbsolute(normalized) ? normalized : join(baseDir, normalized);
}

export async function openMetricsDb(output: string, baseDir = process.cwd()) {
  const filename = resolveMetricsDbPath(output, baseDir);
  await mkdir(dirname(filename), { recursive: true });

  const sql = new SQL({
    adapter: "sqlite",
    filename,
    create: true,
    readwrite: true,
    strict: true,
  });

  await ensureMetricsSchema(sql);
  return sql;
}

export async function appendMetricRows(output: string, rows: MetricRow[], baseDir = process.cwd()) {
  if (!rows.length) return;

  const sql = await openMetricsDb(output, baseDir);
  try {
    await sql.begin(async (tx) => {
      for (const row of rows) {
        await tx`
          INSERT INTO cache_metrics (
            round_id, timestamp_utc, round, page, url, proxy, proxy_country, status_code,
            cf_cache_status, cf_ray, cf_edge, age_seconds, response_ms,
            content_length, content_type, cache_control, server, error
          )
          VALUES (
            ${metricRoundId(row)}, ${value(row.timestamp_utc)}, ${value(row.round)}, ${value(row.page)},
            ${value(row.url)}, ${value(row.proxy)}, ${value(row.proxy_country)},
            ${value(row.status_code)}, ${value(row.cf_cache_status)}, ${value(row.cf_ray)},
            ${value(row.cf_edge)}, ${value(row.age_seconds)}, ${value(row.response_ms)},
            ${value(row.content_length)}, ${value(row.content_type)}, ${value(row.cache_control)},
            ${value(row.server)}, ${value(row.error)}
          )
        `;
      }
    });
  } finally {
    await sql.close();
  }
}

export async function readMetricRows(output: string, baseDir = process.cwd(), dateRange: MetricDateRange = {}) {
  const sql = await openMetricsDb(output, baseDir);
  try {
    const range = normalizeMetricDateRange(dateRange);
    const rows = await sql`
      SELECT
        round_id, timestamp_utc, round, page, url, proxy, proxy_country, status_code,
        cf_cache_status, cf_ray, cf_edge, age_seconds, response_ms,
        content_length, content_type, cache_control, server, error
      FROM cache_metrics
      WHERE
        (${range.sinceIso} IS NULL OR (timestamp_utc <> '' AND datetime(timestamp_utc) >= datetime(${range.sinceIso})))
        AND (${range.untilIso} IS NULL OR (timestamp_utc <> '' AND datetime(timestamp_utc) <= datetime(${range.untilIso})))
      ORDER BY id ASC
    `;

    return rows.map((row) =>
      Object.fromEntries(METRIC_FIELDS.map((field) => [field, value((row as Record<string, unknown>)[field])])),
    );
  } finally {
    await sql.close();
  }
}

export async function createMetricRound(output: string, input: CreateMetricRoundInput = {}, baseDir = process.cwd()) {
  const sql = await openMetricsDb(output, baseDir);
  try {
    const [row] = await sql`
      INSERT INTO cache_rounds (
        status, reason, started_at, page_count, proxy_country_count, config_json
      )
      VALUES (
        ${"running"},
        ${value(input.reason)},
        ${value(input.startedAt || nowIso())},
        ${integer(input.pageCount)},
        ${integer(input.proxyCountryCount)},
        ${value(input.configJson)}
      )
      RETURNING
        id, status, reason, started_at, completed_at, duration_ms, total_rows,
        recheck_rows, page_count, proxy_country_count, config_json, error, created_at
    `;
    return metricRoundFromDb(row);
  } finally {
    await sql.close();
  }
}

export async function finalizeMetricRound(
  output: string,
  roundId: number,
  input: FinalizeMetricRoundInput,
  baseDir = process.cwd(),
) {
  if (!roundId) return null;

  const sql = await openMetricsDb(output, baseDir);
  try {
    let finalized: MetricRoundRow | null = null;

    await sql.begin(async (tx) => {
      const [existing] = await tx`
        SELECT started_at
        FROM cache_rounds
        WHERE id = ${roundId}
        LIMIT 1
      `;
      if (!existing) return;

      const completedAt = input.completedAt || nowIso();
      const counts = await metricRoundCounts(tx, roundId);
      const totalRows = input.totalRows ?? counts.totalRows;
      const recheckRows = input.recheckRows ?? counts.recheckRows;
      const durationMs = durationMsBetween(value((existing as Record<string, unknown>).started_at), completedAt);

      const [row] = await tx`
        UPDATE cache_rounds
        SET
          status = ${input.status},
          completed_at = ${completedAt},
          duration_ms = ${durationMs},
          total_rows = ${integer(totalRows)},
          recheck_rows = ${integer(recheckRows)},
          error = ${value(input.error)}
        WHERE id = ${roundId}
        RETURNING
          id, status, reason, started_at, completed_at, duration_ms, total_rows,
          recheck_rows, page_count, proxy_country_count, config_json, error, created_at
      `;
      finalized = metricRoundFromDb(row);
      await pruneOldMetricRounds(tx, METRIC_RETENTION_DAYS);
    });

    return finalized;
  } finally {
    await sql.close();
  }
}

export async function applyMetricRoundRetention(
  output: string,
  keepDays = METRIC_RETENTION_DAYS,
  baseDir = process.cwd(),
) {
  const sql = await openMetricsDb(output, baseDir);
  try {
    await sql.begin((tx) => pruneOldMetricRounds(tx, keepDays));
  } finally {
    await sql.close();
  }
}

export async function readMetricRounds(output: string, baseDir = process.cwd(), dateRange: MetricDateRange = {}) {
  const sql = await openMetricsDb(output, baseDir);
  try {
    const range = normalizeMetricDateRange(dateRange);
    const rows = await sql`
      SELECT
        id, status, reason, started_at, completed_at, duration_ms, total_rows,
        recheck_rows, page_count, proxy_country_count, config_json, error, created_at
      FROM cache_rounds
      WHERE
        (
          ${range.sinceIso} IS NULL
          OR status = ${"running"}
          OR datetime(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) >= datetime(${range.sinceIso})
        )
        AND (
          ${range.untilIso} IS NULL
          OR datetime(COALESCE(NULLIF(started_at, ''), NULLIF(created_at, ''), NULLIF(completed_at, ''))) <= datetime(${range.untilIso})
        )
      ORDER BY id DESC
    `;
    return rows.map(metricRoundFromDb);
  } finally {
    await sql.close();
  }
}

async function ensureMetricsSchema(sql: SQL) {
  await sql`PRAGMA journal_mode = WAL`;
  await sql`
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
  `;
  await sql`
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
  `;
  await addRoundIdColumnIfMissing(sql);
  await backfillLegacyRound(sql);
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_rounds_status ON cache_rounds (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_rounds_started_at ON cache_rounds (started_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_metrics_round_id ON cache_metrics (round_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_metrics_timestamp ON cache_metrics (timestamp_utc)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_metrics_page_country ON cache_metrics (page, proxy_country)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_metrics_status ON cache_metrics (cf_cache_status)`;
}

async function addRoundIdColumnIfMissing(sql: SQL) {
  const columns = await sql`PRAGMA table_info(cache_metrics)`;
  if (columns.some((column) => value((column as Record<string, unknown>).name) === "round_id")) return;
  await sql`ALTER TABLE cache_metrics ADD COLUMN round_id INTEGER NOT NULL DEFAULT 0`;
}

async function backfillLegacyRound(sql: SQL) {
  const [pending] = await sql`
    SELECT COUNT(*) AS count
    FROM cache_metrics
    WHERE round_id = 0
  `;
  if (!integer((pending as Record<string, unknown>)?.count)) return;

  const [existing] = await sql`
    SELECT id
    FROM cache_rounds
    WHERE reason = ${"legacy-import"}
    ORDER BY id ASC
    LIMIT 1
  `;

  let legacyRoundId = integer((existing as Record<string, unknown> | undefined)?.id);
  if (!legacyRoundId) {
    const [bounds] = await sql`
      SELECT
        MIN(timestamp_utc) AS started_at,
        MAX(timestamp_utc) AS completed_at,
        COUNT(*) AS total_rows,
        SUM(CASE WHEN round LIKE ${"%-recheck"} THEN 1 ELSE 0 END) AS recheck_rows
      FROM cache_metrics
      WHERE round_id = 0
    `;
    const legacy = bounds as Record<string, unknown>;
    const startedAt = value(legacy.started_at) || nowIso();
    const completedAt = value(legacy.completed_at) || startedAt;
    const [created] = await sql`
      INSERT INTO cache_rounds (
        status, reason, started_at, completed_at, duration_ms, total_rows, recheck_rows
      )
      VALUES (
        ${"completed"},
        ${"legacy-import"},
        ${startedAt},
        ${completedAt},
        ${durationMsBetween(startedAt, completedAt)},
        ${integer(legacy.total_rows)},
        ${integer(legacy.recheck_rows)}
      )
      RETURNING id
    `;
    legacyRoundId = integer((created as Record<string, unknown>).id);
  }

  await sql`
    UPDATE cache_metrics
    SET round_id = ${legacyRoundId}
    WHERE round_id = 0
  `;
}

async function metricRoundCounts(sql: SQL, roundId: number) {
  const [row] = await sql`
    SELECT
      COUNT(*) AS total_rows,
      SUM(CASE WHEN round LIKE ${"%-recheck"} THEN 1 ELSE 0 END) AS recheck_rows
    FROM cache_metrics
    WHERE round_id = ${roundId}
  `;
  const counts = row as Record<string, unknown>;
  return {
    totalRows: integer(counts.total_rows),
    recheckRows: integer(counts.recheck_rows),
  };
}

async function pruneOldMetricRounds(sql: SQL, keepDays: number) {
  const keep = integer(keepDays, METRIC_RETENTION_DAYS);
  if (keep <= 0) return;

  const cutoffIso = new Date(Date.now() - keep * DAY_MS).toISOString();

  await sql`
    DELETE FROM cache_metrics
    WHERE round_id IN (
      SELECT id
      FROM cache_rounds
      WHERE status <> ${"running"}
        AND datetime(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) < datetime(${cutoffIso})
    )
  `;
  await sql`
    DELETE FROM cache_metrics
    WHERE timestamp_utc <> ''
      AND datetime(timestamp_utc) < datetime(${cutoffIso})
  `;
  await sql`
    DELETE FROM cache_rounds
    WHERE status <> ${"running"}
      AND datetime(COALESCE(NULLIF(completed_at, ''), NULLIF(started_at, ''), NULLIF(created_at, ''))) < datetime(${cutoffIso})
  `;
}

function metricRoundFromDb(row: unknown): MetricRoundRow {
  const valueRow = row as Record<string, unknown>;
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
  };
}

function metricRoundStatus(input: unknown): MetricRoundStatus {
  const status = value(input);
  return ["running", "completed", "failed", "stopped"].includes(status)
    ? (status as MetricRoundStatus)
    : "running";
}

function metricRoundId(row: MetricRow) {
  return integer(row.round_id);
}

function normalizeMetricDateRange(range: MetricDateRange) {
  return {
    sinceIso: isoOrNull(range.sinceIso),
    untilIso: isoOrNull(range.untilIso),
  };
}

function isoOrNull(input: unknown) {
  const raw = value(input).trim();
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function integer(input: unknown, fallback = 0) {
  const number = Math.round(Number(input));
  return Number.isFinite(number) ? number : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function durationMsBetween(startedAt: string, completedAt: string) {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round(end - start);
}

function value(input: unknown) {
  return input == null ? "" : String(input);
}
