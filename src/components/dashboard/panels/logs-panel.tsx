import { Activity } from 'lucide-react'

export function LogsPanel({ logs }: { logs: string[] }) {
  return (
    <section className="logs-panel full-log-panel">
      <div className="section-head">
        <h2>
          <span aria-hidden="true" className="section-icon">
            <Activity size={16} />
          </span>
          Collector Log
        </h2>
        <span>{logs.length ? `${logs.length} lines` : 'No logs'}</span>
      </div>
      <pre>{logs.length ? logs.join('\n') : 'No collector output yet.'}</pre>
    </section>
  )
}
