import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'

import type { Block } from '../types'

const PANE = 'cardify'
// Change a tag when its value's shape changes: it declines what an earlier version stored.
const latest = atom({ plugin: 'cardify', key: 'latest' } as const, '', {
  shape: 'latest-1',
})
// ponytail: session-only switch. Move it to $.store if it should survive a restart.
const isOn = atom({ plugin: 'cardify', key: 'isOn' } as const, true, {
  shape: 'on-1',
})

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

// A section card's color, sticker and behavior come from its heading. The first match wins, so "Not done yet" is a warning.
const TONES: { re: RegExp; color: string; icon: string; act?: Act }[] = [
  { re: /heads-up|warning|caveat|risk|not done|not yet|still open|bug|problem|issue|gap|unverified/i, color: 'yellow', icon: '⚠️' },
  { re: /question|your answer|reply|tell me|input/i, color: 'magenta', icon: '❓', act: 'input' },
  { re: /option|choose|pick|which|next|todo|to do|steps?|follow/i, color: 'blue', icon: '👉', act: 'button' },
  { re: /done|did|fixed|result|change|added|built|works|checks?|summary|what.s in/i, color: 'green', icon: '✅' },
  { re: /tip|note|info|why|idea|background|context/i, color: 'cyan', icon: '💡' },
]
export const tone = (title: string) => TONES.find(t => t.re.test(title)) ?? { color: 'gray', icon: '📌', act: undefined }

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

type Bar = { label: string; raw: string; bar: string }

const NUM = /^~?[$€£]?-?\d[\d,]*(\.\d+)?\s*(%|k|m|ms|s|x|[a-z]{1,2})?$/i
const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''))

