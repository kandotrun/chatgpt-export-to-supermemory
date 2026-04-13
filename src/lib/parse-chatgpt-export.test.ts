import { describe, expect, test } from "bun:test";
import { buildImportItems, parseChatGptExport } from "./parse-chatgpt-export";

describe("parseChatGptExport", () => {
	test("flattens the active branch from mapping/current_node", () => {
		const conversations = parseChatGptExport([
			{
				id: "conv_1",
				title: "Test conversation",
				create_time: 1_700_000_000,
				update_time: 1_700_000_100,
				current_node: "assistant_1",
				mapping: {
					root: {
						parent: null,
						message: null,
					},
					user_1: {
						parent: "root",
						message: {
							author: { role: "user" },
							create_time: 1_700_000_001,
							content: {
								content_type: "text",
								parts: ["hello"],
							},
						},
					},
					assistant_1: {
						parent: "user_1",
						message: {
							author: { role: "assistant" },
							create_time: 1_700_000_002,
							content: {
								content_type: "text",
								parts: ["world"],
							},
						},
					},
				},
			},
		]);

		expect(conversations).toHaveLength(1);
		expect(
			conversations[0]?.messages.map((message) => [message.role, message.text]),
		).toEqual([
			["user", "hello"],
			["assistant", "world"],
		]);
	});

	test("splits large conversations into multiple import items", () => {
		const conversations = parseChatGptExport([
			{
				id: "conv_2",
				title: "Long conversation",
				current_node: "assistant_1",
				mapping: {
					user_1: {
						parent: null,
						message: {
							author: { role: "user" },
							content: {
								content_type: "text",
								parts: ["a".repeat(3000)],
							},
						},
					},
					assistant_1: {
						parent: "user_1",
						message: {
							author: { role: "assistant" },
							content: {
								content_type: "text",
								parts: ["b".repeat(3000)],
							},
						},
					},
				},
			},
		]);

		const items = buildImportItems(conversations, { maxChars: 2500 });

		expect(items.length).toBeGreaterThan(1);
		expect(items[0]?.content).toContain("[source: chatgpt-export]");
	});
});
