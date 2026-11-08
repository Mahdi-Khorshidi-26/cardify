import { expect, test } from 'claude-code/testing'

import { barSvg, group, isFancyVersion, listChart, parse, parseUi, pieSvg, sparkText, split, tableChart, toMarkdown, tone, wide } from './register'

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
  expect(tone('What I did').tone).toBe('ok')
  expect(tone('Not done yet').tone).toBe('warn')
  expect(tone('Next steps').tone).toBe('next')
  expect(tone('Misc').tone).toBe('note')

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
  expect(t?.data.map(d => d.bar.replace(/░/g, '').length)).toEqual([10, 20])
  expect(tableChart(['A', 'B'], [['x', 'yes'], ['y', 'no']])).toBeUndefined()

  expect(listChart(['CPU: 75%', 'Memory: 25%'])?.map(d => d.bar.replace(/░/g, '').length)).toEqual([15, 5])
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

const F = '`'.repeat(3)
const SAMPLE = `Intro text.\n${F}ui\ntitle: 🍎 Stocks\ncallout warn: ⚠️ Not live | Background only.\ntable: Ticker | Company\n- AAPL | Apple\n- MSFT | Microsoft\nbars: Growth\n- Apple | 8 | 8%\n- Microsoft | 16 | 16%\nbuttons: Next steps\n- Live prices | Search the web for prices\nask: Which one?\nnonsense line\n${F}\nOutro.`

test('parseUi splits prose from ui blocks and skips unknown lines', () => {
  const segs = parseUi(SAMPLE)

  expect(segs.map(u => u.kind)).toEqual(['md', 'title', 'callout', 'table', 'bars', 'buttons', 'ask', 'md'])
  expect(segs.find(u => u.kind === 'table')).toEqual({
    kind: 'table',
    head: ['Ticker', 'Company'],
    rows: [['AAPL', 'Apple'], ['MSFT', 'Microsoft']],
  })
})

test('an unclosed ui block still draws what streamed so far', () => {
  const segs = parseUi(`${F}ui\ntitle: Hi\ntable: A | B\n- 1 | 2`)

  expect(segs.map(u => u.kind)).toEqual(['title', 'table'])
})

test('toMarkdown says a ui block in plain markdown', () => {
  const md = toMarkdown(parseUi(`${F}ui\ntable: A | B\n- 1 | 2\n${F}`))

  expect(md).toContain('| A | B |')
  expect(md).toContain('| 1 | 2 |')
})

test('a ui block is drawn as real components, on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...reply(SAMPLE), surface })

    expect((await ui.find({ type: 'Text', text: /Not live/ }))?.text).toContain('Not live')
    expect((await ui.find({ type: 'Text', text: /Microsoft/ }))?.text).toContain('Microsoft')
    expect(await ui.find({ type: 'Button' })).toBeDefined()
    await ui.unmount()
  }
})

test('a ui button sends its own prompt and an ask sends the answer', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return {} as never
  })

  const ui = await $.ui.mount({ ...reply(SAMPLE), surface: 'desktop' })
  await ui.press({ key: 'cardify-ui-5-0' })
  await ui.input({ plugin: 'cardify', key: 'cardify-ui-6-ask', text: 'Apple' })
  await ui.unmount()

  expect(sent).toEqual(['Search the web for prices', 'Apple'])
})

test('the system prompt gains the ui language, only where something draws', async ($, on) => {
  on('prompt.compose', () => ({ sections: [] }))
  const input = { model: 'm', promptModel: 'm', outputStyle: null, traits: [], tools: [] }

  const drawn = await $.prompt.compose({ ...input, surfaces: ['desktop'] } as never)
  const headless = await $.prompt.compose({ ...input, surfaces: [] } as never)

  expect(drawn.sections.map(s => s.id)).toEqual(['cardify:ui'])
  expect(headless.sections).toEqual([])
})

test('cards, kv, progress and timeline parse, and [tone: text] cells are pills', () => {
  const segs = parseUi(
    `${F}ui\ncards: Companies\n- 🍎 Apple | AAPL | Services | ok\nkv: Apple\n- Ticker | AAPL\nprogress: Rollout\n- EU | 140\ntimeline: History\n- 1976 | Founded\n${F}`,
  )

  expect(segs).toEqual([
    { kind: 'cards', title: 'Companies', items: [{ title: '🍎 Apple', sub: 'AAPL', body: 'Services', tone: 'ok' }] },
    { kind: 'kv', title: 'Apple', items: [{ key: 'Ticker', value: 'AAPL' }] },
    { kind: 'progress', title: 'Rollout', items: [{ label: 'EU', pct: 100 }] },
    { kind: 'timeline', title: 'History', items: [{ when: '1976', what: 'Founded' }] },
  ])
})

