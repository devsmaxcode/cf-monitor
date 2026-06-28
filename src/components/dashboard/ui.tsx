import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { MonitorState } from '#/lib/monitor.server'
import type { MetricRow } from './types'
import { cacheStatus, countdown, statusTone } from './helpers'

export function RuntimeBadge({ status }: { status: MonitorState }) {
  const live = status.running || status.busy
  return (
    <span className={`state-chip ${live ? 'on' : ''}`}>
      <i />
      {status.busy ? `Running round ${status.round || ''}` : status.running ? 'Scheduled' : 'Stopped'}
    </span>
  )
}

export function NextRun({ interval, status }: { interval: number; status: MonitorState }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const updateNow = () => setNow(Date.now())
    updateNow()
    const timer = window.setInterval(updateNow, 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (status.busy && status.crawl) {
    const progress = status.crawl.totalUrls
      ? Math.round((status.crawl.requestedUrls / status.crawl.totalUrls) * 100)
      : 0
    return (
      <div
        className="crawl-progress"
        role="status"
        style={{ '--crawl-progress': `${progress}%` } as CSSProperties}
        title={status.crawl.activeUrl || ''}
      >
        <span aria-hidden="true" className="crawl-spinner" />
        <span className="crawl-copy">
          <strong>Requesting URLs</strong>
          <span>
            Round {status.round || '-'} - {status.crawl.requestedUrls} of {status.crawl.totalUrls} requested
          </span>
        </span>
        <span aria-hidden="true" className="crawl-track">
          <i />
          <b>
            {status.crawl.requestedUrls}/{status.crawl.totalUrls}
          </b>
        </span>
      </div>
    )
  }

  if (!status.nextRunAt || !status.running) return null
  if (now === null) return null

  const seconds = Math.max(0, Math.round((Date.parse(status.nextRunAt) - now) / 1000))
  const progress = Math.max(0, Math.min(100, 100 - Math.round((seconds / interval) * 100)))
  return (
    <div
      className="next-run-card"
      role="timer"
      style={{ '--next-run-progress': `${progress}%` } as CSSProperties}
      title={`Next run: ${status.nextRunAt}`}
    >
      <span aria-hidden="true" className="next-run-pulse">
        <i />
      </span>
      <span className="next-run-copy">
        <strong>Next round</strong>
      </span>
      <span className="next-run-clock">{seconds ? countdown(seconds) : 'Starting'}</span>
      <span aria-hidden="true" className="next-run-track">
        <i />
      </span>
    </div>
  )
}

export function Stat({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="stat">
      {icon ? <span>{icon}</span> : null}
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  )
}

export function IconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button aria-label={label} className="icon-button" onClick={onClick} title={label} type="button">
      {children}
    </button>
  )
}

export function Check(props: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="check">
      <input checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} type="checkbox" />
      <span>{props.label}</span>
    </label>
  )
}

export function StatusPill({ row }: { row: MetricRow }) {
  const value = cacheStatus(row)
  const tone = statusTone(row)
  return <strong className={`status-pill ${tone}`}>{value}</strong>
}
