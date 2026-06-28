import { checkbox, emptyTableRow, escapeAttr, escapeHtml, filterOptions, icon } from "./components";

type Config = {
  pages: string[];
  output: string;
  proxyCountries: string;
  maxProxiesPerCountry: number;
  timeout: number;
  delay: number;
  roundIntervalSeconds: number;
  hitIntervalSeconds: number;
  missIntervalSeconds: number;
  noDirect: boolean;
  noProxySource: boolean;
  noClarketmSource: boolean;
  shuffleProxies: boolean;
  userAgent: string;
};

type MetricRow = Record<string, string>;

type UsedProxyRow = {
  country: string;
  error: string;
  page: string;
  proxy: string;
  responseMs: string;
  source: string;
  status: string;
  timestamp: string;
};

type MetricTimeColumn = {
  key: string;
  label: string;
  meta: string;
  sort: number;
};

const metricRangeDayOptions = [1, 7, 10] as const;
type MetricRangeDays = (typeof metricRangeDayOptions)[number];

type MetricRound = {
  id: number;
  status: "running" | "completed" | "failed" | "stopped";
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

type MetricTimeGroup = {
  key: string;
  page: string;
  url: string;
  country: string;
  countryLabel: string;
  cells: Map<string, MetricRow>;
};

type MetricRowsIndex = {
  countries: string[];
  pages: string[];
  rows: {
    row: MetricRow;
    searchText: string;
    status: string;
  }[];
  statuses: string[];
};

type CacheAgeBucket = {
  key: string;
  label: string;
  meta: string;
  sort: number;
  total: number;
  useful: number;
  hits: number;
  missLike: number;
  noHeader: number;
  errors: number;
  ageValues: number[];
  avgAge: number;
  maxAge: number;
  hitRate: number;
};

type TopHitUrl = {
  url: string;
  hits: number;
  useful: number;
  total: number;
  hitRate: number;
  maxAge: number;
  avgAge: number;
  latestTimestamp: string;
};

type MetricsPayload = {
  range?: {
    days: MetricRangeDays;
    sinceIso: string;
    availableFrom: string | null;
    availableTo: string | null;
  };
  rounds: MetricRound[];
  latestRows: MetricRow[];
  pageStats: {
    page: string;
    hitCount: number;
    missLike: number;
    errors: number;
    maxAge: number;
    avgMs: number;
    total: number;
  }[];
  summary: {
    totalRounds: number;
    totalRows: number;
    latestCells: number;
    latestHits: number;
    latestMissLike: number;
    latestErrors: number;
    maxAge: number;
    avgResponseMs: number;
    lastTimestamp: string | null;
  };
  timeColumns: MetricTimeColumn[];
  rows: MetricRow[];
};

const MATRIX_URL_COL_WIDTH = 260;
const MATRIX_COUNTRY_COL_WIDTH = 150;
const MATRIX_TIME_COL_WIDTH = 122;

type Status = {
  running: boolean;
  busy: boolean;
  round: number;
  crawl: CrawlProgress | null;
  startedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastExitCode: number | null;
  lastReason: string | null;
  lastError: string | null;
  logs: string[];
};

type CrawlProgress = {
  round: number;
  totalUrls: number;
  requestedUrls: number;
  activeUrl: string | null;
};

type RuntimeMessage = {
  type: "runtime";
  metrics: MetricsPayload;
  status: Status;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const METRIC_RANGE_STORAGE_KEY = "cf-monitor-range-days";
const ROUND_TIMEFRAME_STORAGE_KEY = "cf-monitor.roundTimeframeDays";
const DAY_MS = 24 * 60 * 60 * 1000;

const app = document.querySelector<HTMLDivElement>("#app")!;

let config: Config;
let metrics: MetricsPayload;
let statusState: Status;
let proxyText = "";
let activeTab: "metrics" | "rounds" | "config" | "proxies" | "logs" | "age" = "metrics";
let selectedRoundId: number | null = null;
let selectedMetricRangeDays: MetricRangeDays = storedMetricRangeDays();
let formDirty = false;
let metricFilters = {
  query: "",
  country: "",
  page: "",
  status: "",
};
let metricPagination = {
  page: 1,
  pageSize: 25,
};
let liveSocket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let fallbackRefreshTimer: number | null = null;
let nextRunTimer: number | null = null;
let metricFilterTimer: number | null = null;
let metricRuntimeRefreshTimer: number | null = null;
let metricColumnCache = new WeakMap<MetricRow, MetricTimeColumn>();
let metricRowsCache: { source: MetricRow[]; index: MetricRowsIndex } | null = null;
let metricPayloadSignatureValue = "";
let pendingMetricRuntimeRefresh = false;
let dueRefreshForNextRun: string | null = null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function loadAll() {
  const [nextConfig, nextMetrics, nextStatus, proxies] = await Promise.all([
    api<Config>("/api/config"),
    api<MetricsPayload>(metricsApiPath()),
    api<Status>("/api/status"),
    api<{ text: string }>("/api/proxies"),
  ]);
  config = nextConfig;
  metrics = nextMetrics;
  statusState = nextStatus;
  proxyText = proxies.text;
  metricPayloadSignatureValue = metricPayloadSignature(metrics);
  render();
}

async function refreshRuntime() {
  const [nextMetrics, nextStatus] = await Promise.all([api<MetricsPayload>(metricsApiPath()), api<Status>("/api/status")]);
  applyRuntime(nextMetrics, nextStatus);
}

function metricsApiPath() {
  return `/api/metrics?days=${selectedMetricRangeDays}`;
}

function connectLiveUpdates() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  liveSocket = socket;

  socket.addEventListener("open", () => {
    stopFallbackRefresh();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as RuntimeMessage;
    if (message.type !== "runtime") return;
    if (message.metrics.range && message.metrics.range.days !== selectedMetricRangeDays) {
      applyStatusOnly(message.status);
      refreshRuntime().catch(console.error);
      return;
    }
    applyRuntime(message.metrics, message.status);
  });

  socket.addEventListener("error", () => {
    socket.close();
  });

  socket.addEventListener("close", () => {
    if (liveSocket !== socket) return;
    liveSocket = null;
    startFallbackRefresh();
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectLiveUpdates();
  }, 1500);
}

function startFallbackRefresh() {
  if (fallbackRefreshTimer !== null) return;
  fallbackRefreshTimer = window.setInterval(() => {
    const activeForm = activeTab === "config" || activeTab === "proxies";
    if (activeForm && formDirty) return;
    refreshRuntime().catch(console.error);
  }, 15000);
}

function stopFallbackRefresh() {
  if (fallbackRefreshTimer === null) return;
  clearInterval(fallbackRefreshTimer);
  fallbackRefreshTimer = null;
}

function applyRuntime(nextMetrics: MetricsPayload, nextStatus: Status) {
  const nextSignature = metricPayloadSignature(nextMetrics);
  const metricsChanged = nextSignature !== metricPayloadSignatureValue;
  metrics = nextMetrics;
  statusState = nextStatus;
  if (metricsChanged) {
    metricPayloadSignatureValue = nextSignature;
    metricColumnCache = new WeakMap<MetricRow, MetricTimeColumn>();
    metricRowsCache = null;
  }
  updateRuntimeView(metricsChanged);
  syncNextRunTicker();
}

function applyStatusOnly(nextStatus: Status) {
  statusState = nextStatus;
  updateRuntimeView(false);
  syncNextRunTicker();
}

function storedMetricRangeDays(): MetricRangeDays {
  try {
    const storedValue = localStorage.getItem(ROUND_TIMEFRAME_STORAGE_KEY) ?? localStorage.getItem(METRIC_RANGE_STORAGE_KEY);
    const value = Number(storedValue);
    return isMetricRangeDays(value) ? value : 10;
  } catch {
    return 10;
  }
}

function setMetricRangeDays(days: MetricRangeDays) {
  if (selectedMetricRangeDays === days) return;
  selectedMetricRangeDays = days;
  selectedRoundId = null;
  metricColumnCache = new WeakMap<MetricRow, MetricTimeColumn>();
  metricRowsCache = null;
  try {
    localStorage.setItem(METRIC_RANGE_STORAGE_KEY, String(days));
    localStorage.setItem(ROUND_TIMEFRAME_STORAGE_KEY, String(days));
  } catch {
    // Storage can be unavailable in private or locked-down browser contexts.
  }
  if (activeTab === "rounds") {
    setHtml("[data-rounds-view]", renderRoundsContent());
    wireRoundEvents();
  }
  refreshRuntime().catch(console.error);
}

function isMetricRangeDays(value: number): value is MetricRangeDays {
  return metricRangeDayOptions.includes(value as MetricRangeDays);
}

function setText(selector: string, value: string) {
  const el = app.querySelector<HTMLElement>(selector);
  if (el) el.textContent = value;
}

function setHtml(selector: string, value: string) {
  const el = app.querySelector<HTMLElement>(selector);
  if (el) el.innerHTML = value;
}

function render() {
  app.innerHTML = `
    <header class="appbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">${icon("cloud")}</span>
        <span>Cloudflare Cache Monitor</span>
      </div>
      <div class="appbar-controls">
        <span class="state-chip ${statusState.busy || statusState.running ? "on" : ""}" data-status-chip>
          <span class="state-dot" data-status-dot aria-hidden="true"></span>
          <span data-status-label>${escapeHtml(runtimeStatusLabel())}</span>
        </span>
        <div data-crawl-progress>${renderCrawlProgress()}</div>
        <div data-next-run-countdown>${renderNextRunCountdown()}</div>
        <div class="actions" data-actions>${renderActionButtons()}</div>
      </div>
    </header>

    <nav class="tabs">
      <button class="${activeTab === "metrics" ? "active" : ""}" data-tab="metrics">Metrics</button>
      <button class="${activeTab === "rounds" ? "active" : ""}" data-tab="rounds">Rounds</button>
      <button class="${activeTab === "age" ? "active" : ""}" data-tab="age">Age</button>
      <button class="${activeTab === "config" ? "active" : ""}" data-tab="config">Configuration</button>
      <button class="${activeTab === "proxies" ? "active" : ""}" data-tab="proxies">Proxies</button>
      <button class="${activeTab === "logs" ? "active" : ""}" data-tab="logs">Logs</button>
    </nav>

    ${activeTab === "metrics" ? renderMetrics() : ""}
    ${activeTab === "rounds" ? renderRounds() : ""}
    ${activeTab === "age" ? renderAge() : ""}
    ${activeTab === "config" ? renderConfig() : ""}
    ${activeTab === "proxies" ? renderProxies() : ""}
    ${activeTab === "logs" ? renderLogs() : ""}
  `;

  wireEvents();
  syncNextRunTicker();
}

function renderMetrics() {
  const index = metricRowsIndex();
  const rows = filteredMetricRows();
  const timeColumns = metricTimeColumns(rows);
  const groups = metricTimeGroups(rows, timeColumns);
  const pagination = paginationInfo(groups.length);
  const pageGroups = groups.slice(pagination.start, pagination.end);

  return `
    <section class="samples-panel" data-metrics-view>
      <div class="table-filters">
        <label>
          Search
          <input data-filter="query" value="${escapeAttr(metricFilters.query)}" placeholder="URL, edge, proxy, error..." />
        </label>
        ${renderMetricRangeControl()}
        <label>
          Page
          <select data-filter="page">
            <option value="">All pages</option>
            ${filterOptions(index.pages, metricFilters.page)}
          </select>
        </label>
        <label>
          Country
          <select data-filter="country">
            <option value="">All countries</option>
            ${filterOptions(index.countries, metricFilters.country, countryName)}
          </select>
        </label>
        <label>
          Status
          <select data-filter="status">
            <option value="">All statuses</option>
            ${filterOptions(index.statuses, metricFilters.status)}
          </select>
        </label>
      </div>
      <div>
        <table class="sample-table metric-matrix" data-metric-table style="${metricMatrixStyle(timeColumns)}">
          ${renderMetricColgroup(timeColumns)}
          <thead data-filter-head>
            ${renderMetricTimeHeader(timeColumns)}
          </thead>
          <tbody data-filter-body>
            ${groups.length ? pageGroups.map((group) => renderMetricMatrixRow(group, timeColumns)).join("") : renderEmptyListRow(timeColumns)}
          </tbody>
        </table>
      </div>
      <div class="table-pagination" data-pagination>
        ${renderPaginationControls(pagination)}
      </div>
    </section>
  `;
}

function renderAge() {
  return `
    <section class="side-panel cache-age-panel">
      <div class="section-head">
        <h2><span class="section-icon" aria-hidden="true">${icon("clock")}</span>Cache Age</h2>
        <span data-age-timestamp>${escapeHtml(ageRangeLabel())}</span>
      </div>
      <div class="cache-age-dashboard" data-age-dashboard>
        ${renderAgeDashboard()}
      </div>
    </section>
  `;
}

function renderRounds() {
  return `<section class="rounds-panel" data-rounds-view>${renderRoundsContent()}</section>`;
}

function renderRoundsContent() {
  const rounds = roundsInSelectedRange();
  const stats = roundStats(rounds);
  const selected = selectedRound(rounds);

  return `
    <div class="rounds-hero">
      <div>
        <span class="section-icon" aria-hidden="true">${icon("grid")}</span>
        <div>
          <h2>Round Stats</h2>
          <p>${escapeHtml(roundsSubtitle(stats))}</p>
        </div>
      </div>
      <div class="rounds-hero-actions">
        <div class="rounds-live ${statusState.busy ? "active" : statusState.running ? "armed" : ""}">
          <span aria-hidden="true"></span>
          <strong>${escapeHtml(roundsLiveLabel())}</strong>
        </div>
      </div>
    </div>

    <div class="rounds-body">
      <div class="rounds-list-wrap">
        <div class="rounds-list-head">
          <h3>All Rounds</h3>
          <span>${roundsListMeta(rounds.length)}</span>
        </div>
        <div class="rounds-list" data-round-list>
          ${rounds.length ? rounds.map((round) => renderRoundItem(round, selected?.id || null)).join("") : renderRoundsEmptyState()}
        </div>
      </div>

      <div class="rounds-insight">
        <div class="rounds-insight-head">
          <span class="section-icon" aria-hidden="true">${icon("gauge")}</span>
          <div>
            <h3>Round Details</h3>
            <p>${selected ? escapeHtml(`Round ${selected.id} - ${roundStatusLabel(selected.status)}`) : "Select a round to inspect the full result."}</p>
          </div>
        </div>
        ${selected ? renderRoundDetails(selected, stats) : '<div class="empty-state">Run the monitor once to populate round stats.</div>'}
      </div>
    </div>
  `;
}

function renderRoundDetails(round: MetricRound, stats: ReturnType<typeof roundStats>) {
  const details = roundDetailStats(round);
  const profile = roundProfile(round);
  const rowPercent = stats.maxRows ? Math.max(4, Math.round((round.total_rows / stats.maxRows) * 100)) : 0;
  const pageCount = round.page_count || details.pages || config.pages.length;
  const locationCount = round.proxy_country_count || details.countries || configuredLocationCount();
  const pageCountry = `${pageCount} URLs / ${locationCount} locations`;
  return `
    <div class="latest-round-card round-detail-card">
      <div class="latest-round-top">
        <div>
          <span class="round-detail-eyebrow">Selected round</span>
          <strong>Round ${round.id}</strong>
        </div>
        <div class="round-detail-actions">
          ${renderRoundStatus(round.status)}
        </div>
      </div>
      <dl class="round-detail-grid">
        <div><dt>Started</dt><dd>${escapeHtml(round.started_at ? shortDate(round.started_at) : "-")}</dd></div>
        <div><dt>Completed</dt><dd>${escapeHtml(round.completed_at ? shortDate(round.completed_at) : "-")}</dd></div>
        <div><dt>Duration</dt><dd>${escapeHtml(durationFromMs(round.duration_ms))}</dd></div>
        <div><dt>Avg Response</dt><dd>${escapeHtml(details.avgResponseMs ? `${details.avgResponseMs} ms` : "-")}</dd></div>
      </dl>
      <div class="round-breakdown">
        <div><span>Hit Rate</span><strong>${escapeHtml(`${details.hitRate}%`)}</strong></div>
        <div><span>Hits</span><strong>${escapeHtml(compactNumber(details.hits))}</strong></div>
        <div><span>Issues</span><strong>${escapeHtml(compactNumber(details.issues))}</strong></div>
        <div><span>Rechecks</span><strong>${escapeHtml(compactNumber(round.recheck_rows))}</strong></div>
      </div>
      <div class="round-load">
        <span><b style="width:${rowPercent}%"></b></span>
        <small>${escapeHtml(`${compactNumber(round.total_rows)} rows captured - ${pageCountry}`)}</small>
      </div>
      <dl class="round-meta-list">
        <div><dt>Reason</dt><dd>${escapeHtml(round.reason || "scheduled")}</dd></div>
        <div><dt>Pages Seen</dt><dd>${escapeHtml(compactNumber(details.pages))}</dd></div>
        <div><dt>Countries Seen</dt><dd>${escapeHtml(compactNumber(details.countries))}</dd></div>
        <div><dt>Cloudflare Edges</dt><dd>${escapeHtml(compactNumber(details.edges))}</dd></div>
        <div><dt>Timeout</dt><dd>${escapeHtml(profile.timeout ? `${profile.timeout}s` : `${config.timeout}s`)}</dd></div>
        <div><dt>Delay</dt><dd>${escapeHtml(profile.delay ? `${profile.delay}s` : `${config.delay}s`)}</dd></div>
      </dl>
      ${round.error ? `<p class="round-error">${escapeHtml(round.error)}</p>` : ""}
    </div>
  `;
}

function renderRoundItem(round: MetricRound, selectedId: number | null) {
  const rows = `${compactNumber(round.total_rows)} rows`;
  const durationLabel = durationFromMs(round.duration_ms);
  const selected = selectedId === round.id;
  return `
    <button type="button" class="round-item ${round.status} ${selected ? "selected" : ""}" data-round-id="${round.id}" aria-pressed="${selected ? "true" : "false"}">
      <div class="round-marker" aria-hidden="true"></div>
      <div class="round-item-main">
        <div class="round-item-head">
          <strong>Round ${round.id}</strong>
          ${renderRoundStatus(round.status)}
        </div>
        <p>${escapeHtml(round.reason || "scheduled")} &middot; ${escapeHtml(round.started_at ? shortDate(round.started_at) : "-")}</p>
        ${round.error ? `<small class="round-error">${escapeHtml(round.error)}</small>` : ""}
      </div>
      <div class="round-item-metrics">
        <span>${escapeHtml(rows)}</span>
        <span>${escapeHtml(durationLabel)}</span>
        <span>${escapeHtml(`${round.page_count || config.pages.length} URLs`)}</span>
      </div>
    </button>
  `;
}

function renderRoundStatus(status: MetricRound["status"]) {
  return `<span class="round-status ${status}">${escapeHtml(roundStatusLabel(status))}</span>`;
}

function roundStats(rounds = roundsInSelectedRange()) {
  const total = rounds.length;
  const rows = rounds.reduce((sum, round) => sum + round.total_rows, 0);
  const maxRows = Math.max(0, ...rounds.map((round) => round.total_rows));

  return {
    latest: rounds[0] || null,
    maxRows,
    retained: metrics.rounds.length,
    rows,
    total,
  };
}

function selectedRound(rounds = roundsInSelectedRange()) {
  if (!rounds.length) {
    selectedRoundId = null;
    return null;
  }

  const selected = selectedRoundId ? rounds.find((round) => round.id === selectedRoundId) : null;
  const round = selected || rounds[0];
  selectedRoundId = round.id;
  return round;
}

function roundRows(round: MetricRound) {
  const id = String(round.id);
  return metrics.rows.filter((row) => metricRoundBase(row.round_id || row.round || "") === id);
}

function roundDetailStats(round: MetricRound) {
  const rows = roundRows(round);
  const hits = rows.filter((row) => cacheStatus(row) === "HIT").length;
  const misses = rows.filter((row) => isMissLike(cacheStatus(row))).length;
  const errors = rows.filter((row) => row.error || cacheStatus(row) === "FAIL").length;
  const responseValues = rows.map((row) => Number(row.response_ms)).filter((value) => Number.isFinite(value) && value > 0);
  const pages = uniqueValues(rows.map((row) => row.page || row.url || "")).length;
  const countries = uniqueValues(rows.map((row) => row.proxy_country || "")).length;
  const edges = uniqueValues(rows.map((row) => row.cf_edge || "")).length;
  const total = rows.length || round.total_rows;

  return {
    avgResponseMs: averageNumber(responseValues),
    countries,
    edges,
    hitRate: total ? Math.round((hits / total) * 100) : 0,
    hits,
    issues: misses + errors,
    pages,
  };
}

function roundProfile(round: MetricRound) {
  try {
    return JSON.parse(round.config_json || "{}") as Partial<Config>;
  } catch {
    return {};
  }
}

function roundsSubtitle(stats: ReturnType<typeof roundStats>) {
  const range = metricRangeLabel().toLowerCase();
  if (!stats.retained) return "No rounds yet. Start the monitor to build a run history.";
  if (!stats.total) return `No rounds in ${range}; ${stats.retained} retained outside this window.`;
  const latest = stats.latest;
  const latestText = latest?.started_at ? `latest ${relativeTime(latest.started_at)}` : "latest saved";
  return `${stats.total} rounds in ${range}, ${compactNumber(stats.rows)} rows, ${latestText}`;
}

function roundsListMeta(count: number) {
  if (!metrics.rounds.length) return "Empty";
  return `${count} shown / ${metrics.rounds.length} retained`;
}

function renderRoundsEmptyState() {
  if (!metrics.rounds.length) return '<div class="empty-state">No rounds recorded yet.</div>';
  return `<div class="empty-state">No rounds in ${escapeHtml(metricRangeLabel().toLowerCase())}.</div>`;
}

function roundsInSelectedRange() {
  const cutoff = Date.now() - selectedMetricRangeDays * DAY_MS;
  return metrics.rounds.filter((round) => {
    if (round.status === "running") return true;
    const time = roundTime(round);
    return time === null || time >= cutoff;
  });
}

function roundTime(round: MetricRound) {
  const value = round.started_at || round.completed_at || round.created_at;
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function metricRangeLabel(days = selectedMetricRangeDays) {
  return days === 1 ? "1 day" : `${days} days`;
}

function roundsLiveLabel() {
  if (statusState.busy) return statusState.round ? `Round ${statusState.round} running` : "Round running";
  if (statusState.running) return statusState.nextRunAt ? `Armed - ${relativeTime(statusState.nextRunAt)}` : "Armed";
  return "Stopped";
}

function roundStatusLabel(status: MetricRound["status"]) {
  const labels: Record<MetricRound["status"], string> = {
    completed: "Completed",
    failed: "Failed",
    running: "Running",
    stopped: "Stopped",
  };
  return labels[status] || status;
}

function configuredLocationCount() {
  return config.proxyCountries.split(",").map((country) => country.trim()).filter(Boolean).length + (config.noDirect ? 0 : 1);
}

function renderLogs() {
  const logs = statusState.logs.slice(-160);
  return `
    <section class="logs-panel full-log-panel">
      <div class="section-head">
        <h2>Collector Log</h2>
        <span data-log-meta>${logMeta(logs.length)}</span>
      </div>
      <pre data-log-output>${escapeHtml(logs.join("\n") || "No collector output yet.")}</pre>
    </section>
  `;
}

function updateRuntimeView(metricsChanged = true) {
  const statusChip = app.querySelector<HTMLElement>("[data-status-chip]");
  const statusDot = app.querySelector<HTMLElement>("[data-status-dot]");
  const statusText = app.querySelector<HTMLElement>("[data-status-label]");
  const crawlProgress = app.querySelector<HTMLElement>("[data-crawl-progress]");
  const nextRunCountdown = app.querySelector<HTMLElement>("[data-next-run-countdown]");
  const actions = app.querySelector<HTMLElement>("[data-actions]");

  if (!statusChip || !statusDot || !statusText || !crawlProgress || !nextRunCountdown || !actions) {
    const activeForm = activeTab === "config" || activeTab === "proxies";
    if (!activeForm || !formDirty) render();
    return;
  }

  statusChip.classList.toggle("on", statusState.busy || statusState.running);
  statusDot.classList.toggle("on", statusState.busy || statusState.running);
  statusText.textContent = runtimeStatusLabel();
  replaceHtml(crawlProgress, renderCrawlProgress());
  replaceHtml(nextRunCountdown, renderNextRunCountdown());
  if (replaceHtml(actions, renderActionButtons())) {
    wireActionEvents();
  }

  if (activeTab === "proxies" && !formDirty && metricsChanged) {
    const used = usedProxyRows();
    setText("[data-used-proxy-count]", `${used.length} recent`);
    setHtml("[data-used-proxies]", renderUsedProxyList(used));
    return;
  }

  if (activeTab === "logs") {
    const logs = statusState.logs.slice(-160);
    setText("[data-log-meta]", logMeta(logs.length));
    setText("[data-log-output]", logs.join("\n") || "No collector output yet.");
    return;
  }

  if (activeTab === "age" && metricsChanged) {
    setText("[data-age-timestamp]", ageRangeLabel());
    setHtml("[data-age-dashboard]", renderAgeDashboard());
    return;
  }

  if (activeTab === "rounds") {
    setHtml("[data-rounds-view]", renderRoundsContent());
    wireRoundEvents();
    return;
  }

  if (activeTab !== "metrics") return;
  if (!metricsChanged) return;

  scheduleMetricRuntimeUpdate();
}

function replaceHtml(element: HTMLElement, html: string) {
  if (element.innerHTML === html) return false;
  element.innerHTML = html;
  return true;
}

function metricPayloadSignature(payload: MetricsPayload) {
  const rounds = payload.rounds
    .slice(0, 4)
    .map((round) => `${round.id}:${round.status}:${round.total_rows}:${round.completed_at || ""}`)
    .join("|");
  return [
    payload.range?.days || "",
    payload.summary.totalRows,
    payload.summary.latestCells,
    payload.summary.lastTimestamp || "",
    payload.summary.totalRounds,
    rounds,
  ].join(";");
}

function scheduleMetricRuntimeUpdate() {
  if (activeTab !== "metrics") {
    pendingMetricRuntimeRefresh = false;
    return;
  }

  pendingMetricRuntimeRefresh = true;
  if (metricRuntimeRefreshTimer !== null) return;

  const delay = statusState.busy ? 1200 : 0;
  metricRuntimeRefreshTimer = window.setTimeout(flushMetricRuntimeUpdate, delay);
}

function flushMetricRuntimeUpdate() {
  metricRuntimeRefreshTimer = null;

  if (!pendingMetricRuntimeRefresh || activeTab !== "metrics") {
    pendingMetricRuntimeRefresh = false;
    return;
  }

  if (isMetricInteractionActive()) {
    metricRuntimeRefreshTimer = window.setTimeout(flushMetricRuntimeUpdate, 600);
    return;
  }

  pendingMetricRuntimeRefresh = false;
  updateMetricList();
}

function isMetricInteractionActive() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  return Boolean(active.closest("[data-metrics-view]"));
}

function runtimeStatusLabel() {
  if (statusState.busy) return statusState.round ? `Running - round ${statusState.round}` : "Running";
  if (statusState.running) return "Armed";
  return "Stopped";
}

function renderNextRunCountdown() {
  const info = nextRunCountdownInfo();
  if (!info) return "";

  return `
    <div class="next-run-card" role="timer" aria-live="polite" title="${escapeAttr(`Next run: ${shortDate(statusState.nextRunAt || "")}`)}" style="--next-run-progress:${info.percent}%">
      <span class="next-run-pulse" aria-hidden="true"><i></i></span>
      <span class="next-run-copy">
        <strong>Next round</strong>
      </span>
      <span class="next-run-clock">${escapeHtml(info.clock)}</span>
      <span class="next-run-track" aria-hidden="true"><i></i></span>
    </div>
  `;
}

function nextRunCountdownInfo() {
  if (!statusState.running || statusState.busy || !statusState.nextRunAt) return null;

  const nextTime = Date.parse(statusState.nextRunAt);
  if (!Number.isFinite(nextTime)) return null;

  const remainingSeconds = Math.max(0, Math.ceil((nextTime - Date.now()) / 1000));
  const totalSeconds = Math.max(1, nextRunIntervalSeconds());
  const elapsedSeconds = Math.max(0, totalSeconds - remainingSeconds);
  const percent = Math.min(100, Math.round((elapsedSeconds / totalSeconds) * 100));
  const nextRound = statusState.round ? statusState.round + 1 : metrics.summary.totalRounds + 1;

  return {
    clock: remainingSeconds ? countdownClock(remainingSeconds) : "Starting",
    label: remainingSeconds ? `Round ${nextRound} starts in ${compactCountdown(remainingSeconds)}` : "Starting next round",
    percent,
    remainingSeconds,
  };
}

function nextRunIntervalSeconds() {
  return config.roundIntervalSeconds;
}

function syncNextRunTicker() {
  const active = Boolean(statusState?.running && !statusState.busy && statusState.nextRunAt);
  if (active && nextRunTimer === null) {
    nextRunTimer = window.setInterval(updateNextRunCountdownView, 1000);
  }

  if (!active && nextRunTimer !== null) {
    clearInterval(nextRunTimer);
    nextRunTimer = null;
    dueRefreshForNextRun = null;
  }
}

function updateNextRunCountdownView() {
  const host = app.querySelector<HTMLElement>("[data-next-run-countdown]");
  if (!host) return;

  const info = nextRunCountdownInfo();
  host.innerHTML = renderNextRunCountdown();

  if (info?.remainingSeconds === 0 && statusState.nextRunAt && dueRefreshForNextRun !== statusState.nextRunAt) {
    dueRefreshForNextRun = statusState.nextRunAt;
    refreshRuntime().catch(console.error);
  }
}

function renderCrawlProgress() {
  if (!statusState.busy) return "";

  const progress = crawlProgressInfo();
  const round = statusState.round ? `Round ${statusState.round}` : "Current round";
  return `
    <div class="crawl-progress" role="status" aria-live="polite" title="${escapeAttr(progress.activeUrl || "")}" style="--crawl-progress:${progress.percent}%">
      <span class="crawl-spinner" aria-hidden="true"></span>
      <span class="crawl-copy">
        <strong>Requesting URLs</strong>
        <span>${escapeHtml(round)} - ${progress.requested} of ${progress.total} requested</span>
      </span>
      <span class="crawl-track" aria-hidden="true">
        <i></i>
        <b>${progress.requested}/${progress.total}</b>
      </span>
    </div>
  `;
}

function crawlProgressInfo() {
  const live = statusState.crawl;
  if (live && live.totalUrls > 0) {
    const requested = Math.min(live.totalUrls, Math.max(0, live.requestedUrls));
    const percent = Math.min(100, Math.round((requested / live.totalUrls) * 100));
    return { activeUrl: live.activeUrl, percent, requested, total: live.totalUrls };
  }

  const total = config.pages.length;
  const round = String(statusState.round || "");
  const pages = new Set<string>();

  if (round) {
    for (const row of metrics.rows) {
      const rowRound = metricRoundBase(row.round_id || row.round || "");
      if (rowRound === round && row.page) pages.add(row.page);
    }
  }

  const requested = Math.min(total, pages.size);
  const percent = total ? Math.min(100, Math.round((requested / total) * 100)) : 0;
  return { activeUrl: null, percent, requested, total };
}

function metricRoundBase(value: string) {
  return String(value || "").replace(/-recheck$/, "");
}

function renderActionButtons() {
  const runNowButton = statusState.busy
    ? ""
    : `<button class="button secondary" data-action="run-once">Run Now</button>`;
  return `
    <button class="icon-button" data-action="refresh" title="Refresh" aria-label="Refresh">${icon("refresh")}</button>
    ${runNowButton}
    ${
      statusState.running || statusState.busy
        ? '<button class="button danger" data-action="stop">Stop</button>'
        : '<button class="button primary" data-action="start">Start</button>'
    }
  `;
}

function logMeta(count: number) {
  const round = statusState.round ? `round ${statusState.round}` : "no round";
  return `${round} - ${count} lines`;
}

function metricRowsIndex() {
  if (metricRowsCache?.source === metrics.rows) return metricRowsCache.index;

  const indexedRows = [...metrics.rows].reverse().map((row) => {
    const status = cacheStatus(row);
    return {
      row,
      searchText: metricSearchText(row, status),
      status,
    };
  });

  const index: MetricRowsIndex = {
    countries: uniqueValues(indexedRows.map(({ row }) => row.proxy_country)),
    pages: uniqueValues(indexedRows.map(({ row }) => row.page)),
    rows: indexedRows,
    statuses: uniqueValues(indexedRows.map(({ status }) => status)),
  };
  metricRowsCache = { source: metrics.rows, index };
  return index;
}

function metricSearchText(row: MetricRow, status = cacheStatus(row)) {
  return [
    row.page,
    row.url,
    row.proxy_country,
    countryName(row.proxy_country || ""),
    row.cf_edge,
    row.proxy,
    row.error,
    row.cf_ray,
    row.status_code,
    status,
  ]
    .join(" ")
    .toLowerCase();
}

function filteredMetricRows() {
  const query = metricFilters.query.trim().toLowerCase();
  const rows: MetricRow[] = [];

  for (const { row, searchText, status } of metricRowsIndex().rows) {
    if (metricFilters.country && row.proxy_country !== metricFilters.country) continue;
    if (metricFilters.page && row.page !== metricFilters.page) continue;
    if (metricFilters.status && status !== metricFilters.status) continue;
    if (query && !searchText.includes(query)) continue;
    rows.push(row);
  }

  return rows;
}

function metricTimeColumns(rows: MetricRow[]) {
  const columns = new Map<string, MetricTimeColumn & { start: number; end: number }>();

  for (const row of rows) {
    const column = metricBatchColumn(row);
    const time = Date.parse(row.timestamp_utc || "");
    const point = Number.isNaN(time) ? column.sort : time;
    const existing = columns.get(column.key);

    if (!existing) {
      columns.set(column.key, { ...column, start: point, end: point });
      continue;
    }

    existing.start = Math.min(existing.start, point);
    existing.end = Math.max(existing.end, point);
    existing.sort = existing.start;
    existing.meta = batchTimeRange(existing.start, existing.end);
  }

  return [...columns.values()]
    .sort((a, b) => a.sort - b.sort)
    .map(({ start, end, ...column }) => column);
}

function metricTimeGroups(rows: MetricRow[], columns: MetricTimeColumn[]) {
  const validColumns = new Set(columns.map((column) => column.key));
  const groups = new Map<string, MetricTimeGroup>();

  for (const row of rows) {
    const country = row.proxy_country || "-";
    const key = [row.page || "-", row.url || "-", country].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        page: row.page || "-",
        url: row.url || "-",
        country,
        countryLabel: countryName(country),
        cells: new Map<string, MetricRow>(),
      };
      groups.set(key, group);
    }

    const columnKey = metricBatchColumn(row).key;
    if (validColumns.has(columnKey) && !group.cells.has(columnKey)) {
      group.cells.set(columnKey, row);
    }
  }

  return [...groups.values()];
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

