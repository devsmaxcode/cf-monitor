# ☁️ Cloudflare Cache Monitor - Requirements & Implementation Plan

তারিখ: 2026-06-24, 11.15 am  
নোট: আপনার instruction অনুযায়ী কোনো existing file modify করা হয়নি। এই ডকুমেন্টটি শুধু planning/output file হিসেবে নতুন করে তৈরি করা হয়েছে। ✅

---

## ✅ Detailed Requirements - সহজ ভাষায়

### 📄 Metrics Dashboard

- **Cache Matrix container full width করতে হবে** 📊
  - এখন Matrix অংশটা স্ক্রিনের পুরো জায়গা ব্যবহার করছে না।
  - Desktop screen-এ Matrix table যেন বেশি জায়গা পায়, তাই container full-width layout-এ নিতে হবে।
  - Table বেশি country/page দেখালে horizontal scroll থাকতে পারে, কিন্তু overall panel চাপা লাগা যাবে না।

- **Cache Age এবং Collector Logs এক row-তে রাখতে হবে** 🧱
  - Bottom section-এ Cache Age আর Collector Logs এখন আলাদা/অগোছালো দেখাচ্ছে।
  - এই দুই component নিচের দিকে পাশাপাশি দুই column-এ বসাতে হবে।
  - দুইটি component মিলিয়ে screen-এর full width ব্যবহার করবে।
  - Desktop-এ side-by-side, ছোট screen-এ stacked layout রাখা যাবে।

- **Cache Matrix table data আরও readable ও meaningful করতে হবে** 👀
  - Table cell-এর text এখন ইউজারের জন্য সহজে বোঝা যাচ্ছে না।
  - Cloudflare cache status যেমন HIT, MISS, BYPASS, EXPIRED, REVALIDATED এগুলো স্পষ্টভাবে highlight করতে হবে।
  - Cache কতক্ষণ ধরে আছে, কোন country/edge থেকে response এসেছে, response time কত, এগুলো পরিষ্কারভাবে দেখাতে হবে।
  - important value যেমন Cache Age, Status, Response Time, Edge Location visually আলাদা করে দেখাতে হবে।
  - User যেন এক নজরে বুঝতে পারে কোন page/cache ভালো আছে আর কোথায় issue আছে।

- **Start/Stop button real-time sync করতে হবে** 🔄
  - Header-এর Start/Stop button মাঝে মাঝে server state-এর সাথে sync থাকে না।
  - Server running/busy/stopped state frontend-এ real-time আসতে হবে।
  - Button disabled/enabled state server-এর actual state অনুযায়ী update হবে।
  - Polling-এর উপর নির্ভর না করে WebSocket দিয়ে live status, logs, metrics update করতে হবে।

---

### ⚙️ Configuration Module

- **Configuration save/update ঠিকভাবে effect করতে হবে** 💾
  - Config page-এ setting change করলে সেটা monitor run-এ সত্যি সত্যি use হচ্ছে কিনা নিশ্চিত করতে হবে।
  - Save করার পর user feedback দেখাতে হবে, যেমন Saved, Error, Unsaved changes।
  - Save-এর পর dashboard metrics/config আবার refresh হয়ে latest value দেখাবে।
  - Monitor already running থাকলে config change কখন apply হবে সেটা clear করতে হবে।

- **Configuration page UX সহজ করতে হবে** 🧭
  - সব fields একসাথে বড় form হিসেবে না রেখে logical groups করতে হবে।
  - Base URL, Pages, Proxy Settings, Timing, Advanced Options আলাদা section করা যেতে পারে।
  - Field labels, helper text, validation message সহজ রাখতে হবে।
  - User যেন ভুল value দিলে বুঝতে পারে কোন field ঠিক করতে হবে।

---

### 🌐 Proxies Module

- **Local Proxies page-এ meaningful real-time list/metrics দেখাতে হবে** 🌍
  - এখন proxy box খালি বা raw textarea-এর মতো দেখায়, এতে value কম।
  - কোন proxy ব্যবহার হচ্ছে, কোন country-এর জন্য ব্যবহার হচ্ছে, কতগুলো active proxy আছে তা দেখাতে হবে।
  - Local proxy, fetched proxy, direct request আলাদা করে দেখানো ভালো হবে।
  - Country-wise proxy count, last used proxy, success/fail result, response time দেখালে user বেশি value পাবে।
  - Proxy list editable থাকবে, কিন্তু তার পাশাপাশি readable metrics view থাকবে।

