import { useState } from 'react'
import { IconPlus, IconSearch } from '../icons.tsx'
import { displayName, type Memory } from '../jmri/protocol.ts'
import { KEYS, useClient, useJmri, useStored } from '../state.tsx'
import { CreateDialog, describeValue, isSystemBean } from './Devices.tsx'

export function MemoriesPage() {
  const client = useClient()
  const memories = useJmri((s) => s.beans.memory) as unknown as Record<string, Memory>
  const [q, setQ] = useState('')
  const [showSystem, setShowSystem] = useStored(KEYS.showSystem, false)
  const [creating, setCreating] = useState(false)

  const all = Object.values(memories)
  const hidden = all.filter((m) => isSystemBean(m.name)).length
  const items = all
    .filter((m) => showSystem || !isSystemBean(m.name))
    .filter((m) => `${m.name} ${m.userName ?? ''} ${describeValue(m.value)}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), undefined, { numeric: true }))

  return (
    <div className="page">
      <div className="page-head">
        <h1>Memories</h1>
        <div className="search">
          <IconSearch />
          <input className="input" placeholder="Search memories" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {hidden > 0 && (
          <button className="btn ghost" onClick={() => setShowSystem(!showSystem)}>
            {showSystem ? 'Hide' : 'Show'} system ({hidden})
          </button>
        )}
        <button className="btn" onClick={() => setCreating(true)}>
          <IconPlus /> New
        </button>
      </div>
      <div className="card table-wrap">
        {items.length === 0 ? (
          <div className="empty">{all.length === 0 ? 'No memories defined in JMRI yet.' : 'Nothing matches your search.'}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>System name</th>
                <th style={{ width: '45%' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.name}>
                  <td style={{ fontWeight: 600 }}>{displayName(m)}</td>
                  <td className="mono muted">{m.name}</td>
                  <td>
                    <MemoryValue value={describeValue(m.value)} onSave={(v) => client.setMemory(m.name, v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {creating && (
        <CreateDialog
          title="New memory"
          prefix="IM"
          onClose={() => setCreating(false)}
          onCreate={(name, user) => client.createBean('memory', name, user)}
        />
      )}
    </div>
  )
}

function MemoryValue({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft != null
  return (
    <form
      style={{ display: 'flex', gap: 6 }}
      onSubmit={(e) => {
        e.preventDefault()
        if (draft != null && draft !== value) onSave(draft)
        setDraft(null)
      }}
    >
      <input
        className="input"
        style={{ flex: 1 }}
        value={editing ? draft : value}
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setTimeout(() => setDraft(null), 150)}
        onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), setDraft(null))}
        aria-label="Memory value"
      />
      {editing && draft !== value && <button className="btn primary">Save</button>}
    </form>
  )
}
