import { importToSupermemory } from "./lib/import-supermemory";

async function main() {
	console.log("chatgpt-export-to-supermemory");
	console.log("Scaffold ready.");
	console.log(
		"Next: parse ChatGPT export ZIP and send normalized threads to Supermemory.",
	);

	if (process.argv.includes("--dry-run")) {
		await importToSupermemory({ dryRun: true, items: [] });
	}
}

void main();
