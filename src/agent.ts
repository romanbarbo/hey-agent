import { Agent } from "agents";
import {
	TelegramClient,
	type TelegramUpdate,
	type TelegramMessage,
	type TelegramCallbackQuery,
	type InlineKeyboardButton,
} from "./telegram";
import { ElevenLabsClient } from "./elevenlabs";
import { chat } from "./ai";

interface AgentState {
	chatId: number | null;
}

interface MessageRow {
	role: string;
	content: string;
}

interface SearchResultRow {
	title: string;
	url: string;
	phone: string | null;
	address: string | null;
	description: string | null;
}

export class TaskAgent extends Agent<Env, AgentState> {
	initialState: AgentState = { chatId: null };

	private _tg?: TelegramClient;
	private _elevenlabs?: ElevenLabsClient;
	private _tablesReady = false;

	private tg(): TelegramClient {
		return (this._tg ??= new TelegramClient(this.env.BOT_TOKEN));
	}

	private elevenlabs(): ElevenLabsClient {
		return (this._elevenlabs ??= new ElevenLabsClient(
			this.env.ELEVENLABS_API_KEY,
		));
	}

	private ensureTables(): void {
		if (this._tablesReady) return;

		this.sql`CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			chat_id INTEGER NOT NULL,
			role TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`;

		this.sql`CREATE TABLE IF NOT EXISTS search_results (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			chat_id INTEGER NOT NULL,
			title TEXT NOT NULL,
			url TEXT NOT NULL,
			phone TEXT,
			address TEXT,
			description TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`;

		this.sql`CREATE TABLE IF NOT EXISTS calls (
			id TEXT PRIMARY KEY,
			chat_id INTEGER NOT NULL,
			conversation_id TEXT NOT NULL,
			phone TEXT NOT NULL,
			provider_name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'calling',
			data TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`;

		this._tablesReady = true;
	}

