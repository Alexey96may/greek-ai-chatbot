# Greek & Russian Language Practice Bot

A Telegram bot for a multilingual community practicing Greek and Russian. The bot acts as a friendly conversation partner — it doesn't correct mistakes directly, but replies with a natural phrasing that uses the correct form. It also generates a daily topic and word of the day.

Deployed on **Cloudflare Workers** with **Workers KV** for storage and **Cron Triggers** for daily tasks.

## Features

- **Conversational AI** — replies like a native speaker would, without saying "you made a mistake".
- **Two target languages** — Greek and Russian. The bot detects which language the user is learning and responds accordingly.
- **Smart silence** — does not interrupt conversations between two people (replies to human messages are ignored).
- **Direct mentions** — replies instantly when mentioned (`@bot`) or when someone replies to the bot's message.
- **Immediate replies** — responds right away to general messages in the group.
- **Daily topic & word** — once a day (via Cron Trigger), generates a discussion topic and a related Greek word with translation and example.
- **Single-chat mode** — works only in one allowed chat to save API tokens.
- **AI fallback** — tries Gemini first, falls back to Groq if Gemini is unavailable or rate-limited.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Bot framework**: [grammY](https://grammy.dev/)
- **AI providers**:
    - [Google Gemini](https://ai.google.dev/) (primary, free tier)
    - [Groq](https://groq.com/) (fallback, free tier)
- **Storage**: [Cloudflare Workers KV](https://developers.cloudflare.com/kv/)
- **Scheduling**: [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- **Deploy tool**: [Wrangler](https://developers.cloudflare.com/workers/wrangler/)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Alexey96may/greek-ai-chatbot.git
cd greek-ai-chatbot
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create KV namespace

- In the Cloudflare dashboard, go to Workers KV → Create namespace, name it GREEK_KV, copy the ID.
- Or via CLI:

```bash
npx wrangler kv namespace create GREEK_KV
```

- Paste the ID into wrangler.toml:

```bash
[[kv_namespaces]]
binding = "GREEK_KV"
id = "YOUR_KV_ID"
```

### 4. Add secrets

```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY # optional
npx wrangler secret put ALLOWED_CHAT_ID
```

### 5. Configure the bot in BotFather

- Open @BotFather → /mybots → your bot.
- Bot Settings → Group Privacy → Turn off.
- Remove the bot from the group and add it again (required for the setting to apply).

### 6. Deploy

```bash
npm run deploy
```

### 7. Set the webhook

Open in browser (replace <BOT_TOKEN> and <URL>):

```bash
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<URL>
```

Expected response: {"ok":true,"result":true,"description":"Webhook was set"}.
