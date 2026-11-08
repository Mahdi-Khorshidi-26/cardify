import { atom, read, update } from 'claude-code'
import type { ElementTable, Register } from 'claude-code'

import type { Block } from '../types'

const PANE = 'cardify'
// Change the tag when Block changes: it declines what an earlier version stored.
const blocks = atom({ plugin: 'cardify', key: 'blocks' } as const, [], {
  shape: 'blocks-1',
})

const cells = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())

// ponytail: line-based markdown subset (headings, lists, tables, code). Swap for a real parser if it falls short.
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
    } else if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(next)) {
      const rows: string[][] = []
      for (i += 2; i < lines.length && at(i).includes('|'); i++) rows.push(cells(at(i)))
      i--
      out.push({ kind: 'table', head: cells(line), rows })
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const items: string[] = []
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(at(i)); i++) {
        items.push(at(i).replace(/^\s*([-*]|\d+\.)\s+/, ''))
      }
      i--
      out.push({ kind: 'list', items })
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

// One drawing for the pane and the transcript, on any surface that has Box and Text.
const draw = (list: Block[], { Box, Text }: Pick<ElementTable, 'Box' | 'Text'>) => {
  const rich = (s: string) =>
    split(s).map(r =>
      r.color ? (
        <Text bold color="black" backgroundColor={r.color}>{` ${r.text} `}</Text>
      ) : (
        <Text>{r.text}</Text>
      ),
    )

  return (
    <Box flexDirection="column" gap={1}>
      {list.map(b => {
        if (b.kind === 'title') {
          return (
            <Box borderStyle="round" borderColor="cyan" paddingX={1}>
              <Text bold color="cyan">{b.text}</Text>
            </Box>
          )
        }
        if (b.kind === 'list') {
          return (
            <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
              {b.items.map(item => (
                <Text><Text color="green">● </Text>{rich(item)}</Text>
              ))}
            </Box>
          )
        }
        if (b.kind === 'table') {
          return (
            <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
              <Text bold color="magenta">{b.head.join('  |  ')}</Text>
              {b.rows.map(row => (
                <Text>{row.map(c => rich(c)).flatMap((c, i) => (i ? [<Text dimColor>{'  |  '}</Text>, ...c] : c))}</Text>
              ))}
            </Box>
          )
        }
        if (b.kind === 'code') {
          return (
            <Box borderStyle="round" borderColor="yellow" paddingX={1}>
              <Text color="yellow">{b.text}</Text>
            </Box>
          )
        }
        return <Text>{rich(b.text)}</Text>
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
      draw(list, t)
    )
  })

  // Inline: redraw structured replies in the transcript as cards.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const list = parse(e.props.text)

    return (e.props as { isSummary?: true }).isSummary || !isStructured(list) ? next(e) : draw(list, $.ui.resolve(e))
  })
}
