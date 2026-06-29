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
      columns={dashboard.columns}
      countries={dashboard.countries}
      country={dashboard.country}
      error={dashboard.error}
      loading={dashboard.loading}
      page={dashboard.page}
      pageIndex={dashboard.pageIndex}
      pages={dashboard.pages}
      pageSize={dashboard.pageSize}
      query={dashboard.query}
      rangeDays={dashboard.rangeDays}
      rows={dashboard.filteredRows}
      setCacheStatus={dashboard.setCacheStatus}
      setCountry={dashboard.setCountry}
      setPage={dashboard.setPage}
      setPageIndex={dashboard.setPageIndex}
      setPageSize={dashboard.setPageSize}
      setQuery={dashboard.setQuery}
      setRangeDays={dashboard.setRangeDays}
      statuses={dashboard.statuses}
      totalGroups={dashboard.totalGroups}
      totalRows={dashboard.totalRows}
    />
  )
}
