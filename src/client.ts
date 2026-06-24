import { checkbox, emptyTableRow, escapeAttr, escapeHtml, filterOptions, icon, statCard } from "./components";

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

type MetricTimeGroup = {
  key: string;
  page: string;
  url: string;
  country: string;
  countryLabel: string;
  cells: Map<string, MetricRow>;
};

type MetricsPayload = {
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

const MATRIX_URL_COL_WIDTH = 300;
const MATRIX_COUNTRY_COL_WIDTH = 130;
const MATRIX_TIME_COL_WIDTH = 156;

type Status = {
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

type RuntimeMessage = {
  type: "runtime";
  metrics: MetricsPayload;
  status: Status;
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const app = document.querySelector<HTMLDivElement>("#app")!;

let config: Config;
let metrics: MetricsPayload;
let statusState: Status;
let proxyText = "";
let activeTab: "metrics" | "config" | "proxies" = "metrics";
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
    api<MetricsPayload>("/api/metrics"),
    api<Status>("/api/status"),
    api<{ text: string }>("/api/proxies"),
  ]);
  config = nextConfig;
  metrics = nextMetrics;
  statusState = nextStatus;
  proxyText = proxies.text;
  render();
}

async function refreshRuntime() {
  const [nextMetrics, nextStatus] = await Promise.all([api<MetricsPayload>("/api/metrics"), api<Status>("/api/status")]);
  applyRuntime(nextMetrics, nextStatus);
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
  metrics = nextMetrics;
  statusState = nextStatus;
  updateRuntimeView();
}

