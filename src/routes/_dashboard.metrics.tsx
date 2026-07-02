import { createFileRoute } from '@tanstack/react-router'
import { useMetricsConsumer } from '#/components/dashboard/dashboard-consumers'
import { MetricsPanel } from '#/components/dashboard/panels/metrics-panel'

export const Route = createFileRoute('/_dashboard/metrics')({
  component: MetricsRoute,
})

function MetricsRoute() {
  const { filteredRows: rows, ...dashboard } = useMetricsConsumer()
  return <MetricsPanel {...dashboard} rows={rows} />
}
