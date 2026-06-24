# Cloudflare Cache Monitor - প্রজেক্ট ওভারভিউ

এই প্রজেক্টটি একটি ছোট Bun + TypeScript অ্যাপ, যার কাজ হলো নির্দিষ্ট ওয়েবসাইটের বিভিন্ন পেজে Cloudflare cache ঠিকভাবে `HIT` হচ্ছে কিনা তা পর্যবেক্ষণ করা। এটি কয়েকটি দেশ বা proxy location থেকে পেজগুলো request করে, response header থেকে cache তথ্য সংগ্রহ করে, CSV ফাইলে সংরক্ষণ করে, তারপর browser dashboard-এ matrix আকারে দেখায়।

বর্তমান default target:

- Base URL: `https://ummah.one`
- Main dashboard port: `3000`
- Metrics output: `scripts/storage/cloudflare-cache-metrics.csv`
- Config file: `storage/dashboard-config.json`
- Pages list: `storage/pages.txt`
- Local proxies list: `storage/proxies.txt`

## কী সমস্যা সমাধান করে

Cloudflare cache সাধারণত edge location অনুযায়ী আলাদা আচরণ করতে পারে। কোনো পেজ Bangladesh edge থেকে `HIT`, কিন্তু অন্য edge থেকে `MISS` হতে পারে। এই প্রজেক্টটি একই পেজকে direct request এবং বিভিন্ন দেশের proxy দিয়ে hit করে দেখে:

- পেজটি Cloudflare cache থেকে serve হচ্ছে কিনা
- কোন edge location থেকে response এসেছে
- cache age কত
- response time কত
- কোনো proxy/request error হচ্ছে কিনা
- কোন পেজ বা কোন দেশ/edge বারবার `MISS`, `BYPASS`, `DYNAMIC`, `EXPIRED`, `STALE` ইত্যাদি দিচ্ছে কিনা

## Tech Stack

- Runtime: `Bun`
- Language: TypeScript
- Server: `Bun.serve`
- Frontend: plain TypeScript + HTML + CSS
- HTTP probing: `curl`
- Storage: local JSON, TXT, CSV files
- Package manager lockfile: `bun.lock`

## Project Structure

```text
cf-cache-monitor/
├─ package.json
├─ public/
│  └─ index.html
├─ src/
│  ├─ server.ts
│  ├─ client.ts
│  └─ styles.css
├─ scripts/
│  ├─ cloudflare_cache_monitor_bun.ts
│  └─ storage/
│     └─ cloudflare-cache-metrics.csv
└─ storage/
   ├─ dashboard-config.json
   ├─ pages.txt
   └─ proxies.txt
```

## Run Commands

`package.json`-এ দুটি script আছে:

```bash
bun run dev
```

Dashboard server চালায়। Server চালু হলে browser থেকে সাধারণত `http://localhost:3000` খোলা যাবে।

```bash
bun run monitor
```

Standalone collector script চালায়। এটি dashboard ছাড়া সরাসরি metrics collect করতে পারে।

## High-Level Architecture

```text
Browser Dashboard
      |
      | fetch /api/config, /api/metrics, /api/status, /api/proxies
      v
Bun Server: src/server.ts
      |
      | Bun.spawn(...)
      v
Collector Script: scripts/cloudflare_cache_monitor_bun.ts
      |
      | curl direct/proxy requests
      v
Target Site: https://ummah.one
      |
      | Cloudflare response headers
      v
CSV Metrics: scripts/storage/cloudflare-cache-metrics.csv
      |
      | parsed by server
      v
Dashboard Matrix
```

## মূল কম্পোনেন্টগুলো

### 1. `src/server.ts`

এটি dashboard server এবং API layer। এর কাজ:

- `public/index.html` serve করা
- config read/write করা
- pages এবং proxies ফাইল maintain করা
- collector script spawn করা
- runtime status রাখা
- metrics CSV parse করে dashboard-friendly JSON বানানো
- monitor start/stop/run-once control করা

Server state memory-তে থাকে:

```ts
{
  running,
  busy,
  round,
  startedAt,
  lastRunAt,
  nextRunAt,
  lastExitCode,
  lastReason,
  lastError,
  logs
}
```

এই state restart করলে reset হয়ে যাবে, কারণ এটি database-এ রাখা হচ্ছে না।

### 2. `scripts/cloudflare_cache_monitor_bun.ts`

এটি আসল collector। Dashboard থেকে অথবা CLI থেকে চালানো যায়। এর কাজ:

