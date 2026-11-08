import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import type { Block } from '../types'

const PANE = 'cardify'
// Change a tag when its value's shape changes: it declines what an earlier version stored.
const latest = atom({ plugin: 'cardify', key: 'latest' } as const, '', { shape: 'latest-1' })
// ponytail: session-only switch. Move it to $.store if it should survive a restart.
const isOn = atom({ plugin: 'cardify', key: 'isOn' } as const, true, { shape: 'on-1' })
// What each ask or button already sent, so a card shows "Sent" and can't send twice. ponytail: grows for the session.
const sent = atom({ plugin: 'cardify', key: 'sent' } as const, {} as Record<string, string>, { shape: 'sent-1' })

// ---- Look: cards are dark panels with their own text color, so they read the same on a light or dark theme.

const C = {
  panel: '#161b22',
  raised: '#1c2128',
  head: '#21262d',
  line: '#30363d',
  text: '#e6edf3',
  dim: '#8b949e',
  hero: '#1a2142',
  heroLine: '#3d4f9f',
  heroSub: '#a5b4fc',
  hover: '#262c36',
  soft: '#c9d1d9',
  ink: '#0d1117',
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'next' | 'ask' | 'note'
const TONE: Record<Tone, { color: string; bg: string; icon: string }> = {
  ok: { color: '#3fb950', bg: '#0f2419', icon: '✅' },
  warn: { color: '#d29922', bg: '#2a2010', icon: '⚠️' },
  bad: { color: '#f85149', bg: '#2c1416', icon: '❌' },
  info: { color: '#39c5cf', bg: '#0d2229', icon: '💡' },
  next: { color: '#58a6ff', bg: '#0d1b30', icon: '👉' },
  ask: { color: '#db61a2', bg: '#2a1226', icon: '❓' },
  note: { color: '#8b949e', bg: '#161b22', icon: '📌' },
}
const asTone = (s: string | undefined, fallback: Tone = 'info'): Tone =>
  s && s.trim().toLowerCase() in TONE ? (s.trim().toLowerCase() as Tone) : fallback

const BAR = 20

// How many cells a string takes: emoji and pictographs are two wide, variation selectors none.
export const wide = (s: string) =>
  [...s].reduce((w, ch) => {
    const cp = ch.codePointAt(0) ?? 0

    return w + (cp === 0xfe0f || cp === 0x200d ? 0 : cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) ? 2 : 1)
  }, 0)

// ---- Markdown fallback: replies without a ui block still get cards from their structure.

const cells = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())

const ITEM = /^\s*([-*]|\d+\.)\s/

// ponytail: line-based markdown subset (headings, bold-only lines, lists, tables, code). Swap for a real parser if it falls short.
export const parse = (md: string): Block[] => {
  const out: Block[] = []
  const lines = md.split('\n')
  const at = (n: number) => lines[n] ?? ''

  for (let i = 0; i < lines.length; i++) {
    const line = at(i)
    const next = at(i + 1)

    if (line.startsWith('```')) {
      const code: string[] = []
      for (i++; i < lines.length && !at(i).startsWith('```'); i++) code.push(at(i))
      out.push({ kind: 'code', text: code.join('\n') })
    } else if (/^#{1,6}\s/.test(line)) {
      out.push({ kind: 'title', text: line.replace(/^#+\s*/, '') })
    } else if (/^\*\*[^*]+\*\*:?$/.test(line.trim())) {
      out.push({ kind: 'title', text: line.trim().replace(/^\*\*|\*\*:?$/g, '') })
    } else if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(next)) {
      const rows: string[][] = []
      for (i += 2; i < lines.length && at(i).includes('|'); i++) rows.push(cells(at(i)))
      i--
      out.push({ kind: 'table', head: cells(line), rows })
    } else if (ITEM.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      for (; i < lines.length && ITEM.test(at(i)); i++) {
        items.push(at(i).replace(/^\s*([-*]|\d+\.)\s+/, ''))
      }
      i--
      out.push({ kind: 'list', items, ordered })
    } else if (line.trim()) {
      out.push({ kind: 'text', text: line.trim() })
    }
  }

  return out
}

// Status words become sticker badges: [pattern, color, emoji]. Order decides ties: "not verified" beats "verified".
const BADGES: [RegExp, string, string][] = [
  [/\b(done|pass(ed|es|ing)?|ok|success(ful)?|fixed|complete(d)?|installed|enabled|merged|shipped|verified|works)\b/i, 'green', '✅'],
  [/\b(fail(ed|ing|s|ure)?|errors?|blocked|broken|crash(ed)?|missing|denied|refused|regression)\b/i, 'red', '❌'],
  [/\b(warning|pending|todo|wip|not verified|unverified|caution|deprecated|flaky|skipped|untested)\b/i, 'yellow', '⚠️'],
  [/\b(note|tip|hint)\b/i, 'cyan', '💡'],
  [/\b(beta|experimental)\b/i, 'magenta', '🧪'],
]
const BADGE = new RegExp(BADGES.map(([re]) => re.source).join('|'), 'gi')
const BADGE_TONE: Record<string, Tone> = { green: 'ok', red: 'bad', yellow: 'warn', cyan: 'info', magenta: 'ask' }

// Splits a string into plain runs and status-word runs that get a color and a sticker.
export const split = (s: string): { text: string; color?: string; emoji?: string }[] => {
  const out: { text: string; color?: string; emoji?: string }[] = []
  let at = 0

  for (const m of s.matchAll(BADGE)) {
    const hit = BADGES.find(([re]) => re.test(m[0]))
    if (m.index > at) out.push({ text: s.slice(at, m.index) })
    out.push({ text: m[0], color: hit?.[1], emoji: hit?.[2] })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ text: s.slice(at) })

  return out
}

// Only redraw replies that have structure; plain prose stays as the surface draws it.
export const isStructured = (list: Block[]) => list.some(b => b.kind !== 'text')

type Act = 'button' | 'input'

// A section card's tone and behavior come from its heading. The first match wins, so "Not done yet" is a warning.
const TONES: { re: RegExp; tone: Tone; act?: Act }[] = [
  { re: /heads-up|warning|caveat|risk|not done|not yet|still open|bug|problem|issue|gap|unverified/i, tone: 'warn' },
  { re: /question|your answer|reply|tell me|input/i, tone: 'ask', act: 'input' },
  { re: /option|choose|pick|which|next|todo|to do|steps?|follow/i, tone: 'next', act: 'button' },
  { re: /done|did|fixed|result|change|added|built|works|checks?|summary|what.s in/i, tone: 'ok' },
  { re: /tip|note|info|why|idea|background|context/i, tone: 'info' },
]
export const tone = (title: string): { tone: Tone; act?: Act } => TONES.find(t => t.re.test(title)) ?? { tone: 'note' }

type Section = { title?: string; body: Block[] }

// A heading starts a section; anything before the first heading is the intro.
export const group = (list: Block[]): Section[] => {
  const out: Section[] = []
  let cur: Section | undefined

  for (const b of list) {
    if (b.kind === 'title') {
      cur = { title: b.text, body: [] }
      out.push(cur)
    } else {
      if (!cur) {
        cur = { body: [] }
        out.push(cur)
      }
      cur.body.push(b)
    }
  }

  return out
}

type Bar = { label: string; raw: string; bar: string; n: number }

const NUM = /^~?[$€£]?-?\d[\d,]*(\.\d+)?\s*(%|k|m|ms|s|x|[a-z]{1,2})?$/i
const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''))

