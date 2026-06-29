import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import {
  getDashboardFn,
  getProxiesFn,
  getRuntimeFn,
  runOnceFn,
  saveConfigFn,
  saveProxiesFn,
  startMonitorFn,
  stopMonitorFn,
} from '#/lib/monitor.functions'
import type {
  Config,
  DashboardPayload,
  MetricsPayload,
  MonitorState,
} from '#/lib/monitor.server'
import { normalizeDraft } from './helpers'
import { useStoredRange } from './use-stored-range'
import type { DashboardSection, RuntimeAction } from './types'

type DashboardDataContextValue = {
  config: Config
  metrics: MetricsPayload
  proxyText: string
  rangeDays: ReturnType<typeof useStoredRange>[0]
  status: MonitorState
}

type DashboardActionsContextValue = {
  error: string
  saveConfigDraft: (draft: Config) => Promise<void>
  saveProxyDraft: (text: string) => Promise<void>
  saving: boolean
  setDirtyPanel: (value: DashboardSection | null) => void
  setRangeDays: ReturnType<typeof useStoredRange>[1]
  triggerAction: (kind: RuntimeAction) => Promise<void>
}

const DashboardDataContext = createContext<DashboardDataContextValue | null>(
  null,
)
const DashboardActionsContext =
  createContext<DashboardActionsContextValue | null>(null)

export function DashboardProvider({
  children,
  initial,
}: {
  children: ReactNode
  initial: DashboardPayload
}) {
  const [rangeDays, setRangeDays] = useStoredRange()
  const [config, setConfig] = useState<Config>(initial.config)
  const [metrics, setMetrics] = useState<MetricsPayload>(initial.metrics)
  const [status, setStatus] = useState<MonitorState>(initial.status)
  const [proxyText, setProxyText] = useState(initial.proxies.text)
  const [dirtyPanel, setDirtyPanel] = useState<DashboardSection | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const showError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  const loadDashboard = useCallback(
    async (days = rangeDays) => {
      setError('')
      const payload = await getDashboardFn({ data: { days } })
      setConfig(payload.config)
      setMetrics(payload.metrics)
      setStatus(payload.status)
      setProxyText(payload.proxies.text)
    },
    [rangeDays],
  )

  const refreshRuntime = useCallback(
    async (days = rangeDays) => {
      const payload = await getRuntimeFn({ data: { days } })
      setMetrics(payload.metrics)
      setStatus(payload.status)
    },
    [rangeDays],
  )

  useEffect(() => {
    void loadDashboard(rangeDays).catch(showError)
  }, [loadDashboard, rangeDays, showError])

  useEffect(() => {
    const timer = window.setInterval(
      () => {
        if (dirtyPanel) return
        void refreshRuntime().catch(showError)
      },
      status.busy || status.running ? 3000 : 12000,
    )

    return () => window.clearInterval(timer)
  }, [dirtyPanel, refreshRuntime, showError, status.busy, status.running])

  const triggerAction = useCallback(
    async (kind: RuntimeAction) => {
      setError('')
      try {
        if (kind === 'start') setStatus(await startMonitorFn())
        if (kind === 'stop') setStatus(await stopMonitorFn())
        if (kind === 'run-once') setStatus(await runOnceFn())
        await loadDashboard()
      } catch (err) {
        showError(err)
      }
    },
    [loadDashboard, showError],
  )

  const saveConfigDraft = useCallback(
    async (draft: Config) => {
      setSaving(true)
      setError('')
      try {
        const saved = await saveConfigFn({ data: normalizeDraft(draft) })
        setConfig(saved)
        setDirtyPanel(null)
        await loadDashboard()
      } catch (err) {
        showError(err)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [loadDashboard, showError],
  )

  const saveProxyDraft = useCallback(
    async (text: string) => {
      setSaving(true)
      setError('')
      try {
        await saveProxiesFn({ data: { text } })
        const next = await getProxiesFn()
        setProxyText(next.text)
        setDirtyPanel(null)
        await refreshRuntime()
      } catch (err) {
        showError(err)
        throw err
      } finally {
        setSaving(false)
      }
    },
    [refreshRuntime, showError],
  )

  const data = useMemo(
    () => ({ config, metrics, proxyText, rangeDays, status }),
    [config, metrics, proxyText, rangeDays, status],
  )

  const actions = useMemo(
    () => ({
      error,
      saveConfigDraft,
      saveProxyDraft,
      saving,
      setDirtyPanel,
      setRangeDays,
      triggerAction,
    }),
    [
      error,
      saveConfigDraft,
      saveProxyDraft,
      saving,
      setRangeDays,
      triggerAction,
    ],
  )

  return (
    <DashboardDataContext.Provider value={data}>
      <DashboardActionsContext.Provider value={actions}>
        {children}
      </DashboardActionsContext.Provider>
    </DashboardDataContext.Provider>
  )
}

export function useDashboardData() {
  const context = useContext(DashboardDataContext)
  if (!context)
    throw new Error('useDashboardData must be used within DashboardProvider')
  return context
}

export function useDashboardActions() {
  const context = useContext(DashboardActionsContext)
  if (!context)
    throw new Error('useDashboardActions must be used within DashboardProvider')
  return context
}