- target pages list নেয়
- proxy source থেকে proxy download করে
- local `storage/proxies.txt` থেকেও proxy নেয়
- direct request optional ভাবে যোগ করে
- প্রতিটি page-এর জন্য proxy group ধরে request করে
- `curl` দিয়ে request পাঠায়
- response headers parse করে
- Cloudflare-related fields বের করে
- CSV-তে append করে

Collector `curl` ব্যবহার করছে কারণ HTTPS proxy tunneling Bun `fetch` দিয়ে স্থিতিশীলভাবে করা কঠিন হতে পারে। কোডে এটিকে intentional shortcut হিসেবে রাখা হয়েছে।

### 3. `src/client.ts`

এটি browser dashboard। এর কাজ:

- `/api/config`, `/api/metrics`, `/api/status`, `/api/proxies` থেকে data load করা
- summary cards দেখানো
- cache matrix render করা
- config form save করা
- proxy textarea save করা
- Start, Stop, Run Now, Refresh action চালানো
- প্রতি ৫ সেকেন্ডে dashboard refresh করা

যদি config/proxy form edit করা হচ্ছে এবং unsaved change থাকে, তাহলে auto refresh form overwrite করে না।

### 4. `src/styles.css`

Dashboard-এর visual styling। এতে responsive layout আছে:

- বড় screen-এ cache matrix + side panel
- medium screen-এ summary cards ৩ column
- mobile screen-এ single column layout

### 5. `storage/dashboard-config.json`

Dashboard-এর persistent configuration। বর্তমান config-এর গুরুত্বপূর্ণ field:

```json
{
  "baseUrl": "https://ummah.one",
  "output": "scripts/storage/cloudflare-cache-metrics.csv",
  "maxProxiesPerCountry": 8,
  "timeout": 5,
  "delay": 0,
  "hitIntervalSeconds": 900,
  "missIntervalSeconds": 120,
  "shuffleProxies": true
}
```

### 6. `storage/pages.txt`

কোন কোন path monitor করা হবে তার list। যেমন:

```text
/
/quran
/quran/al-fatihah
/dua
/zakat-calculator
/tahakiks
```

Dashboard config save করলে server এই ফাইলটি update করে, যাতে collector script একই page list ব্যবহার করতে পারে।

### 7. `storage/proxies.txt`

Manual/local proxies রাখার ফাইল। বর্তমানে ফাইলটি empty। প্রতি লাইনে একটি proxy রাখা যায়:

```text
http://1.2.3.4:8080
https://5.6.7.8:443
```

`#` দিয়ে শুরু হওয়া line ignore করা হয়।

## Request Flow: Start Button চাপলে কী হয়

1. Browser থেকে `POST /api/monitor/start` call হয়।
2. Server `state.running = true` করে।
3. Server সঙ্গে সঙ্গে `runMonitorRound("start")` চালায়।
4. `runMonitorRound` config পড়ে।
5. `storage/pages.txt` এবং `storage/proxies.txt` ensure করে।
6. Collector script-এর জন্য arguments বানায়।
7. `Bun.spawn([process.execPath, ...args])` দিয়ে collector চালায়।
8. Collector stdout/stderr server log buffer-এ জমা হয়।
9. Collector CSV-তে rows append করে।
10. Collector শেষ হলে server CSV parse করে latest status বোঝে।
11. যদি latest matrix-এ `MISS`-জাতীয় status বা error থাকে, next run দ্রুত হয়।
12. যদি সব ঠিক থাকে, next run তুলনামূলক ধীরে হয়।

## Scheduling Logic

Server দুই ধরনের interval ব্যবহার করে:

- `hitIntervalSeconds`: latest result ভালো হলে, default `900` seconds বা ১৫ মিনিট
- `missIntervalSeconds`: `MISS`, `BYPASS`, `DYNAMIC`, `EXPIRED`, `REVALIDATED`, `STALE`, `UPDATING` অথবা error থাকলে, default `120` seconds বা ২ মিনিট

মানে cache healthy থাকলে monitoring কম ঘন ঘন চলে। কোনো cache miss/error দেখলে দ্রুত recheck করে।

## Collector কীভাবে Proxy নেয়

Collector তিন ধরনের source ব্যবহার করে:

1. Direct request
   - যদি `noDirect` false থাকে, তাহলে proxy ছাড়া request করে।

2. Proxifly free proxy list
   - GitHub-hosted JSON list থেকে proxy নেয়।
   - শুধুমাত্র selected country এবং HTTP/HTTPS compatible proxy নেয়।

