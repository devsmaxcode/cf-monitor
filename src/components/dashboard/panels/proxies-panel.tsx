import { Save } from 'lucide-react'
import {
  countryName,
  normalizeList,
  shortDate,
  statusToneFromValue,
} from '../helpers'
import type { ProxiesPanelProps, UsedProxyRow } from '../types'

export function ProxiesPanel(props: ProxiesPanelProps) {
  const count = normalizeList(props.proxyText).length

  return (
    <form className="form-panel proxy-panel" onSubmit={props.submit}>
      <div className="section-head">
        <h2>Used Proxies</h2>
        <span>{props.proxyRows.length} recent</span>
      </div>
      <div className="table-scroll proxy-scroll">
        {props.proxyRows.length ? (
          <table className="sample-table proxy-table">
            <thead>
              <tr>
                <th>Proxy</th>
                <th>Country</th>
                <th>Source</th>
                <th>Status</th>
                <th>Response</th>
                <th>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {props.proxyRows.map((row) => (
                <ProxyRow key={`${row.country}-${row.proxy}`} row={row} />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            No proxy usage recorded yet. Run the monitor once to populate this
            list.
          </div>
        )}
      </div>
      <div className="section-head">
        <h2>Local Proxies</h2>
        <span>{count} enabled</span>
      </div>
      <textarea
        name="proxies"
        rows={20}
        spellCheck={false}
        value={props.proxyText}
        onChange={(event) => props.setProxyText(event.target.value)}
      />
      <div className="form-actions">
        <button
          className="button primary icon-text"
          disabled={props.saving}
          type="submit"
        >
          <Save size={18} />
          <span>{props.saving ? 'Saving...' : 'Save Proxies'}</span>
        </button>
      </div>
    </form>
  )
}

function ProxyRow({ row }: { row: UsedProxyRow }) {
  return (
    <tr title={row.error || row.page}>
      <th className="url-cell">
        <strong>{row.proxy}</strong>
        <span>{row.page || '-'}</span>
      </th>
      <td>{countryName(row.country)}</td>
      <td>{row.source}</td>
      <td>
        <strong
          className={`status-pill ${statusToneFromValue(row.status, row.error)}`}
        >
          {row.status}
        </strong>
      </td>
      <td>{row.responseMs ? `${row.responseMs} ms` : '-'}</td>
      <td>{row.timestamp ? shortDate(row.timestamp) : '-'}</td>
    </tr>
  )
}
