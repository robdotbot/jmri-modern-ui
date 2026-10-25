// DecoderPro's decoder definitions and programmer panes, for programming by named setting instead of CV number.
//
// The XML comes from the add-on (type decoderDefinition) with its XIncludes already resolved by JMRI. What a
// variable means follows JMRI's symbolicprog classes: masks and radix masks (VariableValue), split values across
// CVs (SplitVariableValue), factor/offset (DecVariableValue), enum values (EnumVariableValue), include/exclude by
// model (DecoderFile.isIncluded) and qualifiers (ArithmeticQualifier). Pane order follows PaneProgFrame.

export interface Qualifier {
  ref: string
  relation: string
  value: number
}

export type VarKind =
  | 'dec'
  | 'hex'
  | 'enum'
  | 'composite'
  | 'speedTable'
  | 'shortAddress'
  | 'longAddress'
  | 'split'
  | 'splitEnum'
  | 'splitHex'
  | 'unsupported'

export interface CvPart {
  cv: string
  mask: string
}

export interface VarDef {
  item: string
  label: string
  tooltip?: string
  kind: VarKind
  /** The CVs holding the value, least significant first. */
  cvs: CvPart[]
  min: number
  max: number
  factor: number
  offset: number
  choices: { label: string; value: number }[]
  composite: { label: string; settings: { ref: string; value: number }[] }[]
  readOnly: boolean
  writeOnly: boolean
  infoOnly: boolean
  /** Default as JMRI's setValue(String) takes it: the shown value (dec/split) or the enum value. */
  default: number | null
  qualifiers: Qualifier[]
}

export type PaneNode =
  | { t: 'box'; dir: 'column' | 'row'; children: PaneNode[]; qualifiers: Qualifier[] }
  | { t: 'grid'; items: { x: number; y: number; w: number; h: number; children: PaneNode[] }[]; qualifiers: Qualifier[] }
  | { t: 'group'; children: PaneNode[]; qualifiers: Qualifier[] }
  /** `label` is '' when the pane hides it; `layout` is where the label goes (JMRI: left, above, right, below). */
  | { t: 'display'; item: string; label?: string; format?: string; layout?: string; tooltip?: string; qualifiers: Qualifier[] }
  | { t: 'label'; text: string; qualifiers: Qualifier[] }
  | { t: 'separator' }
  | { t: 'fnmapping' }
  | { t: 'cvtable' }
  | { t: 'dccaddress' }

export interface PaneDef {
  name: string
  root: PaneNode
  /** Programmer panes are hidden when the decoder has none of their settings; decoder panes always show. */
  fromProgrammer: boolean
}

export interface DecoderDef {
  file: string
  mfg: string
  family: string
  model: string
  productID: string | null
  variables: VarDef[]
  /** Function outputs for the function map, by output number/name. */
  outputs: { name: string; label: string }[]
  panes: PaneDef[]
}

export interface ProgrammerDef {
  name: string
  panes: PaneDef[]
  decoderFilePanes: boolean
}

const LANG = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2)
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

const kids = (el: Element, name?: string) => [...el.children].filter((c) => !name || c.localName === name)
const kid = (el: Element, name: string) => kids(el, name)[0] as Element | undefined
const lang = (el: Element) => el.getAttributeNS(XML_NS, 'lang') || el.getAttribute('xml:lang')

/** A localised value: a child element in the browser's language, else the attribute, else the untagged child. */
function localized(el: Element, name: string): string | undefined {
  const children = kids(el, name)
  const mine = children.find((c) => lang(c) === LANG)
  if (mine && LANG !== 'en') return mine.textContent?.trim()
  const attr = el.getAttribute(name)
  if (attr != null) return attr
  return children.find((c) => !lang(c))?.textContent?.trim()
}

const yes = (el: Element, a: string) => el.getAttribute(a) === 'yes'

// ---------- include / exclude ----------

interface Identity {
  productID: string | null
  model: string
  family: string
}

function inList(checkFor: string | null, list: string) {
  if (checkFor == null) return false
  const test = `,${list},`
  return test.includes(`,${checkFor},`) || (checkFor.includes(',') && checkFor.split(',').some((x) => test.includes(`,${x},`)))
}

