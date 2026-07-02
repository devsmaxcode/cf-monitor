#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import {
  appendMetricRows,
  createMetricRound,
  DEFAULT_METRICS_DB,
  finalizeMetricRound,
  normalizeMetricsOutput,
} from '../src/lib/metrics-db.ts'

const PROXIFLY =
  'https://raw.githubusercontent.com/proxifly/free-proxy-list/refs/heads/main/proxies/all/data.json'
const CLARKETM =
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list.txt'
const CLARKETM_STATUS =
  'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-status.txt'
const COUNTRIES = ['BD', 'IN', 'US', 'GB', 'CA', 'DE', 'FR', 'SG', 'JP', 'AU']
const LEGACY_DEFAULT_BASE_URL = 'https://ummah.one'
const DEFAULT_PAGES = [
  'https://ummah.one/',
  'https://ummah.one/quran',
  'https://ummah.one/quran/al-fatihah',
  'https://ummah.one/quran/al-baqarah',
  'https://ummah.one/quran/juz/1',
  'https://ummah.one/quran/page/1',
  'https://ummah.one/hadith/books',
  'https://ummah.one/dua',
  'https://ummah.one/dua/categories',
  'https://ummah.one/dua/all-duas',
  'https://ummah.one/ruqyah',
  'https://ummah.one/videos',
  'https://ummah.one/99-names-of-allah',
  'https://ummah.one/zakat-calculator',
  'https://ummah.one/projects',
  'https://ummah.one/about-us',
  'https://ummah.one/contact-us',
  'https://ummah.one/privacy-policy',
  'https://ummah.one/tahakiks',
]
const COUNTRY_NAMES: Record<string, string> = {
  BD: 'Bangladesh',
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  DE: 'Germany',
  FR: 'France',
  SG: 'Singapore',
  JP: 'Japan',
  AU: 'Australia',
}
const COUNTRY_CODES_BY_NAME = Object.fromEntries(
  Object.entries(COUNTRY_NAMES).map(([code, name]) => [
    name.toLowerCase(),
    code,
  ]),
)
type ProxyItem = { url: string | null; country: string }
type Metrics = Record<string, string>
type RecheckTarget = { page: string; url: string; proxy: ProxyItem }
type CheckResult = { rows: Metrics[]; rechecks: RecheckTarget[] }
type RequestLimiter = <T>(task: () => Promise<T>) => Promise<T>
type CollectorArgs = {
  pages?: string
  proxies?: string
  pageCountryOverrides?: string
  proxySource: string
  clarketmSource: string
  clarketmStatusSource: string
  proxyCountries: string
  maxProxiesPerCountry: number
  output: string
  roundId: number
  roundReason: string
  rounds: number
  interval: number
  missRecheckDelay: number
  timeout: number
  delay: number
  pageConcurrency: number
  countryConcurrency: number
  globalConcurrency: number
  noDirect: boolean
  shuffleProxies: boolean
  userAgent: string
  requestLimit: RequestLimiter
}

