const TG_BASE = "https://api.telegram.org/bot";

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
	entities?: TelegramMessageEntity[];
}

export interface TelegramUser {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
}

export interface TelegramChat {
	id: number;
	type: "private" | "group" | "supergroup" | "channel";
	first_name?: string;
	username?: string;
}

export interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	data?: string;
}

export interface TelegramMessageEntity {
	type: string;
	offset: number;
	length: number;
}

export interface InlineKeyboardButton {
	text: string;
	callback_data?: string;
	url?: string;
}

export class TelegramClient {
	private token: string;

	constructor(token: string) {
		this.token = token;
	}

	private async call(method: string, body: Record<string, unknown>) {
		const res = await fetch(`${TG_BASE}${this.token}/${method}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		return res.json() as Promise<{ ok: boolean; result?: unknown; description?: string }>;
	}

	async sendMessage(
		chatId: number,
		text: string,
		options?: {
			parseMode?: string;
			replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
		},
	) {
		const body: Record<string, unknown> = {
			chat_id: chatId,
			text,
		};
		if (options?.parseMode) body.parse_mode = options.parseMode;
		if (options?.replyMarkup) body.reply_markup = options.replyMarkup;
		return this.call("sendMessage", body);
	}

	async editMessageText(
		chatId: number,
		messageId: number,
		text: string,
		options?: {
			parseMode?: string;
			replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] };
		},
	) {
		return this.call("editMessageText", {
			chat_id: chatId,
			message_id: messageId,
			text,
			parse_mode: options?.parseMode ?? "HTML",
			reply_markup: options?.replyMarkup,
		});
	}

	async answerCallbackQuery(queryId: string, text?: string) {
		return this.call("answerCallbackQuery", {
			callback_query_id: queryId,
			text,
		});
	}

	async sendChatAction(chatId: number, action: string = "typing") {
		return this.call("sendChatAction", {
			chat_id: chatId,
			action,
		});
	}
}
