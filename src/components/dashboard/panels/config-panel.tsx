import {
  Link,
  Plus,
  Save,
  Settings2,
  Shuffle,
  Timer,
  Trash2,
  User,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { countryName, duration, normalizeList, unique } from '../helpers'
import { Check } from '../ui'
import type { ConfigDraft, ConfigPanelProps } from '../types'

const defaultCountryCodes = [
  'BD',
  'IN',
  'US',
  'GB',
  'CA',
  'DE',
  'FR',
  'SG',
  'JP',
  'AU',
]

const countryCodesByName: Record<string, string> = {
  australia: 'AU',
  bangladesh: 'BD',
  canada: 'CA',
  france: 'FR',
  germany: 'DE',
  india: 'IN',
  japan: 'JP',
  singapore: 'SG',
  uk: 'GB',
  'united kingdom': 'GB',
  'united states': 'US',
}

export function ConfigPanel(props: ConfigPanelProps) {
  const [targetMode, setTargetMode] = useState<'json' | 'preview'>('preview')
  const [targetJson, setTargetJson] = useState(() =>
    targetJsonFromDraft(props.draft),
  )
  const [targetJsonDirty, setTargetJsonDirty] = useState(false)
  const [targetJsonError, setTargetJsonError] = useState('')
  const update = <TKey extends keyof ConfigDraft>(
    key: TKey,
    value: ConfigDraft[TKey],
  ) => props.onChange({ ...props.draft, [key]: value })
  const updateNumber = (
    key:
      | 'delay'
      | 'globalConcurrency'
      | 'maxProxiesPerCountry'
      | 'retentionDays'
      | 'roundIntervalSeconds'
      | 'timeout',
    value: string,
  ) => props.onChange({ ...props.draft, [key]: value })
  const updatePage = (index: number, value: string) => {
    const pages = [...props.draft.pages]
    const current = pages[index] || ''
    const pageCountryOverrides = { ...props.draft.pageCountryOverrides }
    const country = pageCountryOverrides[current]
    pages[index] = value
    delete pageCountryOverrides[current]
    if (value.trim() && country) pageCountryOverrides[value] = country
    props.onChange({ ...props.draft, pages, pageCountryOverrides })
  }
  const updatePageCountry = (page: string, country: string) => {
    const pageCountryOverrides = { ...props.draft.pageCountryOverrides }
    if (country) pageCountryOverrides[page] = country
    else delete pageCountryOverrides[page]
    props.onChange({ ...props.draft, pageCountryOverrides })
  }
  const addPage = () =>
    props.onChange({ ...props.draft, pages: [...props.draft.pages, ''] })
  const removePage = (index: number) => {
    const page = props.draft.pages[index] || ''
    const pages = props.draft.pages.filter(
      (_, itemIndex) => itemIndex !== index,
    )
    const pageCountryOverrides = { ...props.draft.pageCountryOverrides }
    delete pageCountryOverrides[page]
    props.onChange({ ...props.draft, pages, pageCountryOverrides })
  }
  const summary = configSummary(props.draft)
  const countries = props.draft.proxyCountries.includes('\n')
    ? props.draft.proxyCountries
    : normalizeList(props.draft.proxyCountries).join('\n')
  const countryOptions = buildCountryOptions(props.draft)

  useEffect(() => {
    if (targetJsonDirty) return
    setTargetJson(targetJsonFromDraft(props.draft))
  }, [props.draft, targetJsonDirty])

  const syncTargetJson = () => {
    setTargetJson(targetJsonFromDraft(props.draft))
    setTargetJsonDirty(false)
    setTargetJsonError('')
  }
  const showTargetJson = () => {
    syncTargetJson()
    setTargetMode('json')
  }
  const updateTargetJson = (value: string) => {
    setTargetJson(value)
    setTargetJsonDirty(true)
    setTargetJsonError('')
  }
  const applyTargetJson = () => {
    try {
      const parsed = parseTargetJson(targetJson)
      props.onChange({ ...props.draft, ...parsed })
      setTargetJson(targetJsonFromTargets(parsed))
      setTargetJsonDirty(false)
      setTargetJsonError('')
    } catch (error) {
      setTargetJsonError(error instanceof Error ? error.message : String(error))
    }
  }

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
              <div className="target-editor">
                <div className="target-list-head">
                  <span>
                    {summary.lockedUrls} locked / {summary.urls} target URLs
                  </span>
                  <div className="target-head-actions">
                    <div className="target-view-toggle">
                      <button
                        className={targetMode === 'preview' ? 'selected' : ''}
                        onClick={() => setTargetMode('preview')}
                        type="button"
                      >
                        Preview
                      </button>
                      <button
                        className={targetMode === 'json' ? 'selected' : ''}
                        onClick={showTargetJson}
                        type="button"
                      >
                        JSON
                      </button>
                    </div>
                    {targetMode === 'preview' ? (
                      <button
                        className="button icon-text"
                        onClick={addPage}
                        type="button"
                      >
                        <Plus size={16} />
                        <span>Add URL</span>
                      </button>
                    ) : (
                      <>
                        <button
                          className="button icon-text"
                          onClick={applyTargetJson}
                          type="button"
                        >
                          <Plus size={16} />
                          <span>Apply JSON</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {targetMode === 'preview' ? (
                  <div className="target-preview">
                    <div className="target-table-head">
                      <span>URL</span>
                      <span>Country</span>
                      <span />
                    </div>
                    <div className="target-row-list">
                      {props.draft.pages.map((page, index) => (
                        <div className="target-row" key={index}>
                          <input
                            aria-label="Target URL"
                            spellCheck={false}
                            value={page}
                            onChange={(event) =>
                              updatePage(index, event.target.value)
                            }
                          />
                          <select
                            aria-label="Country check"
                            disabled={!page.trim()}
                            value={props.draft.pageCountryOverrides[page] || ''}
                            onChange={(event) =>
                              updatePageCountry(page, event.target.value)
                            }
                          >
                            <option value="">Use global countries</option>
                            {countryOptions.map((item) => (
                              <option key={item.code} value={item.code}>
                                Only {item.label}
                              </option>
                            ))}
                          </select>
                          <button
                            aria-label="Remove URL"
                            className="icon-button target-remove"
                            onClick={() => removePage(index)}
                            title="Remove URL"
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <textarea
                      className="config-textarea-json"
                      spellCheck={false}
                      value={targetJson}
                      onChange={(event) => updateTargetJson(event.target.value)}
                    />
                    {targetJsonError ? (
                      <span className="config-error">{targetJsonError}</span>
                    ) : null}
                  </>
                )}
              </div>
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
              <div className="proxy-location-grid">
                <label className="proxy-countries-field">
                  Proxy Countries
                  <textarea
                    className="config-textarea-small"
                    rows={6}
                    spellCheck={false}
                    value={countries}
                    onChange={(event) =>
                      update('proxyCountries', event.target.value)
                    }
                  />
                </label>
                <label className="proxy-limit-field">
                  Max Proxies / Country
                  <input
                    max={100}
                    min={1}
                    type="number"
                    value={props.draft.maxProxiesPerCountry}
                    onChange={(event) =>
                      updateNumber('maxProxiesPerCountry', event.target.value)
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
                      updateNumber('roundIntervalSeconds', event.target.value)
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
                      updateNumber('timeout', event.target.value)
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
                      updateNumber('delay', event.target.value)
                    }
                  />
                </label>
                <label>
                  Max Requests <small>active</small>
                  <input
                    max={64}
                    min={1}
                    type="number"
                    value={props.draft.globalConcurrency}
                    onChange={(event) =>
                      updateNumber('globalConcurrency', event.target.value)
                    }
                  />
                </label>
                <label>
                  Keep Data <small>days</small>
                  <input
                    max={3650}
                    min={1}
                    type="number"
                    value={props.draft.retentionDays}
                    onChange={(event) =>
                      updateNumber('retentionDays', event.target.value)
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

function configSummary(config: ConfigDraft) {
  const countries = configuredCountryCodes(config)
  const urls = config.pages.filter((page) => page.trim()).length
  const lockedUrls = Object.entries(config.pageCountryOverrides).filter(
    ([page, country]) =>
      config.pages.includes(page) && /^[A-Z]{2}$/.test(country),
  ).length
  const locations = countries.length + (config.noDirect ? 0 : 1)
  const domains = unique(
    config.pages.filter(Boolean).map((page) => {
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
    cells: urls * locations,
    countries: countries.length,
    domains,
    intervals: duration(Number(config.roundIntervalSeconds)),
    lockedUrls,
    locations,
    sources,
    urls,
  }
}

function buildCountryOptions(config: ConfigDraft) {
  return countryOptionCodes(config).map((code) => ({
    code,
    label: countryName(code),
  }))
}

function countryOptionCodes(config: ConfigDraft) {
  return unique([...defaultCountryCodes, ...configuredCountryCodes(config)])
}

function configuredCountryCodes(config: ConfigDraft) {
  return unique([
    ...normalizeList(config.proxyCountries).map(countryCode).filter(Boolean),
    ...Object.values(config.pageCountryOverrides).filter((country) =>
      /^[A-Z]{2}$/.test(country),
    ),
  ])
}

function countryCode(value: string) {
  const raw = value.trim()
  const upper = raw.toUpperCase()
  if (upper === 'UK') return 'GB'
  if (/^[A-Z]{2}$/.test(upper)) return upper
  return countryCodesByName[raw.toLowerCase()] || ''
}

function targetJsonFromDraft(config: ConfigDraft) {
  return targetJsonFromTargets({
    pages: config.pages,
    pageCountryOverrides: config.pageCountryOverrides,
  })
}

function targetJsonFromTargets(targets: {
  pages: string[]
  pageCountryOverrides: Record<string, string>
}) {
  return `${JSON.stringify(
    targets.pages
      .filter((page) => page.trim())
      .map((page) => {
        const country = targets.pageCountryOverrides[page]
        return country ? { country, url: page } : page
      }),
    null,
    2,
  )}\n`
}

function parseTargetJson(value: string) {
  const parsed = JSON.parse(value) as unknown
  const entries = Array.isArray(parsed)
    ? parsed
    : objectArray(parsed, 'urls') || objectArray(parsed, 'pages')
  if (!entries) throw new Error('Expected a JSON array or object with urls.')

  const pages: string[] = []
  const pageCountryOverrides: Record<string, string> = {}

  for (const entry of entries) {
    const target = targetEntry(entry)
    if (!target.url) continue
    pages.push(target.url)
    if (target.country) pageCountryOverrides[target.url] = target.country
  }

  const overrides =
    objectRecord(parsed, 'pageCountryOverrides') ||
    objectRecord(parsed, 'overrides')
  for (const [page, country] of Object.entries(overrides || {})) {
    const code = countryCode(String(country || ''))
    if (pages.includes(page) && code) pageCountryOverrides[page] = code
  }

  return { pages: uniqueList(pages), pageCountryOverrides }
}

function targetEntry(entry: unknown) {
  if (typeof entry === 'string') return { country: '', url: entry.trim() }
  if (!entry || typeof entry !== 'object') return { country: '', url: '' }

  const row = entry as Record<string, unknown>
  const url = String(row.url || row.page || '').trim()
  const country = countryCode(
    String(row.country || row.proxyCountry || row.countryCode || ''),
  )
  return { country, url }
}

function objectArray(value: unknown, key: 'pages' | 'urls') {
  if (!value || typeof value !== 'object') return null
  const item = (value as Record<string, unknown>)[key]
  return Array.isArray(item) ? item : null
}

function objectRecord(
  value: unknown,
  key: 'overrides' | 'pageCountryOverrides',
) {
  if (!value || typeof value !== 'object') return null
  const item = (value as Record<string, unknown>)[key]
  return item && typeof item === 'object' && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : null
}

function uniqueList(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
