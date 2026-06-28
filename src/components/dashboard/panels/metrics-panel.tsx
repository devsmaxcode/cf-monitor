import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { MetricRangeDays } from '#/lib/monitor.server'
import {
  cacheStatus,
  countryName,
  metricMatrixMinWidth,
  metricRangeLabel,
  metricStatusDetails,
  metricTimeColumns,
  metricTimeGroups,
  matrixCountryColWidth,
  matrixTimeColWidth,
  matrixUrlColWidth,
  rangeOptions,
  statusMeta,
  statusTone,
} from '../helpers'
import type { MetricRow, MetricsPanelProps } from '../types'

const pageSizeOptions = [25, 50, 100] as const

export function MetricsPanel(props: MetricsPanelProps) {
  const [mounted, setMounted] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(50)
  const matrixRows = mounted ? props.rows : []
  const columns = useMemo(() => metricTimeColumns(matrixRows), [matrixRows])
  const groups = useMemo(() => metricTimeGroups(matrixRows, columns), [columns, matrixRows])
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const start = (safePage - 1) * pageSize
  const end = Math.min(start + pageSize, groups.length)
  const pageGroups = groups.slice(start, end)
  const tableStyle = {
    '--matrix-country-width': `${matrixCountryColWidth}px`,
    '--matrix-min-width': `${metricMatrixMinWidth(columns)}px`,
    '--matrix-time-width': `${matrixTimeColWidth}px`,
    '--matrix-url-width': `${matrixUrlColWidth}px`,
  } as CSSProperties

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [props.cacheStatus, props.country, props.page, props.query, props.rangeDays, pageSize])

  return (
    <section className="samples-panel" data-metrics-view>
      <div className="section-head">
        <h2>
          <span aria-hidden="true" className="section-icon">
            <Search size={16} />
          </span>
          Metrics Matrix
        </h2>
        <span>{props.rows.length} samples</span>
      </div>

      <div className="table-filters">
        <label>
          Search
          <input
            onChange={(event) => props.setQuery(event.target.value)}
            placeholder="URL, edge, proxy, CF-Ray..."
            value={props.query}
          />
        </label>
        <label className="metric-range-control">
          <span>Timeframe</span>
          <select
            aria-label="Round timeframe"
            onChange={(event) => props.setRangeDays(Number(event.target.value) as MetricRangeDays)}
            value={props.rangeDays}
          >
            {rangeOptions.map((days) => (
              <option key={days} value={days}>
                {metricRangeLabel(days)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Page
          <select onChange={(event) => props.setPage(event.target.value)} value={props.page}>
            <option value="">All pages</option>
            {props.pages.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          Country
          <select onChange={(event) => props.setCountry(event.target.value)} value={props.country}>
            <option value="">All countries</option>
            {props.countries.map((item) => (
              <option key={item} value={item}>
                {item} - {countryName(item)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select onChange={(event) => props.setCacheStatus(event.target.value)} value={props.cacheStatus}>
            <option value="">All statuses</option>
            {props.statuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mounted ? (
        <>
          {pageGroups.length ? (
            <div className="table-scroll metric-table-scroll">
              <table className="sample-table metric-matrix" style={tableStyle}>
                <colgroup>
                  <col className="matrix-url-col" />
                  <col className="matrix-country-col" />
                  {columns.map((column) => (
                    <col className="matrix-time-col" key={column.key} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th>Urls</th>
                    <th>Countries</th>
                    {columns.map((column) => (
                      <th
                        className={`metric-time-heading ${column.key.endsWith('-recheck') ? 'recheck-heading' : ''}`}
                        key={column.key}
                        title={`${column.meta}, ${column.label}`}
                      >
                        <strong>{column.label}</strong>
                        <span>{column.meta}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageGroups.map((group) => (
                    <tr key={group.key}>
                      <th className="url-cell compact-url-cell" title={group.page}>
                        <strong>{group.page}</strong>
                      </th>
                      <td className="country-cell" title={group.countryLabel}>
                        <strong>{group.countryLabel}</strong>
                      </td>
                      {columns.map((column) => (
                        <MetricStatusCell key={column.key} row={group.cells.get(column.key)} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="table-scroll metric-table-scroll matrix-empty-state">
              No samples match the current filters.
            </div>
          )}

          <div className="table-pagination">
            <div className="page-size-control">
              Rows
              <div className="page-size-dropdown">
                <button className="page-size-trigger" type="button">
                  <span>{pageSize}</span>
                  <i aria-hidden="true" />
                </button>
                <div className="page-size-options">
                  {pageSizeOptions.map((size) => (
                    <button
                      className={pageSize === size ? 'selected' : ''}
                      key={size}
                      onClick={() => setPageSize(size)}
                      type="button"
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <span className="pagination-range">
              Showing {groups.length ? start + 1 : 0}-{end} of {groups.length}
            </span>
            <div className="page-controls">
              <button
                aria-label="Previous page"
                className="icon-button compact"
                disabled={safePage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                title="Previous page"
                type="button"
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                Page {safePage} of {pageCount}
              </span>
              <button
                aria-label="Next page"
                className="icon-button compact"
                disabled={safePage >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                title="Next page"
                type="button"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state compact">Loading metrics matrix...</div>
      )}
    </section>
  )
}

function MetricStatusCell({ row }: { row?: MetricRow }) {
  if (!row) return <td className="status-cell empty-status">-</td>

  return (
    <td className="status-cell">
      <button className={`status-pill status-button ${statusTone(row)}`} type="button">
        <strong>{cacheStatus(row)}</strong>
        <span>{statusMeta(row)}</span>
      </button>
      <div className="sample-details">
        <dl>
          {metricStatusDetails(row).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </td>
  )
}