function parseArgs(): CollectorArgs {
  const args: Record<string, string | number | boolean> = {
    proxySource: PROXIFLY,
    clarketmSource: CLARKETM,
    clarketmStatusSource: CLARKETM_STATUS,
    proxyCountries: COUNTRIES.map((country) => COUNTRY_NAMES[country]).join(
      ',',
    ),
    maxProxiesPerCountry: 25,
    output: DEFAULT_METRICS_DB,
    roundId: 0,
    roundReason: 'cli',
    rounds: 1,
    interval: 300,
    missRecheckDelay: 0,
    timeout: 5,
    delay: 0,
    pageConcurrency: 4,
    countryConcurrency: 6,
    globalConcurrency: 8,
    noDirect: false,
    shuffleProxies: false,
    userAgent: 'UmmahOneCacheMonitor/1.0 (+https://ummah.one)',
  }

  const map: Record<string, string> = {
    '--pages': 'pages',
    '--proxies': 'proxies',
    '--page-country-overrides': 'pageCountryOverrides',
    '--proxy-source': 'proxySource',
    '--clarketm-source': 'clarketmSource',
    '--clarketm-status-source': 'clarketmStatusSource',
    '--proxy-countries': 'proxyCountries',
    '--max-proxies-per-country': 'maxProxiesPerCountry',
    '--output': 'output',
    '--round-id': 'roundId',
    '--round-reason': 'roundReason',
    '--rounds': 'rounds',
    '--interval': 'interval',
    '--miss-recheck-delay': 'missRecheckDelay',
    '--timeout': 'timeout',
    '--delay': 'delay',
    '--page-concurrency': 'pageConcurrency',
    '--country-concurrency': 'countryConcurrency',
    '--global-concurrency': 'globalConcurrency',
    '--user-agent': 'userAgent',
  }

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i]
    if (arg === '--help') usage(0)
    if (arg === '--no-direct') args.noDirect = true
    else if (arg === '--no-proxy-source') args.proxySource = ''
    else if (arg === '--no-clarketm-source') args.clarketmSource = ''
    else if (arg === '--shuffle-proxies') args.shuffleProxies = true
    else if (map[arg]) {
      const key = map[arg]
      const value = process.argv[++i]
      if (!value || value.startsWith('--')) usage(1)
      args[key] = [
        'maxProxiesPerCountry',
        'roundId',
        'rounds',
        'interval',
        'missRecheckDelay',
        'timeout',
        'delay',
        'pageConcurrency',
        'countryConcurrency',
        'globalConcurrency',
      ].includes(key)
        ? Number(value)
        : value
    } else {
      console.error(`unknown arg: ${arg}`)
      usage(1)
    }
  }

  args.output = normalizeMetricsOutput(String(args.output))
  args.pageConcurrency = positiveInteger(args.pageConcurrency, 4)
  args.countryConcurrency = positiveInteger(args.countryConcurrency, 6)
  args.globalConcurrency = positiveInteger(args.globalConcurrency, 8)
  args.roundId = nonNegativeInteger(args.roundId, 0)
  if (Number(args.roundId) > 0 && Number(args.rounds) !== 1) {
    console.error('--round-id can only be used with --rounds 1')
    usage(1)
  }

  const parsed = args as unknown as Omit<CollectorArgs, 'requestLimit'> & {
    requestLimit?: RequestLimiter
  }
  parsed.requestLimit = createLimiter(parsed.globalConcurrency)
  return parsed as CollectorArgs
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function createLimiter(limit: number): RequestLimiter {
  let active = 0
  const queue: Array<() => void> = []

  return async function limitTask<T>(task: () => Promise<T>) {
    if (active >= limit) await new Promise<void>((done) => queue.push(done))
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      queue.shift()?.()
    }
  }
}

function usage(code: number): never {
  console.log(`Usage: node --experimental-strip-types cloudflare_cache_monitor.ts [options]

Options:
  --pages pages.txt       full target URLs, default: ${DEFAULT_PAGES.length} common Ummah One URLs
  --page-country-overrides overrides.json
  --proxy-countries Bangladesh,India,United States
  --max-proxies-per-country 25
  --rounds 1              0 = forever
  --timeout 5
  --miss-recheck-delay 0  seconds to wait before rechecking MISS-like samples
  --page-concurrency 4    target pages checked in parallel
  --country-concurrency 6 proxy country groups checked in parallel per page
  --global-concurrency 8  max active requests across the whole round
  --output storage/cloudflare-cache-metrics.sqlite
  --round-id 123          existing cache_rounds id, for dashboard-managed runs
  --round-reason cli      stored when the script creates its own round
  --no-direct
  --no-proxy-source
  --no-clarketm-source
  --shuffle-proxies`)
  process.exit(code)
}

