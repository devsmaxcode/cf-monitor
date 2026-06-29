import { Activity, Cloud, Play, RefreshCw, Square } from 'lucide-react'
import { IconButton, NextRun, RuntimeBadge } from './ui'
import type { RuntimeChromeProps } from './types'
import { shortDate } from './helpers'

export function DashboardHeader({
  intervalSeconds,
  lastTimestamp,
  onAction,
  status,
}: RuntimeChromeProps) {
  return (
    <header className="appbar">
      <div className="brand">
        <span className="brand-mark">
          <Cloud size={22} />
        </span>
        <div>
          <strong>Cloudflare Cache Monitor</strong>
          <span>
            {lastTimestamp ? shortDate(lastTimestamp) : 'No samples yet'}
          </span>
        </div>
      </div>

      <div className="appbar-controls">
        <RuntimeBadge status={status} />
        <NextRun status={status} interval={intervalSeconds} />
        <div className="actions">
          <IconButton label="Refresh" onClick={() => onAction('refresh')}>
            <RefreshCw size={18} />
          </IconButton>
          {status.busy ? null : (
            <button
              className="button secondary"
              onClick={() => onAction('run-once')}
              type="button"
            >
              <Activity size={18} />
              Run Now
            </button>
          )}
          {status.running || status.busy ? (
            <button
              className="button danger"
              onClick={() => onAction('stop')}
              type="button"
            >
              <Square size={17} />
              Stop
            </button>
          ) : (
            <button
              className="button primary"
              onClick={() => onAction('start')}
              type="button"
            >
              <Play size={17} />
              Start
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
