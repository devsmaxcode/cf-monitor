import {
  createFileRoute,
  retainSearchParams,
  stripSearchParams,
  useNavigate,
} from '@tanstack/react-router'
import { useCallback } from 'react'
import { DashboardShell } from '#/components/dashboard/dashboard-shell'
import {
  defaultMetricRangeDays,
  parseMetricRangeDays,
} from '#/lib/metric-range'
import { getDashboardFn } from '#/lib/monitor.functions'
import type { MetricRangeDays } from '#/lib/monitor.server'

const dashboardSearchDefaults = {
  days: defaultMetricRangeDays,
} satisfies { days: MetricRangeDays }

function validateDashboardSearch(search: Record<string, unknown>) {
  return {
    days: parseMetricRangeDays(search.days),
  }
}

export const Route = createFileRoute('/_dashboard')({
  validateSearch: validateDashboardSearch,
  search: {
    middlewares: [
      retainSearchParams(['days']),
      stripSearchParams(dashboardSearchDefaults),
    ],
  },
  loaderDeps: ({ search }) => ({ days: search.days }),
  loader: ({ deps }) => getDashboardFn({ data: { days: deps.days } }),
  component: DashboardRoute,
})

function DashboardRoute() {
  const { days } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const setRangeDays = useCallback(
    (value: MetricRangeDays) => {
      void navigate({
        search: (previous) => ({ ...previous, days: value }),
      })
    },
    [navigate],
  )

  return (
    <DashboardShell
      initial={Route.useLoaderData()}
      rangeDays={days}
      setRangeDays={setRangeDays}
    />
  )
}
