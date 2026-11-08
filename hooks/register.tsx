import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1] ?? ''

    if (line.startsWith('```')) {
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i])
      out.push({ kind: 'code', text: code.join('\n') })
    } else if (/^#{1,6}\s/.test(line)) {
      out.push({ kind: 'title', text: line.replace(/^#+\s*/, '') })
    } else if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(next)) {
      const rows: string[][] = []
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]))
      i--
      out.push({ kind: 'table', head: cells(line), rows })
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const items: string[] = []
      for (; i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i]); i++) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
      }
      i--
      out.push({ kind: 'list', items })
    } else if (line.trim()) {
      out.push({ kind: 'text', text: line.trim() })
    }
  }

  return out
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
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, blocks)

    if (list.length === 0) {
      return <Text dimColor>Nothing yet. Ask Claude something.</Text>
    }

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
                  <Text><Text color="green">● </Text>{item}</Text>
                ))}
              </Box>
            )
          }
          if (b.kind === 'table') {
            return (
              <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
                <Text bold color="magenta">{b.head.join('  |  ')}</Text>
                {b.rows.map(row => (
                  <Text>{row.join('  |  ')}</Text>
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
          return <Text>{b.text}</Text>
        })}
      </Box>
    )
  })
}
