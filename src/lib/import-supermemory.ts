export type ImportItem = {
	conversationId: string;
	part: number;
	content: string;
};

export async function importToSupermemory(params: {
	dryRun?: boolean;
	items: ImportItem[];
}) {
	if (params.dryRun) {
		console.log(
			`Dry run: ${params.items.length} item(s) would be sent to Supermemory.`,
		);
		return;
	}

	// TODO: call Supermemory MCP or HTTP endpoint and persist import manifest.
	console.log(`Import placeholder: ${params.items.length} item(s).`);
}
