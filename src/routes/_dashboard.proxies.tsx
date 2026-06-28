import { createFileRoute } from '@tanstack/react-router'
import { useProxiesConsumer } from '#/components/dashboard/dashboard-consumers'
import { ProxiesPanel } from '#/components/dashboard/panels/proxies-panel'

export const Route = createFileRoute('/_dashboard/proxies')({
  component: ProxiesRoute,
})

function ProxiesRoute() {
  const props = useProxiesConsumer()
  return <ProxiesPanel {...props} />
}
