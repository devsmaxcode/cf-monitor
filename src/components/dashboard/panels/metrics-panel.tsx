import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import type { MetricRangeDays } from '#/lib/monitor.server'
import type { MetricTimeColumn, MetricTimeGroup } from '../helpers'
import {
  cacheStatus,
  countryName,
  metricMatrixMinWidth,
  metricRangeLabel,
  metricStatusDetails,
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
const skeletonColumnKeys = ['round-1', 'round-2', 'round-3'] as const
const skeletonRowKeys = [
  'page-1',
  'page-2',
  'page-3',
  'page-4',
  'page-5',
  'page-6',
  'page-7',
  'page-8',
  'page-9',
  'page-10',
  'page-11',
  'page-12',
  'page-13',
  'page-14',
  'page-15',
  'page-16',
] as const
const matrixHeaderHeight = 58
const matrixRowHeight = 56
const matrixScrollbarHeight = 18
const skeletonTableStyle = {
  '--matrix-country-width': `${matrixCountryColWidth}px`,
  '--matrix-min-width': `${matrixUrlColWidth + matrixCountryColWidth + skeletonColumnKeys.length * matrixTimeColWidth}px`,
  '--matrix-scroll-height': `${matrixHeaderHeight + skeletonRowKeys.length * matrixRowHeight + matrixScrollbarHeight}px`,
  '--matrix-time-width': `${matrixTimeColWidth}px`,
  '--matrix-url-width': `${matrixUrlColWidth}px`,
} as CSSProperties

export function MetricsPanel(props: MetricsPanelProps) {
  const [mounted, setMounted] = useState(false)
  const matrixRows = mounted ? props.rows : []
  const columns = mounted ? props.columns : []
  const groups = useMemo(
    () => metricTimeGroups(matrixRows, columns),
    [columns, matrixRows],
  )
  const pageCount = Math.max(1, Math.ceil(props.totalGroups / props.pageSize))
  const safePage = Math.min(props.pageIndex, pageCount)
  const start = props.totalGroups ? (safePage - 1) * props.pageSize : 0
  const pageGroups = groups
  const end = props.totalGroups ? Math.min(start + pageGroups.length, props.totalGroups) : 0
  const tableColumns = useMetricMatrixColumns(columns)
  const table = useReactTable({
    columns: tableColumns,
    data: pageGroups,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.key,
  })
  const tableRows = table.getRowModel().rows
  const tableStyle = {
    '--matrix-country-width': `${matrixCountryColWidth}px`,
    '--matrix-min-width': `${metricMatrixMinWidth(columns)}px`,
    '--matrix-scroll-height': `${matrixHeaderHeight + tableRows.length * matrixRowHeight + matrixScrollbarHeight}px`,
    '--matrix-time-width': `${matrixTimeColWidth}px`,
    '--matrix-url-width': `${matrixUrlColWidth}px`,
  } as CSSProperties
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (props.pageIndex !== safePage) props.setPageIndex(safePage)
  }, [props.pageIndex, props.setPageIndex, safePage])

  return (
    <section className="samples-panel" data-metrics-view>
      <div className="section-head">
        <h2>
          <span aria-hidden="true" className="section-icon">
            <Search size={16} />
          </span>
          Metrics Matrix
        </h2>
        <span>{props.totalRows} samples</span>
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
            onChange={(event) =>
              props.setRangeDays(Number(event.target.value) as MetricRangeDays)
            }
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
          <select
            onChange={(event) => props.setPage(event.target.value)}
            value={props.page}
          >
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
          <select
            onChange={(event) => props.setCountry(event.target.value)}
            value={props.country}
          >
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
          <select
            onChange={(event) => props.setCacheStatus(event.target.value)}
            value={props.cacheStatus}
          >
            <option value="">All statuses</option>
            {props.statuses.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      {props.error ? <div className="notice error">{props.error}</div> : null}

      {mounted && pageGroups.length ? (
        <div className="matrix-toolbar">
          <div className="matrix-chip-row" aria-label="Metrics matrix summary">
            <span>{props.totalGroups} rows</span>
            <span>{columns.length} rounds</span>
            <span>{props.countries.length} locations</span>
          </div>
          <span className="matrix-range-label">
            {start + 1}-{end} shown
          </span>
        </div>
      ) : null}

      {mounted && (!props.loading || pageGroups.length) ? (
        <>
          {pageGroups.length ? (
            <div className="table-scroll metric-table-scroll" style={tableStyle}>
              <table className="sample-table metric-matrix">
                <colgroup>
                  {table.getAllLeafColumns().map((column) => (
                    <col className={matrixColumnClass(column.id)} key={column.id} />
                  ))}
                </colgroup>
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th
                          className={matrixHeaderClass(header.column.id)}
                          key={header.id}
                          title={matrixHeaderTitle(header.column.id, columns)}
                        >
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {tableRows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => {
                        const cellClass = matrixCellClass(cell.column.id)
                        const title = matrixCellTitle(cell.column.id, row.original)
                        return cell.column.id === 'url' ? (
                          <th className={cellClass} key={cell.id} title={title}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </th>
                        ) : (
                          <td className={cellClass} key={cell.id} title={title}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        )
                      })}
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
                  <span>{props.pageSize}</span>
                  <i aria-hidden="true" />
                </button>
                <div className="page-size-options">
                  {pageSizeOptions.map((size) => (
                    <button
                      className={props.pageSize === size ? 'selected' : ''}
                      key={size}
                      onClick={() => props.setPageSize(size)}
                      type="button"
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <span className="pagination-range">
              Showing {props.totalGroups ? start + 1 : 0}-{end} of {props.totalGroups}
            </span>
            <div className="page-controls">
              <button
                aria-label="Previous page"
                className="icon-button compact"
                disabled={safePage <= 1}
                onClick={() => props.setPageIndex((value) => Math.max(1, value - 1))}
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
                onClick={() =>
                  props.setPageIndex((value) => Math.min(pageCount, value + 1))
                }
                title="Next page"
                type="button"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <MetricsMatrixSkeleton />
      )}
    </section>
  )
}

function useMetricMatrixColumns(columns: MetricTimeColumn[]) {
  return useMemo<ColumnDef<MetricTimeGroup>[]>(
    () => [
      {
        cell: ({ row }) => <strong>{row.original.page}</strong>,
        header: 'Urls',
        id: 'url',
      },
      {
        cell: ({ row }) => <strong>{row.original.countryLabel}</strong>,
        header: 'Countries',
        id: 'country',
      },
      ...columns.map((column) => ({
        cell: ({ row }) => <MetricStatusCellContent row={row.original.cells.get(column.key)} />,
        header: () => <MetricTimeHeader column={column} />,
        id: column.key,
      })),
    ],
    [columns],
  )
}

function MetricTimeHeader({ column }: { column: MetricTimeColumn }) {
  return (
    <>
      <strong>{column.label}</strong>
      <span>{column.meta}</span>
    </>
  )
}

function MetricsMatrixSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Metrics matrix loading"
      className="table-scroll metric-table-scroll"
      style={skeletonTableStyle}
    >
      <table
        aria-hidden="true"
        className="sample-table metric-matrix metric-matrix-skeleton"
      >
        <colgroup>
          <col className="matrix-url-col" />
          <col className="matrix-country-col" />
          {skeletonColumnKeys.map((column) => (
            <col className="matrix-time-col" key={column} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>
              <span className="skeleton-bar skeleton-heading" />
            </th>
            <th>
              <span className="skeleton-bar skeleton-heading short" />
            </th>
            {skeletonColumnKeys.map((column) => (
              <th className="metric-time-heading" key={column}>
                <span className="skeleton-bar skeleton-heading center" />
                <span className="skeleton-bar skeleton-heading center compact" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {skeletonRowKeys.map((row, index) => (
            <tr key={row}>
              <th className="url-cell compact-url-cell">
                <span
                  className={`skeleton-bar skeleton-url line-${(index % 3) + 1}`}
                />
              </th>
              <td className="country-cell">
                <span
                  className={`skeleton-bar skeleton-country line-${(index % 4) + 1}`}
                />
              </td>
              {skeletonColumnKeys.map((column, columnIndex) => (
                <td className="status-cell skeleton-status-cell" key={column}>
                  <span
                    className={`skeleton-pill tone-${(index + columnIndex) % 3}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MetricStatusCellContent({ row }: { row?: MetricRow }) {
  if (!row) return <span className="empty-status">-</span>

  return (
    <>
      <button
        className={`status-pill status-button ${statusTone(row)}`}
        type="button"
      >
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
    </>
  )
}

function matrixColumnClass(id: string) {
  if (id === 'url') return 'matrix-url-col'
  if (id === 'country') return 'matrix-country-col'
  return 'matrix-time-col'
}

function matrixHeaderClass(id: string) {
  if (id === 'url') return ''
  if (id === 'country') return ''
  return `metric-time-heading ${id.endsWith('-recheck') ? 'recheck-heading' : ''}`
}

function matrixCellClass(id: string) {
  if (id === 'url') return 'url-cell compact-url-cell'
  if (id === 'country') return 'country-cell'
  return 'status-cell'
}

function matrixCellTitle(id: string, group: MetricTimeGroup) {
  if (id === 'url') return group.page
  if (id === 'country') return group.countryLabel
  return undefined
}

function matrixHeaderTitle(id: string, columns: MetricTimeColumn[]) {
  const column = columns.find((item) => item.key === id)
  return column ? `${column.meta}, ${column.label}` : undefined
}
