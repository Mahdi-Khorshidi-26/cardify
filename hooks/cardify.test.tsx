import { expect, test } from 'claude-code/testing'

import { group, listChart, parse, split, tableChart, tone } from './register'

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

test('status words get a color and a sticker', () => {
  const runs = split('Tests passed, tip: retry, beta')

  expect(runs.filter(r => r.emoji).map(r => [r.text, r.emoji])).toEqual([
    ['passed', '✅'],
    ['tip', '💡'],
    ['beta', '🧪'],
  ])
})

test('numeric tables and "label: value" lists become bars', () => {
  const t = tableChart(['Step', 'Time'], [['a', '10s'], ['b', '20s']])

  expect(t?.title).toBe('Time')
  expect(t?.data.map(d => d.bar.replace(/░/g, '').length)).toEqual([8, 16])
  expect(tableChart(['A', 'B'], [['x', 'yes'], ['y', 'no']])).toBeUndefined()

  expect(listChart(['CPU: 75%', 'Memory: 25%'])?.map(d => d.bar.replace(/░/g, '').length)).toEqual([12, 4])
  expect(listChart(['one', 'two'])).toBeUndefined()
})

test('next steps are buttons and questions are inputs', () => {
  expect(tone('Next steps').act).toBe('button')
  expect(tone('Questions for you').act).toBe('input')
  expect(tone('Done').act).toBeUndefined()
})

test('a button sends its step as a prompt and an input sends its text', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return {} as never
  })

  const steps = await $.ui.mount({ ...reply('**Next steps**\n- Push the fix'), surface: 'desktop' })
  await steps.press({ key: 'cardify-0-0-0' })
  await steps.unmount()

  const ask = await $.ui.mount({ ...reply('**Questions**\n- Which one?'), surface: 'desktop' })
  await ask.input({ plugin: 'cardify', key: 'cardify-0-ask', text: 'the first' })
  await ask.unmount()

  expect(sent).toEqual(['Go ahead with: Push the fix', 'the first'])
})

test('/cardify off hands replies back to the engine', async ($, on) => {
  on('command.register', () => ({ value: { command: 'cardify' } }))
  on('prompt.submit', () => ({}) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  await $.command.run({ command: 'cardify', args: 'off', origin: { kind: 'composer' }, presentation: {} } as never)
  const off = await $.ui.mount({ ...reply('**Done**\n- x'), surface: 'desktop' })
  expect((await off.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await off.unmount()

  await $.command.run({ command: 'cardify', args: 'on', origin: { kind: 'composer' }, presentation: {} } as never)
  const on2 = await $.ui.mount({ ...reply('**Done**\n- x'), surface: 'desktop' })
  expect((await on2.find({ type: 'Text', text: /Done/ }))?.text).toContain('Done')
  await on2.unmount()
})
