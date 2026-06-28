import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Config } from '#/lib/monitor.server'
import { filterRows, unique, usedProxyRows } from './helpers'
import { useDashboardActions, useDashboardData } from './dashboard-context'
import type { MetricFilters } from './types'

export function useDashboardChrome() {
  const { config, metrics, status } = useDashboardData()
  const { error, triggerAction } = useDashboardActions()
  return { config, error, metrics, status, triggerAction }
}

export function useMetricsConsumer() {
  const { metrics, rangeDays } = useDashboardData()
  const { setRangeDays } = useDashboardActions()
  const [query, setQuery] = useState('')
  const [country, setCountry] = useState('')
  const [page, setPage] = useState('')
  const [cacheStatus, setCacheStatus] = useState('')

  const filteredRows = useMemo(
    () => filterRows(metrics.rows, { cacheStatus, country, page, query } satisfies MetricFilters),
    [cacheStatus, country, metrics.rows, page, query],
  )
  const countries = useMemo(
    () => unique(metrics.rows.map((row) => row.proxy_country || 'unknown')),
    [metrics.rows],
  )
  const pages = useMemo(
    () => unique(metrics.rows.map((row) => row.page || '').filter(Boolean)),
    [metrics.rows],
  )
  const statuses = useMemo(
    () => unique(metrics.rows.map((row) => (row.cf_cache_status || (row.error ? 'FAIL' : '-')).toUpperCase())),
    [metrics.rows],
  )

  return {
    cacheStatus,
    countries,
    country,
    filteredRows,
    page,
    pages,
    query,
    rangeDays,
    setCacheStatus,
    setCountry,
    setPage,
    setQuery,
    setRangeDays,
    statuses,
  }
}

export function useAgeConsumer() {
  const { metrics, rangeDays } = useDashboardData()
  const { setRangeDays } = useDashboardActions()
  return { rangeDays, rows: metrics.rows, setRangeDays }
}

export function useRoundsConsumer() {
  const { config, metrics, rangeDays, status } = useDashboardData()
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null)
  const selectedRound = metrics.rounds.find((round) => round.id === selectedRoundId) ?? metrics.rounds[0] ?? null

  return {
    config,
    rangeDays,
    rounds: metrics.rounds,
    rows: metrics.rows,
    selectedRound,
    setSelectedRoundId,
    status,
  }
}

export function useConfigConsumer() {
  const { config } = useDashboardData()
  const { saveConfigDraft, saving, setDirtyPanel } = useDashboardActions()
  const [draft, setDraft] = useState<Config>(config)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (dirty) return
    setDraft(config)
  }, [config, dirty])

  useEffect(() => () => setDirtyPanel(null), [setDirtyPanel])

  const onChange = (next: Config) => {
    setDraft(next)
    setDirty(true)
    setDirtyPanel('config')
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveConfigDraft(draft).then(() => setDirty(false)).catch(() => undefined)
  }

  return { draft, onChange, onSubmit, saving }
}

export function useProxiesConsumer() {
  const { metrics, proxyText } = useDashboardData()
  const { saveProxyDraft, saving, setDirtyPanel } = useDashboardActions()
  const [draft, setDraft] = useState(proxyText)
  const [dirty, setDirty] = useState(false)
  const proxyRows = useMemo(() => usedProxyRows(metrics.rows, proxyText), [metrics.rows, proxyText])

  useEffect(() => {
    if (dirty) return
    setDraft(proxyText)
  }, [dirty, proxyText])

  useEffect(() => () => setDirtyPanel(null), [setDirtyPanel])

  const setProxyText = (text: string) => {
    setDraft(text)
    setDirty(true)
    setDirtyPanel('proxies')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveProxyDraft(draft).then(() => setDirty(false)).catch(() => undefined)
  }

  return { proxyRows, proxyText: draft, saving, setProxyText, submit }
}

export function useLogsConsumer() {
  const { status } = useDashboardData()
  return { logs: status.logs }
}