/** DecoderFile.isIncluded: an include list must name the decoder; an exclude list must not. */
export function isIncluded(el: Element, id: Identity): boolean {
  const include = el.getAttribute('include')
  if (include && !(inList(id.productID, include) || inList(id.model, include) || inList(id.family, include))) return false
  const exclude = el.getAttribute('exclude')
  if (exclude && (inList(id.productID, exclude) || inList(id.model, exclude) || inList(id.family, exclude))) return false
  return true
}

function qualifiersOf(el: Element): Qualifier[] {
  return kids(el, 'qualifier').flatMap((q) => {
    const ref = kid(q, 'variableref')?.textContent?.trim()
    const relation = kid(q, 'relation')?.textContent?.trim()
    const value = Number(kid(q, 'value')?.textContent?.trim())
    return ref && relation && !Number.isNaN(value) ? [{ ref, relation, value }] : []
  })
}

// ---------- CV lists and masks ----------

/** CvUtil.expandCvList: "1,5,7", "16.3.25(1-7)", "98-103", "25.3.250:4"; [] when there is nothing to expand. */
export function expandCvList(cv: string): string[] {
  if (!/[(),\-:]/.test(cv)) return []
  let prefix = ''
  let body = cv
  let suffix = ''
  const outer = /^([^(),\-:]*?)\(??([^()]*)\)??([^(),\-:]*?)$/.exec(cv)
  if (outer) [, prefix, body, suffix] = outer
  if (/^([^(),\-:]+?)(,[^(),\-:]+?)+?$/.test(body)) return body.split(',').map((x) => prefix + x + suffix)
  const range = /^([^(),\-:]*?)(\d+)-(\d+)([^(),\-:]*?)$/.exec(body)
  if (range) {
    const [, sp, a, b, ss] = range
    const out: string[] = []
    const step = Number(a) <= Number(b) ? 1 : -1
    for (let i = Number(a); ; i += step) {
      out.push(prefix + sp + i + ss + suffix)
      if (i === Number(b)) break
    }
    return out
  }
  const count = /^([^(),\-:]*?)(\d+):(-?\d+)([^(),\-:]*?)$/.exec(body)
  if (count) {
    const [, sp, a, n, ss] = count
    const out: string[] = []
    const step = Number(n) > 0 ? 1 : -1
    for (let i = Number(a); i !== Number(a) + Number(n); i += step) out.push(prefix + sp + i + ss + suffix)
    return out
  }
  return /[(),\-:]/.test(body) ? [] : [prefix + body + suffix]
}

const isBitMask = (m: string) => m === '' || m.startsWith('X') || m.startsWith('V')
const maskInt = (m: string) => [...m].reduce((acc, c) => (acc << 1) | (c === 'V' ? 1 : 0), 0)
const maskShift = (m: string) => (m.includes('V') ? m.length - 1 - m.lastIndexOf('V') : 0)
/** Number of value bits a mask spans (SplitVariableValue counts from the first to the last V). */
const maskWidth = (m: string) => (m.includes('V') ? m.lastIndexOf('V') - m.indexOf('V') + 1 : 8)

/** VariableValue.getValueInCV */
export function getValueInCV(cv: number, mask: string, max: number): number {
  if (isBitMask(mask)) return (cv & maskInt(mask)) >>> maskShift(mask)
  const radix = Number(mask)
  return Math.floor(cv / radix) % (max + 1)
}

/** VariableValue.setValueInCV */
export function setValueInCV(old: number, value: number, mask: string, max: number): number {
  if (isBitMask(mask)) {
    const m = maskInt(mask)
    return (old & ~m) + ((value << maskShift(mask)) & m)
  }
  const radix = Number(mask)
  const low = old % radix
  const span = radix * (max + 1)
  return Math.floor(old / span) * span + (value % (max + 1)) * radix + low
}

// ---------- variables ----------

const NUM = (el: Element, a: string, d: number) => {
  const v = el.getAttribute(a)
  return v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v)
}

function enumChoices(el: Element, id: Identity, out: { label: string; value: number }[] = []) {
  for (const c of kids(el)) {
    if (!isIncluded(c, id)) continue
    if (c.localName === 'enumChoice') {
      const v = c.getAttribute('value')
      out.push({ label: localized(c, 'choice') ?? '', value: v != null ? Number(v) : out.length ? out[out.length - 1].value + 1 : 0 })
    } else if (c.localName === 'enumChoiceGroup') enumChoices(c, id, out)
  }
  return out
}