// Scales values to a bar of BAR cells; percentages scale to 100.
const bars = (rows: { label: string; raw: string }[]): Bar[] | undefined => {
  const vals = rows.map(r => num(r.raw))
  if (rows.length < 2 || vals.some(Number.isNaN)) return undefined

  const top = Math.max(...vals.map(Math.abs), rows.every(r => r.raw.includes('%')) ? 100 : 1)

  return rows.map((r, i) => {
    const n = Math.round((Math.max(vals[i] ?? 0, 0) / top) * BAR)

    return { ...r, n, bar: '█'.repeat(n) + '░'.repeat(BAR - n) }
  })
}

// A table whose column (after the first) is all numbers also gets a bar chart of it.
export const tableChart = (head: string[], rows: string[][]) => {
  const col = head.findIndex((_, c) => c > 0 && rows.length > 1 && rows.every(r => NUM.test(r[c] ?? '')))
  const data = col < 0 ? undefined : bars(rows.map(r => ({ label: r[0] ?? '', raw: r[col] ?? '' })))

  return data && { title: head[col] ?? '', data }
}

// A list of "Label: 72%" items is a bar chart, not rows.
export const listChart = (items: string[]) => {
  const parsed = items.map(i => /^(.+?)\s*[:–-]\s*(~?[$€£]?-?\d[\d,.]*\s*(%|k|ms|s|x)?)$/i.exec(i))
  const ok = parsed.every(Boolean) && parsed.length > 1

  return ok ? bars(parsed.map(m => ({ label: m?.[1] ?? '', raw: m?.[2] ?? '' }))) : undefined
}

// ---- Interaction: an ask or a button sends once, as the person, and its card then says what it sent.

type Io = { send: (key: string, text: string) => void; sentOf: (key: string) => string | undefined }

// A message's own id: the same text in the pane and the transcript shares what it sent.
export const hash = (s: string) => {
  let n = 5381
  for (let i = 0; i < s.length; i++) n = ((n << 5) + n + s.charCodeAt(i)) | 0

  return (n >>> 0).toString(36)
}

// Guards a double Enter, or Enter then the send button, before the redraw lands. ponytail: module memory, cleared on reload.
const fired = new Set<string>()

const ioFor = async ($: EngineInterface, text: string): Promise<Io> => {
  const id = hash(text)
  const done = await read($, sent)

  return {
    sentOf: key => done[`${id}:${key}`],
    send: (key, said) => {
      const k = `${id}:${key}`
      if (fired.has(k) || done[k]) return
      fired.add(k)
      void update($, sent, m => ({ ...m, [k]: said }))
      // A refused submit (busy session) must not throw inside a handler.
      $.prompt.submit({ text: said, asUser: true }).catch(() => {})
    },
  }
}

// ---- Drawing

// Y is the vertical spacing step: 0 on the terminal (a cell is a whole line), 1 on graphical surfaces.
// Svg exists on graphical surfaces only; there charts are real vector drawings, on the terminal colored cells.
type T = Pick<ElementTable, 'Box' | 'Text' | 'Button' | 'Link' | 'Markdown'> & {
  Input?: ElementTable<'desktop'>['Input']
  Svg?: ElementTable<'desktop'>['Svg']
  Y: number
  // Text sizes, monospace and {...ty(t, { tabular: true })} figures: engines before 2.1.317 refuse these props (and with them the whole tree).
  fancy: boolean
}

// Typography props where the engine has them, nothing where it doesn't.
const ty = (t: T, p: { size?: 'caption' | 'footnote' | 'body' | 'heading' | 'title'; mono?: boolean; tabular?: boolean }) =>
  (t.fancy ? p : {}) as {}

export const isFancyVersion = (version: string) => {
  const [a = 0, b = 0, c = 0] = version.split(/[.-]/).map(Number)

  return a > 2 || (a === 2 && (b > 1 || (b === 1 && c >= 317)))
}

