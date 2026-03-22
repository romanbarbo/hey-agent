# Hey Agent

Telegram bot that finds service providers on the web and **calls them for you** using [ElevenLabs agents platform](https://elevenlabs.io/agents) and [Firecrawl](https://firecrawl.dev) web search.

Tell it what you need in any language. It searches the web, extracts contact details, and dispatches an AI voice agent to make the phone call. You get a transcript and summary when it's done.

```
You: Find me a dentist in San Francisco
Bot: 🔍 Searching...
Bot: Found 3 results:
     1. Bay Area Dental — 📞 (415) 555-0123
     [📞 Call Bay Area Dental]

You: *taps button*
Bot: 📞 Calling Bay Area Dental...
Bot: ✅ Call completed!
     Appointment scheduled for March 25 at 2:00 PM.
     Address: 123 Market St, SF.
```

## How It Works

```
Telegram → Cloudflare Worker → Durable Object (per user)
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
               Firecrawl      Kimi K2.5 via        ElevenLabs
             (web search)    AI SDK (routing)      (voice agent)
                                                        │
                                                     Twilio
                                                   (phone line)
```

1. User sends a message. Worker routes it to the user's Durable Object.
2. The AI model (Kimi K2.5) receives the message with conversation history (last 15 messages) and decides what to do via tool calls.
3. If the AI calls `searchWeb`, Firecrawl searches the web and returns results with phone numbers extracted.
4. If the AI calls `makeCall`, ElevenLabs voice agent calls via Twilio and handles the conversation.
5. The AI can chain tools in a single turn — e.g., search and then immediately call the best match.
6. Bot polls for call completion, fetches the transcript, and sends a summary.

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Voice AI | [**ElevenLabs** Conversational AI](https://elevenlabs.io/docs/agents-platform/overview) | AI voice agent, makes phone calls |
| Web Search | [**Firecrawl**](https://firecrawl.dev) | Web search with full page content as markdown |
| Hosting | [Cloudflare Workers](https://developers.cloudflare.com/workers/) | Serverless edge compute |
| State | [Durable Objects](https://developers.cloudflare.com/durable-objects/) (via [Agents SDK](https://developers.cloudflare.com/agents/)) | Per-user persistent state with embedded SQLite |
| LLM | [Kimi K2.5](https://developers.cloudflare.com/workers-ai/models/moonshotai-kimi-k2.5/) via [Vercel AI SDK](https://ai-sdk.dev/) on [Workers AI](https://developers.cloudflare.com/workers-ai/) | Conversational routing with tool calls (searchWeb, makeCall) |
| Phone | [Twilio](https://www.twilio.com/docs/voice) | Phone number (managed by ElevenLabs) |
| Bot | [Telegram Bot API](https://core.telegram.org/bots/api) | User interface |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Telegram bot token](https://core.telegram.org/bots#botfather) (free)
- [**Firecrawl** API key](https://firecrawl.dev) (500 free credits to start)
- [**ElevenLabs** API key](https://elevenlabs.io) (Conversational AI starts at $0.10/min)
- [Twilio account](https://www.twilio.com) with a voice-capable phone number

## Setup

### 1. Clone and install

```bash
git clone https://github.com/romanbarbo/hey-agent.git
cd hey-agent
npm install
```

### 2. Create a Telegram bot

1. Open Telegram, search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot`, choose a name and username
3. Copy the bot token

### 3. Get a Twilio phone number

1. Sign up at [twilio.com](https://www.twilio.com)
2. Go to **Phone Numbers** > **Buy a number** (pick one with Voice capability)
3. Note your **Account SID** and **Auth Token** from the dashboard

### 4. Set up ElevenLabs Conversational AI agent

1. Go to [ElevenLabs](https://elevenlabs.io) > **Conversational AI** > **Create Agent**
2. Set the system prompt (see [Agent Prompt](#elevenlabs-agent-prompt) below)
3. Set **First message** to: `Hello, I'm calling to {{task_description}}. Could you help me with that?`
4. Add dynamic variables: `task_description`, `provider_name`, `user_language`
5. Choose a voice (e.g., "George" or "Sarah") and TTS model (`eleven_flash_v2_5` for lowest latency)
6. Enable the `end_call` built-in tool
7. Copy the **Agent ID** from the URL

### 5. Import Twilio number into ElevenLabs

ElevenLabs manages Twilio natively, no webhook configuration needed:

1. In ElevenLabs > **Conversational AI** > **Phone Numbers**
2. Click **Import phone number** > **From Twilio**
3. Enter your Twilio phone number, Account SID, and Auth Token
4. Assign your agent to the number
5. Copy the **Phone Number ID**

### 6. Configure environment

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your actual values:

```
BOT_TOKEN=123456:ABC-DEF...          # From BotFather
BOT_SECRET=a-long-random-string      # Generate with: openssl rand -hex 32
FIRECRAWL_API_KEY=fc-...             # From firecrawl.dev
ELEVENLABS_API_KEY=sk_...            # From elevenlabs.io
ELEVENLABS_AGENT_ID=...              # From agent URL
ELEVENLABS_PHONE_NUMBER_ID=...       # From phone number settings
```

### 7. Deploy

```bash
# Set production secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BOT_SECRET
npx wrangler secret put FIRECRAWL_API_KEY
npx wrangler secret put ELEVENLABS_API_KEY
npx wrangler secret put ELEVENLABS_AGENT_ID
npx wrangler secret put ELEVENLABS_PHONE_NUMBER_ID

# Deploy
npm run deploy
```

### 8. Register webhook

```bash
curl -H "Authorization: Bearer YOUR_BOT_SECRET" \
  https://hey-agent.YOUR-SUBDOMAIN.workers.dev/register-webhook
```

## Development

```bash
npm run dev        # Start local dev server
npm run test       # Run tests
npm run cf-typegen # Regenerate types after changing wrangler.jsonc
```

Local development uses `.dev.vars` for environment variables.

## ElevenLabs Agent Prompt

Use this as the system prompt for your ElevenLabs Conversational AI agent:

```
You are a polite and professional phone assistant making a call on behalf of a user.

Your task:
{{task_description}}

You are calling: {{provider_name}}

Guidelines:
- Be concise and natural, like a real person making a phone call
- State the purpose of your call clearly at the beginning
- Collect key information: available dates/times, pricing, address, any requirements
- If asked who you are, say you are an assistant calling on behalf of a client
- Confirm all important details before ending the call (date, time, address, cost)
- If the line is busy, voicemail, or no one answers, end the call politely
- If they ask for a callback number, say your client will call back and thank them
- Speak in the language matching the provider's language, but default to {{user_language}} if unsure
- Keep the conversation focused and don't ramble
- Thank them before hanging up
- If you successfully make an appointment or get the needed information, summarize what was agreed upon before ending

Do NOT:
- Provide personal medical, legal, or financial information about the user
- Agree to costs or commitments above what was requested
- Argue or be confrontational if they can't accommodate the request
```

The dynamic variables (`{{task_description}}`, `{{provider_name}}`, `{{user_language}}`) are filled by the bot at call time based on the user's search and selected provider.

## Project Structure

```
src/
├── index.ts        # Worker entry point: Telegram webhook, routing
├── agent.ts        # TaskAgent Durable Object: message history, tool results, call polling
├── telegram.ts     # Telegram Bot API client
├── firecrawl.ts    # Firecrawl search/scrape client
├── elevenlabs.ts   # ElevenLabs Conversational AI client (outbound calls, transcripts)
└── ai.ts           # Vercel AI SDK: generateText with searchWeb/makeCall tools
```

## Architecture

Each Telegram user gets their own **Durable Object instance** identified by `chat_id`:

- **Isolated state** per user
- **SQLite storage** for messages, search results, and calls
- **Scheduled alarms** for call status polling
- **Horizontal scaling** by design

### AI-driven routing

There is no manual intent parser. Every user message is sent to Kimi K2.5 via the Vercel AI SDK's `generateText` with two tools available: `searchWeb` and `makeCall`. The model decides which tools to call (if any) based on the conversation. It can chain multiple tools in a single turn (up to 5 steps).

### Search flow

The AI calls the `searchWeb` tool. Firecrawl searches the web and returns full page content as markdown. Phone numbers are extracted via regex. Results are stored in SQLite and presented to the user with optional inline call buttons.

### Call flow

The AI calls the `makeCall` tool (either directly from user request or after a search). ElevenLabs voice agent calls via Twilio and handles the conversation. The bot polls for completion every 15 seconds and sends a transcript summary when done.

### State Management

| Storage | What | Why |
|---------|------|-----|
| `messages` table | Conversation history (role + content) | Last 15 messages sent as context to the AI |
| `search_results` table | Search results with extracted contacts | Quick lookup when user taps a call button |
| `calls` table | Active/completed calls with conversation IDs | Status polling, transcript storage |

## Supported Languages

The bot detects the user's language and adapts the entire pipeline: search queries, call scripts, and voice agent language. ElevenLabs supports 70+ languages.

## License

MIT
