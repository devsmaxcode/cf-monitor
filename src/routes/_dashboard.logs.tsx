import { createFileRoute } from '@tanstack/react-router'
import { useLogsConsumer } from '#/components/dashboard/dashboard-consumers'
import { LogsPanel } from '#/components/dashboard/panels/logs-panel'

export const Route = createFileRoute('/_dashboard/logs')({
  component: LogsRoute,
})

function LogsRoute() {
  const { logs } = useLogsConsumer()
  return <LogsPanel logs={logs} />
}
