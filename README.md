# Cardify

Turn Claude's answers into readable cards, tables and lists in a side pane.

Cardify is a [Claude Code](https://claude.com/claude-code) plugin. After each answer it reads the markdown and draws it as colored cards:

| Markdown | Card |
|---|---|
| `# Heading` | cyan title card |
| `- list` | green list card |
| table | magenta table card |
| code fence | yellow code card |
| status words | colored badges: green (done, passed), red (failed, error), yellow (warning, pending) |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install cardify --marketplace Mahdi-Khorshidi-26/cardify
```

From a shell:

```bash
claude plugin install cardify --marketplace Mahdi-Khorshidi-26/cardify
```

## Use

Run `/cardify` to open the pane. It updates after every answer.

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