// Scales values to a bar of 16 cells; percentages scale to 100.
const bars = (rows: { label: string; raw: string }[]): Bar[] | undefined => {
  const vals = rows.map(r => num(r.raw))
  if (rows.length < 2 || vals.some(Number.isNaN)) return undefined

  const top = Math.max(...vals.map(Math.abs), rows.every(r => r.raw.includes('%')) ? 100 : 1)

  return rows.map((r, i) => {
    const n = Math.round((Math.max(vals[i] ?? 0, 0) / top) * 16)

    return { ...r, bar: '█'.repeat(n) + '░'.repeat(16 - n) }
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

type T = Pick<ElementTable, 'Box' | 'Text' | 'Button' | 'Link' | 'Markdown'> & { Input?: ElementTable<'desktop'>['Input'] }
type Send = (text: string) => void

// A press or Enter submits as the person; a refused submit (busy session) must not throw inside a handler.
const sender = ($: { prompt: { submit: (a: { text: string; asUser: true }) => Promise<unknown> } }): Send => text => {
  $.prompt.submit({ text, asUser: true }).catch(() => {})
}

// Inline **bold**, `code` and links. Status badges only where asked: rows and cells, never prose.
const rich = ({ Text, Link }: T, s: string, hasBadges: boolean) =>
  s.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/).filter(Boolean).flatMap(part => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return [<Text bold>{part.slice(2, -2)}</Text>]
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return [<Text color="#e6edf3" backgroundColor="#30363d">{` ${part.slice(1, -1)} `}</Text>]
    }
    if (/^https?:\/\//.test(part)) return [<Link href={part} />]
    if (!hasBadges) return [<Text>{part}</Text>]

    return split(part).map(r =>
      r.color ? (
        <Text bold color="black" backgroundColor={r.color}>{` ${r.emoji} ${r.text} `}</Text>
      ) : (
        <Text>{r.text}</Text>
      ),
    )
  })

const chartRows = ({ Box, Text }: T, data: Bar[], color: string) => (
  <Box flexDirection="column">
    {data.map(d => (
      <Text>
        <Text>{d.label.padEnd(Math.max(...data.map(x => x.label.length)))}</Text>
        <Text color={color}>{`  ${d.bar}  `}</Text>
        <Text bold>{d.raw}</Text>
      </Text>
    ))}
  </Box>
)

const plain = (s: string) => s.replace(/\*\*|`/g, '')

// A real table: fixed-width cells (in character cells, same on every surface), a header row and striped rows.
const grid = (t: T, head: string[], rows: string[][], color: string) => {
  const { Box, Text } = t
  const widths = head.map((label, c) => Math.min(30, Math.max(label.length, ...rows.map(r => plain(r[c] ?? '').length))) + 2)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color}>
      <Box backgroundColor="#30363d">
        {head.map((label, c) => (
          <Box width={widths[c] ?? 12} paddingX={1}>
            <Text bold color="#e6edf3">{label}</Text>
          </Box>
        ))}
      </Box>
      {rows.map((row, i) => (
        <Box backgroundColor={i % 2 ? '#161b22' : undefined}>
          {head.map((_, c) => (
            <Box width={widths[c] ?? 12} paddingX={1}>
              <Text>{rich(t, row[c] ?? '', true)}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

type Ctx = { t: T; gap: number; color: string; act?: Act; send: Send; id: string }

const body = (list: Block[], { t, gap, color, act, send, id }: Ctx) => {
  const { Box, Text, Button, Input } = t

  const out = list.map((b, n) => {
    if (b.kind === 'list') {
      const data = listChart(b.items)

      if (data) return chartRows(t, data, color)
      if (act === 'button') {
        return (
          <Box flexDirection="column" gap={gap}>
            {b.items.map((item, i) => (
              <Button key={`${id}-${n}-${i}`} label={plain(item)} onPress={() => send(`Go ahead with: ${plain(item)}`)} />
            ))}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" gap={gap}>
          {b.items.map((item, i) => (
            <Box gap={1}>
              <Text bold color={color}>{b.ordered ? `${i + 1}.` : '•'}</Text>
              <Text>{rich(t, item, true)}</Text>
            </Box>
          ))}
        </Box>
      )
    }
    if (b.kind === 'table') {
      const chart = tableChart(b.head, b.rows)

      return (
        <Box flexDirection="column" gap={1}>
          {grid(t, b.head, b.rows, color)}
          {chart && (
            <Box flexDirection="column">
              <Text dimColor>{chart.title}</Text>
              {chartRows(t, chart.data, color)}
            </Box>
          )}
        </Box>
      )
    }
    if (b.kind === 'code') {
      return (
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Text>{b.text}</Text>
        </Box>
      )
    }

    return <Text>{rich(t, b.text, false)}</Text>
  })

  if (act === 'input' && Input) {
    out.push(
      <Input
        key={`${id}-ask`}
        placeholder="Type your answer"
        submitLabel="send"
        onSubmit={v => v.trim() && send(v.trim())}
      />,
    )
  }

  return out
}

// One drawing for the pane and the transcript, on any surface that has Box and Text.
const draw = (list: Block[], t: T, surface: string, send: Send) => {
  const { Box, Text } = t
  const gap = surface === 'terminal' ? 0 : 1

  return (
    <Box flexDirection="column" gap={1}>
      {group(list).map((s, i) => {
        const id = `cardify-${i}`

        if (s.title === undefined) {
          return <Box flexDirection="column" gap={1}>{body(s.body, { t, gap, color: 'gray', send, id })}</Box>
        }
        const { color, icon, act } = tone(s.title)

        return (
          <Box flexDirection="column" gap={1} borderStyle="round" borderColor={color} paddingX={1}>
            <Text bold color={color}>{`${icon} ${s.title}`}</Text>
            {body(s.body, { t, gap, color, act, send, id })}
          </Box>
        )
      })}
    </Box>
  )
}


// ---- The ui block language: Claude writes it, Cardify draws it. Like OpenUI, but a few lines per component.

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'next'
const TONE: Record<Tone, { color: string; icon: string }> = {
  ok: { color: 'green', icon: '✅' },
  warn: { color: 'yellow', icon: '⚠️' },
  bad: { color: 'red', icon: '❌' },
  info: { color: 'cyan', icon: '💡' },
  next: { color: 'blue', icon: '👉' },
}
const asTone = (s?: string): Tone => (s && s in TONE ? s : 'info') as Tone

export type Ui =
  | { kind: 'md'; text: string }
  | { kind: 'title'; text: string }
  | { kind: 'callout'; tone: Tone; title: string; text: string }
  | { kind: 'stats'; items: { label: string; value: string; note?: string }[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'bars'; title: string; rows: { label: string; raw: string; text: string }[] }
  | { kind: 'list' | 'steps'; title: string; items: string[] }
  | { kind: 'buttons'; title: string; items: { label: string; prompt?: string }[] }
  | { kind: 'ask'; question: string }
  | { kind: 'badges'; items: { text: string; tone: Tone }[] }

const NAME = /^(title|callout|stats|table|bars|list|steps|buttons|ask|badges)(?:\s+(\w+))?\s*:\s*(.*)$/i
const parts = (s: string) => s.split('|').map(p => p.trim())

const component = (name: string, tag: string | undefined, head: string, rows: string[][]): Ui | undefined => {
  switch (name) {
    case 'title':
      return { kind: 'title', text: head }
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
      return { kind: 'badges', items: rows.map(([text = '', tone]) => ({ text, tone: asTone(tone) })) }
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
          return `## ${u.text}`
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
      }
    })
    .join('\n\n')

