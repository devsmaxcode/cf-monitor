export const metricRangeDayOptions = [1, 7, 10, 30, 90, 'all'] as const
export type MetricRangeDays = (typeof metricRangeDayOptions)[number]
export const defaultMetricRangeDays: MetricRangeDays = 7

export function isMetricRangeDays(value: unknown): value is MetricRangeDays {
  return metricRangeDayOptions.includes(value as MetricRangeDays)
}

export function parseMetricRangeDays(value: unknown): MetricRangeDays {
  const range = value === 'all' ? value : Number(value)
  return isMetricRangeDays(range) ? range : defaultMetricRangeDays
}
