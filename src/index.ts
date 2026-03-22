import { TaskAgent } from "./agent";
import type { TelegramUpdate } from "./telegram";

export { TaskAgent };

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Telegram webhook endpoint
		if (url.pathname === "/webhook" && request.method === "POST") {
			const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
			if (secret !== env.BOT_SECRET) {
				return new Response("Unauthorized", { status: 401 });
			}

			let update: TelegramUpdate;
			try {
				update = (await request.json()) as TelegramUpdate;
			} catch {
				return new Response("Bad Request", { status: 400 });
			}

			const chatId =
				update.message?.chat.id ??
				update.callback_query?.message?.chat.id;

			if (!chatId) {
				return new Response("OK");
			}

			const agentId = env.TASK_AGENT.idFromName(`chat:${chatId}`);
			const agent = env.TASK_AGENT.get(agentId);

			ctx.waitUntil(
				agent.handleTelegramUpdate(update).catch((err) => {
					console.error(`Error in agent for chat ${chatId}:`, err);
				}),
			);

			return new Response("OK");
		}

		// Webhook registration (protected by admin secret)
		if (url.pathname === "/register-webhook") {
			const authHeader = request.headers.get("Authorization");
			if (authHeader !== `Bearer ${env.BOT_SECRET}`) {
				return new Response("Unauthorized", { status: 401 });
			}

			const workerUrl = `${url.protocol}//${url.host}/webhook`;
			const tgUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`;

			const res = await fetch(tgUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					url: workerUrl,
					secret_token: env.BOT_SECRET,
					allowed_updates: ["message", "callback_query"],
					drop_pending_updates: true,
				}),
			});

			const result = await res.json();
			return Response.json(result);
		}

		// Health check
		if (url.pathname === "/health") {
			return Response.json({ status: "ok", timestamp: new Date().toISOString() });
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