function compositeChoices(el: Element, id: Identity, out: VarDef['composite'] = []) {
  for (const c of kids(el)) {
    if (!isIncluded(c, id)) continue
    if (c.localName === 'compositeChoice') {
      out.push({
        label: localized(c, 'choice') ?? '',
        settings: kids(c, 'compositeSetting').map((s) => ({ ref: s.getAttribute('label') ?? '', value: Number(s.getAttribute('value')) })),
      })
    } else if (c.localName === 'compositeChoiceGroup') compositeChoices(c, id, out)
  }
  return out
}

function parts(cv: string, mask: string, highCV: string | null, upperMask: string): CvPart[] {
  const masks = mask.split(' ')
  const list = expandCvList(cv)
  if (list.length === 0) return [{ cv, mask: masks[0] }, ...(highCV ? [{ cv: highCV, mask: upperMask }] : [])]
  return list.map((c, i) => ({ cv: c, mask: masks[Math.min(i, masks.length - 1)] }))
}

function variable(el: Element, id: Identity, inherited: Qualifier[]): VarDef | null {
  const item = el.getAttribute('item') ?? localized(el, 'label') ?? ''
  const cv = el.getAttribute('CV') ?? ''
  let mask = el.getAttribute('mask') ?? 'VVVVVVVV'
  const typeEl = kids(el).find((c) => c.localName.endsWith('Val'))
  if (!typeEl) return null
  const base: VarDef = {
    item,
    label: localized(el, 'label') ?? item,
    tooltip: localized(el, 'tooltip'),
    kind: 'unsupported',
    cvs: cv ? [{ cv, mask }] : [],
    min: NUM(typeEl, 'min', 0),
    max: NUM(typeEl, 'max', 255),
    factor: NUM(typeEl, 'factor', 1) || 1,
    offset: NUM(typeEl, 'offset', 0),
    choices: [],
    composite: [],
    readOnly: yes(el, 'readOnly'),
    writeOnly: yes(el, 'writeOnly'),
    infoOnly: yes(el, 'infoOnly'),
    default: el.getAttribute('default') != null && !Number.isNaN(Number(el.getAttribute('default'))) ? Number(el.getAttribute('default')) : null,
    qualifiers: [...inherited, ...qualifiersOf(el)],
  }
  // A matching <defaultItem> overrides the default for that model.
  for (const d of kids(el, 'defaultItem')) if (isIncluded(d, id) && d.getAttribute('default') != null) base.default = Number(d.getAttribute('default'))
  const split = (kind: VarKind) => ({
    ...base,
    kind,
    cvs: parts(cv, mask, typeEl.getAttribute('highCV'), typeEl.getAttribute('upperMask') ?? 'VVVVVVVV'),
    max: NUM(typeEl, 'max', Number.MAX_SAFE_INTEGER),
  })
  switch (typeEl.localName) {
    case 'decVal':
    case 'hexVal':
      // DecVariableValue: a max above 255 with the default mask widens the mask.
      if (base.max > 255 && mask === 'VVVVVVVV') mask = 'V'.repeat(Math.floor(Math.log2(base.max)) + 1)
      return { ...base, kind: typeEl.localName === 'decVal' ? 'dec' : 'hex', cvs: [{ cv, mask }] }
    case 'enumVal': {
      const choices = enumChoices(typeEl, id)
      return { ...base, kind: 'enum', choices, max: typeEl.getAttribute('max') != null ? base.max : choices.length }
    }
    case 'compositeVal':
      return { ...base, kind: 'composite', cvs: [], composite: compositeChoices(typeEl, id) }
    case 'shortAddressVal':
      return { ...base, kind: 'shortAddress', min: 1, max: 127 }
    case 'longAddressVal': {
      const next = /^\d+$/.test(cv) ? String(Number(cv) + 1) : cv
      return { ...base, kind: 'longAddress', cvs: [{ cv, mask: 'VVVVVVVV' }, { cv: next, mask: 'VVVVVVVV' }], min: 0, max: 10239 }
    }
    case 'speedTableVal': {
      const entries = NUM(typeEl, 'entries', 28)
      const first = Number(cv)
      return {
        ...base,
        kind: 'speedTable',
        min: NUM(typeEl, 'min', 0),
        max: NUM(typeEl, 'max', 255),
        cvs: Array.from({ length: entries }, (_, i) => ({ cv: String(first + i), mask: 'VVVVVVVV' })),
      }
    }
    case 'splitVal':
      return split('split')
    case 'splitHexVal':
      return split('splitHex')
    case 'splitEnumVal':
      return { ...split('splitEnum'), choices: enumChoices(typeEl, id) }
    default:
      return base
  }
}

