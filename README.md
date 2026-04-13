# chatgpt-export-to-supermemory

Import ChatGPT export archives into Supermemory using Bun.

## Goal

This project is for backfilling past ChatGPT conversations from an export ZIP into Supermemory.

## Planned flow

1. Open a ChatGPT export ZIP
2. Read `conversations.json`
3. Flatten each conversation thread into ordered messages
4. Remove obvious noise like empty, system, or tool-only entries
5. Split oversized threads into parts
6. Send each part to Supermemory
7. Track imported items in a local manifest to avoid duplicates

## Development

Install dependencies:

```bash
bun install
```

Run the CLI:

```bash
bun run src/cli.ts
```

Type-check:

```bash
bun run check
```

Lint:

```bash
bun run lint
```

Format:

```bash
bun run format
```

## Notes

- Runtime: Bun
- Language: TypeScript
- Initial target: deterministic import without local LLM summarization
