import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Config, MetricsPagePayload } from '#/lib/monitor.server'
import {
  deleteMetricDataFn,
  getMetricAgeRowsFn,
  getMetricProxyRowsFn,
  getMetricRoundRowsFn,
  getMetricRowsPageFn,
} from '#/lib/monitor.functions'
import { usedProxyRows } from './helpers'
import { useDashboardActions, useDashboardData } from './dashboard-context'
import type { ConfigDraft, MetricFilters, MetricRow } from './types'

export function useDashboardChrome() {
  const { config, metrics, status } = useDashboardData()
  const { error, triggerAction } = useDashboardActions()
  return { config, error, metrics, status, triggerAction }
}

export function useMetricsConsumer(initialMetricsPage?: MetricsPagePayload) {
  const { metrics, rangeDays } = useDashboardData()
  const { setRangeDays } = useDashboardActions()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [country, setCountry] = useState('')
  const [pageFilter, setPageFilter] = useState('')
  const [cacheStatus, setCacheStatus] = useState('')
  const [pageIndex, setPageIndex] = useState(1)
  const [pageSize, setPageSizeState] = useState(50)
  const [pagedMetrics, setPagedMetrics] = useState<MetricsPagePayload | null>(
    initialMetricsPage ?? null,
  )
  const [loading, setLoading] = useState(!initialMetricsPage)
  const [pageError, setPageError] = useState('')
  const [deletingMetrics, setDeletingMetrics] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const filters = useMemo(
    () =>
      ({
        cacheStatus,
        country,
        page: pageFilter,
        query: debouncedQuery,
      }) satisfies MetricFilters,
    [cacheStatus, country, debouncedQuery, pageFilter],
  )
  const defaultMetricsView =
    !cacheStatus &&
    !country &&
    !debouncedQuery &&
    !pageFilter &&
    pageIndex === 1 &&
    pageSize === 50
  const initialMetricsFresh = Boolean(
    initialMetricsPage &&
    initialMetricsPage.range.days === rangeDays &&
    initialMetricsPage.totalRows === metrics.summary.totalRows &&
    initialMetricsPage.range.availableTo === metrics.summary.lastTimestamp,
  )
  const pagedMetricsFresh = pagedMetrics?.range.days === rangeDays
  const metricsPage =
    defaultMetricsView && initialMetricsFresh
      ? initialMetricsPage
      : pagedMetricsFresh
        ? pagedMetrics
        : null
  const countries = useMemo(
    () => metricsPage?.countries ?? [],
    [metricsPage?.countries],
  )
  const pages = useMemo(() => metricsPage?.pages ?? [], [metricsPage?.pages])
  const statuses = useMemo(
    () => metricsPage?.statuses ?? [],
    [metricsPage?.statuses],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let active = true
    setPageError('')

    if (defaultMetricsView && initialMetricsFresh && initialMetricsPage) {
      setPagedMetrics(initialMetricsPage)
      setLoading(false)
      return () => {
        active = false
      }
    }

    if (!metricsPage) {
      setLoading(true)
      setPagedMetrics(null)
    }

    void getMetricRowsPageFn({
      data: {
        days: rangeDays,
        filters,
        maxColumns: 80,
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
    defaultMetricsView,
    filters,
    initialMetricsFresh,
    initialMetricsPage,
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
    columns: metricsPage?.columns ?? [],
    countries,
    country,
    deletingMetrics,
    error: pageError,
    filteredRows: metricsPage?.rows ?? [],
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
    totalGroups: metricsPage?.totalGroups ?? 0,
    totalRows: metricsPage?.totalRows ?? metrics.summary.totalRows,
  }
}

export function useAgeConsumer() {
  const { metrics, rangeDays } = useDashboardData()
  const { setRangeDays } = useDashboardActions()
  const [rows, setRows] = useState<MetricRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    void getMetricAgeRowsFn({ data: { days: rangeDays } })
      .then((payload) => {
        if (active) setRows(payload.rows)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [metrics.summary.metricVersion, rangeDays])

  return { error, loading, rangeDays, rows, setRangeDays }
}

export function useRoundsConsumer() {
  const { config, metrics, rangeDays, status } = useDashboardData()
  const [selectedRoundId, setSelectedRoundId] = useState<number | null>(null)
  const selectedRound =
    metrics.rounds.find((round) => round.id === selectedRoundId) ??
    metrics.rounds.at(0) ??
    null
  const [rows, setRows] = useState<MetricRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedRound) {
      setRows([])
      return
    }

    let active = true
    setLoading(true)
    setError('')

    void getMetricRoundRowsFn({ data: { roundId: selectedRound.id } })
      .then((payload) => {
        if (active) setRows(payload.rows)
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [metrics.summary.metricVersion, selectedRound])

  return {
    config,
    error,
    loading,
    rangeDays,
    rounds: metrics.rounds,
    rows,
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
    globalConcurrency: String(config.globalConcurrency),
    hitIntervalSeconds: String(config.hitIntervalSeconds),
    maxProxiesPerCountry: String(config.maxProxiesPerCountry),
    missIntervalSeconds: String(config.missIntervalSeconds),
    retentionDays: String(config.retentionDays),
    roundIntervalSeconds: String(config.roundIntervalSeconds),
    pageCountryOverrides: config.pageCountryOverrides,
    timeout: String(config.timeout),
  }
}

function draftToConfig(draft: ConfigDraft): Config {
  return {
    ...draft,
    delay: Number(draft.delay),
    globalConcurrency: Number(draft.globalConcurrency),
    hitIntervalSeconds: Number(draft.hitIntervalSeconds),
    maxProxiesPerCountry: Number(draft.maxProxiesPerCountry),
    missIntervalSeconds: Number(draft.missIntervalSeconds),
    pageCountryOverrides: draft.pageCountryOverrides,
    retentionDays: Number(draft.retentionDays),
    roundIntervalSeconds: Number(draft.roundIntervalSeconds),
    timeout: Number(draft.timeout),
  }
}

export function useProxiesConsumer() {
  const { metrics, proxyText, rangeDays } = useDashboardData()
  const { saveProxyDraft, saving, setDirtyPanel } = useDashboardActions()
  const [draft, setDraft] = useState(proxyText)
  const [dirty, setDirty] = useState(false)
  const [rows, setRows] = useState<MetricRow[]>([])
  const proxyRows = useMemo(
    () => usedProxyRows(rows, proxyText),
    [proxyText, rows],
  )

  useEffect(() => {
    let active = true

    void getMetricProxyRowsFn({ data: { days: rangeDays } })
      .then((payload) => {
        if (active) setRows(payload.rows)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [metrics.summary.metricVersion, rangeDays])

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