// The element table for a drawing. The terminal hands out an Svg that draws nothing, so charts there use cells.
const table = async ($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0] & { surface: string }): Promise<T> => {
  const r = $.ui.resolve(e)
  const isTerminal = e.surface === 'terminal'

  return { ...r, Svg: !isTerminal && 'Svg' in r ? r.Svg : undefined, Y: isTerminal ? 0 : 1, fancy: await isFancy($) }
}

let fancy: Promise<boolean> | undefined
const isFancy = ($: EngineInterface) =>
  (fancy ??= $.session.version().then(v => isFancyVersion(v.version), () => false))

// Series colors for charts, in order.
const PALETTE = ['#58a6ff', '#3fb950', '#d29922', '#db61a2', '#39c5cf', '#a371f7', '#f85149', '#ffa657']
const hue = (i: number) => PALETTE[i % PALETTE.length] ?? '#58a6ff'

const pill = ({ Text }: T, tn: Tone, text: string) => (
  <Text bold color={TONE[tn].color} backgroundColor={TONE[tn].bg}>{` ${text} `}</Text>
)

// Inline **bold**, `code`, links and [tone: pills]. Status-word badges only where asked: rows and cells, never prose.
const rich = (t: T, s: string, hasBadges: boolean) => {
  const { Text, Link } = t

  return s
    .split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+|\[(?:ok|warn|bad|info|next|ask|note):[^\]]+\])/)
    .filter(Boolean)
    .flatMap(part => {
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
        return [<Text bold>{part.slice(2, -2)}</Text>]
      }
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return [<Text {...ty(t, { mono: true })} color={C.text} backgroundColor={C.line}>{` ${part.slice(1, -1)} `}</Text>]
      }
      if (/^https?:\/\//.test(part)) return [<Link href={part} />]

      const tag = /^\[(\w+):\s*([^\]]+)\]$/.exec(part)
      if (tag) return [pill(t, asTone(tag[1]), (tag[2] ?? '').trim())]
      if (!hasBadges) return [<Text>{part}</Text>]

      return split(part).map(r =>
        r.color ? pill(t, BADGE_TONE[r.color] ?? 'info', `${r.emoji} ${r.text}`) : <Text>{r.text}</Text>,
      )
    })
}

