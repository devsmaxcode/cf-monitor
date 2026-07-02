import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Config, MetricsPagePayload } from '#/lib/monitor.server'
import {
  deleteMetricDataFn,
  getMetricRowsPageFn,
} from '#/lib/monitor.functions'
import { unique, usedProxyRows } from './helpers'
import { useDashboardActions, useDashboardData } from './dashboard-context'
import type { ConfigDraft, MetricFilters } from './types'

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
  const [pageFilter, setPageFilter] = useState('')
  const [cacheStatus, setCacheStatus] = useState('')
  const [pageIndex, setPageIndex] = useState(1)
  const [pageSize, setPageSizeState] = useState(50)
  const [pagedMetrics, setPagedMetrics] = useState<MetricsPagePayload | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [deletingMetrics, setDeletingMetrics] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const countries = useMemo(
    () =>
      pagedMetrics?.countries ??
      unique(metrics.rows.map((row) => row.proxy_country || 'unknown')),
    [metrics.rows, pagedMetrics?.countries],
  )
  const pages = useMemo(
    () =>
      pagedMetrics?.pages ??
      unique(metrics.rows.map((row) => row.page || '').filter(Boolean)),
    [metrics.rows, pagedMetrics?.pages],
  )
  const statuses = useMemo(
    () =>
      pagedMetrics?.statuses ??
      unique(
        metrics.rows.map((row) =>
          (row.cf_cache_status || (row.error ? 'FAIL' : '-')).toUpperCase(),
        ),
      ),
    [metrics.rows, pagedMetrics?.statuses],
  )
  const filters = useMemo(
    () =>
      ({
        cacheStatus,
        country,
        page: pageFilter,
        query,
      }) satisfies MetricFilters,
    [cacheStatus, country, pageFilter, query],
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    setPageError('')
    setPagedMetrics(null)

    void getMetricRowsPageFn({
      data: {
        days: rangeDays,
        filters,
        page: pageIndex,
        pageSize,
      },
    })
      .then((payload) => {
        if (active) setPagedMetrics(payload)
      })
      .catch((error: unknown) => {
        if (active)
          setPageError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [
    filters,
    metrics.summary.metricVersion,
    pageIndex,
    pageSize,
    rangeDays,
    refreshToken,
  ])

  const resetPage = () => setPageIndex(1)
  const setMetricQuery = (value: string) => {
    resetPage()
    setQuery(value)
  }
  const setMetricCountry = (value: string) => {
    resetPage()
    setCountry(value)
  }
  const setMetricPage = (value: string) => {
    resetPage()
    setPageFilter(value)
  }
  const setMetricCacheStatus = (value: string) => {
    resetPage()
    setCacheStatus(value)
  }
  const setMetricRangeDays = (value: typeof rangeDays) => {
    resetPage()
    setRangeDays(value)
  }
  const setPageSize = (value: number) => {
    resetPage()
    setPageSizeState(value)
  }
  const deleteMetricData = async () => {
    if (deletingMetrics) return

    setDeletingMetrics(true)
    setPageError('')
    try {
      await deleteMetricDataFn()
      setRefreshToken((value) => value + 1)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : String(error))
    } finally {
      setDeletingMetrics(false)
    }
  }

  return {
    cacheStatus,
    columns: pagedMetrics?.columns ?? metrics.timeColumns,
    countries,
    country,
    deletingMetrics,
    error: pageError,
    filteredRows: pagedMetrics?.rows ?? [],
    loading,
    onDeleteMetricData: deleteMetricData,
    page: pageFilter,
    pageIndex,
    pages,
    pageSize,
    query,
    rangeDays,
    setCacheStatus: setMetricCacheStatus,
    setCountry: setMetricCountry,
    setPage: setMetricPage,
    setPageIndex,
    setPageSize,
    setQuery: setMetricQuery,
    setRangeDays: setMetricRangeDays,
    statuses,
    totalGroups: pagedMetrics?.totalGroups ?? 0,
    totalRows: pagedMetrics?.totalRows ?? metrics.summary.totalRows,
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
  const selectedRound =
    metrics.rounds.find((round) => round.id === selectedRoundId) ??
    metrics.rounds.at(0) ??
    null

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
  const [draft, setDraft] = useState<ConfigDraft>(() => configToDraft(config))
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (dirty) return
    setDraft(configToDraft(config))
  }, [config, dirty])

  useEffect(() => () => setDirtyPanel(null), [setDirtyPanel])

  const onChange = (next: ConfigDraft) => {
    setDraft(next)
    setDirty(true)
    setDirtyPanel('config')
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveConfigDraft(draftToConfig(draft))
      .then(() => setDirty(false))
      .catch(() => undefined)
  }

  return { draft, onChange, onSubmit, saving }
}

function configToDraft(config: Config): ConfigDraft {
  return {
    ...config,
    delay: String(config.delay),
    hitIntervalSeconds: String(config.hitIntervalSeconds),
    maxProxiesPerCountry: String(config.maxProxiesPerCountry),
    missIntervalSeconds: String(config.missIntervalSeconds),
    roundIntervalSeconds: String(config.roundIntervalSeconds),
    timeout: String(config.timeout),
  }
}

function draftToConfig(draft: ConfigDraft): Config {
  return {
    ...draft,
    delay: Number(draft.delay),
    hitIntervalSeconds: Number(draft.hitIntervalSeconds),
    maxProxiesPerCountry: Number(draft.maxProxiesPerCountry),
    missIntervalSeconds: Number(draft.missIntervalSeconds),
    roundIntervalSeconds: Number(draft.roundIntervalSeconds),
    timeout: Number(draft.timeout),
  }
}

export function useProxiesConsumer() {
  const { metrics, proxyText } = useDashboardData()
  const { saveProxyDraft, saving, setDirtyPanel } = useDashboardActions()
  const [draft, setDraft] = useState(proxyText)
  const [dirty, setDirty] = useState(false)
  const proxyRows = useMemo(
    () => usedProxyRows(metrics.rows, proxyText),
    [metrics.rows, proxyText],
  )

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
    void saveProxyDraft(draft)
      .then(() => setDirty(false))
      .catch(() => undefined)
  }

  return { proxyRows, proxyText: draft, saving, setProxyText, submit }
}

export function useLogsConsumer() {
  const { status } = useDashboardData()
  return { logs: status.logs }
}
