import { createFileRoute } from '@tanstack/react-router'
import { useMetricsConsumer } from '#/components/dashboard/dashboard-consumers'
import { MetricsPanel } from '#/components/dashboard/panels/metrics-panel'
import { parseMetricRangeDays } from '#/lib/metric-range'
import { getMetricRowsPageFn } from '#/lib/monitor.functions'

export const Route = createFileRoute('/_dashboard/metrics')({
  loaderDeps: ({ search }) => ({ days: parseMetricRangeDays(search.days) }),
  loader: ({ deps }) =>
    getMetricRowsPageFn({
      data: {
        days: deps.days,
        filters: {},
        maxColumns: 80,
        page: 1,
        pageSize: 50,
      },
    }),
  component: MetricsRoute,
})

function MetricsRoute() {
  const initialMetricsPage = Route.useLoaderData()
  const { filteredRows: rows, ...dashboard } =
    useMetricsConsumer(initialMetricsPage)
  return <MetricsPanel {...dashboard} rows={rows} />
}