function topAgeRows() {
  return [...metrics.pageStats].sort((a, b) => b.maxAge - a.maxAge).slice(0, 12);
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
    </header>

    <section class="hero" data-region="hero">
      <div class="domain-line">
        <h1>${escapeHtml(targetLabel(config.pages))}</h1>
        <span class="state-dot ${statusState.busy || statusState.running ? "on" : ""}" data-status-dot aria-hidden="true"></span>
        <span class="state-text" data-status-label>${escapeHtml(runtimeStatusLabel())}</span>
      </div>
      <div class="actions" data-actions>${renderActionButtons()}</div>
    </section>

    <section class="status-strip" data-region="status-strip">
      ${renderStatusCards()}
    </section>

    <nav class="tabs">
      <button class="${activeTab === "metrics" ? "active" : ""}" data-tab="metrics">Metrics</button>
      <button class="${activeTab === "config" ? "active" : ""}" data-tab="config">Configuration</button>
      <button class="${activeTab === "proxies" ? "active" : ""}" data-tab="proxies">Proxies</button>
    </nav>

    ${activeTab === "metrics" ? renderMetrics() : ""}
    ${activeTab === "config" ? renderConfig() : ""}
    ${activeTab === "proxies" ? renderProxies() : ""}
  `;

  wireEvents();
}

function renderMetrics() {
  const samples = sampleMetricRows();
  const rows = filteredMetricRows(samples);
  const timeColumns = metricTimeColumns(rows);
  const groups = metricTimeGroups(rows, timeColumns);
  const pagination = paginationInfo(groups.length);
  const pageGroups = groups.slice(pagination.start, pagination.end);

  return `
    <section class="samples-panel">
      <div class="section-head">
        <h2><span class="section-icon" aria-hidden="true">${icon("grid")}</span>Cache Samples</h2>
        <span data-filter-count>${rows.length} of ${samples.length} fetched</span>
      </div>
      <div class="table-filters">
        <label>
          Search
          <input data-filter="query" value="${escapeAttr(metricFilters.query)}" placeholder="URL, edge, proxy, error..." />
        </label>
        <label>
          Page
          <select data-filter="page">
            <option value="">All pages</option>
            ${filterOptions(uniqueValues(samples.map((row) => row.page)), metricFilters.page)}
          </select>
        </label>
        <label>
          Country
          <select data-filter="country">
            <option value="">All countries</option>
            ${filterOptions(uniqueValues(samples.map((row) => row.proxy_country)), metricFilters.country, countryName)}
          </select>
        </label>
        <label>
          Status
          <select data-filter="status">
            <option value="">All statuses</option>
            ${filterOptions(uniqueValues(samples.map(cacheStatus)), metricFilters.status)}
          </select>
        </label>
      </div>
      <div class="table-scroll">
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

    <section class="metrics-bottom">
      <aside class="side-panel">
        <div class="section-head">
          <h2><span class="section-icon" aria-hidden="true">${icon("clock")}</span>Cache Age</h2>
          <span data-age-timestamp>${metrics.summary.lastTimestamp ? shortDate(metrics.summary.lastTimestamp) : ""}</span>
        </div>
        <div class="age-list" data-age-list>
          ${topAgeRows().map(renderAgeRow).join("")}
        </div>
      </aside>

      <section class="logs-panel">
        <div class="section-head">
          <h2>Collector Log</h2>
          <span data-log-round>round ${statusState.round}</span>
        </div>
        <pre data-log-output>${escapeHtml(statusState.logs.slice(-28).join("\n") || "No collector output yet.")}</pre>
      </section>
    </section>
  `;
}

function updateRuntimeView() {
  const statusDot = app.querySelector<HTMLElement>("[data-status-dot]");
  const statusText = app.querySelector<HTMLElement>("[data-status-label]");
  const actions = app.querySelector<HTMLElement>("[data-actions]");
  const statusStrip = app.querySelector<HTMLElement>('[data-region="status-strip"]');

  if (!statusDot || !statusText || !actions || !statusStrip) {
    const activeForm = activeTab === "config" || activeTab === "proxies";
    if (!activeForm || !formDirty) render();
    return;
  }

  statusDot.classList.toggle("on", statusState.busy || statusState.running);
  statusText.textContent = runtimeStatusLabel();
  actions.innerHTML = renderActionButtons();
  wireActionEvents();
  statusStrip.innerHTML = renderStatusCards();

  if (activeTab === "proxies" && !formDirty) {
    const used = usedProxyRows();
    setText("[data-used-proxy-count]", `${used.length} recent`);
    setHtml("[data-used-proxies]", renderUsedProxyList(used));
    return;
  }

  if (activeTab !== "metrics") return;

  updateMetricList();
  setText("[data-age-timestamp]", metrics.summary.lastTimestamp ? shortDate(metrics.summary.lastTimestamp) : "");
  setHtml("[data-age-list]", topAgeRows().map(renderAgeRow).join(""));
  setText("[data-log-round]", `round ${statusState.round}`);
  setText("[data-log-output]", statusState.logs.slice(-28).join("\n") || "No collector output yet.");
}

function runtimeStatusLabel() {
  return statusState.busy ? "Running" : statusState.running ? "Armed" : "Stopped";
}

function renderActionButtons() {
  return `
    <button class="icon-button" data-action="refresh" title="Refresh" aria-label="Refresh">${icon("refresh")}</button>
    <button class="button secondary" data-action="run-once" ${statusState.busy ? "disabled" : ""}>Run Now</button>
    ${
      statusState.running || statusState.busy
        ? '<button class="button danger" data-action="stop">Stop</button>'
        : '<button class="button primary" data-action="start">Start</button>'
    }
  `;
}

function renderStatusCards() {
  return `
    ${statCard("State", runtimeStatusLabel(), statusState.lastReason || "", "pulse")}
    ${statCard("Latest Hits", String(metrics.summary.latestHits), `${metrics.summary.latestCells} cells`, "bars")}
    ${statCard(
      "Miss / Recheck",
      String(metrics.summary.latestMissLike + metrics.summary.latestErrors),
      "latest samples",
      "shuffle",
    )}
    ${statCard("Max Cache Age", duration(metrics.summary.maxAge), "Age header", "clock")}
    ${statCard("Avg Response", `${metrics.summary.avgResponseMs || 0} ms`, "latest cells", "gauge")}
    ${statCard(
      "Next Run",
      statusState.nextRunAt ? relativeTime(statusState.nextRunAt) : "None",
      statusState.lastRunAt ? `last ${relativeTime(statusState.lastRunAt)}` : "",
      "calendar",
    )}
  `;
}

function sampleMetricRows() {
  return [...metrics.rows].reverse();
}

function filteredMetricRows(samples = sampleMetricRows()) {
  const query = metricFilters.query.trim().toLowerCase();
  return samples.filter((row) => {
    if (metricFilters.country && row.proxy_country !== metricFilters.country) return false;
    if (metricFilters.page && row.page !== metricFilters.page) return false;
    if (metricFilters.status && cacheStatus(row) !== metricFilters.status) return false;
    if (!query) return true;

    return [row.page, row.url, row.proxy_country, row.cf_edge, row.proxy, row.error, row.cf_ray]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
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
  const column = metricTimeColumn(row.timestamp_utc || "");
  if (!row.round) return column;
  const recheck = row.round.endsWith("-recheck");
  const round = recheck ? row.round.replace(/-recheck$/, "") : row.round;
  return { ...column, key: `batch-${row.round}`, label: recheck ? `Recheck ${round}` : `First ${round}` };
}

function batchTimeRange(start: number, end: number) {
  if (start === Number.MAX_SAFE_INTEGER) return "No time";
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startLabel = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endLabel = endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${startLabel} - ${endLabel} ${startDate.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function renderMetricTimeHeader(columns: MetricTimeColumn[]) {
  return `
    <tr>
      <th>URL</th>
      <th>Country</th>
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
      <th class="url-cell">
        <strong>${escapeHtml(group.page)}</strong>
        <span>${escapeHtml(group.url)}</span>
      </th>
      <td>
        <strong>${escapeHtml(group.country)}</strong>
        <span>${escapeHtml(group.countryLabel)}</span>
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
      <button class="status-pill status-button ${tone}" type="button" data-sample-toggle aria-expanded="false">
        ${escapeHtml(status)}
      </button>
      <div class="sample-details" hidden>
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

function sampleStage(row: MetricRow) {
  if (!row.round) return "Sample";
  if (row.round.endsWith("-recheck")) return `Recheck after MISS interval`;
  return "First check";
}

function renderEmptyListRow(columns: MetricTimeColumn[] = []) {
  return emptyTableRow("No samples match the current filters.", Math.max(2 + columns.length, 3));
}

function renderAgeRow(row: MetricsPayload["pageStats"][number]) {
  const max = Math.max(metrics.summary.maxAge, 1);
  const width = Math.max(2, Math.round((row.maxAge / max) * 100));
  const hitRatio = row.total ? Math.round((row.hitCount / row.total) * 100) : 0;
  return `
    <div class="age-row">
      <div>
        <strong>${escapeHtml(row.page)}</strong>
        <span>${duration(row.maxAge)} &middot; ${hitRatio}% HIT</span>
      </div>
      <div class="bar"><i style="width:${width}%"></i></div>
    </div>
  `;
}

function renderConfig() {
  return `
    <form class="form-panel config-panel" data-form="config">
      <div class="section-head">
        <h2><span class="section-icon" aria-hidden="true">${icon("settings")}</span>Configuration</h2>
        <span>${config.pages.length} URLs</span>
      </div>

      <div class="config-body">
        <section class="form-section target-section">
          <div class="form-section-title">
            <span class="section-icon" aria-hidden="true">${icon("link")}</span>
            <h3>Target</h3>
          </div>
          <div class="config-grid two">
            <label>SQLite DB<input name="output" value="${escapeAttr(config.output)}" /></label>
          </div>
          <label>URLs<textarea name="pages" rows="12">${escapeHtml(config.pages.join("\n"))}</textarea></label>
        </section>

        <section class="form-section">
          <div class="form-section-title">
            <span class="section-icon" aria-hidden="true">${icon("timer")}</span>
            <h3>Runtime</h3>
          </div>
          <div class="config-grid compact">
            <label>Max Proxies / Country<input name="maxProxiesPerCountry" type="number" min="1" max="100" value="${config.maxProxiesPerCountry}" /></label>
            <label>Timeout Seconds<input name="timeout" type="number" min="1" max="60" value="${config.timeout}" /></label>
            <label>Delay Seconds<input name="delay" type="number" min="0" max="60" value="${config.delay}" /></label>
            <label>HIT Interval<input name="hitIntervalSeconds" type="number" min="15" value="${config.hitIntervalSeconds}" /></label>
            <label>MISS Interval<input name="missIntervalSeconds" type="number" min="15" value="${config.missIntervalSeconds}" /></label>
          </div>
        </section>

        <section class="form-section">
          <div class="form-section-title">
            <span class="section-icon" aria-hidden="true">${icon("user")}</span>
            <h3>Request Profile</h3>
          </div>
          <div class="config-grid two">
            <label>Proxy Countries<input name="proxyCountries" value="${escapeAttr(config.proxyCountries)}" /></label>
            <label>User Agent<input name="userAgent" value="${escapeAttr(config.userAgent)}" /></label>
          </div>
        </section>

        <section class="form-section source-section">
          <div class="form-section-title">
            <span class="section-icon" aria-hidden="true">${icon("shuffle")}</span>
            <h3>Sources</h3>
          </div>
          <div class="switches">
            ${checkbox("shuffleProxies", "Shuffle proxies", config.shuffleProxies)}
            ${checkbox("noDirect", "Disable direct request", config.noDirect)}
            ${checkbox("noProxySource", "Disable Proxifly source", config.noProxySource)}
            ${checkbox("noClarketmSource", "Disable clarketm source", config.noClarketmSource)}
          </div>
        </section>
      </div>

      <div class="form-actions">
        <button class="button primary icon-text" type="submit">${icon("save")}<span>Save Configuration</span></button>
      </div>
    </form>
  `;
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
      updateMetricList();
    };
    input.addEventListener("input", updateFilter);
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
  wireMetricStatusEvents();
  wirePaginationEvents();
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
  const next: Config = {
    ...config,
    pages: String(data.get("pages") || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    output: String(data.get("output") || ""),
    proxyCountries: String(data.get("proxyCountries") || ""),
    maxProxiesPerCountry: Number(data.get("maxProxiesPerCountry")),
    timeout: Number(data.get("timeout")),
    delay: Number(data.get("delay")),
    hitIntervalSeconds: Number(data.get("hitIntervalSeconds")),
    missIntervalSeconds: Number(data.get("missIntervalSeconds")),
    userAgent: String(data.get("userAgent") || ""),
    shuffleProxies: data.has("shuffleProxies"),
    noDirect: data.has("noDirect"),
    noProxySource: data.has("noProxySource"),
    noClarketmSource: data.has("noClarketmSource"),
  };
  await api<Config>("/api/config", { method: "PUT", body: JSON.stringify(next) });
  formDirty = false;
  await loadAll();
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
  const samples = sampleMetricRows();
  const rows = filteredMetricRows(samples);
  const timeColumns = metricTimeColumns(rows);
  const groups = metricTimeGroups(rows, timeColumns);
  const pagination = paginationInfo(groups.length);
  const pageGroups = groups.slice(pagination.start, pagination.end);
  const count = app.querySelector<HTMLElement>("[data-filter-count]");
  const table = app.querySelector<HTMLTableElement>("[data-metric-table]");
  const colgroup = app.querySelector<HTMLTableColElement>("[data-filter-cols]");
  const head = app.querySelector<HTMLTableSectionElement>("[data-filter-head]");
  const body = app.querySelector<HTMLTableSectionElement>("[data-filter-body]");
  const paginationEl = app.querySelector<HTMLElement>("[data-pagination]");
  if (count) count.textContent = `${rows.length} of ${samples.length} fetched`;
  if (table) table.setAttribute("style", metricMatrixStyle(timeColumns));
  if (colgroup) colgroup.innerHTML = renderMetricCols(timeColumns);
  if (head) head.innerHTML = renderMetricTimeHeader(timeColumns);
  if (body) {
    body.innerHTML = groups.length
      ? pageGroups.map((group) => renderMetricMatrixRow(group, timeColumns)).join("")
      : renderEmptyListRow(timeColumns);
  }
  if (paginationEl) paginationEl.innerHTML = renderPaginationControls(pagination);
  wireMetricStatusEvents();
  wirePaginationEvents();
}

function wirePaginationEvents() {
  app.querySelector<HTMLSelectElement>("[data-pagination-size]")?.addEventListener("change", (event) => {
    metricPagination = {
      page: 1,
      pageSize: Number((event.currentTarget as HTMLSelectElement).value) || metricPagination.pageSize,
    };
    updateMetricList();
    scrollMetricTableToTop();
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

function wireMetricStatusEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-sample-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const cell = button.closest<HTMLElement>(".status-cell");
      const details = cell?.querySelector<HTMLElement>(".sample-details");
      if (!cell || !details) return;

      const willOpen = details.hidden === true;
      app.querySelectorAll<HTMLElement>(".sample-details").forEach((panel) => {
        panel.hidden = true;
        panel.closest(".status-cell")?.classList.remove("detail-open");
        panel.parentElement?.querySelector<HTMLButtonElement>("[data-sample-toggle]")?.setAttribute("aria-expanded", "false");
      });

      details.hidden = !willOpen;
      cell.classList.toggle("detail-open", willOpen);
      button.setAttribute("aria-expanded", String(willOpen));
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
    <label class="page-size-control">
      Rows
      <select data-pagination-size>
        ${PAGE_SIZE_OPTIONS.map(
          (size) => `<option value="${size}" ${pagination.pageSize === size ? "selected" : ""}>${size}</option>`,
        ).join("")}
      </select>
    </label>
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

function targetLabel(values: string[]) {
  const hosts = uniqueValues(values.map(hostLabel).filter(Boolean));
  if (!hosts.length) return "Targets";
  if (hosts.length === 1) return hosts[0];
  return `${hosts.length} hosts`;
}

function hostLabel(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
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