const drawUi = (segs: Ui[], t: T, gap: number, send: Send) => {
  const { Box, Text, Button, Markdown, Input } = t

  return (
    <Box flexDirection="column" gap={1}>
      {segs.map((u, n) => {
        const id = `cardify-ui-${n}`

        switch (u.kind) {
          case 'md':
            return <Markdown text={u.text} />
          case 'title':
            return <Text bold>{u.text}</Text>
          case 'callout': {
            const { color, icon } = TONE[u.tone]

            return (
              <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
                <Text bold color={color}>{`${icon} ${u.title}`}</Text>
                {u.text ? <Text>{rich(t, u.text, false)}</Text> : null}
              </Box>
            )
          }
          case 'stats':
            return (
              <Box gap={1} flexWrap="wrap">
                {u.items.map(i => (
                  <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} minWidth={14}>
                    <Text dimColor>{i.label}</Text>
                    <Text bold>{i.value}</Text>
                    {i.note ? <Text color={/^(\+|up)/i.test(i.note) ? 'green' : /^(-|down)/i.test(i.note) ? 'red' : 'gray'}>{i.note}</Text> : null}
                  </Box>
                ))}
              </Box>
            )
          case 'table':
            return grid(t, u.head, u.rows, 'gray')
          case 'bars': {
            const data = bars(u.rows.map(r => ({ label: r.label, raw: r.raw })))

            return (
              <Box flexDirection="column">
                <Text bold>{u.title}</Text>
                {data ? (
                  chartRows(t, data.map((d, i) => ({ ...d, raw: u.rows[i]?.text ?? d.raw })), 'cyan')
                ) : (
                  u.rows.map(r => <Text>{`${r.label}: ${r.text}`}</Text>)
                )}
              </Box>
            )
          }
          case 'list':
          case 'steps':
            return (
              <Box flexDirection="column" gap={gap}>
                <Text bold>{u.title}</Text>
                {u.items.map((item, i) => (
                  <Box gap={1}>
                    <Text bold color="blue">{u.kind === 'steps' ? `${i + 1}.` : '•'}</Text>
                    <Text>{rich(t, item, true)}</Text>
                  </Box>
                ))}
              </Box>
            )
          case 'buttons':
            return (
              <Box flexDirection="column" gap={gap}>
                <Text bold>{u.title}</Text>
                <Box gap={1} flexWrap="wrap">
                  {u.items.map((i, k) => (
                    <Button key={`${id}-${k}`} label={plain(i.label)} onPress={() => send(i.prompt || `Go ahead with: ${plain(i.label)}`)} />
                  ))}
                </Box>
              </Box>
            )
          case 'ask':
            return (
              <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
                <Text bold color="magenta">{`❓ ${u.question}`}</Text>
                {Input ? <Input key={`${id}-ask`} placeholder="Type your answer" submitLabel="send" onSubmit={v => v.trim() && send(v.trim())} /> : null}
              </Box>
            )
          case 'badges':
            return (
              <Box gap={1} flexWrap="wrap">
                {u.items.map(i => (
                  <Text bold color="black" backgroundColor={TONE[i.tone].color}>{` ${TONE[i.tone].icon} ${i.text} `}</Text>
                ))}
              </Box>
            )
        }
      })}
    </Box>
  )
}

// A reply drawn as cards: its ui blocks if it has them, else its markdown structure; nothing if it has neither.
const view = (text: string, t: T, surface: string, send: Send) => {
  const segs = parseUi(text)

  if (segs.some(u => u.kind !== 'md')) return drawUi(segs, t, surface === 'terminal' ? 0 : 1, send)

  const list = parse(text)

  return isStructured(list) ? draw(list, t, surface, send) : undefined
}

const FENCE = '`'.repeat(3)
const UI_PROMPT = `Cardify is installed: the person's screen draws a fenced ${FENCE}ui block as real UI (cards, tables, charts, buttons). For an answer with structure (comparisons, records, status reports, steps, numbers, choices) put the structured part in a ${FENCE}ui block and keep explanation as normal markdown around it. Conversation, short answers and real code stay plain markdown, and code never goes inside a ui block.

Write one component per line as "name: header", then its rows as "- a | b | c". Components:
title: Heading text
callout <ok|warn|bad|info|next>: Title | Body
stats: then rows "- Label | Value | note" (a note starting with + or - shows green or red)
table: Col | Col | Col, then one row per line
bars: Chart title, then rows "- Label | number | display text"
list: Title, or steps: Title, then rows "- item"
buttons: Title, then rows "- Label | prompt sent when pressed (optional)"
ask: A question the person answers in a text box
badges: then rows "- text | ok|warn|bad|info"
Start each title and callout title with one fitting emoji. Inline **bold**, \`code\` and links work in cells and items. Use only figures you actually know: never invent numbers for stats, bars or tables.

Example:
${FENCE}ui
title: 🍎 Stock snapshot
callout warn: ⚠️ Not live data | Background only, not advice.
table: Ticker | Company | Note
- AAPL | Apple | Services keep growing
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
    const t = $.ui.resolve(e)

    return view(await read($, latest), t, e.surface, sender($)) ?? <t.Text dimColor>Nothing yet. Ask Claude something.</t.Text>
  })

  // Inline: redraw replies in the transcript as cards. Off, a ui block falls back to plain markdown.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const t = $.ui.resolve(e)
    const segs = parseUi(e.props.text)

    if (!(await read($, isOn))) {
      return segs.some(u => u.kind !== 'md') ? <t.Markdown text={toMarkdown(segs)} /> : next(e)
    }
    if ((e.props as { isSummary?: true }).isSummary) return next(e)

    return view(e.props.text, t, e.surface, sender($)) ?? next(e)
  })
}
