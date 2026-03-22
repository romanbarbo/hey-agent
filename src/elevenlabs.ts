const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

export interface OutboundCallResponse {
	call_id?: string;
	conversation_id?: string;
	agent_id?: string;
	status?: string;
}

export interface ConversationDetails {
	conversation_id: string;
	agent_id: string;
	status: string;
	transcript?: TranscriptEntry[];
	metadata?: Record<string, unknown>;
	analysis?: {
		call_successful?: string;
		transcript_summary?: string;
	};
}

export interface TranscriptEntry {
	role: "agent" | "user";
	message: string;
	timestamp?: number;
}

export interface ConversationListResponse {
	conversations: Array<{
		conversation_id: string;
		agent_id: string;
		status: string;
		start_time_unix_secs?: number;
		call_duration_secs?: number;
	}>;
}

export class ElevenLabsClient {
	private apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	async initiateOutboundCall(params: {
		agentId: string;
		agentPhoneNumberId: string;
		toNumber: string;
		dynamicVariables?: Record<string, string>;
		firstMessage?: string;
	}): Promise<OutboundCallResponse> {
		const body: Record<string, unknown> = {
			agent_id: params.agentId,
			agent_phone_number_id: params.agentPhoneNumberId,
			to_number: params.toNumber,
		};

		if (params.dynamicVariables || params.firstMessage) {
			body.conversation_initiation_client_data = {
				dynamic_variables: params.dynamicVariables,
				first_message: params.firstMessage,
			};
		}

		const res = await fetch(`${ELEVENLABS_BASE}/convai/twilio/outbound-call`, {
			method: "POST",
			headers: {
				"xi-api-key": this.apiKey,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`ElevenLabs outbound call failed (${res.status}): ${err}`);
		}

		return res.json() as Promise<OutboundCallResponse>;
	}

	async getConversation(conversationId: string): Promise<ConversationDetails> {
		const res = await fetch(
			`${ELEVENLABS_BASE}/convai/conversations/${conversationId}`,
			{
				headers: { "xi-api-key": this.apiKey },
			},
		);

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`ElevenLabs get conversation failed (${res.status}): ${err}`);
		}

		return res.json() as Promise<ConversationDetails>;
	}

	async listConversations(agentId?: string): Promise<ConversationListResponse> {
		const params = new URLSearchParams();
		if (agentId) params.set("agent_id", agentId);

		const res = await fetch(
			`${ELEVENLABS_BASE}/convai/conversations?${params}`,
			{
				headers: { "xi-api-key": this.apiKey },
			},
		);

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`ElevenLabs list conversations failed (${res.status}): ${err}`);
		}

		return res.json() as Promise<ConversationListResponse>;
	}
}
