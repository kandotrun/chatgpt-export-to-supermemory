# chatgpt-export-to-supermemory

Import ChatGPT export archives into Supermemory using Bun.

## What this does

This project backfills past ChatGPT conversations from an export ZIP, an extracted export directory, or a raw `conversations.json` file into Supermemory.

It intentionally uses a deterministic pipeline first:

1. load ChatGPT export data
2. flatten the active conversation thread from `mapping` + `current_node`
3. discard obvious noise like empty or hidden tool messages
4. split oversized threads into safe parts
5. send each part to Supermemory through `mcporter`
6. record imported hashes in a local manifest to avoid duplicate reimports

## Why this exists

OpenAI's export flow is official, but the detailed `conversations.json` schema is not published as a stable public contract. That means the importer can be built against the de facto export structure now, and then hardened further with real sample exports.

So, a sample ZIP is **helpful for validation**, but **not required** to build v1.

## Requirements

- Bun
- `mcporter` configured with access to the `supermemory` MCP server
- a valid Supermemory container tag, or let it default to `sm_project_default`

## Install

```bash
bun install
```

## CLI

```bash
bun run src/cli.ts --input /path/to/export.zip
```

You can also pass:

- an extracted export directory containing `conversations.json`
- `conversations.json` directly

### Options

```bash
--container <tag>      Supermemory container tag
--manifest <path>      Local manifest path for dedupe tracking
--max-chars <n>        Max chars per saved memory item, default 120000
--limit <n>            Only import the first N conversations after filtering
--since <iso-date>     Only import conversations updated on or after this ISO date
--include-system       Include system/custom-instruction style messages
--dry-run              Parse and prepare items without sending to Supermemory
--verbose              Print per-item progress
--help                 Show usage
```

## Examples

Dry run against a ZIP:

```bash
bun run src/cli.ts --input ~/Downloads/chatgpt-export.zip --dry-run --verbose
```

Import only recent conversations:

```bash
bun run src/cli.ts --input ~/Downloads/chatgpt-export.zip --since 2025-01-01T00:00:00Z
```

Use a custom container and manifest location:

```bash
bun run src/cli.ts \
  --input ~/Downloads/chatgpt-export.zip \
  --container sm_project_default \
  --manifest .data/chatgpt-manifest.json
```

## Development

```bash
bun run check
bun run lint
bun run test
```
