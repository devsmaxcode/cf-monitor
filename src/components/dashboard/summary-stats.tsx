import { Activity, Database, Globe2, Timer } from 'lucide-react'
import type { MetricsPayload } from '#/lib/monitor.server'
import { compact } from './helpers'
import { Stat } from './ui'

export function SummaryStats({ metrics }: { metrics: MetricsPayload }) {
  return (
    <section className="summary-grid">
      <Stat
        icon={<Database size={18} />}
        label="Rows"
        value={compact(metrics.summary.totalRows)}
      />
      <Stat
        icon={<Activity size={18} />}
        label="Latest Hits"
        value={compact(metrics.summary.latestHits)}
      />
      <Stat
        icon={<Globe2 size={18} />}
        label="Locations"
        value={compact(metrics.summary.countryCount)}
      />
      <Stat
        icon={<Timer size={18} />}
        label="Avg Response"
        value={`${metrics.summary.avgResponseMs} ms`}
      />
    </section>
  )
}
