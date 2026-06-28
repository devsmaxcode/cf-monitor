export const METRIC_RETENTION_DAYS = 10
export const metricRangeDayOptions = [1, 7, METRIC_RETENTION_DAYS] as const
export type MetricRangeDays = (typeof metricRangeDayOptions)[number]
export const defaultMetricRangeDays: MetricRangeDays = METRIC_RETENTION_DAYS
