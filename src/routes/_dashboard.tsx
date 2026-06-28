import { createFileRoute } from '@tanstack/react-router'
import { DashboardShell } from '#/components/dashboard/dashboard-shell'
import { defaultMetricRangeDays } from '#/lib/metric-range'
import { getDashboardFn } from '#/lib/monitor.functions'

export const Route = createFileRoute('/_dashboard')({
  loader: () => getDashboardFn({ data: { days: defaultMetricRangeDays } }),
  component: DashboardRoute,
})

function DashboardRoute() {
  return <DashboardShell initial={Route.useLoaderData()} />
}
