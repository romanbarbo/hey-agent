import { generateText, tool, stepCountIs } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import { FirecrawlClient } from "./firecrawl";
import { ElevenLabsClient } from "./elevenlabs";

const MODEL_ID = "@cf/moonshotai/kimi-k2.5";

const SYSTEM_PROMPT = `You are Hey Agent, a Telegram bot that helps users find service providers and call them using AI voice.

You have these tools:
- searchWeb: Search the internet for businesses, services, or information
- makeCall: Call a phone number using an AI voice agent that handles the conversation

Behavior:
- Detect the user's language and always respond in it
- Be concise and helpful
- When presenting search results, list them clearly with number, name, phone, and address
- You may search and immediately call if the user's intent is clear (e.g., "find a dentist and book an appointment")
- You can call directly without asking for confirmation
- For greetings, help, or status questions, respond directly without tools
- Use emoji sparingly for clarity

Do NOT use HTML or markdown formatting. Use plain text only.`;

export interface SearchResultData {
	title: string;
	url: string;
	phone: string | null;
	address: string | null;
	description: string | null;
}

export interface CallInitiatedData {
	conversationId: string;
	phone: string;
	providerName: string;
}

export interface ChatResult {
	text: string;
	searchResults?: SearchResultData[];
	callsInitiated?: CallInitiatedData[];
}

export async function chat(params: {
	env: Env;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<ChatResult> {
	const { env, messages } = params;
	const workersai = createWorkersAI({ binding: env.AI });

	let searchResults: SearchResultData[] | undefined;
	const callsInitiated: CallInitiatedData[] = [];

	const firecrawl = new FirecrawlClient(env.FIRECRAWL_API_KEY);
	const elevenlabs = new ElevenLabsClient(env.ELEVENLABS_API_KEY);

	const result = await generateText({
		model: workersai(MODEL_ID),
		system: SYSTEM_PROMPT,
		messages,
		tools: {
			searchWeb: tool({
				description:
					"Search the internet for service providers, businesses, or any information. Returns a list of results with titles, URLs, phone numbers, and descriptions.",
				inputSchema: z.object({
					query: z.string().describe("The search query"),
					location: z
						.string()
						.optional()
						.describe("Location to search near, if relevant"),
				}),
				execute: async ({ query, location }) => {
					const response = await firecrawl.search(query, {
						limit: 5,
						location: location ?? undefined,
					});
					const results = response.data ?? [];
					const enriched: SearchResultData[] = [];

					for (const r of results) {
						const content = r.markdown ?? r.description ?? "";
						let phone: string | null = null;
						const phoneMatch = content.match(
							/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\+\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,
						);
						if (phoneMatch) phone = phoneMatch[0].trim();

						enriched.push({
							title: r.title || "Untitled",
							url: r.url,
							phone,
							address: null,
							description: r.description || null,
						});
					}

					searchResults = enriched;
					return enriched;
				},
			}),

			makeCall: tool({
				description:
					"Make a phone call to a business or person using an AI voice agent. The agent will handle the conversation on behalf of the user.",
				inputSchema: z.object({
					phone: z.string().describe("Phone number to call"),
					providerName: z
						.string()
						.describe("Name of the business or person being called"),
					taskDescription: z
						.string()
						.describe(
							"What the voice agent should accomplish on the call (e.g., 'Book an appointment for a dental cleaning')",
						),
					language: z
						.string()
						.optional()
						.describe(
							"Language for the call, ISO 639-1 code (default: en)",
						),
				}),
				execute: async ({
					phone,
					providerName,
					taskDescription,
					language,
				}) => {
					const callResponse =
						await elevenlabs.initiateOutboundCall({
							agentId: env.ELEVENLABS_AGENT_ID,
							agentPhoneNumberId:
								env.ELEVENLABS_PHONE_NUMBER_ID,
							toNumber: phone,
							dynamicVariables: {
								task_description: taskDescription,
								provider_name: providerName,
								user_language: language ?? "en",
							},
						});

					const conversationId =
						callResponse.conversation_id ??
						callResponse.call_id ??
						"";
					callsInitiated.push({
						conversationId,
						phone,
						providerName,
					});

					return {
						success: true,
						conversationId,
						message: `Call to ${providerName} at ${phone} has been initiated. The AI voice agent is now handling the conversation.`,
					};
				},
			}),
		},
		stopWhen: stepCountIs(5),
	});

	return {
		text: result.text,
		searchResults,
		callsInitiated: callsInitiated.length > 0 ? callsInitiated : undefined,
	};
}
