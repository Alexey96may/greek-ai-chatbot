# Greek & Russian Language Practice Bot

A Telegram bot for a multilingual community practicing Greek and Russian. The bot acts as a friendly conversation partner — it doesn't correct mistakes directly, but replies with a natural phrasing that uses the correct form. It also generates a daily topic and word of the day.

Deployed on **Cloudflare Workers** with **Workers KV** for storage and **Cron Triggers** for daily tasks.

## Features

- **Conversational AI** — replies like a native speaker would, without saying "you made a mistake".
- **Two target languages** — Greek and Russian. The bot detects which language the user is learning and responds accordingly.
- **Voice messages** — transcribes voice messages via Groq Whisper and replies with voice (ElevenLabs TTS) plus text caption.
- **Photo recognition** — describes photos via Z.AI GLM-4.6V-Flash (fallback to Groq vision). Supports exam-style descriptions when asked ("опиши фото").
- **Sticker reactions** — reacts to stickers (static, animated, video) by their emoji, via AI.
- **Conversation memory** — remembers the last 10 messages per chat (separate for group and owner DM). Stored in memory, lost on isolate restart.
- **Smart silence** — does not interrupt conversations between two people (replies to human messages are ignored).
- **Direct mentions** — replies instantly when mentioned (`@bot`) or when someone replies to the bot's message.
- **Immediate replies** — responds right away to general messages in the group.
- **Daily topic & word** — once a day (via Cron Trigger), generates a discussion topic and a related Greek word with translation and example. Avoids repeating recent topics/words (last 7).
- **Topic voting** — every evening (18:00 MSK), the bot creates a Telegram poll with 4 AI-generated topics for tomorrow. In the morning, the winner becomes the topic of the day. If nobody voted, a random topic is chosen. Owner can toggle via `/poll on|off`.
- **Single-chat mode** — works only in the allowed group's **General** room (topic rooms are ignored).
- **Owner private chat** — the bot also responds in DM to the owner (`OWNER_ID`).
- **AI fallback** — tries Gemini first, falls back to Groq if Gemini is unavailable or rate-limited.
- **Error notifications** — critical errors are sent to the owner via DM (with 5-minute anti-spam cooldown per error type).
- **/start anywhere** — if someone finds the bot outside the group, `/start` replies with a link to the group.

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Language**: TypeScript
- **Bot framework**: [grammY](https://grammy.dev/)
- **AI providers**:
    - [Google Gemini](https://ai.google.dev/) (primary text, free tier)
    - [Groq](https://groq.com/) (text fallback, Whisper STT, vision fallback)
    - [Z.AI](https://z.ai/) (vision primary, GLM-4.6V-Flash, free but unstable)
- **Text-to-Speech**: [ElevenLabs](https://elevenlabs.io/) (voice "George", multilingual v2)
- **Storage**: [Cloudflare Workers KV](https://developers.cloudflare.com/kv/) (state only; history is in-memory)
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
npx wrangler secret put ALLOWED_CHAT_ID
npx wrangler secret put OWNER_ID            # optional (private chat for owner)
npx wrangler secret put GROQ_API_KEY        # optional (fallback + voice transcription)
npx wrangler secret put ELEVENLABS_API_KEY  # optional (voice replies)
npx wrangler secret put ZAI_API_KEY         # optional (vision primary)
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

## How It Works

### Reply logic

| Situation                           | Bot behavior                                                     |
| ----------------------------------- | ---------------------------------------------------------------- |
| Private message from owner          | Replies (text or voice)                                          |
| Private message from anyone else    | Ignored (only `/start` replies with group link)                  |
| `@mention` or reply to bot          | Replies immediately                                              |
| Reply to another human              | Silent (doesn't interrupt)                                       |
| General message in group            | Replies immediately                                              |
| Message in a topic room             | Ignored (works only in General)                                  |
| Voice message                       | Transcribes via Groq Whisper → replies with voice + text caption |
| Photo                               | Describes via Z.AI → replies with AI answer                      |
| Sticker (static / animated / video) | Reacts via AI based on emoji                                     |
| `/start` in non-allowed chat        | Replies with group link                                          |

### Daily topic

A Cron Trigger (`0 6 * * *` — 6:00 UTC / 9:00 MSK) runs `scheduled()` once a day. The bot:

1. Checks if today's topic already exists in KV.
2. If not — asks the AI for a topic and a related Greek word, passing the last 7 topics/words to avoid repeats.
3. Saves both to KV.
4. Sends the formatted message to the allowed chat.

### AI fallback

The bot tries providers in order:

**Text:**

1. **Gemini** (`gemini-3.5-flash-lite`)
2. **Groq** (`openai/gpt-oss-20b`)

**Vision:**

1. **Z.AI** (`glm-4.6v-flash`, 2 retries on `400` / `429`)
2. **Groq** (`qwen/qwen3.8-27b`)

If a provider returns `429` (rate limit), `503` (unavailable), or `401` (invalid key), the next provider is tried.

### Voice replies

1. Groq Whisper (`whisper-large-v3-turbo`) transcribes the voice message.
2. The text is sent to the AI (Gemini / Groq) as usual.
3. The answer is synthesized via ElevenLabs (`eleven_multilingual_v2`, voice "George") in OGG/OPUS format, speed `0.9`.
4. The bot sends the audio with the text as a caption.
5. If ElevenLabs fails or the free tier limit is exhausted, the bot falls back to a plain text reply.

### Conversation memory

- Last **10 messages** per chat, stored in `Map<chatId, messages[]>` (in-memory).
- Separated between the group and the owner's DM.
- **Not persisted** to KV — lost when the Cloudflare isolate restarts.
- Passed to the AI as `messages` array for context.

### Error notifications

Critical errors are sent to `OWNER_ID` via DM:

- All AI providers down
- All vision providers down
- TTS failure
- STT failure
- Voice / photo processing errors
- Cron errors

Each error type has a **5-minute cooldown** to prevent spam. Transient errors (`429` / `503`) are not notified — they're expected behavior with fallback.
