import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

export type FlattenedMessage = {
	role: "user" | "assistant" | "system" | "tool" | "unknown";
	text: string;
	createdAt?: string;
};

export type FlattenedConversation = {
	id: string;
	title: string;
	createdAt?: string;
	updatedAt?: string;
	messages: FlattenedMessage[];
};

export type PreparedImportItem = {
	conversationId: string;
	title: string;
	part: number;
	totalParts: number;
	createdAt?: string;
	updatedAt?: string;
	content: string;
};

type RawConversation = {
	id?: unknown;
	title?: unknown;
	create_time?: unknown;
	update_time?: unknown;
	current_node?: unknown;
	mapping?: Record<string, RawNode>;
};

type RawNode = {
	parent?: unknown;
	message?: RawMessage | null;
};

type RawMessage = {
	author?: { role?: unknown } | null;
	content?: {
		content_type?: unknown;
		parts?: unknown;
		text?: unknown;
		result?: unknown;
	} | null;
	metadata?: Record<string, unknown> | null;
	create_time?: unknown;
};

export async function loadChatGptExport(inputPath: string): Promise<unknown> {
	const resolvedPath = resolve(inputPath);
	const inputStat = await stat(resolvedPath);

	if (inputStat.isDirectory()) {
		const file = Bun.file(`${resolvedPath}/conversations.json`);
		if (!(await file.exists())) {
			throw new Error(
				`Could not find conversations.json in directory: ${resolvedPath}`,
			);
		}

		return JSON.parse(await file.text());
	}

	const extension = extname(resolvedPath).toLowerCase();

	if (extension === ".zip") {
		const archive = new Uint8Array(await Bun.file(resolvedPath).arrayBuffer());
		const entries = unzipSync(archive);
		const match = Object.entries(entries).find(([name]) => {
			const normalized = name.replace(/\\/g, "/");
			return (
				normalized === "conversations.json" ||
				normalized.endsWith("/conversations.json")
			);
		});

		if (!match) {
			throw new Error(
				`Could not find conversations.json inside archive: ${basename(resolvedPath)}`,
			);
		}

		return JSON.parse(strFromU8(match[1]));
	}

	if (extension === ".json") {
		return JSON.parse(await Bun.file(resolvedPath).text());
	}

	throw new Error(
		`Unsupported input: ${resolvedPath}. Use a .zip, .json, or extracted export directory.`,
	);
}

export function parseChatGptExport(
	input: unknown,
	options: { includeSystem?: boolean } = {},
): FlattenedConversation[] {
	if (!Array.isArray(input)) {
		throw new Error(
			"Expected conversations.json to contain an array of conversations.",
		);
	}

	return input
		.map((conversation) =>
			flattenConversation(conversation as RawConversation, options),
		)
		.filter((conversation): conversation is FlattenedConversation =>
			Boolean(conversation),
		)
		.filter((conversation) => conversation.messages.length > 0);
}

export function buildImportItems(
	conversations: FlattenedConversation[],
	options: { maxChars?: number } = {},
): PreparedImportItem[] {
	const maxChars = Math.max(2_000, options.maxChars ?? 120_000);
	const bodyBudget = Math.max(1_000, maxChars - 1_000);

	return conversations.flatMap((conversation) => {
		const blocks = conversation.messages.flatMap((message) =>
			renderMessageBlocks(message, bodyBudget),
		);
		const chunks = chunkBlocks(blocks, bodyBudget);

		return chunks.map((chunk, index) => {
			const part = index + 1;
			const totalParts = chunks.length;
			const headerLines = [
				"[source: chatgpt-export]",
				`[conversation_id: ${conversation.id}]`,
				`[title: ${conversation.title}]`,
				conversation.createdAt
					? `[created_at: ${conversation.createdAt}]`
					: undefined,
				conversation.updatedAt
					? `[updated_at: ${conversation.updatedAt}]`
					: undefined,
				`[part: ${part}/${totalParts}]`,
				"",
			].filter((line): line is string => Boolean(line));
			const content = `${headerLines.join("\n")}\n${chunk}`.trim();

			if (content.length > maxChars) {
				throw new Error(
					`Prepared part exceeded maxChars (${content.length} > ${maxChars}) for conversation ${conversation.id}.`,
				);
			}

			return {
				conversationId: conversation.id,
				title: conversation.title,
				part,
				totalParts,
				createdAt: conversation.createdAt,
				updatedAt: conversation.updatedAt,
				content,
			} satisfies PreparedImportItem;
		});
	});
}

function flattenConversation(
	conversation: RawConversation,
	options: { includeSystem?: boolean },
): FlattenedConversation | null {
	const id = asString(conversation.id) ?? crypto.randomUUID();
	const title = asString(conversation.title)?.trim() || "Untitled";
	const createdAt = toIsoTimestamp(conversation.create_time);
	const updatedAt = toIsoTimestamp(conversation.update_time);
	const messages = collectMessages(conversation, options);

	if (messages.length === 0) {
		return null;
	}

	return {
		id,
		title,
		createdAt,
		updatedAt,
		messages,
	};
}

