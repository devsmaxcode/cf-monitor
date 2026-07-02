import { Outlet } from '@tanstack/react-router'
import type { DashboardPayload, MetricRangeDays } from '#/lib/monitor.server'
import { DashboardHeader } from './dashboard-header'
import { DashboardNav } from './dashboard-nav'
import { DashboardProvider } from './dashboard-context'
import { useDashboardChrome } from './dashboard-consumers'

export function DashboardShell({
  initial,
  rangeDays,
  setRangeDays,
}: {
  initial: DashboardPayload
  rangeDays: MetricRangeDays
  setRangeDays: (value: MetricRangeDays) => void
}) {
  return (
    <DashboardProvider
      initial={initial}
      rangeDays={rangeDays}
      setRangeDays={setRangeDays}
    >
      <DashboardFrame />
    </DashboardProvider>
  )
}

function DashboardFrame() {
  const { config, error, metrics, status, triggerAction } = useDashboardChrome()

  return (
    <main className="app-shell">
      <DashboardHeader
        intervalSeconds={config.roundIntervalSeconds}
        lastTimestamp={metrics.summary.lastTimestamp}
        onAction={triggerAction}
        status={status}
      />
      {error ? <div className="notice error">{error}</div> : null}
      <DashboardNav />
      <Outlet />
    </main>
  )
}
