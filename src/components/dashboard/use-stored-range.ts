import { useState } from 'react'
import { defaultMetricRangeDays } from '#/lib/metric-range'
import type { MetricRangeDays } from '#/lib/metric-range'
import { parseMetricRangeDays } from './helpers'

export function useStoredRange() {
  const [range, setRange] = useState<MetricRangeDays>(() => {
    if (typeof window === 'undefined') return defaultMetricRangeDays
    return parseMetricRangeDays(
      window.localStorage.getItem('cf-monitor-range-days') || '',
    )
  })

  const setStoredRange = (value: MetricRangeDays) => {
    setRange(value)
    window.localStorage.setItem('cf-monitor-range-days', String(value))
  }

  return [range, setStoredRange] as const
}
