import type {
  Config,
  DashboardPayload,
  MetricRangeDays,
  MetricsPayload,
  MonitorState,
} from '#/lib/monitor.server'
import type { MetricRoundRow } from '#/lib/metrics-db'

export type DashboardSection = 'metrics' | 'rounds' | 'age' | 'config' | 'proxies' | 'logs'
export type MetricRow = MetricsPayload['rows'][number]

export type DashboardRouteProps = {
  initial: DashboardPayload
  section: DashboardSection
}

export type RuntimeAction = 'start' | 'stop' | 'run-once' | 'refresh'

export type MetricFilters = {
  cacheStatus: string
  country: string
  page: string
  query: string
}

export type UsedProxyRow = {
  country: string
  error: string
  page: string
  proxy: string
  responseMs: string
  source: string
  status: string
  timestamp: string
}

export type ConfigPanelProps = {
  draft: Config
  onChange: (draft: Config) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  saving: boolean
}

export type MetricsPanelProps = {
  cacheStatus: string
  countries: string[]
  country: string
  page: string
  pages: string[]
  query: string
  rangeDays: MetricRangeDays
  rows: MetricRow[]
  setCacheStatus: (value: string) => void
  setCountry: (value: string) => void
  setPage: (value: string) => void
  setQuery: (value: string) => void
  setRangeDays: (value: MetricRangeDays) => void
  statuses: string[]
}

export type RoundsPanelProps = {
  config: Config
  rangeDays: MetricRangeDays
  rounds: MetricRoundRow[]
  rows: MetricRow[]
  selectedRound: MetricRoundRow | null
  setSelectedRoundId: (id: number) => void
  status: MonitorState
}

export type ProxiesPanelProps = {
  proxyRows: UsedProxyRow[]
  proxyText: string
  saving: boolean
  setProxyText: (value: string) => void
  submit: (event: React.FormEvent<HTMLFormElement>) => void
}

export type RuntimeChromeProps = {
  intervalSeconds: number
  lastTimestamp: string | null
  onAction: (kind: RuntimeAction) => void
  status: MonitorState
}
