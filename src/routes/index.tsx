import { createFileRoute, redirect } from '@tanstack/react-router'
import { defaultMetricRangeDays } from '#/lib/metric-range'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({
      search: { days: defaultMetricRangeDays },
      to: '/metrics',
    })
  },
})