function collectVariables(el: Element, id: Identity, inherited: Qualifier[], out: VarDef[]) {
  for (const c of kids(el)) {
    if (!isIncluded(c, id)) continue
    if (c.localName === 'variables') collectVariables(c, id, [...inherited, ...qualifiersOf(c)], out)
    else if (c.localName === 'variable') {
      const v = variable(c, id, inherited)
      if (v) out.push(v)
    }
  }
}

// ---------- panes ----------

function paneNode(el: Element, id: Identity): PaneNode | null {
  if (!isIncluded(el, id)) return null
  const qualifiers = qualifiersOf(el)
  const children = () => kids(el).flatMap((c) => paneNode(c, id) ?? [])
  switch (el.localName) {
    case 'column':
    case 'row':
      return { t: 'box', dir: el.localName, children: children(), qualifiers }
    case 'group':
      return { t: 'group', children: children(), qualifiers }
    case 'grid': {
      // GridBagLayout: gridx/gridy are numbers, NEXT/RELATIVE (after the previous item) or CURRENT (same as it).
      let x = -1
      let y = 0
      const items = kids(el, 'griditem').flatMap((g) => {
        if (!isIncluded(g, id)) return []
        const gx = g.getAttribute('gridx') ?? 'NEXT'
        const gy = g.getAttribute('gridy') ?? 'CURRENT'
        x = gx === 'NEXT' || gx === 'RELATIVE' ? x + 1 : gx === 'CURRENT' ? Math.max(x, 0) : Number(gx)
        y = gy === 'NEXT' || gy === 'RELATIVE' ? y + 1 : gy === 'CURRENT' ? y : Number(gy)
        const span = (a: string) => {
          const v = g.getAttribute(a)
          return v == null || v === 'REMAINDER' || v === 'RELATIVE' || Number.isNaN(Number(v)) ? 1 : Number(v)
        }
        return [{ x, y, w: span('gridwidth'), h: span('gridheight'), children: kids(g).flatMap((c) => paneNode(c, id) ?? []) }]
      })
      return { t: 'grid', items, qualifiers }
    }
    case 'display':
      return {
        t: 'display',
        item: el.getAttribute('item') ?? '',
        label: el.hasAttribute('label') ? (el.getAttribute('label') ?? '') : (localized(el, 'label') ?? undefined),
        format: el.getAttribute('format') ?? undefined,
        layout: el.getAttribute('layout') ?? undefined,
        tooltip: localized(el, 'tooltip') ?? undefined,
        qualifiers,
      }
    case 'label': {
      const text = (kid(el, 'text') ? localized(el, 'text') : (el.getAttribute('label') ?? el.textContent))?.trim() ?? ''
      return { t: 'label', text, qualifiers }
    }
    case 'separator':
      return { t: 'separator' }
    case 'fnmapping':
    case 'cvtable':
    case 'dccaddress':
      return { t: el.localName }
    default:
      return null
  }
}

function pane(el: Element, id: Identity, fromProgrammer: boolean): PaneDef | null {
  if (!isIncluded(el, id)) return null
  const name = localized(el, 'name') ?? el.getAttribute('name') ?? 'Pane'
  const children = kids(el).flatMap((c) => paneNode(c, id) ?? [])
  return { name, fromProgrammer, root: { t: 'box', dir: 'row', children, qualifiers: [] } }
}

/** Primary (untranslated) pane name, which is what decoder panes replace programmer panes by. */
const primaryName = (el: Element) => kids(el, 'name').find((n) => !lang(n))?.textContent?.trim() ?? el.getAttribute('name') ?? ''

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) throw new Error(`Bad XML: ${err.textContent?.slice(0, 120)}`)
  return doc
}

/**
 * A decoder definition for one model. Panes are merged with the programmer's like DecoderPro: programmer panes in
 * order (a same-named decoder pane replaces one), then the decoder's other panes.
 */