function metricBatchColumn(row: MetricRow): MetricTimeColumn {
  const cached = metricColumnCache.get(row);
  if (cached) return cached;

  const column = metricTimeColumn(row.timestamp_utc || "");
  const roundValue = row.round || row.round_id;
  if (!roundValue) {
    metricColumnCache.set(row, column);
    return column;
  }

  const recheck = roundValue.endsWith("-recheck");
  const round = recheck ? roundValue.replace(/-recheck$/, "") : roundValue;
  const batchColumn = { ...column, key: `batch-${roundValue}`, label: recheck ? `Recheck ${round}` : `Round ${round}` };
  metricColumnCache.set(row, batchColumn);
  return batchColumn;
}

function batchTimeRange(start: number, end: number) {
  if (start === Number.MAX_SAFE_INTEGER) return "No time";
  const middleDate = new Date(start + (end - start) / 2);
  const middleLabel = middleDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${middleLabel} ${middleDate.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function renderMetricTimeHeader(columns: MetricTimeColumn[]) {
  return `
    <tr>
      <th>Urls</th>
      <th>Countries</th>
      ${columns.map((column) => `
        <th class="metric-time-heading ${column.key.endsWith("-recheck") ? "recheck-heading" : ""}" title="${escapeAttr(`${column.meta}, ${column.label}`)}">
          <strong>${escapeHtml(column.label)}</strong>
          <span>${escapeHtml(column.meta)}</span>
        </th>
      `).join("")}
    </tr>
  `;
}

function renderMetricColgroup(columns: MetricTimeColumn[]) {
  return `<colgroup data-filter-cols>${renderMetricCols(columns)}</colgroup>`;
}

function renderMetricCols(columns: MetricTimeColumn[]) {
  return `
    <col class="matrix-url-col" />
    <col class="matrix-country-col" />
    ${columns.map(() => '<col class="matrix-time-col" />').join("")}
  `;
}

function metricMatrixMinWidth(columns: MetricTimeColumn[]) {
  return MATRIX_URL_COL_WIDTH + MATRIX_COUNTRY_COL_WIDTH + columns.length * MATRIX_TIME_COL_WIDTH;
}

function metricMatrixStyle(columns: MetricTimeColumn[]) {
  return [
    `--matrix-url-width:${MATRIX_URL_COL_WIDTH}px`,
    `--matrix-country-width:${MATRIX_COUNTRY_COL_WIDTH}px`,
    `--matrix-time-width:${MATRIX_TIME_COL_WIDTH}px`,
    `--matrix-min-width:${metricMatrixMinWidth(columns)}px`,
  ].join(";");
}

function renderMetricMatrixRow(group: MetricTimeGroup, columns: MetricTimeColumn[]) {
  return `
    <tr>
      <th class="url-cell compact-url-cell" title="${escapeAttr(group.page)}">
        <strong>${escapeHtml(group.page)}</strong>
      </th>
      <td class="country-cell" title="${escapeAttr(group.countryLabel)}">
        <strong>${escapeHtml(group.countryLabel)}</strong>
      </td>
      ${columns.map((column) => renderMetricStatusCell(group.cells.get(column.key))).join("")}
    </tr>
  `;
}

function renderMetricStatusCell(row?: MetricRow) {
  if (!row) return `<td class="status-cell empty-status">-</td>`;

  const status = cacheStatus(row);
  const tone = row.error ? "fail" : status === "HIT" ? "hit" : isMissLike(status) ? "miss" : "other";
  const details = renderMetricStatusDetails(row);

  return `
    <td class="status-cell">
      <button class="status-pill status-button ${tone}" type="button">
        <strong>${escapeHtml(status)}</strong>
        <span>${escapeHtml(statusMeta(row))}</span>
      </button>
      <div class="sample-details">
        ${details}
      </div>
    </td>
  `;
}

function renderMetricStatusDetails(row: MetricRow) {
  const status = cacheStatus(row);
  const response = row.response_ms ? `${row.response_ms} ms` : "-";
  const age = Number(row.age_seconds) || 0;
  const details = [
    ["Round", row.round_id || row.round || "-"],
    ["Sample", sampleStage(row)],
    ["Status", status],
    ["Age", duration(age)],
    ["Edge", row.cf_edge || "-"],
    ["Response", response],
    ["HTTP", row.status_code || "-"],
    ["Fetched", row.timestamp_utc ? shortDate(row.timestamp_utc) : "-"],
    ["Country", countryName(row.proxy_country || "-")],
    ["Proxy", row.proxy || "-"],
    ["CF-Ray", row.cf_ray || "-"],
  ];

  if (row.error) details.push(["Error", row.error]);

  return `
    <dl>
      ${details.map(([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `).join("")}
    </dl>
  `;
}

function statusMeta(row: MetricRow) {
  if (row.error) return row.status_code || "fail";
  if (row.response_ms) return `${row.response_ms}ms`;
  if (row.cf_edge) return row.cf_edge;
  return row.status_code || "-";
}

function sampleStage(row: MetricRow) {
  const round = row.round || row.round_id;
  if (!round) return "Sample";
  if (round.endsWith("-recheck")) return `Recheck after MISS interval`;
  return "First check";
}

function renderEmptyListRow(columns: MetricTimeColumn[] = []) {
  return emptyTableRow("No samples match the current filters.", Math.max(2 + columns.length, 3));
}

function renderAgeDashboard() {
  const buckets = cacheAgeBuckets();
  if (!metrics.rows.length || !buckets.length) {
    return `<div class="empty-state">No cache age data yet.</div>`;
  }

  const summary = cacheAgeSummary(buckets);
  const topUrls = topHitUrls();

  return `
    <div class="age-summary-grid">
      ${renderAgeStat("HIT Rate", `${summary.hitRate}%`, `${compactNumber(summary.hits)} HIT / ${compactNumber(summary.useful)} useful`, "hit")}
      ${renderAgeStat("Max Age", duration(summary.maxAge), `${duration(summary.avgAge)} average`, "age")}
      ${renderAgeStat("MISS-like", compactNumber(summary.missLike), "BYPASS, MISS, EXPIRED and similar", "miss")}
      ${renderAgeStat(
        "No Header / Errors",
        compactNumber(summary.noHeader + summary.errors),
        `${compactNumber(summary.noHeader)} no header, ${compactNumber(summary.errors)} errors`,
        "warn",
      )}
    </div>

    <div class="age-chart-grid">
      <section class="age-chart-card">
        <div class="age-chart-head">
          <h3>Cache Status Over Time</h3>
          <span>${escapeHtml(`${buckets.length} time points`)}</span>
        </div>
        ${renderCacheStatusBars(buckets)}
        ${renderAgeLegend()}
      </section>

      <section class="age-chart-card">
        <div class="age-chart-head">
          <h3>Cache Age Trend</h3>
          <span>${escapeHtml(`Peak ${duration(summary.maxAge)}`)}</span>
        </div>
        ${renderAgeLineChart(buckets)}
      </section>
    </div>

    <section class="age-chart-card age-top-card">
      <div class="age-chart-head">
        <h3>Top HIT URLs</h3>
        <span>${escapeHtml(topUrls.length ? `${topUrls.length} URLs` : "No HIT data")}</span>
      </div>
      ${renderTopHitUrlChart(topUrls)}
    </section>
  `;
}

function renderAgeStat(label: string, value: string, meta: string, tone: string) {
  return `
    <div class="age-stat ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(meta)}</small>
    </div>
  `;
}

function renderCacheStatusBars(buckets: CacheAgeBucket[]) {
  const visible = buckets.slice(-40);
  const maxTotal = Math.max(1, ...visible.map((bucket) => bucket.total));

  return `
    <div class="age-status-chart">
      ${visible
        .map((bucket) => {
          const height = Math.max(10, Math.round((bucket.total / maxTotal) * 100));
          return `
            <div class="age-status-column" title="${escapeAttr(ageBucketTitle(bucket))}">
              <div class="age-status-stack" style="height:${height}%">
                <i class="hit" style="height:${ageSegmentHeight(bucket.hits, bucket.total)}%"></i>
                <i class="miss" style="height:${ageSegmentHeight(bucket.missLike, bucket.total)}%"></i>
                <i class="warn" style="height:${ageSegmentHeight(bucket.noHeader, bucket.total)}%"></i>
                <i class="fail" style="height:${ageSegmentHeight(bucket.errors, bucket.total)}%"></i>
              </div>
              <span>${escapeHtml(bucket.label)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderAgeLegend() {
  return `
    <div class="age-legend">
      <span><i class="hit"></i>HIT</span>
      <span><i class="miss"></i>MISS-like</span>
      <span><i class="warn"></i>No header</span>
      <span><i class="fail"></i>Error</span>
    </div>
  `;
}

function renderAgeLineChart(buckets: CacheAgeBucket[]) {
  const visible = buckets.slice(-40);
  const width = 720;
  const height = 190;
  const pad = 24;
  const maxAge = Math.max(1, ...visible.map((bucket) => bucket.maxAge));
  const points = visible.map((bucket, index) => {
    const x = visible.length === 1 ? width / 2 : pad + (index / (visible.length - 1)) * (width - pad * 2);
    const y = height - pad - (bucket.maxAge / maxAge) * (height - pad * 2);
    return { bucket, x: Math.round(x), y: Math.round(y) };
  });
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = points.length
    ? `M ${points[0].x} ${height - pad} L ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${
        points.at(-1)!.x
      } ${height - pad} Z`
    : "";

  return `
    <div class="age-line-wrap">
      <svg class="age-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cache age over time">
        <path class="age-line-grid" d="M ${pad} ${height - pad} H ${width - pad} M ${pad} ${pad} H ${width - pad}" />
        ${area ? `<path class="age-line-area" d="${area}" />` : ""}
        ${line ? `<polyline class="age-line" points="${line}" />` : ""}
        ${points
          .map(
            (point) =>
              `<circle cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(
                `${point.bucket.label}: ${duration(point.bucket.maxAge)} max age`,
              )}</title></circle>`,
          )
          .join("")}
      </svg>
      <div class="age-line-meta">
        <span>${escapeHtml(visible[0]?.meta || "-")}</span>
        <strong>${escapeHtml(duration(maxAge))}</strong>
        <span>${escapeHtml(visible.at(-1)?.meta || "-")}</span>
      </div>
    </div>
  `;
}

function renderTopHitUrlChart(rows: TopHitUrl[]) {
  if (!rows.length) return `<div class="empty-state compact">No HIT rows found in this timeframe.</div>`;
  const maxHits = Math.max(1, ...rows.map((row) => row.hits));
  return `
    <div class="top-hit-chart">
      ${rows
        .map((row) => {
          const width = Math.max(3, Math.round((row.hits / maxHits) * 100));
          return `
            <div class="top-hit-row" title="${escapeAttr(row.url)}">
              <div class="top-hit-copy">
                <strong>${escapeHtml(compactUrl(row.url))}</strong>
                <span>${escapeHtml(`${compactNumber(row.hits)} HIT / ${compactNumber(row.useful)} useful - ${row.hitRate}% HIT - max age ${duration(row.maxAge)}`)}</span>
              </div>
              <b>${escapeHtml(`${row.hitRate}%`)}</b>
              <div class="top-hit-bar"><i style="width:${width}%"></i></div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function cacheAgeBuckets() {
  const buckets = new Map<string, CacheAgeBucket>();

  for (const row of metrics.rows) {
    const time = Date.parse(row.timestamp_utc || "");
    const round = metricRoundBase(row.round_id || row.round || "");
    const fallbackKey = Number.isNaN(time) ? "unknown" : new Date(time).toISOString().slice(0, 13);
    const key = round ? `round-${round}` : fallbackKey;
    let bucket = buckets.get(key);

    if (!bucket) {
      const date = Number.isNaN(time) ? null : new Date(time);
      bucket = {
        key,
        label: round ? `R${round}` : date ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "-",
        meta: date ? shortDate(date.toISOString()) : "No time",
        sort: Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time,
        total: 0,
        useful: 0,
        hits: 0,
        missLike: 0,
        noHeader: 0,
        errors: 0,
        ageValues: [],
        avgAge: 0,
        maxAge: 0,
        hitRate: 0,
      };
      buckets.set(key, bucket);
    }

    const status = cacheStatus(row);
    const age = Number(row.age_seconds) || 0;
    bucket.total += 1;
    bucket.sort = Math.min(bucket.sort, Number.isNaN(time) ? bucket.sort : time);

    if (row.error || status === "FAIL") {
      bucket.errors += 1;
    } else if (!row.cf_cache_status) {
      bucket.noHeader += 1;
    } else {
      bucket.useful += 1;
      if (status === "HIT") bucket.hits += 1;
      else if (isMissLike(status)) bucket.missLike += 1;
    }

    if (status === "HIT" && age > 0) bucket.ageValues.push(age);
  }

  return [...buckets.values()]
    .map(finalizeAgeBucket)
    .sort((a, b) => a.sort - b.sort);
}

function finalizeAgeBucket(bucket: CacheAgeBucket) {
  bucket.maxAge = Math.max(0, ...bucket.ageValues);
  bucket.avgAge = averageNumber(bucket.ageValues);
  bucket.hitRate = bucket.useful ? Math.round((bucket.hits / bucket.useful) * 100) : 0;
  return bucket;
}

function cacheAgeSummary(buckets: CacheAgeBucket[]) {
  const ageValues = buckets.flatMap((bucket) => bucket.ageValues);
  const hits = buckets.reduce((sum, bucket) => sum + bucket.hits, 0);
  const useful = buckets.reduce((sum, bucket) => sum + bucket.useful, 0);
  return {
    avgAge: averageNumber(ageValues),
    errors: buckets.reduce((sum, bucket) => sum + bucket.errors, 0),
    hitRate: useful ? Math.round((hits / useful) * 100) : 0,
    hits,
    maxAge: Math.max(0, ...ageValues),
    missLike: buckets.reduce((sum, bucket) => sum + bucket.missLike, 0),
    noHeader: buckets.reduce((sum, bucket) => sum + bucket.noHeader, 0),
    useful,
  };
}

function topHitUrls() {
  const urls = new Map<string, TopHitUrl & { ageValues: number[] }>();

  for (const row of metrics.rows) {
    const url = row.url || row.page || "-";
    const status = cacheStatus(row);
    const age = Number(row.age_seconds) || 0;
    let item = urls.get(url);
    if (!item) {
      item = { url, hits: 0, useful: 0, total: 0, hitRate: 0, maxAge: 0, avgAge: 0, latestTimestamp: "", ageValues: [] };
      urls.set(url, item);
    }

    item.total += 1;
    if (row.cf_cache_status) item.useful += 1;
    if (status === "HIT") {
      item.hits += 1;
      if (age > 0) item.ageValues.push(age);
    }
    if (!item.latestTimestamp || Date.parse(row.timestamp_utc || "") > Date.parse(item.latestTimestamp)) {
      item.latestTimestamp = row.timestamp_utc || "";
    }
  }

  return [...urls.values()]
    .map(({ ageValues, ...item }) => ({
      ...item,
      avgAge: averageNumber(ageValues),
      hitRate: item.useful ? Math.round((item.hits / item.useful) * 100) : 0,
      maxAge: Math.max(0, ...ageValues),
    }))
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.hitRate - a.hitRate || b.maxAge - a.maxAge)
    .slice(0, 10);
}

function ageSegmentHeight(count: number, total: number) {
  return total ? Math.round((count / total) * 100) : 0;
}

function ageBucketTitle(bucket: CacheAgeBucket) {
  return [
    `${bucket.label} (${bucket.meta})`,
    `${bucket.hitRate}% HIT`,
    `${bucket.hits} HIT`,
    `${bucket.missLike} MISS-like`,
    `${bucket.noHeader} no header`,
    `${bucket.errors} errors`,
  ].join(" - ");
}

function ageRangeLabel() {
  const updated = metrics.range?.availableTo || metrics.summary.lastTimestamp;
  const availableFrom = metrics.range?.availableFrom;
  if (!updated) return `${metricRangeLabel()} - No data`;
  const available = availableFrom ? `${shortDate(availableFrom)} to ${shortDate(updated)}` : shortDate(updated);
  return `${metricRangeLabel()} - ${available}`;
}

function renderMetricRangeControl() {
  return `
    <label class="metric-range-control">
      <span>Timeframe</span>
      <select data-metric-range aria-label="Round timeframe">
        ${metricRangeDayOptions
          .map((days) => `<option value="${days}" ${selectedMetricRangeDays === days ? "selected" : ""}>${metricRangeLabel(days)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function compactUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "/" : url.pathname}`;
  } catch {
    return value || "-";
  }
}

function wireMetricRangeEvents() {
  app.querySelectorAll<HTMLSelectElement>("[data-metric-range]").forEach((select) => {
    select.addEventListener("change", () => {
      const days = Number(select.value);
      if (isMetricRangeDays(days)) setMetricRangeDays(days);
    });
  });
}

function renderConfig() {
  const summary = configSummary();
  return `
    <form class="form-panel config-panel" data-form="config">
      <div class="section-head">
        <h2><span class="section-icon" aria-hidden="true">${icon("settings")}</span>Configuration</h2>
        <span>${summary.urls} URLs / ${summary.locations} locations</span>
      </div>

      <div class="config-body">
        <div class="config-layout">
          <div class="config-column config-main">
            <section class="form-section target-section">
              <div class="form-section-title">
                <span class="section-icon" aria-hidden="true">${icon("link")}</span>
                <div>
                  <h3>Targets & Storage</h3>
                  <p>Saved into ${escapeHtml(config.output)}</p>
                </div>
              </div>
              <div class="config-grid two">
                <label>
                  SQLite Database
                  <input name="output" value="${escapeAttr(config.output)}" spellcheck="false" />
                </label>
                <label>
                  User Agent
                  <input name="userAgent" value="${escapeAttr(config.userAgent)}" spellcheck="false" />
                </label>
              </div>
              <label>
                Target URLs
                <textarea class="config-textarea-large" name="pages" rows="${Math.min(18, Math.max(10, config.pages.length + 2))}" spellcheck="false">${escapeHtml(config.pages.join("\n"))}</textarea>
              </label>
            </section>

            <section class="form-section">
              <div class="form-section-title">
                <span class="section-icon" aria-hidden="true">${icon("user")}</span>
                <div>
                  <h3>Proxy Locations</h3>
                  <p>${summary.sources} active request sources</p>
                </div>
              </div>
              <div class="config-grid two">
                <label>
                  Proxy Countries
                  <textarea class="config-textarea-small" name="proxyCountries" rows="6" spellcheck="false">${escapeHtml(configProxyCountries().join("\n"))}</textarea>
                </label>
                <label>
                  Max Proxies / Country
                  <input name="maxProxiesPerCountry" type="number" min="1" max="100" value="${config.maxProxiesPerCountry}" />
                </label>
              </div>
            </section>
          </div>

          <div class="config-column config-side">
            <section class="form-section">
              <div class="form-section-title">
                <span class="section-icon" aria-hidden="true">${icon("timer")}</span>
                <div>
                  <h3>Schedule & Request Timing</h3>
                  <p>${escapeHtml(summary.intervals)} round interval</p>
                </div>
              </div>
              <div class="config-grid schedule">
                <label>Round Interval <small>seconds</small><input name="roundIntervalSeconds" type="number" min="15" max="86400" step="15" value="${config.roundIntervalSeconds}" /></label>
                <label>Request Timeout <small>seconds</small><input name="timeout" type="number" min="1" max="60" value="${config.timeout}" /></label>
                <label>Retry Delay <small>seconds</small><input name="delay" type="number" min="0" max="60" value="${config.delay}" /></label>
              </div>
            </section>

            <section class="form-section source-section">
              <div class="form-section-title">
                <span class="section-icon" aria-hidden="true">${icon("shuffle")}</span>
                <div>
                  <h3>Source Controls</h3>
                  <p>${summary.sources} enabled</p>
                </div>
              </div>
              <div class="switches">
                ${checkbox("shuffleProxies", "Shuffle proxies", config.shuffleProxies)}
                ${checkbox("enableDirect", "Direct request", !config.noDirect)}
                ${checkbox("enableProxySource", "Proxifly source", !config.noProxySource)}
                ${checkbox("enableClarketmSource", "Clarketm source", !config.noClarketmSource)}
              </div>
            </section>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <span class="config-error" data-config-error hidden></span>
        <button class="button primary icon-text" type="submit">${icon("save")}<span>Save Configuration</span></button>
      </div>
    </form>
  `;
}

function configSummary() {
  const countries = configProxyCountries();
  const locations = countries.length + (config.noDirect ? 0 : 1);
  const domains = uniqueValues(config.pages.map((page) => {
    try {
      return new URL(page).hostname;
    } catch {
      return "";
    }
  })).length;
  const sources = [
    !config.noDirect,
    !config.noProxySource,
    !config.noClarketmSource,
  ].filter(Boolean).length;

  return {
    cells: compactNumber(config.pages.length * locations),
    countries: countries.length,
    domains,
    intervals: duration(config.roundIntervalSeconds),
    locations,
    sources,
    urls: config.pages.length,
  };
}

function configProxyCountries() {
  return normalizeConfigList(config.proxyCountries);
}

function renderProxies() {
  const count = localProxyLines().length;
  const used = usedProxyRows();

  return `
    <form class="form-panel proxy-panel" data-form="proxies">
      <div class="section-head">
        <h2>Used Proxies</h2>
        <span data-used-proxy-count>${used.length} recent</span>
      </div>
      <div class="table-scroll proxy-scroll" data-used-proxies>
        ${renderUsedProxyList(used)}
      </div>
      <div class="section-head">
        <h2>Local Proxies</h2>
        <span>${count} enabled</span>
      </div>
      <textarea name="proxies" rows="20" spellcheck="false">${escapeHtml(proxyText)}</textarea>
      <div class="form-actions">
        <button class="button primary" type="submit">Save Proxies</button>
      </div>
    </form>
  `;
}

function renderUsedProxyList(rows = usedProxyRows()) {
  if (!rows.length) return `<div class="empty-state">No proxy usage recorded yet. Run the monitor once to populate this list.</div>`;

  return `
    <table class="sample-table proxy-table">
      <thead>
        <tr>
          <th>Proxy</th>
          <th>Country</th>
          <th>Source</th>
          <th>Status</th>
          <th>Response</th>
          <th>Last Used</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(renderUsedProxyRow).join("")}
      </tbody>
    </table>
  `;
}

function renderUsedProxyRow(row: UsedProxyRow) {
  const tone = row.error ? "fail" : row.status === "HIT" ? "hit" : isMissLike(row.status) ? "miss" : "other";
  return `
    <tr title="${escapeAttr(row.error || row.page)}">
      <th class="url-cell">
        <strong>${escapeHtml(row.proxy)}</strong>
        <span>${escapeHtml(row.page || "-")}</span>
      </th>
      <td>${escapeHtml(countryName(row.country))}</td>
      <td>${escapeHtml(row.source)}</td>
      <td><strong class="status-pill ${tone}">${escapeHtml(row.status)}</strong></td>
      <td>${escapeHtml(row.responseMs ? `${row.responseMs} ms` : "-")}</td>
      <td>${row.timestamp ? shortDate(row.timestamp) : "-"}</td>
    </tr>
  `;
}

function usedProxyRows() {
  const local = new Set(localProxyLines().map(proxyKey));
  const seen = new Set<string>();
  const rows: UsedProxyRow[] = [];

  for (const row of [...metrics.rows].reverse()) {
    const proxy = row.proxy || "";
    if (!proxy) continue;

    const country = row.proxy_country || "-";
    const key = `${country}|${proxy}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      country,
      error: row.error || "",
      page: row.page || "",
      proxy,
      responseMs: row.response_ms || "",
      source:
        proxy === "direct" ? "Direct" : country.toLowerCase() === "local" || local.has(proxyKey(proxy)) ? "Local" : "Fetched",
      status: cacheStatus(row),
      timestamp: row.timestamp_utc || "",
    });

    if (rows.length >= 80) break;
  }

  return rows;
}

function localProxyLines() {
  return proxyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function proxyKey(value: string) {
  if (value === "direct") return value;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `http://${value}`);
    return `${url.protocol}//${url.username}${url.password ? ":***" : ""}${url.username ? "@" : ""}${url.host}`;
  } catch {
    return value;
  }
}

function wireEvents() {
  wireActionEvents();
  wireMetricRangeEvents();

  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab as typeof activeTab;
      formDirty = false;
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-filter]").forEach((input) => {
    const updateFilter = () => {
      const key = input.dataset.filter as keyof typeof metricFilters;
      metricFilters = { ...metricFilters, [key]: input.value };
      metricPagination.page = 1;
      queueMetricListUpdate(key === "query" ? 160 : 0);
    };
    if (input.dataset.filter === "query") {
      input.addEventListener("input", updateFilter);
      input.addEventListener("change", () => {
        updateFilter();
        queueMetricListUpdate(0);
      });
      return;
    }
    input.addEventListener("change", updateFilter);
  });

  const configForm = app.querySelector<HTMLFormElement>('[data-form="config"]');
  const proxiesForm = app.querySelector<HTMLFormElement>('[data-form="proxies"]');
  configForm?.addEventListener("input", () => {
    formDirty = true;
  });
  proxiesForm?.addEventListener("input", () => {
    formDirty = true;
  });
  configForm?.addEventListener("submit", saveConfig);
  proxiesForm?.addEventListener("submit", saveProxies);
  wirePaginationEvents();
  wireRoundEvents();
}

function wireActionEvents() {
  const actions: Record<string, () => void> = {
    refresh: () => void loadAll(),
    start: () => void postAction("/api/monitor/start"),
    stop: () => void postAction("/api/monitor/stop"),
    "run-once": () => void postAction("/api/monitor/run-once"),
  };

  for (const [name, handler] of Object.entries(actions)) {
    app.querySelector(`[data-action="${name}"]`)?.addEventListener("click", handler);
  }
}

async function postAction(path: string) {
  await api(path, { method: "POST", body: "{}" });
  await refreshRuntime();
}

async function saveConfig(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const pages = normalizeConfigList(data.get("pages"));
  const proxyCountries = normalizeConfigList(data.get("proxyCountries"));

  setConfigError("");
  if (!pages.length) {
    setConfigError("Add at least one target URL before saving.");
    return;
  }
  if (!proxyCountries.length) {
    setConfigError("Add at least one proxy country before saving.");
    return;
  }

  const next: Config = {
    ...config,
    pages,
    output: String(data.get("output") || ""),
    proxyCountries: proxyCountries.join(","),
    maxProxiesPerCountry: numberFormValue(data, "maxProxiesPerCountry", config.maxProxiesPerCountry),
    timeout: numberFormValue(data, "timeout", config.timeout),
    delay: numberFormValue(data, "delay", config.delay),
    roundIntervalSeconds: numberFormValue(data, "roundIntervalSeconds", config.roundIntervalSeconds),
    hitIntervalSeconds: numberFormValue(data, "roundIntervalSeconds", config.roundIntervalSeconds),
    missIntervalSeconds: numberFormValue(data, "missIntervalSeconds", config.missIntervalSeconds),
    userAgent: String(data.get("userAgent") || ""),
    shuffleProxies: data.has("shuffleProxies"),
    noDirect: !data.has("enableDirect"),
    noProxySource: !data.has("enableProxySource"),
    noClarketmSource: !data.has("enableClarketmSource"),
  };

  try {
    await api<Config>("/api/config", { method: "PUT", body: JSON.stringify(next) });
    formDirty = false;
    await loadAll();
  } catch (error) {
    setConfigError(error instanceof Error ? error.message : String(error));
  }
}

function normalizeConfigList(value: FormDataEntryValue | string | null) {
  const seen = new Set<string>();
  return String(value || "")
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function numberFormValue(data: FormData, name: string, fallback: number) {
  const raw = String(data.get(name) || "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function setConfigError(message: string) {
  const error = app.querySelector<HTMLElement>("[data-config-error]");
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

async function saveProxies(event: SubmitEvent) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const text = String(new FormData(form).get("proxies") || "");
  await api("/api/proxies", { method: "PUT", body: JSON.stringify({ text }) });
  formDirty = false;
  await loadAll();
}

function updateMetricList() {
  if (activeTab !== "metrics") return;

  const rows = filteredMetricRows();
  const timeColumns = metricTimeColumns(rows);
  const groups = metricTimeGroups(rows, timeColumns);
  const pagination = paginationInfo(groups.length);
  const pageGroups = groups.slice(pagination.start, pagination.end);
  const table = app.querySelector<HTMLTableElement>("[data-metric-table]");
  const colgroup = app.querySelector<HTMLTableColElement>("[data-filter-cols]");
  const head = app.querySelector<HTMLTableSectionElement>("[data-filter-head]");
  const body = app.querySelector<HTMLTableSectionElement>("[data-filter-body]");
  const paginationEl = app.querySelector<HTMLElement>("[data-pagination]");
  if (table) table.setAttribute("style", metricMatrixStyle(timeColumns));
  if (colgroup) colgroup.innerHTML = renderMetricCols(timeColumns);
  if (head) head.innerHTML = renderMetricTimeHeader(timeColumns);
  if (body) {
    body.innerHTML = groups.length
      ? pageGroups.map((group) => renderMetricMatrixRow(group, timeColumns)).join("")
      : renderEmptyListRow(timeColumns);
  }
  if (paginationEl) paginationEl.innerHTML = renderPaginationControls(pagination);
  wirePaginationEvents();
}

function queueMetricListUpdate(delayMs: number) {
  if (metricFilterTimer !== null) {
    clearTimeout(metricFilterTimer);
    metricFilterTimer = null;
  }

  if (!delayMs) {
    updateMetricList();
    return;
  }

  metricFilterTimer = window.setTimeout(() => {
    metricFilterTimer = null;
    updateMetricList();
  }, delayMs);
}

function wirePaginationEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-pagination-size]").forEach((button) => {
    button.addEventListener("click", () => {
      metricPagination = {
        page: 1,
        pageSize: Number(button.dataset.paginationSize) || metricPagination.pageSize,
      };
      updateMetricList();
      scrollMetricTableToTop();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-page-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const direction = button.dataset.pageAction === "next" ? 1 : -1;
      metricPagination.page += direction;
      updateMetricList();
      scrollMetricTableToTop();
    });
  });
}

function paginationInfo(total: number) {
  const pageSize = metricPagination.pageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(metricPagination.page, 1), pageCount);
  metricPagination.page = page;
  const start = total ? (page - 1) * pageSize : 0;
  const end = Math.min(start + pageSize, total);
  return { end, page, pageCount, pageSize, start, total };
}

function renderPaginationControls(pagination: ReturnType<typeof paginationInfo>) {
  const from = pagination.total ? pagination.start + 1 : 0;
  const to = pagination.end;
  const isFirst = pagination.page <= 1;
  const isLast = pagination.page >= pagination.pageCount;

  return `
    <div class="page-size-control">
      <span>Rows</span>
      <div class="page-size-dropdown">
        <button class="page-size-trigger" type="button" aria-haspopup="listbox" aria-label="Rows per page">
          <span>${pagination.pageSize}</span>
          <i aria-hidden="true"></i>
        </button>
        <div class="page-size-options" role="listbox" aria-label="Rows per page">
        ${PAGE_SIZE_OPTIONS.map(
          (size) => `
            <button
              type="button"
              class="${pagination.pageSize === size ? "selected" : ""}"
              data-pagination-size="${size}"
              role="option"
              aria-selected="${pagination.pageSize === size ? "true" : "false"}"
            >${size}</button>
          `,
        ).join("")}
        </div>
      </div>
    </div>
    <span class="pagination-range">Showing ${from}-${to} of ${pagination.total}</span>
    <div class="page-controls">
      <button class="icon-button compact" data-page-action="prev" title="Previous page" aria-label="Previous page" ${
        isFirst ? "disabled" : ""
      }>${icon("chevronLeft")}</button>
      <span>Page ${pagination.page} of ${pagination.pageCount}</span>
      <button class="icon-button compact" data-page-action="next" title="Next page" aria-label="Next page" ${
        isLast ? "disabled" : ""
      }>${icon("chevronRight")}</button>
    </div>
  `;
}

function scrollMetricTableToTop() {
  const scroll = app.querySelector<HTMLElement>(".table-scroll");
  if (scroll) scroll.scrollTop = 0;
}

function countryName(code: string) {
  const names: Record<string, string> = {
    AU: "Australia",
    BD: "Bangladesh",
    CA: "Canada",
    DE: "Germany",
    FR: "France",
    GB: "United Kingdom",
    IN: "India",
    JP: "Japan",
    LOCAL: "Local",
    local: "Local",
    SG: "Singapore",
    UK: "United Kingdom",
    US: "United States",
    direct: "Direct",
  };
  return names[code] || code;
}

function cacheStatus(row: MetricRow) {
  return (row.cf_cache_status || (row.error ? "FAIL" : "-")).toUpperCase();
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function duration(seconds: number) {
  if (!seconds) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

function averageNumber(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function wireRoundEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-round-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.roundId);
      selectedRoundId = Number.isFinite(id) ? id : null;
      setHtml("[data-rounds-view]", renderRoundsContent());
      wireRoundEvents();
    });
  });
}

function durationFromMs(ms: number) {
  if (!ms) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return duration(Math.round(ms / 1000));
}

function compactNumber(value: number) {
  return new Intl.NumberFormat([], { maximumFractionDigits: 1, notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function compactCountdown(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(rest).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

function countdownClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function relativeTime(value: string) {
  const diff = Date.parse(value) - Date.now();
  const abs = Math.abs(Math.round(diff / 1000));
  const label = duration(abs);
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

function shortDate(value: string) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function isMissLike(status: string) {
  return ["MISS", "BYPASS", "DYNAMIC", "EXPIRED", "REVALIDATED", "STALE", "UPDATING"].includes(status);
}

loadAll()
  .then(connectLiveUpdates)
  .catch((error) => {
    app.innerHTML = `<div class="fatal">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  });