async function readList(path?: string) {
  if (!path) return []
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function targetUrl(value: string) {
  try {
    return new URL(value).toString()
  } catch {
    return new URL(
      value.replace(/^\/+/, ''),
      LEGACY_DEFAULT_BASE_URL.replace(/\/?$/, '/'),
    ).toString()
  }
}

function countries(value: string) {
  return value
    .split(',')
    .map((part) => countryCode(part.trim()))
    .filter(Boolean)
}

function countryCode(value: string) {
  return COUNTRY_CODES_BY_NAME[value.toLowerCase()] || value.toUpperCase()
}

function countryName(value: string) {
  return COUNTRY_NAMES[value] || value
}

function normalizeProxy(proxy: string) {
  const value = /^[a-z]+:\/\//i.test(proxy) ? proxy : `http://${proxy}`
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  return value
}

async function fetchText(url: string, timeout: number, maxBytes = 5_000_000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'UmmahOneCacheMonitor/1.0 (+https://ummah.one)' },
    signal: AbortSignal.timeout(timeout * 1000),
  })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const text = await response.text()
  if (Buffer.byteLength(text) > maxBytes)
    throw new Error(`response too large: ${url}`)
  return text
}

async function readPageCountryOverrides(path?: string) {
  if (!path) return {}

  const value = JSON.parse(await readFile(path, 'utf8')) as Record<
    string,
    unknown
  >
  const overrides: Record<string, string> = {}

  for (const [page, country] of Object.entries(value)) {
    const normalizedCountry = countryCode(String(country || '').trim())
    if (/^[A-Z]{2}$/.test(normalizedCountry)) {
      overrides[targetUrl(page)] = normalizedCountry
    }
  }

  return overrides
}

function proxyBucket(proxy: string) {
  const host = new URL(proxy).hostname
  const parts = host.split('.')
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part)))
    return parts.slice(0, 3).join('.')
  return host
}

function selectDiverse(items: any[], countryCodes: string[], limit: number) {
  const proxies: ProxyItem[] = []
  for (const country of countryCodes) {
    const ordered = items
      .filter((item) => item.country === country)
      .sort(sortCandidate)
    const seen = new Set<string>()
    const diverse = []
    const rest = []

    for (const item of ordered) {
      const bucket = proxyBucket(item.url)
      if (seen.has(bucket)) rest.push(item)
      else {
        seen.add(bucket)
        diverse.push(item)
      }
    }

    for (const item of [...diverse, ...rest].slice(0, limit)) {
      proxies.push({ url: item.url, country: item.country })
    }
  }
  return proxies
}

function sortCandidate(a: any, b: any) {
  return (
    a.countryOrder - b.countryOrder ||
    (a.scheme ?? 1) - (b.scheme ?? 1) ||
    a.port443 - b.port443 ||
    a.good - b.good ||
    a.anonymity - b.anonymity ||
    b.score - a.score ||
    a.url.localeCompare(b.url)
  )
}

async function loadProxifly(
  source: string,
  countryCodes: string[],
  limit: number,
  timeout: number,
) {
  const data = JSON.parse(await fetchText(source, timeout))
  const countryOrder = Object.fromEntries(
    countryCodes.map((country, index) => [country, index]),
  )
  const anonymity: Record<string, number> = {
    elite: 0,
    anonymous: 1,
    transparent: 2,
  }
  const items = []

  for (const row of data) {
    const country = String(row?.geolocation?.country || '').toUpperCase()
    const protocol = String(row?.protocol || '').toLowerCase()
    if (
      !countryCodes.includes(country) ||
      !['http', 'https'].includes(protocol) ||
      row?.https !== true
    ) {
      continue
    }

    try {
      const url = normalizeProxy(String(row.proxy || '').trim())
      if (!url) continue
      const parsed = new URL(url)
      const httpsUrl = `https://${parsed.host}`
      for (const candidateUrl of [httpsUrl, url]) {
        items.push({
          country,
          url: candidateUrl,
          countryOrder: countryOrder[country],
          scheme: candidateUrl.startsWith('https://') ? 0 : 1,
          port443: new URL(candidateUrl).port === '443' ? 1 : 0,
          good: 0,
          anonymity: anonymity[String(row.anonymity || '').toLowerCase()] ?? 3,
          score: Number(row.score || 0),
        })
      }
    } catch {
      continue
    }
  }

  return selectDiverse(items, countryCodes, limit)
}