export function parseDecoder(file: string, xml: string, model: string | null, programmerXml: string | null, familyHint?: string): { def: DecoderDef; programmer: ProgrammerDef | null } {
  const root = parseXml(xml).documentElement
  const decoder = kid(root, 'decoder')
  const familyEl = decoder && kid(decoder, 'family')
  if (!decoder || !familyEl) throw new Error(`${file} is not a decoder definition`)
  const models = kids(familyEl, 'model')
  const modelEl = models.find((m) => m.getAttribute('model') === model) ?? models[0]
  const id: Identity = {
    productID: modelEl?.getAttribute('productID') ?? null,
    model: modelEl?.getAttribute('model') ?? model ?? '',
    family: familyHint ?? familyEl.getAttribute('name') ?? '',
  }
  const variables: VarDef[] = []
  const varsEl = kid(decoder, 'variables')
  if (varsEl) collectVariables(varsEl, id, qualifiersOf(varsEl), variables)
  const outputs = [...kids(familyEl, 'output'), ...(modelEl ? kids(modelEl, 'output') : [])].map((o) => ({
    name: o.getAttribute('name') ?? '',
    label: o.getAttribute('label') ?? o.getAttribute('name') ?? '',
  }))
  const decoderPaneEls = kids(root, 'pane').filter((p) => isIncluded(p, id))
  const def: DecoderDef = { file, mfg: familyEl.getAttribute('mfg') ?? '', family: id.family, model: id.model, productID: id.productID, variables, outputs, panes: [] }

  let programmer: ProgrammerDef | null = null
  const remaining = [...decoderPaneEls]
  if (programmerXml) {
    const pRoot = parseXml(programmerXml).documentElement
    const pEl = kid(pRoot, 'programmer')
    const panes: PaneDef[] = []
    for (const p of pEl ? kids(pEl, 'pane') : []) {
      const i = remaining.findIndex((d) => primaryName(d) === primaryName(p))
      const replaced = i >= 0 ? remaining.splice(i, 1)[0] : null
      const made = pane(replaced ?? p, id, !replaced)
      if (made) panes.push(made)
    }
    programmer = { name: pRoot.getAttribute('name') ?? 'Comprehensive', panes, decoderFilePanes: pEl?.getAttribute('decoderFilePanes') !== 'no' }
    def.panes = panes
  }
  if (!programmer || programmer.decoderFilePanes) def.panes = [...def.panes, ...remaining.flatMap((p) => pane(p, id, false) ?? [])]
  return { def, programmer }
}

// ---------- values ----------

export type CvState = 'default' | 'file' | 'read' | 'edited' | 'stored'

export interface CvEntry {
  value: number
  state: CvState
}

export type CvStore = Record<string, CvEntry>

const pow2 = (n: number) => 2 ** n

/** The variable's raw value from its CVs (before factor/offset), or null if it has none. */
export function rawValue(v: VarDef, cvs: CvStore, vars?: Map<string, VarDef>): number | null {
  const at = (cv: string) => cvs[cv]?.value ?? 0
  switch (v.kind) {
    case 'longAddress':
      return ((at(v.cvs[0].cv) & 0x3f) << 8) + at(v.cvs[1].cv)
    case 'split':
    case 'splitHex':
    case 'splitEnum': {
      let offset = 0
      let total = 0
      for (const p of v.cvs) {
        const bits = isBitMask(p.mask) ? (at(p.cv) & maskInt(p.mask)) >>> maskShift(p.mask) : at(p.cv)
        total += bits * pow2(offset)
        offset += maskWidth(p.mask)
      }
      return total
    }
    case 'composite': {
      if (!vars) return null
      const i = v.composite.findIndex((c) => c.settings.every((s) => {
        const target = vars.get(s.ref)
        return target ? rawValue(target, cvs, vars) === s.value : false
      }))
      return i
    }
    case 'speedTable':
    case 'unsupported':
      return v.cvs.length ? at(v.cvs[0].cv) : null
    default:
      return v.cvs.length ? getValueInCV(at(v.cvs[0].cv), v.cvs[0].mask, v.max) : null
  }
}

/** Value as shown (factor and offset applied). */
export function shownValue(v: VarDef, cvs: CvStore): number | null {
  const raw = rawValue(v, cvs)
  return raw == null ? null : raw * v.factor + v.offset
}

