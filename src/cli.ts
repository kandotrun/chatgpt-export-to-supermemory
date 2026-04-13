import { importToSupermemory } from "./lib/import-supermemory";
import {
	buildImportItems,
	loadChatGptExport,
	parseChatGptExport,
} from "./lib/parse-chatgpt-export";

type CliOptions = {
	input?: string;
	containerTag: string;
	manifestPath: string;
	maxChars: number;
	limit?: number;
	since?: string;
	includeSystem: boolean;
	dryRun: boolean;
	verbose: boolean;
	help: boolean;
};

async function main() {
	const options = parseArgs(process.argv.slice(2));

	if (options.help || !options.input) {
		printUsage();
		process.exit(options.help ? 0 : 1);
	}

	const rawExport = await loadChatGptExport(options.input);
	const parsed = parseChatGptExport(rawExport, {
		includeSystem: options.includeSystem,
	});

	const filtered = parsed
		.filter((conversation) => {
			if (!options.since) {
				return true;
			}

			const updatedAt = conversation.updatedAt ?? conversation.createdAt;
			return updatedAt
				? Date.parse(updatedAt) >= Date.parse(options.since)
				: false;
		})
		.sort((left, right) =>
			compareTimestamps(
				left.updatedAt ?? left.createdAt,
				right.updatedAt ?? right.createdAt,
			),
		);

	const limited =
		typeof options.limit === "number"
			? filtered.slice(0, options.limit)
			: filtered;
	const items = buildImportItems(limited, { maxChars: options.maxChars });

	console.log(
		`Loaded ${parsed.length} conversation(s), selected ${limited.length}, prepared ${items.length} import item(s).`,
	);

	const result = await importToSupermemory({
		dryRun: options.dryRun,
		verbose: options.verbose,
		containerTag: options.containerTag,
		manifestPath: options.manifestPath,
		items,
	});

	console.log(
		`${options.dryRun ? "Dry run complete" : "Import complete"}. Imported: ${result.imported}, skipped: ${result.skipped}, failed: ${result.failed}.`,
	);
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		input: undefined,
		containerTag: process.env.SUPERMEMORY_CONTAINER_TAG || "sm_project_default",
		manifestPath: ".data/import-manifest.json",
		maxChars: 120_000,
		limit: undefined,
		since: undefined,
		includeSystem: false,
		dryRun: false,
		verbose: false,
		help: false,
	};

	const consumeValue = (index: number, flag: string) => {
		const value = args[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for ${flag}`);
		}
		return value;
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (!arg) {
			continue;
		}

		if (!arg.startsWith("--")) {
			options.input ??= arg;
			continue;
		}

		switch (arg) {
			case "--input":
				options.input = consumeValue(index, arg);
				index += 1;
				break;
			case "--container":
				options.containerTag = consumeValue(index, arg);
				index += 1;
				break;
			case "--manifest":
				options.manifestPath = consumeValue(index, arg);
				index += 1;
				break;
			case "--max-chars":
				options.maxChars = parsePositiveInt(consumeValue(index, arg), arg);
				index += 1;
				break;
			case "--limit":
				options.limit = parsePositiveInt(consumeValue(index, arg), arg);
				index += 1;
				break;
			case "--since": {
				const value = consumeValue(index, arg);
				if (Number.isNaN(Date.parse(value))) {
					throw new Error(`Invalid ISO date for ${arg}: ${value}`);
				}
				options.since = value;
				index += 1;
				break;
			}
			case "--include-system":
				options.includeSystem = true;
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--verbose":
				options.verbose = true;
				break;
			case "--help":
			case "-h":
				options.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function parsePositiveInt(value: string, flag: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Expected a positive integer for ${flag}, got: ${value}`);
	}
	return parsed;
}

function compareTimestamps(left?: string, right?: string): number {
	const leftValue = left ? Date.parse(left) : 0;
	const rightValue = right ? Date.parse(right) : 0;
	return leftValue - rightValue;
}

function printUsage() {
	console.log(`chatgpt-export-to-supermemory

Usage:
  bun run src/cli.ts --input <path>
  bun run src/cli.ts <path>

Accepted input:
  - ChatGPT export .zip
  - extracted export directory containing conversations.json
  - conversations.json directly

Options:
  --container <tag>      Supermemory container tag (default: SUPERMEMORY_CONTAINER_TAG or sm_project_default)
  --manifest <path>      Local manifest path for dedupe tracking (default: .data/import-manifest.json)
  --max-chars <n>        Max chars per saved memory item (default: 120000)
  --limit <n>            Only import the first N conversations after filtering
  --since <iso-date>     Only import conversations updated on or after this ISO date
  --include-system       Include system/custom-instruction style messages
  --dry-run              Parse and prepare items without sending to Supermemory
  --verbose              Print per-item progress
  --help                 Show this help
`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
