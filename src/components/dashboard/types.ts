import type {
  Config,
  DashboardPayload,
  MetricRangeDays,
  MonitorState,
} from '#/lib/monitor.server'
import type { MetricRoundRow, MetricRow as MetricDbRow } from '#/lib/metrics-db'
import type { MetricTimeColumn } from './helpers'

export type DashboardSection =
  'metrics' | 'rounds' | 'age' | 'config' | 'proxies' | 'logs'
export type MetricRow = MetricDbRow

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

type ConfigNumberKey =
  | 'delay'
  | 'globalConcurrency'
  | 'hitIntervalSeconds'
  | 'maxProxiesPerCountry'
  | 'missIntervalSeconds'
  | 'retentionDays'
  | 'roundIntervalSeconds'
  | 'timeout'

export type ConfigDraft = Omit<Config, ConfigNumberKey> & {
  [key in ConfigNumberKey]: string
}

export type ConfigPanelProps = {
  draft: ConfigDraft
  onChange: (draft: ConfigDraft) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  saving: boolean
}

export type MetricsPanelProps = {
  cacheStatus: string
  columns: MetricTimeColumn[]
  countries: string[]
  country: string
  deletingMetrics: boolean
  error: string
  loading: boolean
  onDeleteMetricData: () => Promise<void>
  page: string
  pageIndex: number
  pages: string[]
  pageSize: number
  query: string
  rangeDays: MetricRangeDays
  rows: MetricRow[]
  setCacheStatus: (value: string) => void
  setCountry: (value: string) => void
  setPage: (value: string) => void
  setPageIndex: (value: number | ((current: number) => number)) => void
  setPageSize: (value: number) => void
  setQuery: (value: string) => void
  setRangeDays: (value: MetricRangeDays) => void
  statuses: string[]
  totalGroups: number
  totalRows: number
}

export type RoundsPanelProps = {
  config: Config
  error: string
  loading: boolean
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
