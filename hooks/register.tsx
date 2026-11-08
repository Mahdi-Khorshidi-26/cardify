import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'

import type { Block } from '../types'

const PANE = 'cardify'
// Change the tag when Block changes: it declines what an earlier version stored.
const blocks = atom({ plugin: 'cardify', key: 'blocks' } as const, [], {
  shape: 'blocks-2',
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

const BADGES: [RegExp, string][] = [
  [/\b(done|passed?|ok|success|fixed|live|ready)\b/i, 'green'],
  [/\b(fail(ed|ing)?|error|blocked|broken)\b/i, 'red'],
  [/\b(warning|pending|todo|wip|not verified)\b/i, 'yellow'],
]
const BADGE = new RegExp(BADGES.map(([re]) => re.source).join('|'), 'gi')

// Splits a string into plain runs and status-word runs that get a color.
export const split = (s: string): { text: string; color?: string }[] => {
  const out: { text: string; color?: string }[] = []
  let at = 0

  for (const m of s.matchAll(BADGE)) {
    const color = BADGES.find(([re]) => re.test(m[0]))?.[1]
    if (m.index > at) out.push({ text: s.slice(at, m.index) })
    out.push({ text: m[0], color })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push({ text: s.slice(at) })

  return out
}

// Only redraw replies that have structure; plain prose stays as the surface draws it.
export const isStructured = (list: Block[]) => list.some(b => b.kind !== 'text')

// A section card's color and icon come from its heading. The first match wins, so "Not done yet" is a warning.
const TONES = [
  { re: /heads-up|warning|caveat|risk|not done|not yet|still open|bug|problem|issue|gap|unverified/i, color: 'yellow', icon: '▲' },
  { re: /next|todo|to do|steps?|follow/i, color: 'blue', icon: '→' },
  { re: /done|did|fixed|result|change|added|built|works|checks?|summary|what.s in/i, color: 'green', icon: '✔' },
]
export const tone = (title: string) => TONES.find(t => t.re.test(title)) ?? { color: 'gray', icon: '●' }

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

type T = Pick<ElementTable, 'Box' | 'Text'>

// Inline **bold** and `code`. Status badges only where asked: rows and cells, never prose.
const rich = ({ Text }: T, s: string, hasBadges: boolean) =>
  s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).flatMap(part => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return [<Text bold>{part.slice(2, -2)}</Text>]
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return [<Text color="#e6edf3" backgroundColor="#30363d">{` ${part.slice(1, -1)} `}</Text>]
    }
    if (!hasBadges) return [<Text>{part}</Text>]

    return split(part).map(r =>
      r.color ? (
        <Text bold color="black" backgroundColor={r.color}>{` ${r.text} `}</Text>
      ) : (
        <Text>{r.text}</Text>
      ),
    )
  })

const body = (list: Block[], t: T, rowGap: number, mark: string, color: string) => {
  const { Box, Text } = t

  return list.map(b => {
    if (b.kind === 'list') {
      return (
        <Box flexDirection="column" gap={rowGap}>
          {b.items.map((item, i) => (
            <Box gap={1}>
              <Text bold color={color}>{b.ordered ? `${i + 1}.` : mark}</Text>
              <Text>{rich(t, item, true)}</Text>
            </Box>
          ))}
        </Box>
      )
    }
    if (b.kind === 'table') {
      return (
        <Box flexDirection="column">
          <Text bold color={color}>{b.head.join('  |  ')}</Text>
          {b.rows.map(row => (
            <Text>{row.map(c => rich(t, c, true)).flatMap((c, i) => (i ? [<Text dimColor>{'  |  '}</Text>, ...c] : c))}</Text>
          ))}
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
}

// One drawing for the pane and the transcript, on any surface that has Box and Text.
const draw = (list: Block[], t: T, surface: string) => {
  const { Box, Text } = t
  const rowGap = surface === 'terminal' ? 0 : 1

  return (
    <Box flexDirection="column" gap={1}>
      {group(list).map(s => {
        if (s.title === undefined) {
          return <Box flexDirection="column" gap={1}>{body(s.body, t, rowGap, '•', 'gray')}</Box>
        }
        const { color, icon } = tone(s.title)

        return (
          <Box flexDirection="column" gap={1} borderStyle="round" borderColor={color} paddingX={1}>
            <Text bold color={color}>{`${icon} ${s.title}`}</Text>
            {body(s.body, t, rowGap, icon === '●' ? '•' : icon, color)}
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
      description: "Show Claude's latest answer as cards in a pane",
    })

    return next(e)
  })

  on('command.run', { command: 'cardify' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Cardify' })

    return { text: 'Cardify pane opened.' }
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

    return list.length === 0 ? (
      <t.Text dimColor>Nothing yet. Ask Claude something.</t.Text>
    ) : (
      draw(list, t, e.surface)
    )
  })

  // Inline: redraw structured replies in the transcript as cards.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const list = parse(e.props.text)

    return (e.props as { isSummary?: true }).isSummary || !isStructured(list)
      ? next(e)
      : draw(list, $.ui.resolve(e), e.surface)
  })
}
