import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { SQL } from "bun";

export const DEFAULT_METRICS_DB = "storage/cloudflare-cache-metrics.sqlite";

export const METRIC_FIELDS = [
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
            timestamp_utc, round, page, url, proxy, proxy_country, status_code,
            cf_cache_status, cf_ray, cf_edge, age_seconds, response_ms,
            content_length, content_type, cache_control, server, error
          )
          VALUES (
            ${value(row.timestamp_utc)}, ${value(row.round)}, ${value(row.page)},
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

export async function readMetricRows(output: string, baseDir = process.cwd()) {
  const sql = await openMetricsDb(output, baseDir);
  try {
    const rows = await sql`
      SELECT
        timestamp_utc, round, page, url, proxy, proxy_country, status_code,
        cf_cache_status, cf_ray, cf_edge, age_seconds, response_ms,
        content_length, content_type, cache_control, server, error
      FROM cache_metrics
      ORDER BY id ASC
    `;

    return rows.map((row) =>
      Object.fromEntries(METRIC_FIELDS.map((field) => [field, value((row as Record<string, unknown>)[field])])),
    );
  } finally {
    await sql.close();
  }
}

async function ensureMetricsSchema(sql: SQL) {
  await sql`PRAGMA journal_mode = WAL`;
  await sql`
    CREATE TABLE IF NOT EXISTS cache_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_metrics_timestamp ON cache_metrics (timestamp_utc)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_metrics_page_country ON cache_metrics (page, proxy_country)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_cache_metrics_status ON cache_metrics (cf_cache_status)`;
}

function value(input: unknown) {
  return input == null ? "" : String(input);
}