3. clarketm proxy list
   - plain text proxy list এবং status file থেকে proxy নেয়।
   - successful proxy-কে priority দেয়।

4. Local proxy file
   - `storage/proxies.txt` থেকে user-provided proxy নেয়।

Proxy selection country অনুযায়ী group করা হয়। একই subnet বা host bucket থেকে অতিরিক্ত duplicate proxy কমানোর চেষ্টা করে।

## Collector-এর Request Logic

প্রতিটি page-এর জন্য collector:

1. `baseUrl` + page path দিয়ে full URL বানায়।
2. Proxy country/group ধরে loop করে।
3. এক group-এর proxy গুলো একে একে try করে।
4. কোনো request useful হলে group-এর বাকি proxy skip করে।
5. useful বলতে বোঝায় response-এ এগুলো আছে:
   - HTTP status code
   - `cf-ray`
   - `cf-cache-status`
6. প্রতিটি attempt CSV row হিসেবে save হয়।

এই design-এর ফলে প্রতি country/group থেকে অন্তত একটি useful sample নেওয়ার চেষ্টা হয়, কিন্তু broken proxy থাকলে পরের proxy try করা হয়।

## `curl` দিয়ে কী collect করা হয়

Collector `curl` চালায় roughly এই উদ্দেশ্যে:

- redirect follow করা
- response body discard করা
- response headers stdout-এ dump করা
- timeout enforce করা
- proxy ব্যবহার করা
- total response time বের করা

তারপর header থেকে এই fields বের করে:

- `cf-cache-status`
- `cf-ray`
- Cloudflare edge code, যেমন `DAC`, `SIN`, `FRA`
- `age`
- `content-length`
- `content-type`
- `cache-control`
- `server`

## CSV Schema

Metrics CSV-এর header:

```csv
timestamp_utc,round,page,url,proxy,proxy_country,status_code,cf_cache_status,cf_ray,cf_edge,age_seconds,response_ms,content_length,content_type,cache_control,server,error
```

প্রতিটি row একটি request attempt বোঝায়।

Field explanation:

- `timestamp_utc`: request সময়
- `round`: collector round number
- `page`: monitored path
- `url`: full URL
- `proxy`: direct বা proxy URL
- `proxy_country`: direct/local/country name
- `status_code`: HTTP status
- `cf_cache_status`: Cloudflare cache result, যেমন `HIT`, `MISS`
- `cf_ray`: Cloudflare Ray ID
- `cf_edge`: Ray ID থেকে edge code
- `age_seconds`: cached response-এর age header
- `response_ms`: request duration
- `content_length`: response content length, থাকলে
- `content_type`: response content type
- `cache_control`: cache-control header
- `server`: server header
- `error`: request/proxy error থাকলে

## Dashboard Metrics কীভাবে বানানো হয়

Server CSV-এর সব row পড়ে, তারপর latest matrix বানায়:

1. প্রতিটি row-এর country normalize করে।
   - `Bangladesh` -> `BD`
   - `United States` -> `US`
   - `direct` -> `direct`
2. key বানায়: `page|proxy_country`
3. একই page + country-এর মধ্যে latest timestamp row নেয়।
4. সেই latest rows দিয়ে matrix বানায়।

Dashboard summary হিসাব করে:

- total CSV rows
- latest matrix cells
- latest `HIT` count
- latest miss-like count
- latest error count
- max cache age
- average response time
- last timestamp

Miss-like status list:

```text
MISS, BYPASS, DYNAMIC, EXPIRED, REVALIDATED, STALE, UPDATING
```

## API Endpoints

### `GET /api/config`

বর্তমান config ফেরত দেয়। Config না থাকলে default config তৈরি করে।

### `PUT /api/config`

Dashboard থেকে config save করে। Server value sanitize করে:

- numeric range clamp করে
- empty page বাদ দেয়
- boolean normalize করে

### `GET /api/metrics`

CSV পড়ে dashboard-ready metrics JSON ফেরত দেয়।

### `GET /api/proxies`

`storage/proxies.txt` পড়ে raw text, count, parsed proxies ফেরত দেয়।

### `PUT /api/proxies`

Manual proxy text save করে।

### `GET /api/status`

Runtime monitor state ফেরত দেয়।

### `POST /api/monitor/start`

Monitor চালু করে এবং immediately একটি round শুরু করে।

### `POST /api/monitor/stop`

Monitor stop করে এবং scheduled timer clear করে।

### `POST /api/monitor/run-once`

Monitoring schedule on না করেও একবার collector চালায়।

## Frontend Tabs

