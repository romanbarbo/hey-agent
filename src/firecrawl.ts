const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

export interface SearchResult {
	title?: string;
	description?: string;
	url: string;
	markdown?: string | null;
	metadata?: {
		title?: string;
		description?: string;
		sourceURL?: string;
		statusCode?: number;
	};
}

export interface SearchResponse {
	success: boolean;
	data: SearchResult[];
}

export interface ScrapeResponse {
	success: boolean;
	data: {
		markdown?: string;
		metadata?: Record<string, unknown>;
	};
}

export class FirecrawlClient {
	private apiKey: string;

	constructor(apiKey: string) {
		this.apiKey = apiKey;
	}

	async search(
		query: string,
		options?: { limit?: number; location?: string; country?: string },
	): Promise<SearchResponse> {
		const res = await fetch(`${FIRECRAWL_BASE}/search`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query,
				limit: options?.limit ?? 5,
				location: options?.location,
				country: options?.country,
				scrapeOptions: {
					formats: ["markdown"],
				},
			}),
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`Firecrawl search failed (${res.status}): ${err}`);
		}

		return res.json() as Promise<SearchResponse>;
	}

	async scrape(
		url: string,
		options?: { formats?: string[]; onlyMainContent?: boolean },
	): Promise<ScrapeResponse> {
		const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				url,
				formats: options?.formats ?? ["markdown"],
				onlyMainContent: options?.onlyMainContent ?? true,
			}),
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`Firecrawl scrape failed (${res.status}): ${err}`);
		}

		return res.json() as Promise<ScrapeResponse>;
	}
}
