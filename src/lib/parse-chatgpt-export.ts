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

export function parseChatGptExport(_input: unknown): FlattenedConversation[] {
	// TODO: implement conversations.json parsing and deterministic thread flattening.
	return [];
}
