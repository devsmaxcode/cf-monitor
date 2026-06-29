export const metricRangeDayOptions = [1, 7, 10, 30, 90, 'all'] as const
export type MetricRangeDays = (typeof metricRangeDayOptions)[number]
export const defaultMetricRangeDays: MetricRangeDays = 'all'
