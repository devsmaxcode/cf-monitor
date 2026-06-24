import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Cron } from "croner";
import index from "../public/index.html";
import {
  DEFAULT_METRICS_DB,
  normalizeMetricsOutput,
  readMetricRows,
  type MetricRow,
} from "./metrics-db";

type Config = {
  pages: string[];
  output: string;
  proxyCountries: string;
  maxProxiesPerCountry: number;
  timeout: number;
  delay: number;
  hitIntervalSeconds: number;
  missIntervalSeconds: number;
  noDirect: boolean;
  noProxySource: boolean;
  noClarketmSource: boolean;
  shuffleProxies: boolean;
  userAgent: string;
};

type MetricTimeColumn = {
  key: string;
  label: string;
  meta: string;
  sort: number;
};

type MonitorState = {
  running: boolean;
  busy: boolean;
  round: number;
  startedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastExitCode: number | null;
  lastReason: string | null;
  lastError: string | null;
  logs: string[];
};

const root = join(import.meta.dir, "..");
const storageDir = join(root, "storage");
const configPath = join(storageDir, "dashboard-config.json");
const pagesPath = join(storageDir, "pages.txt");
const proxiesPath = join(storageDir, "proxies.txt");
const legacyDefaultBaseUrl = "https://ummah.one";

const defaultPages = [
  "https://ummah.one/",
  "https://ummah.one/quran",
  "https://ummah.one/quran/al-fatihah",
  "https://ummah.one/quran/al-baqarah",
  "https://ummah.one/quran/juz/1",
  "https://ummah.one/quran/page/1",
  "https://ummah.one/hadith/books",
  "https://ummah.one/dua",
  "https://ummah.one/dua/categories",
  "https://ummah.one/dua/all-duas",
  "https://ummah.one/99-names-of-allah",
  "https://ummah.one/zakat-calculator",
  "https://ummah.one/tahakiks",
];

const defaultConfig: Config = {
  pages: defaultPages,
  output: DEFAULT_METRICS_DB,
  proxyCountries: "Bangladesh,India,United States,United Kingdom,Canada,Germany,France,Singapore,Japan,Australia",
  maxProxiesPerCountry: 8,
  timeout: 5,
  delay: 0,
  hitIntervalSeconds: 900,
  missIntervalSeconds: 120,
  noDirect: false,
  noProxySource: false,
  noClarketmSource: false,
  shuffleProxies: true,
  userAgent: "UmmahOneCacheMonitor/1.0 (+https://ummah.one)",
};

const state: MonitorState = {
  running: false,
  busy: false,
  round: 0,
  startedAt: null,
  lastRunAt: null,
  nextRunAt: null,
  lastExitCode: null,
  lastReason: null,
  lastError: null,
  logs: [],
};

