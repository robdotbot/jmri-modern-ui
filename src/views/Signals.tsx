import { useEffect, useState } from 'react'
import { IconSearch, IconX } from '../icons.tsx'
import type { JmriClient } from '../jmri/client.ts'
import { HEAD, displayName, type SignalHeadData, type SignalMastData } from '../jmri/protocol.ts'
import { useClient, useJmri } from '../state.tsx'

interface AspectInfo {
  aspect: string
  image: string | null
}

interface MastInfo {
  aspects: AspectInfo[]
  heldImage: string | null
  darkImage: string | null
}

const mastCache = new Map<string, Promise<MastInfo>>()

/**
 * Valid aspects for a mast. The add-on returns exactly the mast's enabled aspects; without it we fall back to the
 * signal system's appearance file, whose path is encoded in the mast's system name (e.g. IF$vsm:basic:one-low($0001)).
 */
function mastInfo(client: JmriClient, name: string, hasAddon: boolean): Promise<MastInfo> {
  const key = `${hasAddon}:${name}`
  let p = mastCache.get(key)
  if (!p) {
    p = hasAddon
      ? client.request<MastInfo>({ type: 'signalAspects', data: { name } }).then((m) => m.data!)
      : appearanceFile(client, name)
    p.catch(() => mastCache.delete(key))
    mastCache.set(key, p)
  }
  return p
}