async function loadClarketm(
  source: string,
  statusSource: string,
  countryCodes: string[],
  limit: number,
  timeout: number,
) {
  const [text, statusText] = await Promise.all([
    fetchText(source, timeout),
    statusSource ? fetchText(statusSource, timeout).catch(() => '') : '',
  ])
  const successful = new Set(
    statusText
      .split(/\r?\n/)
      .filter((line) => line.endsWith('=> success'))
      .map((line) => line.split(' => ', 1)[0].trim()),
  )
  const countryOrder = Object.fromEntries(
    countryCodes.map((country, index) => [country, index]),
  )
  const anonymity: Record<string, number> = { H: 0, A: 1, N: 2 }
  const items = []

  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+:\d+)\s+([A-Z]{2})-([A-Z!-]+)/)
    if (!match) continue
    const [, host, country, flags] = match
    if (!countryCodes.includes(country) || !flags.includes('S')) continue
    items.push({
      country,
      url: `http://${host}`,
      countryOrder: countryOrder[country],
      port443: host.endsWith(':443') ? 1 : 0,
      good: successful.has(host) ? 0 : 1,
      anonymity: anonymity[flags.slice(0, 1)] ?? 3,
      score: 0,
    })
  }

  return selectDiverse(items, countryCodes, limit)
}