---

## 🧩 Suggested / Missing Requirements - aligned with your feature list

- **Live connection indicator দরকার** 🟢
  - WebSocket connected/disconnected/reconnecting status ছোট indicator হিসেবে header-এ দেখানো দরকার।
  - এতে user বুঝবে dashboard live আছে নাকি stale data দেখাচ্ছে।

- **Button click feedback দরকার** ✨
  - Start/Stop/Run Now click করলে button loading state দেখাবে।
  - Double click বা repeated request prevent করতে button temporary disable থাকবে।

- **Toast বা inline message দরকার** 📣
  - Config save success/fail, proxy save success/fail, monitor start/stop result user-কে জানাতে হবে।

- **Unsaved changes warning দরকার** ⚠️
  - Configuration বা Proxies page-এ edit করে tab change/refresh করলে warning বা visual dirty state থাকা ভালো।

- **Cache status legend দরকার** 🏷️
  - HIT green, MISS/BYPASS/EXPIRED amber, FAIL red, OTHER blue - এই meaning user যেন সহজে বুঝতে পারে।

- **Matrix filtering/search দরকার** 🔎
  - অনেক page/country থাকলে page search, status filter, country filter দরকার হতে পারে।
  - এটা first version-এ optional, কিন্তু current readability issue-এর সাথে aligned।

- **Proxy source visibility দরকার** 🧭
  - proxy কোথা থেকে এসেছে: Local, Proxifly, clarketm, Direct - এটা দেখালে Proxies module বেশি meaningful হবে।

- **Last updated timestamp দরকার** 🕒
  - Metrics, Proxy list, Config save - প্রতিটি জায়গায় last updated time দেখানো ভালো।

- **Error details collapsible রাখা দরকার** 🧯
  - Collector logs পুরোটা সবসময় না দেখিয়ে latest summary + expandable full logs দিলে dashboard cleaner হবে।

---

## 🛠️ Detailed Implementation Plan - সহজ ভাষায় Non-Technical

### 1. Metrics Dashboard layout ঠিক করা 📐

- Cache Matrix অংশটাকে dashboard-এর main full-width section বানানো হবে।
- Matrix-এর নিচে Cache Age এবং Collector Logs পাশাপাশি দুই column-এ রাখা হবে।
- Desktop screen-এ layout wide হবে, mobile/tablet screen-এ সুন্দরভাবে নিচে নিচে stack হবে।
- Long table হলে table-এর ভেতরে scroll থাকবে, পুরো page ভেঙে যাবে না।

### 2. Matrix table readable করা 👓

- প্রতিটি cell-এ cache status বড় ও color-coded badge হিসেবে দেখানো হবে।
- Cache age, response time, edge code আলাদা ছোট line-এ দেখানো হবে।
- HIT/MISS/FAIL status color দিয়ে আলাদা করা হবে।
- Page column sticky থাকবে, country header sticky থাকবে, যাতে scroll করলেও context হারিয়ে না যায়।
- Empty data থাকলে blank না রেখে clean empty state দেখানো হবে।

### 3. Cache Age + Collector Logs bottom row বানানো 🧱

- Cache Age card left column-এ থাকবে।
- Collector Logs card right column-এ থাকবে।
- দুই card-এর height এবং spacing balanced করা হবে।
- Logs panel readable dark terminal style রাখা যায়, কিন্তু header ও summary clear হবে।

### 4. Start/Stop real-time করা 🔌

- Server থেকে frontend-এ live update পাঠানোর জন্য WebSocket connection যোগ করা হবে।
- Monitor start, stop, run progress, logs, next run time এগুলো live update হবে।
- Button state server state অনুযায়ী instant update হবে।
- Connection disconnect হলে dashboard user-কে জানাবে এবং reconnect করার চেষ্টা করবে।

### 5. Configuration page সহজ করা ⚙️