async function appearanceFile(client: JmriClient, name: string): Promise<MastInfo> {
  const m = /\$\w+:([^:]+):([^(]+)\(/.exec(name)
  if (!m) return { aspects: [], heldImage: null, darkImage: null }
  const [, system, mastType] = m
  const r = await fetch(client.url(`/xml/signals/${system}/appearance-${mastType}.xml`))
  if (!r.ok) return { aspects: [], heldImage: null, darkImage: null }
  const doc = new DOMParser().parseFromString(await r.text(), 'application/xml')
  const img = (el: Element | null) => {
    const link = el?.querySelector('imagelink')?.textContent?.trim()
    return link ? '/' + link.replace(/^(\.\.\/)+/, '') : null
  }
  return {
    aspects: [...doc.querySelectorAll('appearance')].map((a) => ({
      aspect: a.querySelector('aspectname')?.textContent?.trim() ?? '',
      image: img(a),
    })),
    heldImage: img(doc.querySelector('specificappearances held')),
    darkImage: img(doc.querySelector('specificappearances dark')),
  }
}

export function SignalsPage() {
  const masts = useJmri((s) => s.beans.signalMast) as unknown as Record<string, SignalMastData>
  const heads = useJmri((s) => s.beans.signalHead) as unknown as Record<string, SignalHeadData>
  const [chosen, setKind] = useState<'masts' | 'heads' | null>(null)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)

  const match = (b: { name: string; userName: string | null; comment: string | null }) =>
    `${b.name} ${b.userName ?? ''} ${b.comment ?? ''}`.toLowerCase().includes(q.toLowerCase())
  const sort = <T extends { name: string; userName: string | null }>(a: T, b: T) =>
    displayName(a).localeCompare(displayName(b), undefined, { numeric: true })
  const mastList = Object.values(masts).filter(match).sort(sort)
  const headList = Object.values(heads).filter(match).sort(sort)
  const nMasts = Object.keys(masts).length
  const nHeads = Object.keys(heads).length

  // Default to whichever kind this railroad actually uses.
  const kind = chosen ?? (nMasts === 0 && nHeads > 0 ? 'heads' : 'masts')

  return (
    <div className="page">
      <div className="page-head">
        <h1>Signals</h1>
        <div className="search">
          <IconSearch />
          <input className="input" placeholder="Search signals" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="segmented" role="group" aria-label="Signal kind" style={{ alignSelf: 'flex-start' }}>
        <button aria-pressed={kind === 'masts'} onClick={() => setKind('masts')}>
          Masts ({nMasts})
        </button>
        <button aria-pressed={kind === 'heads'} onClick={() => setKind('heads')}>
          Heads ({nHeads})
        </button>
      </div>
      {(kind === 'masts' ? mastList : headList).length === 0 ? (
        <div className="card empty">{q ? 'Nothing matches your search.' : `No signal ${kind} defined in JMRI.`}</div>
      ) : (
        <div className="device-grid">
          {kind === 'masts'
            ? mastList.map((m) => <MastCard key={m.name} m={m} onClick={() => setPicked(m.name)} />)
            : headList.map((h) => <HeadCard key={h.name} h={h} onClick={() => setPicked(h.name)} />)}
        </div>
      )}
      {picked && masts[picked] && <MastSheet m={masts[picked]} onClose={() => setPicked(null)} />}
      {picked && heads[picked] && <HeadSheet h={heads[picked]} onClose={() => setPicked(null)} />}
    </div>
  )
}

function useMastInfo(name: string) {
  const client = useClient()
  const addon = useJmri((s) => s.addon)
  const [info, setInfo] = useState<MastInfo | null>(null)
  useEffect(() => {
    if (addon === undefined) return
    let live = true
    mastInfo(client, name, !!addon).then((i) => live && setInfo(i), () => live && setInfo({ aspects: [], heldImage: null, darkImage: null }))
    return () => {
      live = false
    }
  }, [client, name, addon])
  return info
}

function mastImage(m: SignalMastData, info: MastInfo | null) {
  if (!info) return null
  if (m.held && info.heldImage) return info.heldImage
  if (!m.lit && info.darkImage) return info.darkImage
  return info.aspects.find((a) => a.aspect === m.aspect)?.image ?? null
}

function aspectTone(aspect: string) {
  const a = aspect.toLowerCase()
  if (/stop|restrict|held|dark|unlit/.test(a) && !/approach/.test(a)) return 'danger'
  if (/approach|medium|slow|limited|diverging/.test(a)) return 'warn'
  if (/clear|proceed/.test(a)) return 'ok'
  return undefined
}

function MastCard({ m, onClick }: { m: SignalMastData; onClick: () => void }) {
  const client = useClient()
  const info = useMastInfo(m.name)
  const img = mastImage(m, info)
  return (
    <button className="device" data-tone={aspectTone(m.held ? 'Held' : m.aspect)} onClick={onClick} aria-label={`${displayName(m)}: ${m.state}`}>
      <span className="glyph signal-glyph">{img ? <img src={client.url(img)} alt="" /> : null}</span>
      <span className="meta">
        <span className="title" style={{ display: 'block' }}>
          {displayName(m)}
        </span>
        <span className="sub">
          {m.aspect}
          {m.held && ' · held'}
          {!m.lit && ' · dark'}
        </span>
      </span>
    </button>
  )
}

function MastSheet({ m, onClose }: { m: SignalMastData; onClose: () => void }) {
  const client = useClient()
  const info = useMastInfo(m.name)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-label={displayName(m)} onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h2 style={{ marginRight: 'auto' }}>{displayName(m)}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="muted small mono">{m.name}</div>
        <div className="aspect-grid">
          {(info?.aspects ?? []).map((a) => (
            <button
              key={a.aspect}
              className="aspect"
              aria-pressed={!m.held && m.aspect === a.aspect}
              onClick={() => client.setSignalMast(m.name, a.aspect)}
            >
              {a.image ? <img src={client.url(a.image)} alt="" /> : <span className="aspect-blank" />}
              <span>{a.aspect}</span>
            </button>
          ))}
          {info && info.aspects.length === 0 && <span className="muted">JMRI didn't report this mast's aspects.</span>}
          {!info && <span className="muted">Loading aspects…</span>}
        </div>
        <div className="row-wrap">
          <label className="toggle-row">
            <input type="checkbox" checked={m.held} onChange={(e) => client.setSignalFlags('signalMast', m.name, { held: e.target.checked })} />
            <span>Held</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={m.lit} onChange={(e) => client.setSignalFlags('signalMast', m.name, { lit: e.target.checked })} />
            <span>Lit</span>
          </label>
        </div>
      </div>
    </div>
  )
}

// ---- heads ----

