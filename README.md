# Cardify

Turn Claude's answers into readable cards, tables and lists in a side pane.

Cardify is a [Claude Code](https://claude.com/claude-code) plugin. After each answer it reads the markdown and draws it as colored cards:

![Cardify preview](docs/preview.svg)

*Illustrative mockup of the card styles.*

| Markdown | Card |
|---|---|
| `# Heading` or a bold-only line | a section card, colored by its title |
| list | rows with a marker, numbered when ordered |
| table | aligned columns inside the section |
| code fence | bordered code box |
| `**bold**` and `` `code` `` | real bold and code chips |
| status words in rows and cells | colored badges: green (done, passed), red (failed, error), yellow (warning, pending) |

Section colors follow the heading: green for done, yellow for heads-up or not done, blue for next steps, gray for anything else.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cardify --marketplace Mahdi-Khorshidi-26/cardify
```

From a shell:

```bash
claude plugin marketplace add Mahdi-Khorshidi-26/cardify
claude plugin install cardify@cardify
```

## Use

Replies with headings, lists, tables or code fences are redrawn as cards right in the chat. Plain prose is left alone. The stored message is untouched, so `ctrl+o` still shows the original.

Run `/cardify` to open a side pane that keeps the latest answer as cards.

## Develop

```bash
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

## Roadmap

- More badge words and emoji stickers
- Real markdown parser
- Themes

## License

MIT
