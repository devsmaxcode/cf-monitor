import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Config } from './monitor.server'
import { metricRangeDayOptions, type MetricRangeDays } from './metric-range'

const daysSchema = z.object({
  days: z
    .number()
    .refine((value): value is MetricRangeDays =>
      metricRangeDayOptions.includes(value as MetricRangeDays),
    ),
})

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
  })
  .passthrough()

export const getDashboardFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => daysSchema.parse(input))
  .handler(async ({ data }) => {
    const { getDashboard } = await import('./monitor.server')
    return getDashboard(data.days)
  })

export const getRuntimeFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => daysSchema.parse(input))
  .handler(async ({ data }) => {
    const { getRuntime } = await import('./monitor.server')
    return getRuntime(data.days)
  })

export const saveConfigFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => configSchema.parse(input))
  .handler(async ({ data }) => {
    const { saveConfig, sanitizeConfig } = await import('./monitor.server')
    return saveConfig(sanitizeConfig(data))
  })

export const getProxiesFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { readProxies } = await import('./monitor.server')
  return readProxies()
})

export const saveProxiesFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ text: z.string() }).parse(input))
  .handler(async ({ data }) => {
    const { saveProxies } = await import('./monitor.server')
    return saveProxies(data.text)
  })

export const startMonitorFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { startMonitor } = await import('./monitor.server')
  return startMonitor()
})

export const stopMonitorFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { stopMonitor } = await import('./monitor.server')
  return stopMonitor()
})

export const runOnceFn = createServerFn({ method: 'POST' }).handler(async () => {
  const { runOnce } = await import('./monitor.server')
  return runOnce()
})
