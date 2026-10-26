// Decoder identification from CV8 (manufacturer) and CV7 (version), using the
// decoder index JMRI serves at /xml/decoderIndex.xml — the same data DecoderPro uses.

export interface DecoderMatch {
  family: string
  model: string
  /** Decoder definition file, under xml/decoders. */
  file: string
  mfg: string
}

export interface DecoderIndex {
  manufacturer(id: number): string | null
  identify(mfgId: number, version: number): DecoderMatch[]
  /** Every decoder model JMRI knows, by manufacturer. */
  all(): Map<string, DecoderMatch[]>
}

let cached: Promise<DecoderIndex> | null = null

export function loadDecoderIndex(url: string): Promise<DecoderIndex> {
  cached ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`decoder index: HTTP ${r.status}`)
      return r.text()
    })
    .then(parse)
    .catch((e) => {
      cached = null
      throw e
    })
  return cached
}

const inRange = (el: Element, v: number) => {
  const lo = el.getAttribute('lowVersionID')
  const hi = el.getAttribute('highVersionID')
  if (lo == null) return null // no version information
  return v >= Number(lo) && v <= Number(hi ?? lo)
}

const match = (f: Element, m: Element): DecoderMatch => ({
  family: f.getAttribute('name') ?? '',
  model: m.getAttribute('model') ?? '',
  file: f.getAttribute('file') ?? '',
  mfg: f.getAttribute('mfg') ?? '',
})

function parse(xml: string): DecoderIndex {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const mfgById = new Map<number, string>()
  for (const m of doc.querySelectorAll('mfgList > manufacturer')) {
    const id = Number(m.getAttribute('mfgID'))
    // Several names can share an ID (resellers); keep the first, which JMRI lists as primary.
    if (!Number.isNaN(id) && !mfgById.has(id)) mfgById.set(id, m.getAttribute('mfg') ?? '')
  }
  const families = [...doc.querySelectorAll('familyList > family')]

  return {
    manufacturer: (id) => mfgById.get(id) ?? null,
    identify(mfgId, version) {
      const names = new Set(
        [...doc.querySelectorAll(`mfgList > manufacturer[mfgID="${mfgId}"]`)].map((m) => m.getAttribute('mfg')),
      )
      const out: DecoderMatch[] = []
      for (const f of families) {
        if (!names.has(f.getAttribute('mfg'))) continue
        const familyOk = inRange(f, version)
        for (const m of f.querySelectorAll(':scope > model')) {
          const ranges = [m, ...m.querySelectorAll(':scope > versionCV')].map((el) => inRange(el, version))
          const known = ranges.filter((r) => r != null)
          const ok = known.length ? known.some(Boolean) : familyOk === true
          if (ok) out.push(match(f, m))
        }
      }
      return out
    },
    all() {
      const out = new Map<string, DecoderMatch[]>()
      for (const f of families) {
        const list = out.get(f.getAttribute('mfg') ?? '') ?? []
        for (const m of f.querySelectorAll(':scope > model')) list.push(match(f, m))
        out.set(f.getAttribute('mfg') ?? '', list)
      }
      return out
    },
  }
}

/** CV29 bits per NMRA S-9.2.2. */
export const CV29_BITS = [
  { bit: 0, label: 'Reverse direction', hint: 'Swaps forward and reverse' },
  { bit: 1, label: '28/128 speed steps', hint: 'Off = 14 steps (very old systems)' },
  { bit: 2, label: 'Analog (DC) operation', hint: 'Runs on DC layouts' },
  { bit: 3, label: 'RailCom', hint: 'Bi-directional communication' },
  { bit: 4, label: 'Speed table', hint: 'Use CV67–94 speed table instead of CV2/5/6' },
  { bit: 5, label: 'Long address', hint: 'Use CV17/18 instead of CV1' },
] as const

/** CV17/CV18 for a long address (NMRA: CV17 = 192 + high bits). */
export function longAddressCVs(address: number): { cv17: number; cv18: number } {
  return { cv17: 192 + (address >> 8), cv18: address & 0xff }
}

/** Long address from CV17/18, or null when CV17 doesn't hold one (valid CV17 is 192–231). */
export function longAddressFromCVs(cv17: number, cv18: number): number | null {
  if (cv17 < 192 || cv17 > 231) return null
  return ((cv17 - 192) << 8) + cv18
}