	async handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
		this.ensureTables();
		try {
			if (update.callback_query) {
				await this.handleCallbackQuery(update.callback_query);
			} else if (update.message) {
				await this.handleMessage(update.message);
			}
		} catch (err) {
			console.error("Error handling update:", err);
			const chatId =
				update.message?.chat.id ??
				update.callback_query?.message?.chat.id;
			if (chatId) {
				await this.tg().sendMessage(
					chatId,
					"An error occurred. Please try again.",
				);
			}
		}
	}

	private async handleMessage(message: TelegramMessage): Promise<void> {
		const chatId = message.chat.id;
		const text = message.text?.trim();

		if (!text) {
			await this.tg().sendMessage(
				chatId,
				"I can only process text messages.",
			);
			return;
		}

		this.setState({ ...this.state, chatId });
		await this.tg().sendChatAction(chatId, "typing");

		// Save user message
		this.sql`INSERT INTO messages (chat_id, role, content)
			VALUES (${chatId}, 'user', ${text})`;

		// Load last 15 messages for context
		const history = this.sql<MessageRow>`
			SELECT role, content FROM messages
			WHERE chat_id = ${chatId}
			ORDER BY id DESC LIMIT 15
		`.reverse();

		const messages = history.map((m) => ({
			role: m.role as "user" | "assistant",
			content: m.content,
		}));

		// Call AI with tools
		const result = await chat({ env: this.env, messages });

		// Store search results and build inline buttons
		const buttons: InlineKeyboardButton[][] = [];
		if (result.searchResults?.length) {
			this.sql`DELETE FROM search_results WHERE chat_id = ${chatId}`;
			for (const r of result.searchResults) {
				this.sql`INSERT INTO search_results (chat_id, title, url, phone, address, description)
					VALUES (${chatId}, ${r.title}, ${r.url}, ${r.phone}, ${r.address}, ${r.description})`;
			}

			for (let i = 0; i < result.searchResults.length; i++) {
				const r = result.searchResults[i];
				if (r.phone) {
					buttons.push([
						{
							text: `📞 Call ${r.title.slice(0, 30)}`,
							callback_data: `call:${i}`,
						},
					]);
				}
			}
		}

		// Set up polling for any calls initiated by the AI
		if (result.callsInitiated?.length) {
			for (const call of result.callsInitiated) {
				const callId = crypto.randomUUID();
				this.sql`INSERT INTO calls (id, chat_id, conversation_id, phone, provider_name)
					VALUES (${callId}, ${chatId}, ${call.conversationId}, ${call.phone}, ${call.providerName})`;

				if (call.conversationId) {
					await this.schedule(15, "checkCallStatusScheduled", {
						callId,
						conversationId: call.conversationId,
						chatId,
						attempt: 1,
					});
				}
			}
		}

		// Send AI response
		const responseText = result.text || "Done.";
		this.sql`INSERT INTO messages (chat_id, role, content)
			VALUES (${chatId}, 'assistant', ${responseText})`;

		await this.tg().sendMessage(chatId, responseText, {
			replyMarkup:
				buttons.length > 0
					? { inline_keyboard: buttons }
					: undefined,
		});
	}

	private async handleCallbackQuery(
		query: TelegramCallbackQuery,
	): Promise<void> {
		const chatId = query.message?.chat.id;
		if (!chatId || !query.data) {
			if (query.id) await this.tg().answerCallbackQuery(query.id);
			return;
		}

		await this.tg().answerCallbackQuery(query.id, "Processing...");

		const [action, indexStr] = query.data.split(":");
		if (action === "call" && indexStr !== undefined) {
			const index = parseInt(indexStr, 10);
			const results = this.sql<SearchResultRow>`
				SELECT * FROM search_results
				WHERE chat_id = ${chatId} ORDER BY id
			`;

			if (!results[index]?.phone) {
				await this.tg().sendMessage(
					chatId,
					"Result not found. Try searching again.",
				);
				return;
			}

			const r = results[index];
			// Feed button press as a user message through the AI
			await this.handleMessage({
				message_id: 0,
				chat: { id: chatId, type: "private" },
				date: Math.floor(Date.now() / 1000),
				text: `Call ${r.title} at ${r.phone}`,
			});
		}
	}

	async checkCallStatusScheduled(payload: {
		callId: string;
		conversationId: string;
		chatId: number;
		attempt: number;
	}): Promise<void> {
		this.ensureTables();
		const MAX_ATTEMPTS = 40; // ~10 minutes

		try {
			const conversation = await this.elevenlabs().getConversation(
				payload.conversationId,
			);

			if (
				conversation.status === "done" ||
				conversation.status === "ended"
			) {
				const transcript =
					conversation.transcript
						?.map((e) => `${e.role}: ${e.message}`)
						.join("\n") ?? "No transcript available.";

				const summary =
					conversation.analysis?.transcript_summary ??
					transcript.slice(0, 500);
				const msg = `Call completed!\n\n${summary}`;

				this.sql`UPDATE calls SET status = 'completed', data = ${JSON.stringify({ transcript })}
					WHERE id = ${payload.callId}`;
				this.sql`INSERT INTO messages (chat_id, role, content)
					VALUES (${payload.chatId}, 'assistant', ${msg})`;

				await this.tg().sendMessage(payload.chatId, msg);
				return;
			}

			if (
				conversation.status === "failed" ||
				conversation.status === "error"
			) {
				this.sql`UPDATE calls SET status = 'failed' WHERE id = ${payload.callId}`;
				await this.tg().sendMessage(
					payload.chatId,
					"Call failed. The number might be unreachable. Try again later.",
				);
				return;
			}

			if (payload.attempt < MAX_ATTEMPTS) {
				await this.schedule(15, "checkCallStatusScheduled", {
					...payload,
					attempt: payload.attempt + 1,
				});
			} else {
				await this.tg().sendMessage(
					payload.chatId,
					"Call monitoring timed out.",
				);
			}
		} catch (err) {
			console.error("Status check failed:", err);
			if (payload.attempt < MAX_ATTEMPTS) {
				await this.schedule(30, "checkCallStatusScheduled", {
					...payload,
					attempt: payload.attempt + 1,
				});
			}
		}
	}
}