Dashboard-এ তিনটি tab আছে:

### Metrics

- Cache matrix
- Country/edge-wise status
- Cache age side panel
- Collector log

### Configuration

- Base URL
- Pages
- CSV output path
- Proxy countries
- Max proxies per country
- Timeout
- Delay
- HIT/MISS interval
- User agent
- Proxy source toggles

### Proxies

- Manual local proxy list edit/save

## Config Field Guide

- `baseUrl`: target site root URL
- `pages`: monitor করার path list
- `output`: CSV output path
- `proxyCountries`: কোন দেশ থেকে proxy নিতে হবে
- `maxProxiesPerCountry`: প্রতি দেশে কত proxy candidate নেওয়া হবে
- `timeout`: request/proxy source timeout, seconds
- `delay`: request attempt-এর মাঝে delay, seconds
- `hitIntervalSeconds`: healthy result হলে next schedule delay
- `missIntervalSeconds`: miss/error হলে next schedule delay
- `noDirect`: true হলে direct request বাদ যাবে
- `noProxySource`: true হলে Proxifly source বাদ যাবে
- `noClarketmSource`: true হলে clarketm source বাদ যাবে
- `shuffleProxies`: true হলে proxy order shuffle হবে
- `userAgent`: curl request user-agent

## Important Implementation Notes

- Metrics CSV append-only। পুরনো data নিজে থেকে clean হয় না।
- `.gitignore`-এ CSV ignore করা আছে:
  - `storage/*.csv`
  - `scripts/storage/*.csv`
- Dashboard শুধু latest page-country cell দেখায়, কিন্তু CSV history রেখে দেয়।
- Runtime status memory-only। Server restart করলে logs/status reset হবে।
- Proxy source external GitHub URLs থেকে আসে, তাই network/source unavailable হলে proxy loading fail করতে পারে।
- Broken proxy থাকলে collector error row save করতে পারে।
- `cf-cache-status` না থাকলে row useful ধরা হয় না, কিন্তু attempt CSV-তে থাকতে পারে।
- `age_seconds` শুধু cache hit বা relevant response-এ meaningful হতে পারে।

## Typical Usage

1. Dependency install:

```bash
bun install
```

2. Dashboard চালু:

```bash
bun run dev
```

3. Browser খুলুন:

```text
http://localhost:3000
```

4. Configuration tab থেকে pages/proxy countries/interval ঠিক করুন।

5. `Run Now` দিয়ে একবার test করুন।

6. `Start` দিলে monitor scheduled mode-এ চলবে।

7. Metrics tab-এ cache matrix, age, response time, logs দেখুন।

## Standalone Collector Usage

Dashboard ছাড়া collector script সরাসরি চালানো যায়:

```bash
bun run scripts/cloudflare_cache_monitor_bun.ts --base-url https://ummah.one --rounds 1
```

Custom pages/proxies:

```bash
bun run scripts/cloudflare_cache_monitor_bun.ts \
  --base-url https://ummah.one \
  --pages storage/pages.txt \
  --proxies storage/proxies.txt \
  --output scripts/storage/cloudflare-cache-metrics.csv \
  --rounds 1 \
  --timeout 5 \
  --shuffle-proxies
```

## Data Lifecycle

```text
Config save
  -> storage/dashboard-config.json
  -> storage/pages.txt

Monitor run
  -> collector loads pages/proxies/proxy sources
  -> curl requests target pages
  -> Cloudflare headers parsed
  -> CSV rows appended

Dashboard refresh
  -> server parses CSV
  -> latest page-country matrix generated
  -> browser renders UI
```

## এই প্রজেক্টের বর্তমান অবস্থা

এই repo-তে dashboard, collector, config storage, local proxy editing, CSV metrics এবং responsive UI সবই আছে। অর্থাৎ এটি শুধু script নয়; একটি usable local monitoring dashboard।

তবে এটি production service হিসেবে hardening করা হয়নি। Long-running deployment চাইলে নিচের বিষয়গুলো ভাবা দরকার:

- CSV rotation বা retention policy
- persistent logs
- authentication
- proxy health cache
- better error classification
- background process supervision
- Windows/Linux deployment docs
- automated tests

## এক লাইনের সারাংশ

এই প্রজেক্টটি `ummah.one`-এর গুরুত্বপূর্ণ পেজগুলো direct এবং country-based proxy request দিয়ে hit করে Cloudflare cache status সংগ্রহ করে, CSV-তে history রাখে, আর dashboard-এ latest global cache health matrix দেখায়।