const HEAD_LOOK: Record<number, { name: string; color: string; flash?: boolean }> = {
  [HEAD.DARK]: { name: 'Dark', color: 'transparent' },
  [HEAD.RED]: { name: 'Red', color: '#e5484d' },
  [HEAD.FLASHRED]: { name: 'Flashing red', color: '#e5484d', flash: true },
  [HEAD.YELLOW]: { name: 'Yellow', color: '#f5b100' },
  [HEAD.FLASHYELLOW]: { name: 'Flashing yellow', color: '#f5b100', flash: true },
  [HEAD.GREEN]: { name: 'Green', color: '#30a46c' },
  [HEAD.FLASHGREEN]: { name: 'Flashing green', color: '#30a46c', flash: true },
  [HEAD.LUNAR]: { name: 'Lunar', color: '#dfe6ee' },
  [HEAD.FLASHLUNAR]: { name: 'Flashing lunar', color: '#dfe6ee', flash: true },
}

const DEFAULT_HEAD_APPEARANCES = [HEAD.DARK, HEAD.RED, HEAD.YELLOW, HEAD.GREEN, HEAD.FLASHRED, HEAD.FLASHYELLOW, HEAD.FLASHGREEN]

function Lamp({ appearance, size = 26 }: { appearance: number; size?: number }) {
  const look = HEAD_LOOK[appearance] ?? HEAD_LOOK[HEAD.DARK]
  return (
    <span
      className={`lamp${look.flash ? ' flash' : ''}`}
      style={{ width: size, height: size, background: look.color, boxShadow: look.color !== 'transparent' ? `0 0 10px ${look.color}` : undefined }}
    />
  )
}

function HeadCard({ h, onClick }: { h: SignalHeadData; onClick: () => void }) {
  const tone = h.held ? 'danger' : h.appearance === HEAD.GREEN ? 'ok' : h.appearance & (HEAD.YELLOW | HEAD.FLASHYELLOW) ? 'warn' : h.appearance & (HEAD.RED | HEAD.FLASHRED) ? 'danger' : undefined
  return (
    <button className="device" data-tone={tone} onClick={onClick} aria-label={`${displayName(h)}: ${h.appearanceName}`}>
      <span className="glyph signal-glyph head">
        <Lamp appearance={h.lit ? h.appearance : HEAD.DARK} />
      </span>
      <span className="meta">
        <span className="title" style={{ display: 'block' }}>
          {displayName(h)}
        </span>
        <span className="sub">
          {h.appearanceName}
          {h.held && ' · held'}
          {!h.lit && ' · unlit'}
        </span>
      </span>
    </button>
  )
}

function HeadSheet({ h, onClose }: { h: SignalHeadData; onClose: () => void }) {
  const client = useClient()
  const addon = useJmri((s) => s.addon)
  const [fromAddon, setValid] = useState<{ appearance: number; name: string }[] | null>(null)
  const fallback = DEFAULT_HEAD_APPEARANCES.map((a) => ({ appearance: a, name: HEAD_LOOK[a].name }))
  const valid = addon ? fromAddon : fallback
  useEffect(() => {
    if (!addon) return
    client
      .request<{ appearances: { appearance: number; name: string }[] }>({ type: 'signalAspects', data: { name: h.name } })
      .then((m) => setValid(m.data!.appearances))
      .catch(() => setValid(DEFAULT_HEAD_APPEARANCES.map((a) => ({ appearance: a, name: HEAD_LOOK[a].name }))))
  }, [client, addon, h.name])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-label={displayName(h)} onClick={(e) => e.stopPropagation()}>
        <div className="page-head">
          <h2 style={{ marginRight: 'auto' }}>{displayName(h)}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="aspect-grid">
          {(valid ?? []).map((a) => (
            <button
              key={a.appearance}
              className="aspect"
              aria-pressed={!h.held && h.appearance === a.appearance}
              onClick={() => client.setSignalHead(h.name, a.appearance)}
            >
              <Lamp appearance={a.appearance} size={30} />
              <span>{a.name}</span>
            </button>
          ))}
        </div>
        <div className="row-wrap">
          <label className="toggle-row">
            <input type="checkbox" checked={h.held} onChange={(e) => client.setSignalFlags('signalHead', h.name, { held: e.target.checked })} />
            <span>Held</span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={h.lit} onChange={(e) => client.setSignalFlags('signalHead', h.name, { lit: e.target.checked })} />
            <span>Lit</span>
          </label>
        </div>
      </div>
    </div>
  )
}