async function loadProxies(args: ReturnType<typeof parseArgs>) {
  const countryCodes = countries(args.proxyCountries)
  const proxies: ProxyItem[] = args.noDirect
    ? []
    : [{ url: null, country: 'direct' }]
  const sourceJobs: Promise<ProxyItem[]>[] = []

  if (args.proxySource) {
    sourceJobs.push(
      loadProxifly(
        args.proxySource,
        countryCodes,
        args.maxProxiesPerCountry,
        args.timeout,
      ).catch((error) => {
        console.error(`proxifly failed: ${errorName(error)}`)
        return []
      }),
    )
  }

  if (args.clarketmSource) {
    sourceJobs.push(
      loadClarketm(
        args.clarketmSource,
        args.clarketmStatusSource,
        countryCodes,
        args.maxProxiesPerCountry,
        args.timeout,
      ).catch((error) => {
        console.error(`clarketm failed: ${errorName(error)}`)
        return []
      }),
    )
  }

  for (const sourceProxies of await Promise.all(sourceJobs)) {
    proxies.push(...sourceProxies)
  }

  for (const line of await readList(args.proxies)) {
    try {
      proxies.push({ url: normalizeProxy(line), country: 'local' })
    } catch (error) {
      console.error(`bad local proxy skipped: ${line} (${errorName(error)})`)
    }
  }

  const seen = new Set<string>()
  return proxies.filter((proxy) => {
    const key = `${proxy.country}|${proxy.url || 'direct'}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function proxyGroups(proxies: ProxyItem[], shuffle: boolean) {
  const items = [...proxies]
  if (shuffle) items.sort(() => Math.random() - 0.5)
  const map = new Map<string, ProxyItem[]>()
  for (const proxy of items) {
    if (!map.has(proxy.country)) map.set(proxy.country, [])
    map.get(proxy.country)!.push(proxy)
  }
  return [...map.values()]
}

async function request(
  url: string,
  proxy: string | null,
  timeout: number,
  userAgent: string,
): Promise<Metrics> {
  // ponytail: curl owns HTTPS proxy tunneling; replace only if fetch gets stable proxy support.
  const started = performance.now()
  const out = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const command = process.platform === 'win32' ? 'curl.exe' : 'curl'
  const args = [
    '--location',
    '--silent',
    '--show-error',
    '--proxy-insecure',
    '--dump-header',
    '-',
    '--output',
    out,
    '--max-time',
    String(timeout),
    '--connect-timeout',
    String(timeout),
    '--user-agent',
    userAgent,
    '--header',
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '--header',
    'Accept-Language: en-US,en;q=0.9,bn;q=0.8',
    '--write-out',
    '\n__curl_metrics__:%{http_code} %{time_total}',
  ]
  if (proxy) args.push('--proxy', proxy)
  args.push(url)

  const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const [stdout, stderr, exitCode] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    new Promise<number>((resolve) =>
      proc.once('close', (code) => resolve(code ?? 1)),
    ),
  ])

  const metrics = parseCurl(stdout, Math.round(performance.now() - started))
  if (exitCode !== 0) {
    metrics.error = `curl exit ${exitCode}: ${(stderr || 'request failed').trim()}`
  }
  return metrics
}

async function streamText(stream: NodeJS.ReadableStream | null) {
  if (!stream) return ''
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parseCurl(stdout: string, fallbackMs: number): Metrics {
  const marker = '__curl_metrics__:'
  const markerAt = stdout.lastIndexOf(marker)
  const headerText = (
    markerAt === -1 ? stdout : stdout.slice(0, markerAt)
  ).replace(/\r/g, '')
  const metricText =
    markerAt === -1 ? '' : stdout.slice(markerAt + marker.length).trim()
  const [code = '', total = ''] = metricText.split(/\s+/)
  const block = headerText
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .reverse()
    .find((part) => /^HTTP\/\S+\s+\d+/.test(part))
  const headers = new Map<string, string>()

  if (block) {
    for (const line of block.split('\n').slice(1)) {
      const at = line.indexOf(':')
      if (at > 0)
        headers.set(
          line.slice(0, at).trim().toLowerCase(),
          line.slice(at + 1).trim(),
        )
    }
  }

  const cfRay = headers.get('cf-ray') || ''
  return {
    status_code: code && code !== '000' ? code : statusFromBlock(block),
    cf_cache_status: headers.get('cf-cache-status') || '',
    cf_ray: cfRay,
    cf_edge: edgeFromRay(cfRay),
    age_seconds: headers.get('age') || '',
    response_ms: String(total ? Math.round(Number(total) * 1000) : fallbackMs),
    content_length: headers.get('content-length') || '',
    content_type: headers.get('content-type') || '',
    cache_control: headers.get('cache-control') || '',
    server: headers.get('server') || '',
    error: '',
  }
}

function statusFromBlock(block?: string) {
  return block?.match(/^HTTP\/\S+\s+(\d+)/)?.[1] || ''
}

function edgeFromRay(ray: string) {
  return ray.includes('-') ? ray.split('-').pop() || '' : ''
}

function useful(metrics: Metrics) {
  return Boolean(
    metrics.status_code && metrics.cf_ray && metrics.cf_cache_status,
  )
}

function isMissLike(metrics: Metrics) {
  const status = String(metrics.cf_cache_status || '').toUpperCase()
  return [
    'MISS',
    'BYPASS',
    'DYNAMIC',
    'EXPIRED',
    'REVALIDATED',
    'STALE',
    'UPDATING',
  ].includes(status)
}

function fit(value: string, width: number) {
  if (value.length > width) return value.slice(0, width - 1) + '.'
  return value.padEnd(width)
}

function alignRight(value: string, width: number) {
  return value.padStart(width)
}

function logRow(row: Metrics, attempt: string) {
  const cache = row.cf_cache_status || (row.error ? 'FAIL' : '-')
  console.log(
    [
      fit(row.timestamp_utc, 25),
      fit(cache, 7),
      alignRight(row.status_code || '-', 3),
      alignRight(`${row.response_ms}ms`, 7),
      `edge=${fit(row.cf_edge || '-', 4)}`,
      `country=${fit(row.proxy_country, 14)}`,
      `try=${fit(attempt, 5)}`,
      `proxy=${fit(row.proxy, 30)}`,
      `error=${fit(row.error || '-', 46)}`,
      `page=${row.page}`,
    ].join('  '),
  )
}

function logPageRequest(roundId: number, page: string) {
  console.log(`requesting round=${roundId} page=${page}`)
}

async function appendRows(output: string, rows: Metrics[]) {
  await appendMetricRows(output, rows)
}

async function openRound(
  args: ReturnType<typeof parseArgs>,
  pages: string[],
  pageCountryOverrides: Record<string, string>,
  sequence: number,
) {
  if (args.roundId > 0) return args.roundId

  const round = await createMetricRound(args.output, {
    reason: args.roundReason || `cli-${sequence}`,
    pageCount: pages.length,
    proxyCountryCount:
      countries(args.proxyCountries).length + (args.noDirect ? 0 : 1),
    configJson: roundConfigJson(args, pages, pageCountryOverrides),
  })
  console.log(`opened database round ${round.id}`)
  return round.id
}

function roundConfigJson(
  args: ReturnType<typeof parseArgs>,
  pages: string[],
  pageCountryOverrides: Record<string, string>,
) {
  return JSON.stringify({
    pages,
    pageCountryOverrides,
    proxyCountries: args.proxyCountries,
    maxProxiesPerCountry: args.maxProxiesPerCountry,
    timeout: args.timeout,
    delay: args.delay,
    pageConcurrency: args.pageConcurrency,
    countryConcurrency: args.countryConcurrency,
    noDirect: args.noDirect,
    noProxySource: !args.proxySource,
    noClarketmSource: !args.clarketmSource,
    shuffleProxies: args.shuffleProxies,
    userAgent: args.userAgent,
  })
}

function proxyLabel(proxy: string | null) {
  if (!proxy) return 'direct'
  const url = new URL(proxy)
  if (!url.password) return proxy
  return `${url.protocol}//${url.username}:***@${url.host}`
}

function proxiesForPage(
  page: string,
  proxies: ProxyItem[],
  pageCountryOverrides: Record<string, string>,
) {
  const country = pageCountryOverrides[page]
  if (!country) return proxies
  return proxies.filter((proxy) => proxy.country === country)
}

function errorName(error: unknown) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

const sleep = (seconds: number) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000))