- Form fields group করে সাজানো হবে: Website, Pages, Proxy, Timing, Advanced।
- Save করার সময় loading state থাকবে।
- Save success/fail message দেখানো হবে।
- Invalid input হলে user-friendly message দেখানো হবে।
- Save করার পর config data reload করে নিশ্চিত করা হবে যে value apply হয়েছে।

### 6. Proxies page valuable করা 🌐

- Raw proxy editor-এর পাশাপাশি proxy summary dashboard থাকবে।
- Country-wise proxy count দেখানো হবে।
- Local proxies count, active proxies count, direct mode status দেখানো হবে।
- Recent metrics থেকে কোন country/proxy ব্যবহার হয়েছে তা list আকারে দেখানো হবে।
- Proxy save করলে live refresh হবে।

---

## 🧑‍💻 Detailed Implementation Plan - Technical

### 1. Current app structure বুঝে কাজের জায়গা

- Backend entry: `src/server.ts`
- Frontend entry: `src/client.ts`
- Styling: `src/styles.css`
- Static shell: `public/index.html`
- Runtime config: `storage/dashboard-config.json`
- Local proxy file: `storage/proxies.txt`
- Collector script: `scripts/cloudflare_cache_monitor_bun.ts`
- Metrics CSV output currently configured as `scripts/storage/cloudflare-cache-metrics.csv`

### 2. Metrics layout technical changes

- `renderMetrics()` restructure করতে হবে।
- Current `.workspace` grid থেকে Matrix panel-কে standalone full-width section বানাতে হবে।
- Bottom area-এর জন্য নতুন wrapper যেমন `.bottom-grid` বা `.metrics-bottom` যোগ করতে হবে।
- Cache Age এবং Collector Logs একই wrapper-এর দুই column হবে।
- CSS idea:
  - `.matrix-panel { width: 100%; }`
  - `.metrics-bottom { display: grid; grid-template-columns: minmax(320px, 0.8fr) minmax(420px, 1.2fr); gap: 18px; }`
  - `@media (max-width: 1024px) { .metrics-bottom { grid-template-columns: 1fr; } }`

### 3. Matrix data readability technical changes

- `renderMatrixCell()` update করতে হবে।
- Current status/age/edge/response display আরও structured করা হবে।
- Add derived labels:
  - status tone: `hit`, `miss`, `fail`, `other`, `empty`
  - cache decision text: HIT = "Cached", MISS/BYPASS/EXPIRED = "Recheck needed", FAIL = "Request failed"
  - age label: `duration(age_seconds)`
  - response label: `${response_ms} ms`
- Add optional status legend above table.
- Use CSS classes for visual emphasis:
  - `.status-pill.hit`
  - `.status-pill.miss`
  - `.metric-chip`
  - `.cell-meta`
- Keep table header sticky and first page column sticky.
- Consider adding compact row height to prevent table becoming too tall.

### 4. WebSocket technical changes

- In `src/server.ts`, add WebSocket support in `Bun.serve`.
- Maintain connected clients set.
- Add helper:
  - `broadcast(type, payload)`
  - `snapshot()` returning `{ config, metrics, status, proxiesSummary }`
- Broadcast after:
  - `pushLog()`
  - `startMonitor()`
  - `stopMonitor()`
  - `runMonitorRound()` start/finish/error
  - `saveConfig()`
  - proxy update
  - `scheduleNext()`
- Frontend `src/client.ts`:
  - Add `connectSocket()`
  - On message type `snapshot/status/metrics/logs/config/proxies`, update local state and `render()`
  - Add reconnect with short backoff
  - Keep REST API as fallback for initial load and manual refresh
- UI state:
  - disable Start if `running || busy`
  - disable Stop if `!running && !busy`
  - disable Run Now if `busy`
  - show connection state in header

### 5. Configuration save technical changes

- Backend already has `PUT /api/config`, but apply reliability should be improved:
  - validate URL
  - validate pages list not empty
  - validate output path exists/creatable
  - sanitize number fields with clear min/max
  - after save, call `ensureRunFiles(config)` so `pages.txt` and output directory stay synced
  - if monitor is running, reschedule next run with updated interval where appropriate
- Frontend:
  - `saveConfig()` should show saving state and error state
  - reload saved config from response
  - refresh metrics/status after save
  - preserve form input while saving fails
  - add dirty indicator

### 6. Proxy metrics technical changes

