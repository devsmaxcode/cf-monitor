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

type MetricsPayload = {
  countries: string[];
  matrix: { page: string; cells: (MetricRow | null)[] }[];
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

type IconName = "bars" | "calendar" | "clock" | "cloud" | "gauge" | "grid" | "pulse" | "refresh" | "shuffle";

const app = document.querySelector<HTMLDivElement>("#app")!;

let config: Config;
let metrics: MetricsPayload;
let statusState: Status;
let proxyText = "";
let activeTab: "metrics" | "config" | "proxies" = "metrics";
let formDirty = false;

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
  metrics = nextMetrics;
  statusState = nextStatus;
  render();
}

function render() {
  const statusLabel = statusState.busy ? "Running" : statusState.running ? "Armed" : "Stopped";

  app.innerHTML = `
    <header class="appbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">${icon("cloud")}</span>
        <span>Cloudflare Cache Monitor</span>
      </div>
    </header>

    <section class="hero">
      <div class="domain-line">
        <h1>${escapeHtml(hostLabel(config.baseUrl))}</h1>
        <span class="state-dot ${statusState.busy || statusState.running ? "on" : ""}" aria-hidden="true"></span>
        <span class="state-text">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="actions">
        <button class="icon-button" data-action="refresh" title="Refresh" aria-label="Refresh">${icon("refresh")}</button>
        <button class="button secondary" data-action="run-once" ${statusState.busy ? "disabled" : ""}>Run Now</button>
        ${
          statusState.running
            ? '<button class="button danger" data-action="stop">Stop</button>'
            : '<button class="button primary" data-action="start">Start</button>'
        }
      </div>
    </section>

    <section class="status-strip">
      ${statCard("State", statusLabel, statusState.lastReason || "", "pulse")}
      ${statCard("Latest Hits", String(metrics.summary.latestHits), `${metrics.summary.latestCells} cells`, "bars")}
      ${statCard(
        "Miss / Recheck",
        String(metrics.summary.latestMissLike + metrics.summary.latestErrors),
        "latest matrix",
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
  return `
    <section class="workspace">
      <div class="matrix-panel">
        <div class="section-head">
          <h2><span class="section-icon" aria-hidden="true">${icon("grid")}</span>Cache Matrix</h2>
          <span>${metrics.summary.totalRows} samples</span>
        </div>
        <div class="matrix-scroll">
          <table class="matrix">
            <thead>
              <tr>
                <th>URL</th>
                ${metrics.countries
                  .map(
                    (country) => `
                      <th>
                        <span class="country-code">${escapeHtml(country)}</span>
                        <small>${escapeHtml(countryName(country))}</small>
                      </th>
                    `,
                  )
                  .join("")}
              </tr>
            </thead>
            <tbody>
              ${metrics.matrix.map(renderMatrixRow).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <aside class="side-panel">
        <div class="section-head">
          <h2><span class="section-icon" aria-hidden="true">${icon("clock")}</span>Cache Age</h2>
          <span>${metrics.summary.lastTimestamp ? shortDate(metrics.summary.lastTimestamp) : ""}</span>
        </div>
        <div class="age-list">
          ${metrics.pageStats
            .sort((a, b) => b.maxAge - a.maxAge)
            .slice(0, 12)
            .map(renderAgeRow)
            .join("")}
        </div>
      </aside>
    </section>

    <section class="logs-panel">
      <div class="section-head">
        <h2>Collector Log</h2>
        <span>round ${statusState.round}</span>
      </div>
      <pre>${escapeHtml(statusState.logs.slice(-28).join("\n") || "No collector output yet.")}</pre>
    </section>
  `;
}

function renderMatrixRow(row: { page: string; cells: (MetricRow | null)[] }) {
  return `
    <tr>
      <th class="page-cell">${escapeHtml(row.page)}</th>
      ${row.cells.map(renderMatrixCell).join("")}
    </tr>
  `;
}

function renderMatrixCell(row: MetricRow | null) {
  if (!row) return '<td><span class="empty">-</span></td>';

  const status = (row.cf_cache_status || (row.error ? "FAIL" : "-")).toUpperCase();
  const tone = row.error ? "fail" : status === "HIT" ? "hit" : isMissLike(status) ? "miss" : "other";
  const age = Number(row.age_seconds) || 0;
  const title = [
    row.url,
    `Status: ${status}`,
    `Age: ${duration(age)}`,
    `Edge: ${row.cf_edge || "-"}`,
    `Response: ${row.response_ms || "-"} ms`,
    row.error ? `Error: ${row.error}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `
    <td title="${escapeAttr(title)}">
      <div class="cache-cell ${tone}">
        <div class="cell-top">
          <strong class="status-pill">${escapeHtml(status)}</strong>
          <span>${duration(age)}</span>
        </div>
        <small>${escapeHtml(row.cf_edge || "-")} &middot; ${escapeHtml(row.response_ms || "-")}ms</small>
      </div>
    </td>
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
    <form class="form-panel" data-form="config">
      <label>Base URL<input name="baseUrl" value="${escapeAttr(config.baseUrl)}" /></label>
      <label>Pages<textarea name="pages" rows="12">${escapeHtml(config.pages.join("\n"))}</textarea></label>
      <label>CSV Output<input name="output" value="${escapeAttr(config.output)}" /></label>
      <label>Proxy Countries<input name="proxyCountries" value="${escapeAttr(config.proxyCountries)}" /></label>

      <div class="field-grid">
        <label>Max Proxies / Country<input name="maxProxiesPerCountry" type="number" min="1" max="100" value="${config.maxProxiesPerCountry}" /></label>
        <label>Timeout Seconds<input name="timeout" type="number" min="1" max="60" value="${config.timeout}" /></label>
        <label>Delay Seconds<input name="delay" type="number" min="0" max="60" value="${config.delay}" /></label>
        <label>HIT Interval<input name="hitIntervalSeconds" type="number" min="15" value="${config.hitIntervalSeconds}" /></label>
        <label>MISS Interval<input name="missIntervalSeconds" type="number" min="15" value="${config.missIntervalSeconds}" /></label>
      </div>

      <label>User Agent<input name="userAgent" value="${escapeAttr(config.userAgent)}" /></label>

      <div class="switches">
        ${checkbox("shuffleProxies", "Shuffle proxies", config.shuffleProxies)}
        ${checkbox("noDirect", "Disable direct request", config.noDirect)}
        ${checkbox("noProxySource", "Disable Proxifly source", config.noProxySource)}
        ${checkbox("noClarketmSource", "Disable clarketm source", config.noClarketmSource)}
      </div>

      <div class="form-actions">
        <button class="button primary" type="submit">Save Configuration</button>
      </div>
    </form>
  `;
}

function renderProxies() {
  const count = proxyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")).length;

  return `
    <form class="form-panel" data-form="proxies">
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
  app.querySelector('[data-action="refresh"]')?.addEventListener("click", () => loadAll());
  app.querySelector('[data-action="start"]')?.addEventListener("click", () => postAction("/api/monitor/start"));
  app.querySelector('[data-action="stop"]')?.addEventListener("click", () => postAction("/api/monitor/stop"));
  app.querySelector('[data-action="run-once"]')?.addEventListener("click", () => postAction("/api/monitor/run-once"));

  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab as typeof activeTab;
      formDirty = false;
      render();
    });
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
}

async function postAction(path: string) {
  await api(path, { method: "POST", body: "{}" });
  await loadAll();
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
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.4 4.8 4.8 0 0 0 7 18Z"/>',
    gauge: '<path d="M4 15a8 8 0 1 1 16 0"/><path d="m12 15 4-5"/><path d="M12 15h.01"/>',
    grid:
      '<rect x="4" y="4" width="5" height="5" rx="1"/><rect x="15" y="4" width="5" height="5" rx="1"/><rect x="4" y="15" width="5" height="5" rx="1"/><rect x="15" y="15" width="5" height="5" rx="1"/>',
    pulse: '<path d="M4 13h4l2-7 4 14 2-7h4"/>',
    refresh:
      '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a6 6 0 0 0-10-3.5L4 9"/><path d="M6 15a6 6 0 0 0 10 3.5l4-3.5"/>',
    shuffle:
      '<path d="M4 7h3c4 0 5 10 9 10h4"/><path d="M16 13l4 4-4 4"/><path d="M4 17h3c1.8 0 3-1.8 4.1-3.8"/><path d="M16 3l4 4-4 4"/><path d="M14 7h6"/>',
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
    SG: "Singapore",
    UK: "United Kingdom",
    US: "United States",
    direct: "Direct",
  };
  return names[code] || code;
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

loadAll().catch((error) => {
  app.innerHTML = `<div class="fatal">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
});

setInterval(() => {
  const activeForm = activeTab === "config" || activeTab === "proxies";
  if (activeForm && formDirty) return;
  const refresh = activeForm ? refreshRuntime : loadAll;
  refresh().catch(console.error);
}, 5000);