function collectMessages(
	conversation: RawConversation,
	options: { includeSystem?: boolean },
): FlattenedMessage[] {
	const mapping = conversation.mapping ?? {};
	const currentNode = asString(conversation.current_node);
	const branchNodes: RawNode[] = [];
	const seen = new Set<string>();

	if (currentNode) {
		let cursor: string | undefined = currentNode;

		while (cursor && !seen.has(cursor)) {
			seen.add(cursor);
			const node = mapping[cursor];
			if (!node) {
				break;
			}

			branchNodes.push(node);
			cursor = asString(node.parent);
		}
	}

	const candidateNodes =
		branchNodes.length > 0 ? branchNodes.reverse() : Object.values(mapping);

	return candidateNodes
		.map((node) => normalizeMessage(node.message, options))
		.filter((message): message is FlattenedMessage => Boolean(message));
}

function normalizeMessage(
	rawMessage: RawMessage | null | undefined,
	options: { includeSystem?: boolean },
): FlattenedMessage | null {
	if (!rawMessage) {
		return null;
	}

	const metadata = rawMessage.metadata ?? {};
	if (metadata.is_visually_hidden_from_conversation === true) {
		return null;
	}

	const role = normalizeRole(rawMessage.author?.role);
	if (role === "tool") {
		return null;
	}

	if (
		role === "system" &&
		!options.includeSystem &&
		metadata.is_user_system_message !== true
	) {
		return null;
	}

	const text = extractMessageText(rawMessage.content).trim();
	if (!text) {
		return null;
	}

	return {
		role,
		text,
		createdAt: toIsoTimestamp(rawMessage.create_time),
	};
}

function normalizeRole(value: unknown): FlattenedMessage["role"] {
	const role = asString(value)?.toLowerCase();

	if (
		role === "user" ||
		role === "assistant" ||
		role === "system" ||
		role === "tool"
	) {
		return role;
	}

	return "unknown";
}

function extractMessageText(content: RawMessage["content"]): string {
	if (!content) {
		return "";
	}

	const parts = Array.isArray(content.parts)
		? content.parts.map(extractTextFromUnknown).filter(Boolean)
		: [];

	if (parts.length > 0) {
		return parts.join("\n\n").replace(/\r\n/g, "\n").trim();
	}

	const fallbacks = [content.text, content.result]
		.map(extractTextFromUnknown)
		.filter(Boolean)
		.join("\n\n");

	return fallbacks.replace(/\r\n/g, "\n").trim();
}

function extractTextFromUnknown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map(extractTextFromUnknown).filter(Boolean).join("\n");
	}

	if (value && typeof value === "object") {
		const candidate = value as Record<string, unknown>;

		for (const key of ["text", "content", "result", "title"]) {
			if (key in candidate) {
				const text = extractTextFromUnknown(candidate[key]);
				if (text) {
					return text;
				}
			}
		}
	}

	return "";
}

function renderMessageBlocks(
	message: FlattenedMessage,
	maxBlockChars: number,
): string[] {
	const label = roleLabel(message.role);
	const normalizedText = message.text.replace(/\r\n/g, "\n").trim();
	const basePrefix = `${label}:\n`;
	const continuedPrefix = `${label} (continued):\n`;

	const initialBudget = Math.max(200, maxBlockChars - basePrefix.length - 2);
	const continuedBudget = Math.max(
		200,
		maxBlockChars - continuedPrefix.length - 2,
	);
	const segments = splitText(normalizedText, initialBudget, continuedBudget);

	return segments.map((segment, index) => {
		const prefix = index === 0 ? basePrefix : continuedPrefix;
		return `${prefix}${segment.trim()}\n`;
	});
}

function splitText(
	text: string,
	firstBudget: number,
	continuedBudget: number,
): string[] {
	const segments: string[] = [];
	let remaining = text.trim();
	let budget = firstBudget;

	while (remaining.length > 0) {
		if (remaining.length <= budget) {
			segments.push(remaining);
			break;
		}

		const sliceIndex = findSplitPoint(remaining, budget);
		segments.push(remaining.slice(0, sliceIndex).trim());
		remaining = remaining.slice(sliceIndex).trim();
		budget = continuedBudget;
	}

	return segments;
}

function findSplitPoint(text: string, budget: number): number {
	const candidates = ["\n\n", "\n", ". ", "。", " "];

	for (const token of candidates) {
		const index = text.lastIndexOf(token, budget);
		if (index > budget * 0.6) {
			return index + token.length;
		}
	}

	return budget;
}

function chunkBlocks(blocks: string[], maxChars: number): string[] {
	const chunks: string[] = [];
	let current = "";

	for (const block of blocks) {
		const candidate = current
			? `${current}\n${block.trimEnd()}`
			: block.trimEnd();

		if (candidate.length > maxChars && current) {
			chunks.push(current.trimEnd());
			current = block.trimEnd();
			continue;
		}

		current = candidate;
	}

	if (current.trim()) {
		chunks.push(current.trimEnd());
	}

	return chunks;
}

function roleLabel(role: FlattenedMessage["role"]): string {
	switch (role) {
		case "assistant":
			return "Assistant";
		case "system":
			return "System";
		case "tool":
			return "Tool";
		case "unknown":
			return "Message";
		default:
			return "User";
	}
}

function toIsoTimestamp(value: unknown): string | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		const milliseconds = value > 1e12 ? value : value * 1_000;
		return new Date(milliseconds).toISOString();
	}

	if (typeof value === "string" && value.trim()) {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			return toIsoTimestamp(numeric);
		}

		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) {
			return new Date(parsed).toISOString();
		}
	}

	return undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}
