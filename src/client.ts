type Config = {
  baseUrl: string;
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
  rows: MetricRow[];
};

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

type IconName =
  | "bars"
  | "calendar"
  | "chevronLeft"
  | "chevronRight"
  | "clock"
  | "cloud"
  | "gauge"
  | "grid"
  | "link"
  | "pulse"
  | "refresh"
  | "save"
  | "settings"
  | "shuffle"
  | "timer"
  | "user";

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
        <h1>${escapeHtml(hostLabel(config.baseUrl))}</h1>
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
  const rows = filteredMetricRows();
  const pagination = paginationInfo(rows.length);
  const pageRows = rows.slice(pagination.start, pagination.end);

  return `
    <section class="samples-panel">
      <div class="section-head">
        <h2><span class="section-icon" aria-hidden="true">${icon("grid")}</span>Cache Samples</h2>
        <span data-filter-count>${rows.length} of ${metrics.latestRows.length} latest</span>
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
            ${filterOptions(uniqueValues(metrics.latestRows.map((row) => row.page)), metricFilters.page)}
          </select>
        </label>
        <label>
          Country
          <select data-filter="country">
            <option value="">All countries</option>
            ${filterOptions(uniqueValues(metrics.latestRows.map((row) => row.proxy_country)), metricFilters.country, countryName)}
          </select>
        </label>
        <label>
          Status
          <select data-filter="status">
            <option value="">All statuses</option>
            ${filterOptions(uniqueValues(metrics.latestRows.map(cacheStatus)), metricFilters.status)}
          </select>
        </label>
      </div>
      <div class="table-scroll">
        <table class="sample-table">
          <thead>
            <tr>
              <th>URL</th>
              <th>Country</th>
              <th>Status</th>
              <th>Age</th>
              <th>Edge</th>
              <th>Response</th>
              <th>HTTP</th>
              <th>Checked</th>
            </tr>
          </thead>
          <tbody data-filter-body>
            ${rows.length ? pageRows.map(renderMetricListRow).join("") : renderEmptyListRow()}
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
          ${metrics.pageStats
            .sort((a, b) => b.maxAge - a.maxAge)
            .slice(0, 12)
            .map(renderAgeRow)
            .join("")}
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
  const statusLabel = runtimeStatusLabel();
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
  statusText.textContent = statusLabel;
  actions.innerHTML = renderActionButtons();
  wireActionEvents();
  statusStrip.innerHTML = renderStatusCards();

  if (activeTab === "proxies" && !formDirty) {
    const used = usedProxyRows();
    const usedCount = app.querySelector<HTMLElement>("[data-used-proxy-count]");
    const usedList = app.querySelector<HTMLElement>("[data-used-proxies]");
    if (usedCount) usedCount.textContent = `${used.length} recent`;
    if (usedList) usedList.innerHTML = renderUsedProxyList(used);
    return;
  }

  if (activeTab !== "metrics") return;

  updateMetricList();

  const ageTimestamp = app.querySelector<HTMLElement>("[data-age-timestamp]");
  const ageList = app.querySelector<HTMLElement>("[data-age-list]");
  const logRound = app.querySelector<HTMLElement>("[data-log-round]");
  const logOutput = app.querySelector<HTMLElement>("[data-log-output]");

  if (ageTimestamp) ageTimestamp.textContent = metrics.summary.lastTimestamp ? shortDate(metrics.summary.lastTimestamp) : "";
  if (ageList) {
    ageList.innerHTML = metrics.pageStats
      .sort((a, b) => b.maxAge - a.maxAge)
      .slice(0, 12)
      .map(renderAgeRow)
      .join("");
  }
  if (logRound) logRound.textContent = `round ${statusState.round}`;
  if (logOutput) logOutput.textContent = statusState.logs.slice(-28).join("\n") || "No collector output yet.";
}

function runtimeStatusLabel() {
  return statusState.busy ? "Running" : statusState.running ? "Armed" : "Stopped";
}

function renderActionButtons() {
  return `
    <button class="icon-button" data-action="refresh" title="Refresh" aria-label="Refresh">${icon("refresh")}</button>
    <button class="button secondary" data-action="run-once" ${statusState.busy ? "disabled" : ""}>Run Now</button>
    ${
      statusState.running
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

function filteredMetricRows() {
  const query = metricFilters.query.trim().toLowerCase();
  return metrics.latestRows.filter((row) => {
    if (metricFilters.country && row.proxy_country !== metricFilters.country) return false;
    if (metricFilters.page && row.page !== metricFilters.page) return false;
    if (metricFilters.status && cacheStatus(row) !== metricFilters.status) return false;
    if (!query) return true;

    return [row.page, row.url, row.proxy_country, row.cf_edge, row.proxy, row.error, row.cf_ray]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderMetricListRow(row: MetricRow) {
  const status = cacheStatus(row);
  const tone = row.error ? "fail" : status === "HIT" ? "hit" : isMissLike(status) ? "miss" : "other";
  const response = row.response_ms ? `${row.response_ms} ms` : "-";
  const age = Number(row.age_seconds) || 0;
  const title = row.error || row.cf_ray || row.proxy || "";

  return `
    <tr title="${escapeAttr(title)}">
      <th class="url-cell">
        <strong>${escapeHtml(row.page || "-")}</strong>
        <span>${escapeHtml(row.url || "-")}</span>
      </th>
      <td>
        <strong>${escapeHtml(row.proxy_country || "-")}</strong>
        <span>${escapeHtml(countryName(row.proxy_country || "-"))}</span>
      </td>
      <td><strong class="status-pill ${tone}">${escapeHtml(status)}</strong></td>
      <td>${duration(age)}</td>
      <td>${escapeHtml(row.cf_edge || "-")}</td>
      <td>${escapeHtml(response)}</td>
      <td>${escapeHtml(row.status_code || "-")}</td>
      <td>${row.timestamp_utc ? shortDate(row.timestamp_utc) : "-"}</td>
    </tr>
  `;
}

function renderEmptyListRow() {
  return `
    <tr>
      <td class="empty-row" colspan="8">No samples match the current filters.</td>
    </tr>
  `;
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
        <span>${config.pages.length} pages</span>
      </div>

      <div class="config-body">
        <section class="form-section target-section">
          <div class="form-section-title">
            <span class="section-icon" aria-hidden="true">${icon("link")}</span>
            <h3>Target</h3>
          </div>
          <div class="config-grid two">
            <label>Base URL<input name="baseUrl" value="${escapeAttr(config.baseUrl)}" /></label>
            <label>CSV Output<input name="output" value="${escapeAttr(config.output)}" /></label>
          </div>
          <label>Pages<textarea name="pages" rows="12">${escapeHtml(config.pages.join("\n"))}</textarea></label>
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

function statCard(label: string, value: string, meta: string, iconName: IconName) {
  return `
    <article class="stat">
      <span class="stat-icon" aria-hidden="true">${icon(iconName)}</span>
      <div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(meta)}</small>
      </div>
    </article>
  `;
}

function checkbox(name: keyof Config, label: string, checked: boolean) {
  return `
    <label class="check">
      <input name="${name}" type="checkbox" ${checked ? "checked" : ""} />
      <span>${label}</span>
    </label>
  `;
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
  wirePaginationEvents();
}

function wireActionEvents() {
  app.querySelector('[data-action="refresh"]')?.addEventListener("click", () => loadAll());
  app.querySelector('[data-action="start"]')?.addEventListener("click", () => postAction("/api/monitor/start"));
  app.querySelector('[data-action="stop"]')?.addEventListener("click", () => postAction("/api/monitor/stop"));
  app.querySelector('[data-action="run-once"]')?.addEventListener("click", () => postAction("/api/monitor/run-once"));
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
    baseUrl: String(data.get("baseUrl") || ""),
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
  const rows = filteredMetricRows();
  const pagination = paginationInfo(rows.length);
  const pageRows = rows.slice(pagination.start, pagination.end);
  const count = app.querySelector<HTMLElement>("[data-filter-count]");
  const body = app.querySelector<HTMLTableSectionElement>("[data-filter-body]");
  const paginationEl = app.querySelector<HTMLElement>("[data-pagination]");
  if (count) count.textContent = `${rows.length} of ${metrics.latestRows.length} latest`;
  if (body) body.innerHTML = rows.length ? pageRows.map(renderMetricListRow).join("") : renderEmptyListRow();
  if (paginationEl) paginationEl.innerHTML = renderPaginationControls(pagination);
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

function hostLabel(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function icon(name: IconName) {
  const paths: Record<IconName, string> = {
    bars: '<path d="M5 19V11"/><path d="M12 19V5"/><path d="M19 19V8"/>',
    calendar:
      '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M4 10h16"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.4 4.8 4.8 0 0 0 7 18Z"/>',
    gauge: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="m12 15 4-5"/><path d="M12 15h.01"/>',
    grid:
      '<rect x="4" y="4" width="5" height="5" rx="1"/><rect x="15" y="4" width="5" height="5" rx="1"/><rect x="4" y="15" width="5" height="5" rx="1"/><rect x="15" y="15" width="5" height="5" rx="1"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.3"/><path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8"/>',
    pulse: '<path d="M4 13h4l2-7 4 14 2-7h4"/>',
    refresh:
      '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a6 6 0 0 0-10-3.5L4 9"/><path d="M6 15a6 6 0 0 0 10 3.5l4-3.5"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    settings:
      '<path d="M12.2 2h-.4l-.7 2.6a7.5 7.5 0 0 0-1.7.7L7 4 4 7l1.3 2.4a7.5 7.5 0 0 0-.7 1.7L2 11.8v.4l2.6.7c.2.6.4 1.2.7 1.7L4 17l3 3 2.4-1.3c.5.3 1.1.5 1.7.7l.7 2.6h.4l.7-2.6c.6-.2 1.2-.4 1.7-.7L17 20l3-3-1.3-2.4c.3-.5.5-1.1.7-1.7l2.6-.7v-.4l-2.6-.7a7.5 7.5 0 0 0-.7-1.7L20 7l-3-3-2.4 1.3a7.5 7.5 0 0 0-1.7-.7L12.2 2Z"/><circle cx="12" cy="12" r="3"/>',
    shuffle:
      '<path d="M4 7h3c4 0 5 10 9 10h4"/><path d="M16 13l4 4-4 4"/><path d="M4 17h3c1.8 0 3-1.8 4.1-3.8"/><path d="M16 3l4 4-4 4"/><path d="M14 7h6"/>',
    timer: '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
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

function filterOptions(values: string[], selected: string, label = (value: string) => value) {
  return values
    .map((value) => {
      const text = label(value);
      const suffix = text === value ? "" : ` - ${text}`;
      return `<option value="${escapeAttr(value)}" ${selected === value ? "selected" : ""}>${escapeHtml(value + suffix)}</option>`;
    })
    .join("");
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

loadAll()
  .then(connectLiveUpdates)
  .catch((error) => {
    app.innerHTML = `<div class="fatal">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
  });
