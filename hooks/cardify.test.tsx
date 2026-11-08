import { expect, test } from 'claude-code/testing'

import { group, parse, split, tone } from './register'

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

test('a bold-only line is a heading and a numbered list is ordered', () => {
  const blocks = parse('**Next steps**\n\n1. one\n2. two\n')

  expect(blocks).toEqual([
    { kind: 'title', text: 'Next steps' },
    { kind: 'list', items: ['one', 'two'], ordered: true },
  ])
})

test('headings pick a tone and start a section', () => {
  expect(tone('What I did').color).toBe('green')
  expect(tone('Not done yet').color).toBe('yellow')
  expect(tone('Next steps').color).toBe('blue')
  expect(tone('Misc').color).toBe('gray')

  const sections = group(parse('intro\n\n**Done**\n- a\n\n**Heads-up**\nb'))

  expect(sections.map(s => s.title)).toEqual([undefined, 'Done', 'Heads-up'])
})

const reply = (text: string) =>
  ({ plugin: 'cardify', component: 'AssistantMessage', props: { text, isFirstOfReply: true } }) as const

test('a structured reply is redrawn as cards, on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...reply('**Done**\n- tests passed\n- `ok` now'), surface })

    expect((await ui.find({ type: 'Text', text: /Done/ }))?.text).toContain('Done')
    await ui.unmount()
  }
})

test('plain prose is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...reply('Just a sentence.'), surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
