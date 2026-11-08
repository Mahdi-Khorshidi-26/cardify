export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; text: string }

declare module 'claude-code' {
  interface PluginState {
    cardify: { blocks: Shaped<Block[]> }
  }
}
