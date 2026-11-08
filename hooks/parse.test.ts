import { expect, test } from 'claude-code/testing'

import { parse, split } from './register'

test('split colors status words', () => {
  const runs = split('Build passed, deploy FAILED')

  expect(runs.filter(r => r.color).map(r => [r.text, r.color])).toEqual([
    ['passed', 'green'],
    ['FAILED', 'red'],
  ])
})

test('parse turns markdown into blocks', () => {
  const blocks = parse('# Hi\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- x\n- y\n')

  expect(blocks.map(b => b.kind)).toEqual(['title', 'table', 'list'])
})