- Current `/api/proxies` only returns raw local proxy text/count.
- Add backend summary builder using:
  - local proxy file lines
  - latest metrics rows from CSV
  - `proxy`, `proxy_country`, `response_ms`, `error`, `cf_cache_status`, `timestamp_utc`
- Possible API shape:
  - `{ text, count, proxies, summaryByCountry, recentlyUsed, sourceCounts }`
- Since fetched proxies are loaded inside collector script and not persisted separately, first implementation can derive actual used proxies from CSV.
- For richer source-level tracking, collector script can include a new field later, like `proxy_source`, but that changes CSV schema and should be planned carefully.
- Frontend:
  - `renderProxies()` should show:
    - summary cards
    - country table/list
    - recent proxy usage list
    - raw editable textarea below or beside metrics

### 7. Styling technical changes

- Keep current design language: clean white panels, teal accent, 8px radius.
- Avoid nested cards.
- Use responsive grid with fixed min widths for table/cells.
- Improve typography:
  - stronger contrast for primary values
  - muted text only for secondary data
  - avoid tiny text for core metrics
- Add stable dimensions for matrix cells to prevent layout jumping during live updates.

---

## 🧪 Virtual Testing Plan - কোনো test code লেখা হবে না

- **Layout check - Desktop** 🖥️
  - Metrics tab open করে Cache Matrix full width নিচ্ছে কিনা verify করতে হবে।
  - Cache Age এবং Collector Logs একই row-তে আছে কিনা দেখতে হবে।
  - Wide table scroll করলে page column/header context ঠিক থাকে কিনা check করতে হবে।

- **Layout check - Responsive** 📱
  - Tablet/mobile width-এ Matrix usable আছে কিনা check করতে হবে।
  - Cache Age এবং Collector Logs stack হয়ে readable থাকে কিনা verify করতে হবে।

- **Matrix readability check** 👀
  - HIT cell green tone-এ clear কিনা।
  - MISS/BYPASS/EXPIRED amber tone-এ clear কিনা।
  - FAIL/error red tone-এ clear কিনা।
  - Age, response time, edge value এক নজরে বোঝা যায় কিনা।
  - Empty cell clean placeholder দেখায় কিনা।

- **Start/Stop WebSocket check** 🔌
  - Page load করলে WebSocket connect indicator on হয় কিনা।
  - Start click করলে frontend state instantly running/busy হয় কিনা।
  - Stop click করলে server state এবং button state sync হয় কিনা।
  - Multiple browser tab খুলে Start/Stop করলে সব tab live update পায় কিনা।
  - Server restart/disconnect হলে reconnect state দেখায় কিনা।

- **Config save check** 💾
  - Base URL change করে save করলে saved value reload হয় কিনা।
  - Pages add/remove করলে `pages.txt` sync হয় কিনা।
  - Timing interval change করলে next run scheduling-এ effect হয় কিনা।
  - Invalid value দিলে user-friendly error আসে কিনা।
  - Save fail হলে form data হারায় না কিনা।

- **Proxies page check** 🌍
  - Empty `storage/proxies.txt` থাকলেও useful empty state দেখায় কিনা।
  - Local proxy add/save করলে count update হয় কিনা।
  - Metrics CSV থাকলে country-wise used proxy list দেখা যায় কিনা।
  - Recent proxy usage list response/error সহ দেখায় কিনা।

- **Regression check** ✅
  - Existing `/api/config`, `/api/metrics`, `/api/status`, `/api/proxies` কাজ করছে কিনা।
  - Monitor run command আগের মতো collector script চালাচ্ছে কিনা।
  - CSV parse/build metrics আগের মতো কাজ করছে কিনা।
  - Existing polling fallback থাকলে WebSocket fail করলেও dashboard পুরোপুরি dead হয় না কিনা।

---

## 📌 Priority Suggestion

- **Phase 1:** Metrics layout + Matrix readability + bottom two-column layout
- **Phase 2:** WebSocket real-time state/log/metrics sync
- **Phase 3:** Config save reliability + UX feedback
- **Phase 4:** Proxy metrics/list view
- **Phase 5:** Filters, legends, advanced polish

এই order-এ গেলে UI-এর visible pain আগে কমবে, এরপর live sync আর data reliability শক্ত হবে। 🚀