async function mapLimit<TItem, TResult>(
  items: TItem[],
  limit: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
) {
  const results = new Array<TResult>(items.length)
  let next = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await mapper(items[index], index)
      }
    },
  )

  await Promise.all(workers)
  return results
}

async function checkProxyGroup(
  page: string,
  url: string,
  group: ProxyItem[],
  roundId: number,
  args: ReturnType<typeof parseArgs>,
): Promise<CheckResult> {
  const rows: Metrics[] = []
  const rechecks: RecheckTarget[] = []

  for (let index = 0; index < group.length; index++) {
    const proxy = group[index]
    const metrics = await args.requestLimit(() =>
      request(url, proxy.url, args.timeout, args.userAgent),
    )
    const row = {
      round_id: String(roundId),
      timestamp_utc: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      round: String(roundId),
      page,
      url,
      proxy: proxyLabel(proxy.url),
      proxy_country: countryName(proxy.country),
      ...metrics,
    }
    rows.push(row)

    logRow(row, `${index + 1}/${group.length}`)

    if (args.delay) await sleep(args.delay)
    if (useful(metrics)) {
      if (args.missRecheckDelay > 0 && isMissLike(metrics)) {
        rechecks.push({ page, url, proxy })
      }
      break
    }
  }

  return { rows, rechecks }
}

