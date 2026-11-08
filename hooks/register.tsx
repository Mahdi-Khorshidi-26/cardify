import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'

import type { Block } from '../types'

const PANE = 'cardify'
// Change a tag when its value's shape changes: it declines what an earlier version stored.
const blocks = atom({ plugin: 'cardify', key: 'blocks' } as const, [], {
  shape: 'blocks-2',
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

type T = Pick<ElementTable, 'Box' | 'Text' | 'Button' | 'Link'> & { Input?: ElementTable<'desktop'>['Input'] }
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
          <Box flexDirection="column">
            <Text bold color={color}>{b.head.join('  |  ')}</Text>
            {b.rows.map(row => (
              <Text>{row.map(c => rich(t, c, true)).flatMap((c, i) => (i ? [<Text dimColor>{'  |  '}</Text>, ...c] : c))}</Text>
            ))}
          </Box>
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

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.answer) {
      await update($, blocks, () => parse(e.answer))
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, blocks)
    const t = $.ui.resolve(e)
    const send = sender($)

    return list.length === 0 ? (
      <t.Text dimColor>Nothing yet. Ask Claude something.</t.Text>
    ) : (
      draw(list, t, e.surface, send)
    )
  })

  // Inline: redraw structured replies in the transcript as cards, unless switched off.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const list = parse(e.props.text)
    const isSkipped =
      !(await read($, isOn)) || (e.props as { isSummary?: true }).isSummary || !isStructured(list)
    const send = sender($)

    return isSkipped ? next(e) : draw(list, $.ui.resolve(e), e.surface, send)
  })
}
