import { useState } from 'react'
import { defaultMetricRangeDays, type MetricRangeDays } from '#/lib/metric-range'
import { isMetricRangeDays } from './helpers'

export function useStoredRange() {
  const [range, setRange] = useState<MetricRangeDays>(() => {
    if (typeof window === 'undefined') return defaultMetricRangeDays
    const stored = Number(window.localStorage.getItem('cf-monitor-range-days'))
    return isMetricRangeDays(stored) ? stored : defaultMetricRangeDays
  })

  const setStoredRange = (value: MetricRangeDays) => {
    setRange(value)
    window.localStorage.setItem('cf-monitor-range-days', String(value))
  }

  return [range, setStoredRange] as const
}
