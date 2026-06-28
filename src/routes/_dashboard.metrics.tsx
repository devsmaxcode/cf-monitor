import { createFileRoute } from '@tanstack/react-router'
import { useMetricsConsumer } from '#/components/dashboard/dashboard-consumers'
import { MetricsPanel } from '#/components/dashboard/panels/metrics-panel'

export const Route = createFileRoute('/_dashboard/metrics')({
  component: MetricsRoute,
})

function MetricsRoute() {
  const dashboard = useMetricsConsumer()
  return (
    <MetricsPanel
      cacheStatus={dashboard.cacheStatus}
      countries={dashboard.countries}
      country={dashboard.country}
      page={dashboard.page}
      pages={dashboard.pages}
      query={dashboard.query}
      rangeDays={dashboard.rangeDays}
      rows={dashboard.filteredRows}
      setCacheStatus={dashboard.setCacheStatus}
      setCountry={dashboard.setCountry}
      setPage={dashboard.setPage}
      setQuery={dashboard.setQuery}
      setRangeDays={dashboard.setRangeDays}
      statuses={dashboard.statuses}
    />
  )
}
