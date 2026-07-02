import { Link } from '@tanstack/react-router'
import { defaultMetricRangeDays } from '#/lib/metric-range'

const links = [
  { label: 'Metrics', to: '/metrics' },
  { label: 'Rounds', to: '/rounds' },
  { label: 'Summary', to: '/age' },
  { label: 'Config', to: '/config' },
  { label: 'Proxies', to: '/proxies' },
  { label: 'Logs', to: '/logs' },
] as const

export function DashboardNav() {
  return (
    <nav className="tabs" aria-label="Dashboard sections">
      {links.map((link) => (
        <Link
          activeProps={{ className: 'active' }}
          key={link.to}
          search={(previous) => ({
            ...previous,
            days: previous.days ?? defaultMetricRangeDays,
          })}
          to={link.to}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