/** New CV values that give the variable this raw value. */
export function cvsForRaw(v: VarDef, raw: number, cvs: CvStore): Record<string, number> {
  const at = (cv: string) => cvs[cv]?.value ?? 0
  const out: Record<string, number> = {}
  switch (v.kind) {
    case 'longAddress':
      out[v.cvs[0].cv] = 192 + ((raw >> 8) & 0x3f)
      out[v.cvs[1].cv] = raw & 0xff
      return out
    case 'split':
    case 'splitHex':
    case 'splitEnum': {
      let offset = 0
      for (const p of v.cvs) {
        const width = maskWidth(p.mask)
        const part = Math.floor(raw / pow2(offset)) % pow2(width)
        out[p.cv] = isBitMask(p.mask) ? setValueInCV(at(p.cv), part, p.mask, 255) : part
        offset += width
      }
      return out
    }
    case 'composite':
    case 'speedTable':
    case 'unsupported':
      return out
    default:
      if (v.cvs.length) out[v.cvs[0].cv] = setValueInCV(at(v.cvs[0].cv), raw, v.cvs[0].mask, v.max)
      return out
  }
}

/** Raw value for a shown value (inverse of factor/offset). */
export const rawFromShown = (v: VarDef, shown: number) => Math.round((shown - v.offset) / v.factor)

/** Variables by item, falling back to label (VariableTableModel.findVar). */
export function variableIndex(vars: VarDef[]): Map<string, VarDef> {
  const m = new Map<string, VarDef>()
  for (const v of vars) if (!m.has(v.label)) m.set(v.label, v)
  for (const v of vars) m.set(v.item, v)
  return m
}

/** ArithmeticQualifier: every qualifier must hold. */
export function qualified(qs: Qualifier[], vars: Map<string, VarDef>, cvs: CvStore): boolean {
  return qs.every((q) => {
    const target = vars.get(q.ref)
    if (q.relation === 'exists') return (target ? 1 : 0) === q.value
    if (!target) return true // JMRI leaves an unresolvable qualifier inert
    const v = rawValue(target, cvs, vars)
    if (v == null) return true
    switch (q.relation) {
      case 'eq':
        return v === q.value
      case 'ne':
        return v !== q.value
      case 'gt':
        return v > q.value
      case 'ge':
        return v >= q.value
      case 'lt':
        return v < q.value
      case 'le':
        return v <= q.value
      default:
        return true
    }
  })
}

/** CV store with every variable's CVs at 0, then each default applied in file order, as DecoderPro starts. */
export function defaultStore(def: DecoderDef): CvStore {
  const store: CvStore = {}
  for (const v of def.variables) for (const p of v.cvs) store[p.cv] ??= { value: 0, state: 'default' }
  for (const v of def.variables) {
    if (v.default == null) continue
    const raw = v.kind === 'enum' || v.kind === 'splitEnum' ? v.default : rawFromShown(v, v.default)
    for (const [cv, value] of Object.entries(cvsForRaw(v, raw, store))) store[cv] = { value, state: 'default' }
  }
  return store
}

/** Every CV the definition uses, in a natural order. */
export function allCvs(def: DecoderDef): string[] {
  const set = new Set<string>()
  for (const v of def.variables) for (const p of v.cvs) set.add(p.cv)
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/** Function-map cell for a variable named like "FL(f) controls output 1" or "F3 controls output 4". */
export function fnMapCell(item: string): { fn: string; output: string } | null {
  const m = /^(FL\([fr]\)|F\d+(?:\([fr]\))?) controls output (\S+)$/.exec(item)
  return m ? { fn: m[1], output: m[2] } : null
}

/** Display items a pane shows (for emptiness and for "read this pane"). */
export function paneItems(node: PaneNode, out: string[] = []): string[] {
  switch (node.t) {
    case 'box':
    case 'group':
      node.children.forEach((c) => paneItems(c, out))
      break
    case 'grid':
      node.items.forEach((i) => i.children.forEach((c) => paneItems(c, out)))
      break
    case 'display':
      out.push(node.item)
      break
  }
  return out
}

export function paneHas(node: PaneNode, t: PaneNode['t']): boolean {
  if (node.t === t) return true
  if (node.t === 'box' || node.t === 'group') return node.children.some((c) => paneHas(c, t))
  if (node.t === 'grid') return node.items.some((i) => i.children.some((c) => paneHas(c, t)))
  return false
}