let scheduledJob: Cron | null = null;
let activeMonitorProcess: ReturnType<typeof Bun.spawn> | null = null;
let stopRequested = false;
let broadcastTimer: Timer | null = null;
let broadcastInFlight = false;
let broadcastAgain = false;
const sockets = new Set<{ send(data: string): void }>();

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function fail(error: unknown, status = 500) {
  return json({ error: errorMessage(error) }, status);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readConfig(): Promise<Config> {
  if (!(await exists(configPath))) {
    await saveConfig(defaultConfig);
    return defaultConfig;
  }

  const stored = JSON.parse(await readFile(configPath, "utf8"));
  return sanitizeConfig({ ...defaultConfig, ...stored });
}

function sanitizeConfig(value: Partial<Config> & { baseUrl?: string }): Config {
  const { baseUrl, ...configValue } = value;
  const legacyBaseUrl = String(baseUrl || legacyDefaultBaseUrl).trim();
  return {
    ...defaultConfig,
    ...configValue,
    pages: Array.isArray(value.pages)
      ? value.pages.map((page) => normalizeTargetUrl(String(page).trim(), legacyBaseUrl)).filter(Boolean)
      : defaultPages,
    maxProxiesPerCountry: clamp(Number(value.maxProxiesPerCountry), 1, 100, 8),
    timeout: clamp(Number(value.timeout), 1, 60, 5),
    delay: clamp(Number(value.delay), 0, 60, 0),
    hitIntervalSeconds: clamp(Number(value.hitIntervalSeconds), 15, 86400, 900),
    missIntervalSeconds: clamp(Number(value.missIntervalSeconds), 15, 86400, 120),
    output: normalizeMetricsOutput(String(value.output || defaultConfig.output).trim()),
    proxyCountries: String(value.proxyCountries || defaultConfig.proxyCountries).trim(),
    userAgent: String(value.userAgent || defaultConfig.userAgent).trim(),
    noDirect: Boolean(value.noDirect),
    noProxySource: Boolean(value.noProxySource),
    noClarketmSource: Boolean(value.noClarketmSource),
    shuffleProxies: Boolean(value.shuffleProxies),
  };
}

function normalizeTargetUrl(value: string, legacyBaseUrl = legacyDefaultBaseUrl) {
  if (!value) return "";
  try {
    return new URL(value).toString();
  } catch {
    try {
      return new URL(value.replace(/^\/+/, ""), legacyBaseUrl.replace(/\/?$/, "/")).toString();
    } catch {
      return value;
    }
  }
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

async function saveConfig(config: Config) {
  await mkdir(storageDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(sanitizeConfig(config), null, 2)}\n`, "utf8");
}

async function ensureRunFiles(config: Config) {
  await mkdir(storageDir, { recursive: true });
  await writeFile(pagesPath, `${config.pages.join("\n")}\n`, "utf8");
  if (!(await exists(proxiesPath))) await writeFile(proxiesPath, "", "utf8");
  await mkdir(dirname(join(root, config.output)), { recursive: true });
}

async function readProxyText() {
  if (!(await exists(proxiesPath))) return "";
  return readFile(proxiesPath, "utf8");
}

function pushLog(line: string) {
  state.logs.push(line);
  state.logs = state.logs.slice(-160);
  queueRuntimeBroadcast();
}

function snapshotState(): MonitorState {
  return { ...state, logs: [...state.logs] };
}

async function buildRuntimePayload() {
  const config = await readConfig();
  return {
    type: "runtime",
    metrics: await buildMetrics(config),
    status: snapshotState(),
  };
}

function queueRuntimeBroadcast() {
  if (!sockets.size) return;
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastRuntime().catch((error) => console.error("websocket broadcast failed", error));
  }, 100);
}

async function broadcastRuntime() {
  if (broadcastInFlight) {
    broadcastAgain = true;
    return;
  }

  broadcastInFlight = true;
  try {
    const message = JSON.stringify(await buildRuntimePayload());
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        sockets.delete(socket);
      }
    }
  } finally {
    broadcastInFlight = false;
    if (broadcastAgain) {
      broadcastAgain = false;
      queueRuntimeBroadcast();
    }
  }
}

async function sendRuntime(socket: { send(data: string): void }) {
  socket.send(JSON.stringify(await buildRuntimePayload()));
}

async function pipeProcessOutput(stream: ReadableStream<Uint8Array> | null, label = "") {
  if (!stream) return;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) pushLog(label ? `${label}${line}` : line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) pushLog(label ? `${label}${buffer}` : buffer);
  } finally {
    reader.releaseLock();
  }
}

async function runMonitorRound(reason: string) {
  if (state.busy) return { skipped: true, reason: "monitor is already running" };

  state.busy = true;
  state.round += 1;
  state.lastReason = reason;
  state.lastError = null;
  state.nextRunAt = null;
  queueRuntimeBroadcast();

  let config: Config | null = null;
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  stopRequested = false;

  try {
    config = await readConfig();
    await ensureRunFiles(config);

    if (stopRequested) {
      pushLog(`[${new Date().toLocaleString()}] round ${state.round} stopped before collector start`);
      return { skipped: false };
    }

    const args = monitorArgs(config);
    const started = new Date();
    state.lastRunAt = started.toISOString();
    pushLog(`[${started.toLocaleString()}] round ${state.round} started (${reason})`);
    pushLog(`collector args: ${args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`);

    proc = Bun.spawn([process.execPath, ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    activeMonitorProcess = proc;

    const [exitCode] = await Promise.all([
      proc.exited,
      pipeProcessOutput(proc.stdout),
      pipeProcessOutput(proc.stderr, "stderr: "),
    ]);

    state.lastExitCode = exitCode;

    if (exitCode !== 0) {
      if (stopRequested) {
        pushLog(`[${new Date().toLocaleString()}] round ${state.round} stopped`);
      } else {
        state.lastError = `collector exited with code ${exitCode}`;
        pushLog(state.lastError);
      }
    } else {
      pushLog(`[${new Date().toLocaleString()}] round ${state.round} finished`);
    }
  } catch (error) {
    state.lastExitCode = 1;
    state.lastError = errorMessage(error);
    pushLog(state.lastError);
  } finally {
    if (activeMonitorProcess === proc) activeMonitorProcess = null;
    stopRequested = false;
    state.busy = false;
    queueRuntimeBroadcast();
  }

  if (state.running && config) void scheduleNext(config);
  return { skipped: false };
}

function monitorArgs(config: Config) {
  const args = [
    join(root, "scripts", "cloudflare_cache_monitor_bun.ts"),
    "--pages",
    pagesPath,
    "--proxies",
    proxiesPath,
    "--output",
    config.output,
    "--rounds",
    "1",
    "--miss-recheck-delay",
    String(config.missIntervalSeconds),
    "--timeout",
    String(config.timeout),
    "--delay",
    String(config.delay),
    "--proxy-countries",
    config.proxyCountries,
    "--max-proxies-per-country",
    String(config.maxProxiesPerCountry),
    "--user-agent",
    config.userAgent,
  ];

  if (config.noDirect) args.push("--no-direct");
  if (config.noProxySource) args.push("--no-proxy-source");
  if (config.noClarketmSource) args.push("--no-clarketm-source");
  if (config.shuffleProxies) args.push("--shuffle-proxies");
  return args;
}

async function startMonitor() {
  if (state.running) return;
  state.running = true;
  state.startedAt = new Date().toISOString();
  void runMonitorRound("start");
}

function stopMonitor() {
  state.running = false;
  state.nextRunAt = null;
  clearScheduledJob();
  stopActiveMonitor();
  pushLog(`[${new Date().toLocaleString()}] monitor stopped`);
  queueRuntimeBroadcast();
}

function stopActiveMonitor() {
  stopRequested = true;
  if (!activeMonitorProcess) return;
  try {
    activeMonitorProcess.kill();
  } catch (error) {
    pushLog(`failed to stop collector: ${errorMessage(error)}`);
  }
}

function clearScheduledJob() {
  if (!scheduledJob) return;
  scheduledJob.stop();
  scheduledJob = null;
}

async function scheduleNext(config: Config) {
  if (!state.running) return;
  clearScheduledJob();

  let delay = config.hitIntervalSeconds;
  try {
    const summary = (await buildMetrics(config)).summary;
    delay =
      summary.latestMissLike > 0 || summary.latestErrors > 0 ? config.missIntervalSeconds : config.hitIntervalSeconds;
  } catch (error) {
    pushLog(`schedule metrics read failed: ${errorMessage(error)}`);
  }

  const next = new Date(Date.now() + delay * 1000);
  state.nextRunAt = next.toISOString();
  pushLog(`[${new Date().toLocaleString()}] next run in ${delay}s`);

  scheduledJob = new Cron(next, { name: "cloudflare-cache-monitor-next-run", maxRuns: 1, protect: true }, () => {
    scheduledJob = null;
    void runMonitorRound("schedule");
  });
}

async function buildMetrics(config: Config) {
  const rows = await readMetricRows(config.output, root);
  const timeColumns = metricTimeColumns(rows);
  const latest = new Map<string, MetricRow>();

  for (const row of rows) {
    const normalizedRow: MetricRow = { ...row, proxy_country: normalizeCountry(row.proxy_country || "unknown") };
    const key = `${normalizedRow.page}|${normalizedRow.proxy_country}`;
    const existing = latest.get(key);
    if (!existing || Date.parse(normalizedRow.timestamp_utc) >= Date.parse(existing.timestamp_utc)) {
      latest.set(key, normalizedRow);
    }
  }

  const latestRows = [...latest.values()].sort((a, b) =>
    `${a.page}|${a.proxy_country}`.localeCompare(`${b.page}|${b.proxy_country}`),
  );
  const configuredCountries = config.proxyCountries
    .split(",")
    .map((country) => normalizeCountry(country))
    .filter(Boolean);
  const countries = [
    ...new Set([
      ...(!config.noDirect ? ["direct"] : []),
      ...configuredCountries,
      ...latestRows.map((row) => row.proxy_country || "unknown"),
    ]),
  ].sort((a, b) => (a === "direct" ? -1 : b === "direct" ? 1 : a.localeCompare(b)));
  const pages = [...new Set([...config.pages, ...latestRows.map((row) => row.page)].filter(Boolean))];
  const pageStats = pages.map((page) => {
    const pageRows = latestRows.filter((row) => row.page === page);
    const hitCount = pageRows.filter((row) => row.cf_cache_status === "HIT").length;
    const missLike = pageRows.filter((row) => isMissLike(row)).length;
    const errors = pageRows.filter((row) => row.error).length;
    const maxAge = Math.max(0, ...pageRows.map((row) => Number(row.age_seconds) || 0));
    const avgMs = average(pageRows.map((row) => Number(row.response_ms)).filter(Number.isFinite));
    return { page, hitCount, missLike, errors, maxAge, avgMs, total: pageRows.length };
  });
  const matrix = pages.map((page) => ({
    page,
    cells: countries.map((country) => latest.get(`${page}|${country}`) || null),
  }));

  const summary = {
    totalRows: rows.length,
    latestCells: latestRows.length,
    latestHits: latestRows.filter((row) => row.cf_cache_status === "HIT").length,
    latestMissLike: latestRows.filter(isMissLike).length,
    latestErrors: latestRows.filter((row) => row.error).length,
    maxAge: Math.max(0, ...latestRows.map((row) => Number(row.age_seconds) || 0)),
    avgResponseMs: average(latestRows.map((row) => Number(row.response_ms)).filter(Number.isFinite)),
    lastTimestamp: rows.at(-1)?.timestamp_utc || null,
  };

  return { rows, latestRows, countries, pages, pageStats, matrix, timeColumns, summary };
}

function metricTimeColumns(rows: MetricRow[]) {
  const columns = new Map<string, MetricTimeColumn>();
  for (const row of rows) {
    const column = metricTimeColumn(row.timestamp_utc || "");
    if (!columns.has(column.key)) columns.set(column.key, column);
  }
  return [...columns.values()].sort((a, b) => a.sort - b.sort);
}

function metricTimeColumn(value: string): MetricTimeColumn {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { key: "unknown", label: "-", meta: "No time", sort: Number.MAX_SAFE_INTEGER };
  }

  const key = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join("-");

  return {
    key,
    label: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    meta: date.toLocaleDateString([], { month: "short", day: "numeric" }),
    sort:
      date.getFullYear() * 100000000 +
      (date.getMonth() + 1) * 1000000 +
      date.getDate() * 10000 +
      date.getHours() * 100 +
      date.getMinutes(),
  };
}

function isMissLike(row: MetricRow) {
  const status = (row.cf_cache_status || "").toUpperCase();
  return ["MISS", "BYPASS", "DYNAMIC", "EXPIRED", "REVALIDATED", "STALE", "UPDATING"].includes(status);
}

function normalizeCountry(country: string) {
  const value = country.trim();
  const names: Record<string, string> = {
    AUSTRALIA: "AU",
    BANGLADESH: "BD",
    CANADA: "CA",
    FRANCE: "FR",
    GERMANY: "DE",
    INDIA: "IN",
    JAPAN: "JP",
    SINGAPORE: "SG",
    "UNITED KINGDOM": "GB",
    "UNITED STATES": "US",
  };
  const upper = value.toUpperCase();
  if (upper === "DIRECT") return "direct";
  return names[upper] || upper;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

const server = Bun.serve({
  port: Number(process.env.PORT || 3000),
  routes: {
    "/": index,
    "/api/config": {
      async GET() {
        return json(await readConfig());
      },
      async PUT(req) {
        try {
          const config = sanitizeConfig(await req.json());
          await saveConfig(config);
          queueRuntimeBroadcast();
          return json(config);
        } catch (error) {
          return fail(error, 400);
        }
      },
    },
    "/api/metrics": {
      async GET() {
        const config = await readConfig();
        return json(await buildMetrics(config));
      },
    },
    "/api/proxies": {
      async GET() {
        const text = await readProxyText();
        const proxies = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        return json({ text, count: proxies.length, proxies });
      },
      async PUT(req) {
        const body = await req.json();
        await mkdir(storageDir, { recursive: true });
        await writeFile(proxiesPath, String(body.text || ""), "utf8");
        queueRuntimeBroadcast();
        return json({ ok: true });
      },
    },
    "/api/status": {
      GET() {
        return json(state);
      },
    },
    "/api/monitor/start": {
      async POST() {
        await startMonitor();
        return json(state);
      },
    },
    "/api/monitor/stop": {
      POST() {
        stopMonitor();
        return json(state);
      },
    },
    "/api/monitor/run-once": {
      async POST() {
        void runMonitorRound("manual");
        return json(state);
      },
    },
  },
  development: {
    hmr: true,
    console: true,
  },
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(socket) {
      sockets.add(socket);
      sendRuntime(socket).catch((error) => {
        sockets.delete(socket);
        console.error("websocket initial send failed", error);
      });
    },
    close(socket) {
      sockets.delete(socket);
    },
    message() {},
  },
});

console.log(`Cloudflare cache dashboard running at ${server.url}`);
