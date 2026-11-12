# Greek & Russian Language Practice Bot

A Telegram bot for a multilingual community practicing Greek and Russian. The bot acts as a friendly conversation partner — it doesn't correct mistakes directly, but replies with a natural phrasing that uses the correct form. It also generates a daily topic and word of the day.

## Features

- **Conversational AI** — replies like a native speaker would, without saying "you made a mistake".
- **Two target languages** — Greek and Russian. The bot detects which language the user is learning and responds accordingly.
- **Smart silence** — does not interrupt conversations between two people (replies to human messages are ignored).
- **Direct mentions** — replies instantly when mentioned (`@bot`) or when someone replies to the bot's message.
- **Delayed group replies** — in group chats, waits 3 seconds before replying to general messages, to avoid looking like a spam bot.
- **Daily topic & word** — once a day, generates a discussion topic and a related Greek word with translation and example.
- **Single-chat mode** — works only in one allowed chat to save API tokens.
- **AI fallback** — tries Gemini first, falls back to Groq if Gemini is unavailable or rate-limited.

## Tech Stack

- **Runtime**: Node.js (>= 22)
- **Language**: TypeScript
- **Bot framework**: [grammY](https://grammy.dev/)
- **AI providers**:
    - [Google Gemini](https://ai.google.dev/) (primary, free tier)
    - [Groq](https://groq.com/) (fallback, free tier)
- **Storage**: local JSON file (`data/state.json`)
- **Dev runner**: `tsx` (runs TypeScript without build step)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/greek-practice-bot.git
cd greek-practice-bot
npm install
```

### 2. Create .env

- BOT_TOKEN=123456:ABC...
- GEMINI_API_KEY=...
- GROQ_API_KEY=... # optional, used as fallback
- ALLOWED_CHAT_ID=-100... # your group's chat ID

### 3. Get the credentials

- BOT_TOKEN — from @BotFather: /newbot or /mybots.
- GEMINI_API_KEY — from Google AI Studio. Restrict the key to Gemini API.
- GROQ_API_KEY — from Groq Console (optional).
- ALLOWED_CHAT_ID — send a message to the bot in the group, read chat_id from the logs.

### 4. Configure the bot in BotFather

- Open @BotFather → /mybots → your bot.
- Bot Settings → Group Privacy → Turn off.
- Remove the bot from the group and add it again (required for the setting to apply).

### 5. Run

```bash
npm run dev
```
