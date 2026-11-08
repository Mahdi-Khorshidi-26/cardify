# Cardify

Turn Claude's answers into readable cards, tables and lists in a side pane.

Cardify is a [Claude Code](https://claude.com/claude-code) plugin. After each answer it reads the markdown and draws it as colored cards:

![Cardify preview](docs/preview.svg)

*Illustrative mockup of the card styles.*

| Markdown | Card |
|---|---|
| `# Heading` or a bold-only line | a section card, colored and stickered by its title |
| list | rows with a marker, numbered when ordered |
| list of `Label: 72%` | a bar chart |
| table | aligned columns, plus a bar chart when a column is numeric |
| code fence | bordered code box |
| `**bold**`, `` `code` ``, URLs | real bold, code chips, clickable links |
| status words in rows and cells | sticker badges: ✅ done, ❌ failed, ⚠️ pending, 💡 note, 🧪 beta |
| list under "Next steps", "Options" | buttons that send the item back to Claude |
| section titled "Questions" | an input box that sends your answer back to Claude |

Section colors follow the heading: green for done, yellow for heads-up or not done, blue for next steps, magenta for questions, cyan for tips, gray for anything else.

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

Switch inline cards with `/cardify off` and `/cardify on`. The switch lasts for the session.

## Develop

```bash
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

## Roadmap

- Real markdown parser
- Themes

## License

MIT
