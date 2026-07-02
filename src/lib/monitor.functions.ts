import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Config } from './monitor.server'
import {
  deleteMetricData,
  getDashboard,
  getMetricRowsPage,
  getRuntime,
  readProxies,
  runOnce,
  sanitizeConfig,
  saveConfig,
  saveProxies,
  startMonitor,
  stopMonitor,
} from './monitor.server'
import { metricRangeDayOptions } from './metric-range'
import type { MetricRangeDays } from './metric-range'

const metricRangeDaysSchema: z.ZodType<MetricRangeDays> = z.union([
  z.literal('all'),
  z
    .number()
    .refine((value): value is Extract<MetricRangeDays, number> =>
      metricRangeDayOptions.includes(value as MetricRangeDays),
    ),
])

const daysSchema = z.object({
  days: metricRangeDaysSchema,
})

const metricFiltersSchema = z.object({
  cacheStatus: z.string().optional(),
  country: z.string().optional(),
  page: z.string().optional(),
  query: z.string().optional(),
})

const metricRowsPageSchema = daysSchema.extend({
  filters: metricFiltersSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  maxColumns: z.number().int().min(1).max(200).optional(),
})

const proxyTextSchema = z.object({ text: z.string() })

const configSchema: z.ZodType<Config> = z
  .object({
    pages: z.array(z.string()),
    output: z.string(),
    proxyCountries: z.string(),
    maxProxiesPerCountry: z.number(),
    timeout: z.number(),
    delay: z.number(),
    roundIntervalSeconds: z.number(),
    hitIntervalSeconds: z.number(),
    missIntervalSeconds: z.number(),
    noDirect: z.boolean(),
    noProxySource: z.boolean(),
    noClarketmSource: z.boolean(),
    shuffleProxies: z.boolean(),
    userAgent: z.string(),
    retentionDays: z.number(),
    globalConcurrency: z.number(),
  })
  .passthrough()

export const getDashboardFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => daysSchema.parse(input))
  .handler(({ data }) => getDashboard(data.days))

export const getRuntimeFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => daysSchema.parse(input))
  .handler(({ data }) => getRuntime(data.days))

export const getMetricRowsPageFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => metricRowsPageSchema.parse(input))
  .handler(({ data }) => getMetricRowsPage(data))

export const deleteMetricDataFn = createServerFn({ method: 'POST' }).handler(
  () => deleteMetricData(),
)

export const saveConfigFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => configSchema.parse(input))
  .handler(({ data }) => saveConfig(sanitizeConfig(data)))

export const getProxiesFn = createServerFn({ method: 'GET' }).handler(
  () => readProxies(),
)

export const saveProxiesFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => proxyTextSchema.parse(input))
  .handler(({ data }) => saveProxies(data.text))

export const startMonitorFn = createServerFn({ method: 'POST' }).handler(
  () => startMonitor(),
)

export const stopMonitorFn = createServerFn({ method: 'POST' }).handler(
  () => stopMonitor(),
)

export const runOnceFn = createServerFn({ method: 'POST' }).handler(
  () => runOnce(),
)
