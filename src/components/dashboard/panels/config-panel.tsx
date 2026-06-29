import { Link, Save, Settings2, Shuffle, Timer, User } from 'lucide-react'
import type { Config } from '#/lib/monitor.server'
import { duration, normalizeList, unique } from '../helpers'
import { Check } from '../ui'
import type { ConfigPanelProps } from '../types'

export function ConfigPanel(props: ConfigPanelProps) {
  const update = <TKey extends keyof Config>(key: TKey, value: Config[TKey]) =>
    props.onChange({ ...props.draft, [key]: value })
  const summary = configSummary(props.draft)
  const countries = normalizeList(props.draft.proxyCountries)

  return (
    <form className="form-panel config-panel" onSubmit={props.onSubmit}>
      <div className="section-head">
        <h2>
          <span aria-hidden="true" className="section-icon">
            <Settings2 size={16} />
          </span>
          Configuration
        </h2>
        <span>
          {summary.urls} URLs / {summary.locations} locations
        </span>
      </div>

      <div className="config-body">
        <div className="config-layout">
          <div className="config-column config-main">
            <section className="form-section target-section">
              <div className="form-section-title">
                <span aria-hidden="true" className="section-icon">
                  <Link size={16} />
                </span>
                <div>
                  <h3>Targets & Storage</h3>
                  <p>Saved into {props.draft.output}</p>
                </div>
              </div>
              <div className="config-grid two">
                <label>
                  SQLite Database
                  <input
                    spellCheck={false}
                    value={props.draft.output}
                    onChange={(event) => update('output', event.target.value)}
                  />
                </label>
                <label>
                  User Agent
                  <input
                    spellCheck={false}
                    value={props.draft.userAgent}
                    onChange={(event) =>
                      update('userAgent', event.target.value)
                    }
                  />
                </label>
              </div>
              <label>
                Target URLs
                <textarea
                  className="config-textarea-large"
                  rows={Math.min(
                    18,
                    Math.max(10, props.draft.pages.length + 2),
                  )}
                  spellCheck={false}
                  value={props.draft.pages.join('\n')}
                  onChange={(event) =>
                    update('pages', normalizeList(event.target.value))
                  }
                />
              </label>
            </section>

            <section className="form-section">
              <div className="form-section-title">
                <span aria-hidden="true" className="section-icon">
                  <User size={16} />
                </span>
                <div>
                  <h3>Proxy Locations</h3>
                  <p>{summary.sources} active request sources</p>
                </div>
              </div>
              <div className="config-grid two">
                <label>
                  Proxy Countries
                  <textarea
                    className="config-textarea-small"
                    rows={6}
                    spellCheck={false}
                    value={countries.join('\n')}
                    onChange={(event) =>
                      update(
                        'proxyCountries',
                        normalizeList(event.target.value).join(','),
                      )
                    }
                  />
                </label>
                <label>
                  Max Proxies / Country
                  <input
                    max={100}
                    min={1}
                    type="number"
                    value={props.draft.maxProxiesPerCountry}
                    onChange={(event) =>
                      update('maxProxiesPerCountry', Number(event.target.value))
                    }
                  />
                </label>
              </div>
            </section>
          </div>

          <div className="config-column config-side">
            <section className="form-section">
              <div className="form-section-title">
                <span aria-hidden="true" className="section-icon">
                  <Timer size={16} />
                </span>
                <div>
                  <h3>Schedule & Request Timing</h3>
                  <p>{summary.intervals} round interval</p>
                </div>
              </div>
              <div className="config-grid schedule">
                <label>
                  Round Interval <small>seconds</small>
                  <input
                    max={86400}
                    min={15}
                    step={15}
                    type="number"
                    value={props.draft.roundIntervalSeconds}
                    onChange={(event) =>
                      update('roundIntervalSeconds', Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Request Timeout <small>seconds</small>
                  <input
                    max={60}
                    min={1}
                    type="number"
                    value={props.draft.timeout}
                    onChange={(event) =>
                      update('timeout', Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Retry Delay <small>seconds</small>
                  <input
                    max={60}
                    min={0}
                    type="number"
                    value={props.draft.delay}
                    onChange={(event) =>
                      update('delay', Number(event.target.value))
                    }
                  />
                </label>
              </div>
            </section>

            <section className="form-section source-section">
              <div className="form-section-title">
                <span aria-hidden="true" className="section-icon">
                  <Shuffle size={16} />
                </span>
                <div>
                  <h3>Source Controls</h3>
                  <p>{summary.sources} enabled</p>
                </div>
              </div>
              <div className="switches">
                <Check
                  checked={props.draft.shuffleProxies}
                  label="Shuffle proxies"
                  onChange={(value) => update('shuffleProxies', value)}
                />
                <Check
                  checked={!props.draft.noDirect}
                  label="Direct request"
                  onChange={(value) => update('noDirect', !value)}
                />
                <Check
                  checked={!props.draft.noProxySource}
                  label="Proxifly source"
                  onChange={(value) => update('noProxySource', !value)}
                />
                <Check
                  checked={!props.draft.noClarketmSource}
                  label="Clarketm source"
                  onChange={(value) => update('noClarketmSource', !value)}
                />
              </div>
            </section>
          </div>
        </div>
      </div>

      <div className="form-actions">
        <span className="config-error" hidden />
        <button
          className="button primary icon-text"
          disabled={props.saving}
          type="submit"
        >
          <Save size={18} />
          <span>{props.saving ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>
    </form>
  )
}

function configSummary(config: Config) {
  const countries = normalizeList(config.proxyCountries)
  const locations = countries.length + (config.noDirect ? 0 : 1)
  const domains = unique(
    config.pages.map((page) => {
      try {
        return new URL(page).hostname
      } catch {
        return ''
      }
    }),
  ).length
  const sources = [
    !config.noDirect,
    !config.noProxySource,
    !config.noClarketmSource,
  ].filter(Boolean).length

  return {
    cells: config.pages.length * locations,
    countries: countries.length,
    domains,
    intervals: duration(config.roundIntervalSeconds),
    locations,
    sources,
    urls: config.pages.length,
  }
}
