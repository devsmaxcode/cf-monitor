import { createFileRoute } from '@tanstack/react-router'
import { useRoundsConsumer } from '#/components/dashboard/dashboard-consumers'
import { RoundsPanel } from '#/components/dashboard/panels/rounds-panel'

export const Route = createFileRoute('/_dashboard/rounds')({
  component: RoundsRoute,
})

function RoundsRoute() {
  const dashboard = useRoundsConsumer()
  return (
    <RoundsPanel
      config={dashboard.config}
      error={dashboard.error}
      loading={dashboard.loading}
      rangeDays={dashboard.rangeDays}
      rounds={dashboard.rounds}
      rows={dashboard.rows}
      selectedRound={dashboard.selectedRound}
      setSelectedRoundId={dashboard.setSelectedRoundId}
      status={dashboard.status}
    />
  )
}
