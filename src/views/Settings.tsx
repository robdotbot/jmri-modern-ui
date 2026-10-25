import { useState } from 'react'
import { OFF, ON } from '../jmri/protocol.ts'
import { KEYS, save, useClient, useJmri, useTheme, type Theme } from '../state.tsx'

export function SettingsPage() {
  const client = useClient()
  const hello = useJmri((s) => s.hello)
  const power = useJmri((s) => s.power)
  const connections = useJmri((s) => s.connections)
  const time = useJmri((s) => s.time)
  const [theme, setTheme] = useTheme()
  const [server, setServer] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEYS.server) ?? 'null') ?? ''
    } catch {
      return ''
    }
  })

  const applyServer = (value: string) => {
    save(KEYS.server, value.trim() || null)
    location.reload()
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <section className="card dialog" style={{ width: '100%', maxHeight: 'none' }}>
        <h2>JMRI server</h2>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault()
            applyServer(server)
          }}
        >
          <label htmlFor="server">Web server address</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="server"
              className="input"
              style={{ flex: 1 }}
              placeholder={`Same as this page (${location.host})`}
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
            <button className="btn primary">Connect</button>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            Leave empty when this page is served by JMRI. Otherwise e.g. <span className="mono">192.168.0.10:12080</span>.
            Currently <span className="mono">{client.base.host}</span>.
          </span>
        </form>
        {hello && (
          <table className="table">
            <tbody>
              <tr><th>Railroad</th><td>{hello.railroad}</td></tr>
              <tr><th>Profile</th><td>{hello.activeProfile}</td></tr>
              <tr><th>JMRI version</th><td className="mono">{hello.JMRI}</td></tr>
              <tr><th>JSON protocol</th><td className="mono">{hello.json} ({hello.version})</td></tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="card dialog" style={{ width: '100%', maxHeight: 'none' }}>
        <h2>Connections &amp; track power</h2>
        <table className="table">
          <thead>
            <tr><th>Connection</th><th>Prefix</th><th>Track power</th></tr>
          </thead>
          <tbody>
            {connections.map((c) => {
              const p = Object.values(power).find((x) => x.name === c.name || x.prefix === c.prefix)
              return (
                <tr key={c.prefix}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.description && <div className="muted" style={{ fontSize: 12 }}>{c.description}</div>}
                  </td>
                  <td className="mono">{c.prefix}</td>
                  <td>
                    {p ? (
                      <div className="segmented" role="group" aria-label={`Power ${c.name}`}>
                        <button aria-pressed={p.state === ON} onClick={() => client.setPower(ON, p.prefix ?? c.prefix)}>On</button>
                        <button aria-pressed={p.state === OFF} onClick={() => client.setPower(OFF, p.prefix ?? c.prefix)}>Off</button>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <span className="muted" style={{ fontSize: 12 }}>
          If power buttons have no effect, untick “Web clients can't change track power” in JMRI Preferences → Web Server.
        </span>
      </section>

      {time && (
        <section className="card dialog" style={{ width: '100%', maxHeight: 'none' }}>
          <h2>Fast clock</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="segmented" role="group" aria-label="Clock running">
              <button aria-pressed={time.state === 2} onClick={() => client.setClock({ state: 2 })}>Run</button>
              <button aria-pressed={time.state !== 2} onClick={() => client.setClock({ state: 4 })}>Stop</button>
            </div>
            <div className="segmented" role="group" aria-label="Clock rate">
              {[1, 2, 4, 6, 10].map((r) => (
                <button key={r} aria-pressed={time.rate === r} onClick={() => client.setClock({ rate: r })}>
                  {r}×
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="card dialog" style={{ width: '100%', maxHeight: 'none' }}>
        <h2>Appearance</h2>
        <div className="segmented" role="group" aria-label="Theme" style={{ alignSelf: 'flex-start' }}>
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)} style={{ textTransform: 'capitalize' }}>
              {t}
            </button>
          ))}
        </div>
        <a className="muted" href={client.url('/')} style={{ fontSize: 13 }}>
          Open the classic JMRI web interface →
        </a>
      </section>
    </div>
  )
}