async function checkPage(
  page: string,
  proxies: ProxyItem[],
  pageCountryOverrides: Record<string, string>,
  roundId: number,
  args: ReturnType<typeof parseArgs>,
): Promise<CheckResult> {
  logPageRequest(roundId, page)
  const url = page
  const groups = proxyGroups(
    proxiesForPage(page, proxies, pageCountryOverrides),
    args.shuffleProxies,
  )
  const groupResults = await mapLimit(
    groups,
    args.countryConcurrency,
    (group) => checkProxyGroup(page, url, group, roundId, args),
  )

  return {
    rows: groupResults.flatMap((result) => result.rows),
    rechecks: groupResults.flatMap((result) => result.rechecks),
  }
}

async function main() {
  const args = parseArgs()
  const pageList = await readList(args.pages)
  const pages = (pageList.length ? pageList : DEFAULT_PAGES).map(targetUrl)
  const pageCountryOverrides = await readPageCountryOverrides(
    args.pageCountryOverrides,
  )

  for (let round = 1; args.rounds === 0 || round <= args.rounds; round++) {
    let roundId = 0
    let rowCount = 0
    let recheckCount = 0
    try {
      roundId = await openRound(args, pages, pageCountryOverrides, round)
      const ownsRound = args.roundId <= 0
      const proxies = await loadProxies(args)
      const rows: Metrics[] = []
      const rechecks: RecheckTarget[] = []
      const pageResults = await mapLimit(pages, args.pageConcurrency, (page) =>
        checkPage(page, proxies, pageCountryOverrides, roundId, args),
      )

      for (const result of pageResults) {
        rows.push(...result.rows)
        rechecks.push(...result.rechecks)
      }

      await appendRows(args.output, rows)
      rowCount += rows.length
      console.log(
        `saved ${rows.length} rows for database round ${roundId} -> ${args.output}`,
      )

      if (rechecks.length && args.missRecheckDelay > 0) {
        console.log(
          `waiting ${args.missRecheckDelay}s to recheck ${rechecks.length} MISS-like samples`,
        )
        await sleep(args.missRecheckDelay)

        const recheckRows: Metrics[] = []
        for (const target of rechecks) {
          const metrics = await args.requestLimit(() =>
            request(target.url, target.proxy.url, args.timeout, args.userAgent),
          )
          const row = {
            round_id: String(roundId),
            timestamp_utc: new Date()
              .toISOString()
              .replace(/\.\d{3}Z$/, '+00:00'),
            round: `${roundId}-recheck`,
            page: target.page,
            url: target.url,
            proxy: proxyLabel(target.proxy.url),
            proxy_country: countryName(target.proxy.country),
            ...metrics,
          }
          recheckRows.push(row)
          logRow(row, 'rechk')
          if (args.delay) await sleep(args.delay)
        }

        await appendRows(args.output, recheckRows)
        rowCount += recheckRows.length
        recheckCount = recheckRows.length
        console.log(
          `saved ${recheckRows.length} recheck rows for database round ${roundId} -> ${args.output}`,
        )
      }

      if (ownsRound) {
        await finalizeMetricRound(args.output, roundId, {
          status: 'completed',
          totalRows: rowCount,
          recheckRows: recheckCount,
        })
      }
      console.log(`completed database round ${roundId}`)
    } catch (error) {
      if (roundId && args.roundId <= 0) {
        await finalizeMetricRound(args.output, roundId, {
          status: 'failed',
          totalRows: rowCount,
          recheckRows: recheckCount,
          error: errorName(error),
        }).catch((finalizeError: unknown) =>
          console.error(`round finalize failed: ${errorName(finalizeError)}`),
        )
      }
      throw error
    }

    if (args.rounds === 0 || round < args.rounds) await sleep(args.interval)
  }
}

main().catch((error) => {
  console.error(errorName(error))
  process.exit(1)
})
