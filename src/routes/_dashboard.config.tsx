import { createFileRoute } from '@tanstack/react-router'
import { useConfigConsumer } from '#/components/dashboard/dashboard-consumers'
import { ConfigPanel } from '#/components/dashboard/panels/config-panel'

export const Route = createFileRoute('/_dashboard/config')({
  component: ConfigRoute,
})

function ConfigRoute() {
  const props = useConfigConsumer()
  return <ConfigPanel {...props} />
}
