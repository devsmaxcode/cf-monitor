import { createFileRoute } from '@tanstack/react-router'
import { useAgeConsumer } from '#/components/dashboard/dashboard-consumers'
import { AgePanel } from '#/components/dashboard/panels/age-panel'

export const Route = createFileRoute('/_dashboard/age')({
  component: AgeRoute,
})

function AgeRoute() {
  const dashboard = useAgeConsumer()
  return (
    <AgePanel
      error={dashboard.error}
      loading={dashboard.loading}
      rangeDays={dashboard.rangeDays}
      rows={dashboard.rows}
      setRangeDays={dashboard.setRangeDays}
    />
  )
}