const RICH = `${F}ui\ncards: Companies\n- 🍎 Apple | AAPL | Services | ok\nkv: Apple\n- Ticker | AAPL\nprogress: Rollout\n- EU | 40\ntimeline: History\n- 1976 | Founded\ntable: Co | Status\n- Apple | [ok: Public]\n${F}`

test('the new components draw on every surface', async $ => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...reply(RICH), surface })

    expect((await ui.find({ type: 'Text', text: /Founded/ }))?.text).toContain('Founded')
    expect((await ui.find({ type: 'Text', text: /Public/ }))?.text).toContain('Public')
    // Charts are SVG where the surface draws vectors, colored cells on the terminal.
    expect(await ui.find(surface === 'terminal' ? { type: 'Text', text: /40%/ } : { type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
})

test('an ask sends once, then says what it sent', async ($, on) => {
  const sent: string[] = []
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return {} as never
  })

  const text = `${F}ui\nask: Which stocks?\n${F}`
  const ui = await $.ui.mount({ ...reply(text), surface: 'desktop' })
  await ui.input({ plugin: 'cardify', key: 'cardify-ui-0-ask', text: 'Apple' })
  await ui.unmount()

  const again = await $.ui.mount({ ...reply(text), surface: 'desktop' })
  expect((await again.find({ type: 'Text', text: /Sent/ }))?.text).toBe('✓ Sent: Apple')
  await again.unmount()

  expect(sent).toEqual(['Apple'])
})

test('wide counts emoji as two cells', () => {
  expect(wide('Apple')).toBe(5)
  expect(wide('🛰️ Starlink')).toBe(11)
  expect(wide('⚠️')).toBe(2)
})

test('a later title and a section draw as headings, not banners', async $ => {
  const segs = parseUi(`${F}ui\ntitle: Top\nsection: Part one\ntitle: Part two\n${F}`)
  expect(segs.map(u => u.kind)).toEqual(['title', 'section', 'title'])

  const ui = await $.ui.mount({ ...reply(`${F}ui\ntitle: Top\nsection: Part one\ntitle: Part two\n${F}`), surface: 'desktop' })
  expect(await ui.findAll({ type: 'Text', text: /▍/ })).toHaveLength(2)
  await ui.unmount()
})

test('typography props only on engines that take them', () => {
  expect(isFancyVersion('2.1.287')).toBe(false)
  expect(isFancyVersion('2.1.317')).toBe(true)
  expect(isFancyVersion('2.2.0')).toBe(true)
  expect(isFancyVersion('2.1.320-dev.20261101.t1.sha1')).toBe(true)
})

test('pie, trend and a title subtitle parse', () => {
  const segs = parseUi(`${F}ui\ntitle: Top | Subtitle here\npie: Share\n- iOS | 60\n- Android | 40\ntrend: Price\n- AAPL | 1, 3, 2, 5 | $5\n${F}`)

  expect(segs).toEqual([
    { kind: 'title', text: 'Top', sub: 'Subtitle here' },
    { kind: 'pie', title: 'Share', items: [{ label: 'iOS', value: 60 }, { label: 'Android', value: 40 }] },
    { kind: 'trend', title: 'Price', items: [{ label: 'AAPL', values: [1, 3, 2, 5], text: '$5' }] },
  ])
})

test('charts render as SVG strings and terminal sparklines', () => {
  const bar = barSvg([{ label: 'A <b>', frac: 0.5, text: '50%' }])
  expect(bar.source.startsWith('<svg')).toBe(true)
  expect(bar.source).toContain('A &lt;b&gt;')
  expect(pieSvg([1, 1]).source.match(/stroke-dasharray/g)).toHaveLength(2)
  expect(sparkText([1, 2, 3, 8])).toBe('▁▂▃█')
})

test('charts and the hero draw on every surface', async $ => {
  const text = `${F}ui\ntitle: Top | Sub\npie: Share\n- iOS | 60\n- Android | 40\ntrend: Price\n- AAPL | 1, 3, 2, 5 | $5\nbars: Growth\n- A | 10 | 10%\n- B | 20 | 20%\nprogress: Rollout\n- EU | 40\n${F}`

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...reply(text), surface })

    expect((await ui.find({ type: 'Text', text: /Sub/ }))?.text).toBe('Sub')
    expect((await ui.find({ type: 'Text', text: /Share/ }))?.text).toContain('Share')
    await ui.unmount()
  }
})