const plain = (s: string) => s.replace(/\*\*|`|\[\w+:\s*|\]/g, '')

type El = ReturnType<typeof rich>[number]

// A tinted panel: the shared shape of every card.
const card = (t: T, tn: Tone, title: string | undefined, kids: (El | null)[]) => {
  const { Box, Text, Y } = t

  return (
  <Box flexDirection="column" gap={Y} backgroundColor={TONE[tn].bg} borderStyle="round" borderColor={TONE[tn].color} paddingX={2} paddingY={Y}>
    {title ? <Text bold {...ty(t, { size: 'heading' })} color={TONE[tn].color}>{title}</Text> : null}
    {kids}
  </Box>
  )
}

// ---- Vector charts (graphical surfaces)

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const SVG = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">${body}</svg>`

type Row = { label: string; frac: number; text: string; color?: string }

// Horizontal bars: label column, rounded track and bar, value at the end.
export const barSvg = (rows: Row[]) => {
  const lw = Math.round(Math.min(200, Math.max(60, ...rows.map(r => wide(r.label) * 7.6))) + 12)
  const W = 600
  const bw = W - lw - 96
  const body = rows
    .map((r, i) => {
      const y = i * 32
      const w = r.frac > 0 ? Math.max(8, Math.round(Math.min(r.frac, 1) * bw)) : 0

      return (
        `<text x="0" y="${y + 21}" fill="${C.text}" font-size="13">${esc(r.label)}</text>` +
        `<rect x="${lw}" y="${y + 8}" width="${bw}" height="16" rx="8" fill="${C.line}"/>` +
        `<rect x="${lw}" y="${y + 8}" width="${w}" height="16" rx="8" fill="${r.color ?? hue(i)}"/>` +
        `<text x="${lw + bw + 12}" y="${y + 21}" fill="${C.text}" font-size="13" font-weight="600">${esc(r.text)}</text>`
      )
    })
    .join('')

  return { source: SVG(W, rows.length * 32, body), width: W, height: rows.length * 32 }
}

// A donut: one arc per value, on a dark ring.
export const pieSvg = (values: number[]) => {
  const total = values.reduce((a, v) => a + Math.max(v, 0), 0) || 1
  const R = 58
  const L = 2 * Math.PI * R
  let off = 0
  const arcs = values
    .map((v, i) => {
      const len = (Math.max(v, 0) / total) * L
      const arc = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${hue(i)}" stroke-width="24" stroke-dasharray="${len.toFixed(2)} ${(L - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)"/>`
      off += len

      return arc
    })
    .join('')

  return { source: SVG(160, 160, `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${C.line}" stroke-width="24"/>${arcs}`), width: 160, height: 160 }
}

// A sparkline: a soft area under a line, a dot on the latest value.
export const sparkSvg = (vals: number[], color: string) => {
  const W = 150
  const H = 34
  const min = Math.min(...vals)
  const span = Math.max(...vals) - min || 1
  const pts = vals.map((v, i) => [(i / (vals.length - 1 || 1)) * (W - 8) + 4, H - 4 - ((v - min) / span) * (H - 10)] as const)
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pts[pts.length - 1] ?? [0, 0]

  return {
    source: SVG(
      W,
      H,
      `<polygon points="4,${H} ${line} ${W - 4},${H}" fill="${color}" fill-opacity="0.18"/>` +
        `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>` +
        `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.2" fill="${color}"/>`,
    ),
    width: W,
    height: H,
  }
}

// The terminal's sparkline: one block glyph per value.
export const sparkText = (vals: number[]) => {
  const min = Math.min(...vals)
  const span = Math.max(...vals) - min || 1

  return vals.map(v => '▁▂▃▄▅▆▇█'[Math.round(((v - min) / span) * 7)] ?? '▁').join('')
}

// A bar: a filled run and its track, drawn as colored cells (the terminal's chart).
const meter = ({ Text }: T, n: number, color: string) => (
  <Text>
    <Text backgroundColor={color}>{' '.repeat(n)}</Text>
    <Text backgroundColor={C.line}>{' '.repeat(Math.max(BAR - n, 0))}</Text>
  </Text>
)

// Bars as a vector chart where the surface draws one, else as colored cells.
const chart = (t: T, rows: Row[], alt: string) => {
  const { Box, Text, Svg, Y } = t

  if (Svg) {
    const svg = barSvg(rows)

    return <Svg source={svg.source} width={svg.width} height={svg.height} alt={alt} />
  }
  const w = Math.max(...rows.map(r => wide(r.label))) + 1

  return (
    <Box flexDirection="column" gap={Y}>
      {rows.map((r, i) => (
        <Box gap={1}>
          <Box width={w}>
            <Text color={C.text}>{r.label}</Text>
          </Box>
          {meter(t, Math.round(Math.min(r.frac, 1) * BAR), r.color ?? hue(i))}
          <Text bold color={C.text}>{r.text}</Text>
        </Box>
      ))}
    </Box>
  )
}

const chartRows = (t: T, data: Bar[], color?: string) =>
  chart(t, data.map(d => ({ label: d.label, frac: d.n / BAR, text: d.raw, color })), data.map(d => `${d.label} ${d.raw}`).join(', '))

// A real table: fixed-width cells (character cells, the same on every surface), a header band, striped rows that
// light up under the pointer, numbers right-aligned in {...ty(t, { tabular: true })} figures, the first column bold.
const grid = (t: T, head: string[], rows: string[][], id: string) => {
  const { Box, Text, Y } = t
  const isNum = head.map((_, c) => rows.length > 0 && rows.every(r => NUM.test(plain(r[c] ?? ''))))
  const widths = head.map((label, c) => Math.min(32, Math.max(wide(label), ...rows.map(r => wide(plain(r[c] ?? ''))))) + 4)
  const cell = (c: number, kid: El) => (
    <Box width={widths[c] ?? 14} paddingX={2} justifyContent={isNum[c] ? 'flex-end' : 'flex-start'}>
      {kid}
    </Box>
  )

  return (
    <Box flexDirection="column" backgroundColor={C.panel} borderStyle="round" borderColor={C.line}>
      <Box backgroundColor={C.head} paddingY={Y}>
        {head.map((label, c) => cell(c, <Text bold {...ty(t, { size: 'footnote' })} color={C.dim}>{label}</Text>))}
      </Box>
      {rows.map((row, i) => (
        <Box key={`${id}-row-${i}`} backgroundColor={i % 2 ? C.raised : C.panel} paddingY={Y} hover={{ backgroundColor: C.hover }}>
          {head.map((_, c) => cell(c, <Text color={C.text} bold={c === 0} {...ty(t, { tabular: isNum[c] })}>{rich(t, row[c] ?? '', true)}</Text>))}
        </Box>
      ))}
    </Box>
  )
}

const sentNote = ({ Text }: T, said: string) => <Text bold color={TONE.ok.color}>{`✓ Sent: ${said}`}</Text>

type Ctx = { t: T; tn: Tone; act?: Act; io: Io; id: string }

const body = (list: Block[], { t, tn, act, io, id }: Ctx) => {
  const { Box, Text, Button, Input, Y } = t
  const color = TONE[tn].color

  const out: (El | null)[] = list.map((b, n) => {
    if (b.kind === 'list') {
      const data = listChart(b.items)

      if (data) return chartRows(t, data, color)
      if (act === 'button') {
        const done = b.items.map((_, i) => io.sentOf(`${id}-${n}-${i}`)).find(Boolean)

        return done ? sentNote(t, done) : (
          <Box gap={1} flexWrap="wrap">
            {b.items.map((item, i) => (
              <Button
                key={`${id}-${n}-${i}`}
                variant={i === 0 ? 'primary' : 'secondary'}
                label={plain(item)}
                onPress={() => io.send(`${id}-${n}-${i}`, `Go ahead with: ${plain(item)}`)}
              />
            ))}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" gap={Y}>
          {b.items.map((item, i) => (
            <Box gap={1}>
              <Text bold color={color}>{b.ordered ? `${i + 1}.` : '•'}</Text>
              <Text color={C.text}>{rich(t, item, true)}</Text>
            </Box>
          ))}
        </Box>
      )
    }
    if (b.kind === 'table') {
      const tc = tableChart(b.head, b.rows)

      return (
        <Box flexDirection="column" gap={Y}>
          {grid(t, b.head, b.rows, `${id}-${n}`)}
          {tc ? (
            <Box flexDirection="column" gap={Y}>
              <Text {...ty(t, { size: 'footnote' })} color={C.dim}>{tc.title}</Text>
              {chartRows(t, tc.data)}
            </Box>
          ) : null}
        </Box>
      )
    }
    if (b.kind === 'code') {
      return (
        <Box backgroundColor={C.ink} borderStyle="round" borderColor={C.line} paddingX={2}>
          <Text {...ty(t, { mono: true })} color={C.text}>{b.text}</Text>
        </Box>
      )
    }

    return <Text color={C.text}>{rich(t, b.text, false)}</Text>
  })

  if (act === 'input' && Input) {
    const done = io.sentOf(`${id}-ask`)

    out.push(
      done ? sentNote(t, done) : (
        <Input key={`${id}-ask`} placeholder="Type your answer" submitLabel="send" onSubmit={v => v.trim() && io.send(`${id}-ask`, v.trim())} />
      ),
    )
  }

  return out
}

// The markdown fallback's drawing: a tinted card per section.
const draw = (list: Block[], t: T, io: Io) => {
  const { Box, Y } = t

  return (
    <Box flexDirection="column" gap={1}>
      {group(list).map((s, i) => {
        const id = `cardify-${i}`

        if (s.title === undefined) {
          return <Box flexDirection="column" gap={Y}>{body(s.body, { t, tn: 'note', io, id })}</Box>
        }
        const { tone: tn, act } = tone(s.title)

        return card(t, tn, `${TONE[tn].icon} ${s.title}`, body(s.body, { t, tn, act, io, id }))
      })}
    </Box>
  )
}

// ---- The ui block language: Claude writes it, Cardify draws it. Like OpenUI, but a few lines per component.

export type Ui =
  | { kind: 'md'; text: string }
  | { kind: 'title' | 'section'; text: string; sub?: string }
  | { kind: 'callout'; tone: Tone; title: string; text: string }
  | { kind: 'stats'; items: { label: string; value: string; note?: string }[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'bars'; title: string; rows: { label: string; raw: string; text: string }[] }
  | { kind: 'list' | 'steps'; title: string; items: string[] }
  | { kind: 'buttons'; title: string; items: { label: string; prompt?: string }[] }
  | { kind: 'ask'; question: string }
  | { kind: 'badges'; items: { text: string; tone: Tone }[] }
  | { kind: 'cards'; title: string; items: { title: string; sub?: string; body?: string; tone: Tone }[] }
  | { kind: 'kv'; title: string; items: { key: string; value: string }[] }
  | { kind: 'progress'; title: string; items: { label: string; pct: number }[] }
  | { kind: 'timeline'; title: string; items: { when: string; what: string }[] }
  | { kind: 'pie'; title: string; items: { label: string; value: number }[] }
  | { kind: 'trend'; title: string; items: { label: string; values: number[]; text: string }[] }

const NAME = /^(title|section|callout|stats|table|bars|list|steps|buttons|ask|badges|cards|kv|progress|timeline|pie|trend)(?:\s+(\w+))?\s*:\s*(.*)$/i
const parts = (s: string) => s.split('|').map(p => p.trim())

const component = (name: string, tag: string | undefined, head: string, rows: string[][]): Ui | undefined => {
  switch (name) {
    case 'title': {
      const [text = '', ...sub] = parts(head)

      return { kind: 'title', text, sub: sub.join(' | ') || undefined }
    }
    case 'section':
      return { kind: 'section', text: head }
    case 'callout': {
      const [title = '', ...rest] = parts(head)

      return { kind: 'callout', tone: asTone(tag), title, text: rest.join(' | ') }
    }
    case 'stats':
      return { kind: 'stats', items: rows.map(([label = '', value = '', note]) => ({ label, value, note })) }
    case 'table':
      return { kind: 'table', head: parts(head), rows }
    case 'bars':
      return { kind: 'bars', title: head, rows: rows.map(([label = '', raw = '', text]) => ({ label, raw, text: text ?? raw })) }
    case 'list':
      return { kind: 'list', title: head, items: rows.map(r => r.join(' | ')) }
    case 'steps':
      return { kind: 'steps', title: head, items: rows.map(r => r.join(' | ')) }
    case 'buttons':
      return { kind: 'buttons', title: head, items: rows.map(([label = '', prompt]) => ({ label, prompt })) }
    case 'ask':
      return { kind: 'ask', question: head }
    case 'badges':
      return { kind: 'badges', items: rows.map(([text = '', tn]) => ({ text, tone: asTone(tn) })) }
    case 'cards':
      return { kind: 'cards', title: head, items: rows.map(([title = '', sub, body, tn]) => ({ title, sub, body, tone: asTone(tn, 'note') })) }
    case 'kv':
      return { kind: 'kv', title: head, items: rows.map(([key = '', ...value]) => ({ key, value: value.join(' | ') })) }
    case 'progress':
      return { kind: 'progress', title: head, items: rows.map(([label = '', raw = '']) => ({ label, pct: Math.min(Math.max(num(raw) || 0, 0), 100) })) }
    case 'timeline':
      return { kind: 'timeline', title: head, items: rows.map(([when = '', ...what]) => ({ when, what: what.join(' | ') })) }
    case 'pie':
      return { kind: 'pie', title: head, items: rows.map(([label = '', raw = '']) => ({ label, value: num(raw) || 0 })) }
    case 'trend':
      return {
        kind: 'trend',
        title: head,
        items: rows.map(([label = '', raw = '', text]) => {
          const values = raw.split(/[,\s]+/).map(num).filter(v => !Number.isNaN(v))

          return { label, values, text: text ?? String(values[values.length - 1] ?? '') }
        }),
      }
    default:
      return undefined
  }
}

// One component per `name: header` line, its rows as `- a | b | c` lines. Unknown lines are skipped.
const block = (src: string): Ui[] => {
  const out: Ui[] = []
  let cur: { name: string; tag?: string; head: string; rows: string[][] } | undefined
  const flush = () => {
    const u = cur && component(cur.name, cur.tag, cur.head, cur.rows)
    if (u) out.push(u)
    cur = undefined
  }

  for (const line of src.split('\n')) {
    const m = NAME.exec(line.trim())
    const row = /^\s*-\s+(.*)$/.exec(line)

    if (m) {
      flush()
      cur = { name: (m[1] ?? '').toLowerCase(), tag: m[2]?.toLowerCase(), head: (m[3] ?? '').trim(), rows: [] }
    } else if (row && cur) {
      cur.rows.push(parts(row[1] ?? ''))
    }
  }
  flush()

  return out
}

// Splits a reply into markdown prose and ui blocks. An unclosed block (still streaming) draws what it has.
export const parseUi = (text: string): Ui[] => {
  const out: Ui[] = []
  let at = 0
  const prose = (md: string) => {
    if (md.trim()) out.push({ kind: 'md', text: md.trim() })
  }

  for (const m of text.matchAll(/```(?:ui|cardify)[^\n]*\n([\s\S]*?)(?:```|$)/g)) {
    prose(text.slice(at, m.index))
    out.push(...block(m[1] ?? ''))
    at = m.index + m[0].length
  }
  prose(text.slice(at))

  return out
}

// What a ui block says as plain markdown, for when the cards are off.
export const toMarkdown = (segs: Ui[]) =>
  segs
    .map(u => {
      switch (u.kind) {
        case 'md':
          return u.text
        case 'title':
          return `## ${u.text}${u.sub ? `\n${u.sub}` : ''}`
        case 'section':
          return `### ${u.text}`
        case 'callout':
          return `> **${u.title}** ${u.text}`
        case 'stats':
          return u.items.map(i => `- ${i.label}: **${i.value}** ${i.note ?? ''}`).join('\n')
        case 'table':
          return [`| ${u.head.join(' | ')} |`, `|${u.head.map(() => '---').join('|')}|`, ...u.rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
        case 'bars':
          return `**${u.title}**\n${u.rows.map(r => `- ${r.label}: ${r.text}`).join('\n')}`
        case 'list':
        case 'steps':
          return `**${u.title}**\n${u.items.map((i, n) => (u.kind === 'steps' ? `${n + 1}. ${i}` : `- ${i}`)).join('\n')}`
        case 'buttons':
          return `**${u.title}**\n${u.items.map(i => `- ${i.label}`).join('\n')}`
        case 'ask':
          return `**${u.question}**`
        case 'badges':
          return u.items.map(i => `\`${i.text}\``).join(' ')
        case 'cards':
          return `**${u.title}**\n${u.items.map(c => `- **${c.title}** ${c.sub ?? ''} ${c.body ?? ''}`).join('\n')}`
        case 'kv':
          return `**${u.title}**\n${u.items.map(i => `- ${i.key}: ${i.value}`).join('\n')}`
        case 'progress':
          return `**${u.title}**\n${u.items.map(i => `- ${i.label}: ${i.pct}%`).join('\n')}`
        case 'timeline':
          return `**${u.title}**\n${u.items.map(i => `- ${i.when}: ${i.what}`).join('\n')}`
        case 'pie':
          return `**${u.title}**\n${u.items.map(i => `- ${i.label}: ${i.value}`).join('\n')}`
        case 'trend':
          return `**${u.title}**\n${u.items.map(i => `- ${i.label}: ${i.values.join(', ')} (${i.text})`).join('\n')}`
      }
    })
    .join('\n\n')

const drawUi = (segs: Ui[], t: T, io: Io) => {
  const { Box, Text, Button, Markdown, Input, Svg, Y } = t
  const heading = (s: string) => (s ? <Text bold {...ty(t, { size: 'heading' })}>{s}</Text> : null)
  // One hero per reply; every later title reads as a section heading, so a long answer isn't a stack of banners.
  const hero = segs.findIndex(u => u.kind === 'title')
  const section = (s: string) => (
    <Box gap={1} paddingY={Y}>
      <Text bold color={TONE.next.color}>▍</Text>
      <Text bold {...ty(t, { size: 'heading' })}>{s}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {segs.map((u, n) => {
        const id = `cardify-ui-${n}`

        switch (u.kind) {
          case 'md':
            return <Markdown text={u.text} />
          case 'section':
            return section(u.text)
          case 'title':
            return n !== hero ? section(u.text) : (
              <Box flexDirection="column" gap={Y} backgroundColor={C.hero} borderStyle="round" borderColor={C.heroLine} paddingX={2} paddingY={Y}>
                <Text bold {...ty(t, { size: 'title' })} color={C.text}>{u.text}</Text>
                {u.sub ? <Text {...ty(t, { size: 'footnote' })} color={C.heroSub}>{u.sub}</Text> : null}
              </Box>
            )
          case 'callout':
            return card(t, u.tone, u.title, [u.text ? <Text color={C.text}>{rich(t, u.text, false)}</Text> : null])
          case 'stats': {
            const w = Math.min(30, Math.max(18, ...u.items.map(i => Math.max(wide(i.label), wide(i.value) + 2, wide(i.note ?? '') + 2) + 4)))

            return (
              <Box gap={1} flexWrap="wrap">
                {u.items.map((i, k) => {
                  const up = /^(\+|up)/i.test(i.note ?? '')
                  const down = /^(-|down)/i.test(i.note ?? '')

                  return (
                    <Box key={`${id}-tile-${k}`} flexDirection="column" width={w} backgroundColor={C.panel} borderStyle="round" borderColor={C.line} paddingX={2} paddingY={Y} hover={{ borderColor: TONE.next.color }}>
                      <Text {...ty(t, { size: 'caption' })} color={C.dim}>{i.label}</Text>
                      <Text bold {...ty(t, { size: 'title' })} {...ty(t, { tabular: true })} color={C.text}>{i.value}</Text>
                      {i.note ? (
                        <Text bold {...ty(t, { size: 'footnote' })} color={up ? TONE.ok.color : down ? TONE.bad.color : C.dim}>{`${up ? '▲ ' : down ? '▼ ' : ''}${i.note}`}</Text>
                      ) : null}
                    </Box>
                  )
                })}
              </Box>
            )
          }
          case 'table':
            return grid(t, u.head, u.rows, id)
          case 'bars': {
            const data = bars(u.rows.map(r => ({ label: r.label, raw: r.raw })))

            return card(t, 'note', u.title, [
              data
                ? chart(t, data.map((d, i) => ({ label: d.label, frac: d.n / BAR, text: u.rows[i]?.text ?? d.raw })), u.title)
                : <Text color={C.text}>{u.rows.map(r => `${r.label}: ${r.text}`).join('\n')}</Text>,
            ])
          }
          case 'progress':
            return card(t, 'note', u.title, [
              chart(t, u.items.map(i => ({ label: i.label, frac: i.pct / 100, text: `${i.pct}%`, color: i.pct >= 100 ? TONE.ok.color : TONE.next.color })), u.title),
            ])
          case 'pie': {
            const total = u.items.reduce((a, i) => a + Math.max(i.value, 0), 0) || 1
            const legend = (
              <Box flexDirection="column" gap={Y} justifyContent="center">
                {u.items.map((i, k) => (
                  <Box gap={1}>
                    <Text color={hue(k)}>●</Text>
                    <Text color={C.text}>{i.label}</Text>
                    <Text bold {...ty(t, { tabular: true })} color={C.text}>{`${Math.round((Math.max(i.value, 0) / total) * 100)}%`}</Text>
                  </Box>
                ))}
              </Box>
            )

            if (!Svg) {
              return card(t, 'note', u.title, [chart(t, u.items.map(i => ({ label: i.label, frac: Math.max(i.value, 0) / total, text: `${Math.round((Math.max(i.value, 0) / total) * 100)}%` })), u.title)])
            }
            const svg = pieSvg(u.items.map(i => i.value))

            return card(t, 'note', u.title, [
              <Box gap={3} alignItems="center">
                <Svg source={svg.source} width={svg.width} height={svg.height} alt={u.items.map(i => `${i.label} ${i.value}`).join(', ')} />
                {legend}
              </Box>,
            ])
          }
          case 'trend': {
            const w = Math.max(...u.items.map(i => wide(i.label)), 4) + 2

            return card(t, 'note', u.title, u.items.map(i => {
              const first = i.values[0] ?? 0
              const last = i.values[i.values.length - 1] ?? 0
              const color = last >= first ? TONE.ok.color : TONE.bad.color
              const svg = Svg && i.values.length > 1 ? sparkSvg(i.values, color) : undefined

              return (
                <Box gap={2} alignItems="center">
                  <Box width={w}>
                    <Text color={C.text}>{i.label}</Text>
                  </Box>
                  {svg && Svg ? <Svg source={svg.source} width={svg.width} height={svg.height} alt={`${i.label}: ${i.values.join(', ')}`} /> : <Text color={color}>{sparkText(i.values)}</Text>}
                  <Text bold {...ty(t, { tabular: true })} color={color}>{`${last >= first ? '▲' : '▼'} ${i.text}`}</Text>
                </Box>
              )
            }))
          }
          case 'list':
          case 'steps':
            return card(t, 'note', u.title, [
              <Box flexDirection="column" gap={Y}>
                {u.items.map((item, i) => (
                  <Box gap={1}>
                    {u.kind === 'steps' ? (
                      <Text bold color={C.ink} backgroundColor={TONE.next.color}>{` ${i + 1} `}</Text>
                    ) : (
                      <Text bold color={TONE.next.color}>•</Text>
                    )}
                    <Text color={C.text}>{rich(t, item, true)}</Text>
                  </Box>
                ))}
              </Box>,
            ])
          case 'buttons': {
            const done = u.items.map((_, k) => io.sentOf(`${id}-${k}`)).find(Boolean)

            return (
              <Box flexDirection="column" gap={Y}>
                {heading(u.title)}
                {done ? sentNote(t, done) : (
                  <Box gap={1} flexWrap="wrap">
                    {u.items.map((i, k) => (
                      <Button
                        key={`${id}-${k}`}
                        variant={k === 0 ? 'primary' : 'secondary'}
                        label={plain(i.label)}
                        onPress={() => io.send(`${id}-${k}`, i.prompt || `Go ahead with: ${plain(i.label)}`)}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            )
          }
          case 'ask': {
            const done = io.sentOf(`${id}-ask`)

            return card(t, 'ask', `${TONE.ask.icon} ${u.question}`, [
              done
                ? sentNote(t, done)
                : Input
                  ? <Input key={`${id}-ask`} placeholder="Type your answer" submitLabel="send" onSubmit={v => v.trim() && io.send(`${id}-ask`, v.trim())} />
                  : null,
            ])
          }
          case 'badges':
            return (
              <Box gap={1} flexWrap="wrap">
                {u.items.map(i => pill(t, i.tone, `${TONE[i.tone].icon} ${i.text}`))}
              </Box>
            )
          case 'cards':
            return (
              <Box flexDirection="column" gap={Y}>
                {heading(u.title)}
                <Box gap={1} flexWrap="wrap">
                  {u.items.map((c, k) => (
                    <Box key={`${id}-card-${k}`} flexDirection="column" gap={Y} width={36} backgroundColor={C.panel} borderStyle="round" borderColor={C.line} paddingX={2} paddingY={Y} hover={{ borderColor: TONE[c.tone].color, backgroundColor: C.raised }}>
                      <Text bold {...ty(t, { size: 'heading' })} color={C.text}>{c.title}</Text>
                      {c.sub ? <Box>{pill(t, c.tone, c.sub)}</Box> : null}
                      {c.body ? <Text {...ty(t, { size: 'footnote' })} color={C.soft}>{rich(t, c.body, true)}</Text> : null}
                    </Box>
                  ))}
                </Box>
              </Box>
            )
          case 'kv': {
            const w = Math.max(...u.items.map(i => wide(i.key)), 4) + 3

            return card(t, 'note', u.title, u.items.map(i => (
              <Box>
                <Box width={w}>
                  <Text {...ty(t, { size: 'footnote' })} color={C.dim}>{i.key}</Text>
                </Box>
                <Text bold color={C.text}>{rich(t, i.value, true)}</Text>
              </Box>
            )))
          }
          case 'timeline': {
            const w = Math.max(...u.items.map(i => wide(i.when)), 4) + 3

            return card(t, 'note', u.title, u.items.map((i, k) => (
              <Box gap={1}>
                <Text color={k === u.items.length - 1 ? TONE.ok.color : TONE.next.color}>{k === u.items.length - 1 ? '◉' : '●'}</Text>
                <Box width={w}>
                  <Text bold {...ty(t, { tabular: true })} {...ty(t, { size: 'footnote' })} color={C.dim}>{i.when}</Text>
                </Box>
                <Text color={C.text}>{rich(t, i.what, true)}</Text>
              </Box>
            )))
          }
        }
      })}
    </Box>
  )
}

// A reply drawn as cards: its ui blocks if it has them, else its markdown structure; nothing if it has neither.
const view = (text: string, t: T, io: Io) => {
  const segs = parseUi(text)

  if (segs.some(u => u.kind !== 'md')) return drawUi(segs, t, io)

  const list = parse(text)

  return isStructured(list) ? draw(list, t, io) : undefined
}

const FENCE = '`'.repeat(3)
const UI_PROMPT = `Cardify is installed: the person's screen draws a fenced ${FENCE}ui block as real UI (cards, tables, charts, buttons). For an answer with structure (comparisons, records, status reports, steps, numbers, choices) put the structured part in a ${FENCE}ui block and keep explanation as normal markdown around it. Conversation, short answers and real code stay plain markdown, and code never goes inside a ui block.

Write one component per line as "name: header", then its rows as "- a | b | c". Components:
title: Heading text | optional subtitle (once, at the top)
section: A later heading
callout <ok|warn|bad|info|next>: Title | Body
stats: then rows "- Label | Value | note" (a note starting with + or - shows green or red)
table: Col | Col | Col, then one row per line
cards: Title, then rows "- Name | subtitle | short body | ok|warn|bad|info|next" (a grid of small cards, good for comparing items)
kv: Title, then rows "- Key | Value" (a fact sheet for one thing)
bars: Chart title, then rows "- Label | number | display text"
progress: Title, then rows "- Label | percent"
timeline: Title, then rows "- When | What happened"
pie: Title, then rows "- Label | number" (a donut of shares)
trend: Title, then rows "- Label | 3, 5, 4, 8 | display text" (a sparkline per row)
list: Title, or steps: Title, then rows "- item"
buttons: Title, then rows "- Label | prompt sent when pressed (optional)"
ask: A question the person answers in a text box
badges: then rows "- text | ok|warn|bad|info"

Style: start each title, card name and callout title with one fitting emoji. In cells and items, write a short status as a pill: [ok: Public], [warn: Private], [bad: Delisted]. Inline **bold**, \`code\` and links work too. Keep cells short; put long explanation in a card body or the prose. Show several items side by side with cards (not one callout each); keep callout for one warning or key note. Put dated events in a timeline, not steps. When you offer the person choices, use buttons, not a bullet list; when you need their input, use ask. Use only figures you actually know: never invent numbers.

Example:
${FENCE}ui
title: 🍎 Stock snapshot | Four companies, Nov 2026
callout warn: ⚠️ Not live data | Background only, not advice.
section: 🏢 Companies
cards: Companies
- 🍎 Apple | AAPL | Services keep growing | ok
- 🤖 OpenAI | Private | No public shares | warn
table: Company | Status | Market cap
- Apple | [ok: Public] | about $5T
buttons: Next steps
- Get live prices | Search the web for current prices
${FENCE}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cardify',
      description: 'Open the Cardify pane, or /cardify on|off to switch inline cards',
    })

    return next(e)
  })

  on('command.run', { command: 'cardify' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')

      return { text: `Cardify inline cards are ${arg}.` }
    }
    await $.ui.open({ id: PANE, title: 'Cardify' })

    return {
      text: `Cardify pane opened. Inline cards are ${(await read($, isOn)) ? 'on' : 'off'}. Use /cardify on or /cardify off.`,
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)

    if (e.surfaces.length === 0 || !(await read($, isOn))) return r

    return { sections: [...r.sections, { id: 'cardify:ui', text: UI_PROMPT, scope: 'session' }] }
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.answer) {
      await update($, latest, () => e.answer)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = await table($, e)
    const text = await read($, latest)

    return view(text, t, await ioFor($, text)) ?? <t.Text dimColor>Nothing yet. Ask Claude something.</t.Text>
  })

  // Inline: redraw replies in the transcript as cards. Off, a ui block falls back to plain markdown.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const t = await table($, e)
    const segs = parseUi(e.props.text)

    if (!(await read($, isOn))) {
      return segs.some(u => u.kind !== 'md') ? <t.Markdown text={toMarkdown(segs)} /> : next(e)
    }
    if ((e.props as { isSummary?: true }).isSummary) return next(e)

    return view(e.props.text, t, await ioFor($, e.props.text)) ?? next(e)
  })
}
