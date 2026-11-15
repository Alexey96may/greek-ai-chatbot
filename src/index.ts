// src/index.ts
import { Bot, Context, webhookCallback, InputFile } from "grammy";
import OpenAI from "openai";
import { loadState } from "./state";
import { generateDailyTopic, formatDailyMessage } from "./daily";

import type { Env } from "./types";

// Кэш в рамках одного изолята
let botInstance: Bot | null = null;
let botUsername = "";

const historyMap = new Map<
    number,
    Array<{ role: "user" | "assistant"; name?: string; text: string }>
>();
const MAX_HISTORY = 10;

function getHistory(chatId: number) {
    return historyMap.get(chatId) ?? [];
}

function appendHistory(
    chatId: number,
    role: "user" | "assistant",
    text: string,
    name?: string,
) {
    let history = historyMap.get(chatId) ?? [];
    history.push({ role, text, name });
    if (history.length > MAX_HISTORY) {
        history = history.slice(-MAX_HISTORY);
    }
    historyMap.set(chatId, history);
}

// ============================================================
// Промпт: «Собеседник»
// ============================================================
const COMPANION_SYSTEM_PROMPT = `Ты — дружелюбный участник многонационального чата взаимного изучения языков.
В чате два предметных языка: ГРЕЧЕСКИЙ и РУССКИЙ.
Кто-то учит греческий, кто-то учит русский. Родной язык у всех разный.

ТВОЯ ЗАДАЧА:
Ответь на сообщение так, как ответил бы живой участник чата в ongoing беседе. Всегда.

ГЛАВНОЕ ПРАВИЛО:
Ты НЕ учитель и НЕ корректор. Ты НЕ комментируешь фразы пользователя.
Никогда не пиши "так правильнее", "так звучит естественнее", "вот так будет по-гречески",
"лучше сказать", "правильная форма" и любые похожие метакомментарии.
Просто ОТВЕТЬ по существу, используя естественную форму. Если в сообщении была ошибка —
твой ответ сам по себе покажет правильную форму, без явного указания на ошибку.

ПРАВИЛА:
1. НЕ ЗДОРОВАЙСЯ, если человек сам не поздоровался первым.
2. Определи, на каком языке пишет человек и какой язык он изучает.
   - Пишет по-гречески с ошибками или смешивает с русским → вероятно, учит греческий.
   - Пишет по-русски с ошибками или смешивает с греческим → вероятно, учит русский.
   - Пишет на третьем языке → ответь на этом языке, мягко предложи попробовать греческий или русский.
3. Отвечай на том языке, на котором написал человек (или на смешанном).
4. Если в сообщении есть ошибка — просто ответь естественной фразой, которая использует
   правильную форму, и продолжи разговор вопросом или комментарием.
   НЕ объясняй, что было не так. НЕ показывай "правильный вариант" отдельно.
5. Если ошибки нет — просто поддержи разговор: вопрос, реакция, комментарий.
6. Если человек явно что-то спросил — ответь на вопрос.
7. Тон дружелюбный, ненавязчивый. Отвечай коротко (1–3 предложения).
8. Не переводи всё подряд — только если человек явно просит или смешал языки.
9. Если пользователь просит сгенерировать изображение, видео или другой медиафайл — 
ответь коротко, что ты не умеешь этого делать, и предложи продолжить беседу.
10. Если в сообщении есть [Тема дня в чате: ...] — можешь мягко поддерживать беседу
в этом направлении, если это уместно. Не навязывай тему, но если человек
сам её касается — подхвати.
11. Если есть [Слово дня: ...] — можешь использовать его в ответе, если это звучит
естественно. Не вставляй его насильно.
12. Если в system-промпте указано "Сейчас с тобой говорит: Имя" — используй это имя
в ответе, если это звучит естественно (например, при приветствии, вопросе или
эмоциональной реакции). Не вставляй имя в каждый ответ, но и не игнорируй его
полностью — хотя бы иногда обращайся по имени.
13. Если в сообщении есть [Пользователь отправил стикер с эмодзи: ...] —
ответь так, как ответил бы живой человек на этот стикер. Учитывай эмодзи
(😂 — смех, 😢 — грусть, ❤️ — любовь и т.д.). Можешь пошутить, поддержать,
спросить, что случилось. Не описывай стикер словами — просто реагируй.
Если уместно — мягко свяжи реакцию с темой дня или словом дня.
Не навязывай связь насильно — только если это звучит естественно.
14. Если в сообщении есть [Подпись пользователя к фото] и/или [Описание фото от vision-модели]:
   - Если пользователь просит описать фото ("опиши фото", "describe the photo",
     "περιγράψτε τη φωτογραφία", "что на фото") — дай РАЗВЁРНУТОЕ описание
     в формате экзаменационного ответа (как на устной части языкового экзамена, можно ненавязчиво использовать тему или слово дня).
     Структура:
     1) Введение: что это за фото в целом (жанр, место, время суток/года, атмосфера).
     2) Детали: кто/что изображено, что делает, во что одет, цвета, расположение объектов.
     3) Эмоции и настроение: какие чувства вызывает фото, какая атмосфера.
     4) Предположения: почему это происходит, что могло быть до/после, что за история.
     5) Личное мнение: нравится ли тебе это фото и почему.
     6) Можно добавить вопрос по фото для остальных участников, чтобы вовлечь их.
     Объём — 5–8 предложений. Можно с эмоциями и живыми деталями.
     Отвечай на языке пользователя (или на греческом, если просит по-гречески).
   - Если пользователь НЕ просит описать, а просто отправил фото — можешь
     отреагировать коротко и эмоционально, как живой человек.

ПРИМЕРЫ ТОГО, ЧЕГО НЕЛЬЗЯ ДЕЛАТЬ:
- НЕ пиши "так правильнее", "так звучит естественнее", "вот так будет по-гречески".
- НЕ показывай "правильный вариант" отдельной строкой.
- НЕ объясняй, что было не так в сообщении.
- НЕ здоровайся, если человек не поздоровался первым.

Верни ТОЛЬКО текст ответа, без пояснений.`;

// ============================================================
// AI: Gemini + fallback на Groq
// ============================================================
async function askAI(
    env: Env,
    text: string,
    context?: string,
    userName?: string,
    topic?: string | null,
    word?: string | null,
    history?: Array<{
        role: "user" | "assistant";
        name?: string;
        text: string;
    }>,
): Promise<string> {
    const providers: Array<{ name: string; client: OpenAI; model: string }> =
        [];

    if (env.GEMINI_API_KEY) {
        providers.push({
            name: "gemini",
            client: new OpenAI({
                apiKey: env.GEMINI_API_KEY,
                baseURL:
                    "https://generativelanguage.googleapis.com/v1beta/openai/",
            }),
            model: "gemini-3.5-flash-lite",
        });
    }

    if (env.GROQ_API_KEY) {
        providers.push({
            name: "groq",
            client: new OpenAI({
                apiKey: env.GROQ_API_KEY,
                baseURL: "https://api.groq.com/openai/v1",
            }),
            model: "openai/gpt-oss-20b",
        });
    }

    if (providers.length === 0) throw new Error("Нет AI-провайдеров");

    const systemPrompt = userName
        ? `${COMPANION_SYSTEM_PROMPT}\n\nСейчас с тобой говорит: ${userName}.`
        : COMPANION_SYSTEM_PROMPT;

    for (const p of providers) {
        try {
            const messages: Array<{
                role: "system" | "user" | "assistant";
                content: string;
            }> = [{ role: "system", content: systemPrompt }];

            if (history && history.length > 0) {
                for (const msg of history) {
                    messages.push({
                        role: msg.role,
                        content: msg.name
                            ? `${msg.name}: ${msg.text}`
                            : msg.text,
                    });
                }
            }

            const parts: string[] = [];
            if (topic) parts.push(`[Тема дня в чате: ${topic}]`);
            if (word) parts.push(`[Слово дня: ${word}]`);
            if (context) parts.push(`[Предыдущее сообщение]: "${context}"`);
            parts.push(`[Сообщение]: ${text}`);
            messages.push({ role: "user", content: parts.join("\n") });
            const userContent = parts.join("\n");

            const res = await p.client.chat.completions.create({
                model: p.model,
                messages,
                max_tokens: 500,
                temperature: 0.7,
            });
            return res.choices[0]?.message?.content?.trim() ?? "";
        } catch (err: any) {
            if (
                err?.status === 429 ||
                err?.status === 503 ||
                err?.status === 401
            ) {
                console.warn(
                    `[AI] ${p.name} недоступен (${err.status}), пробую следующего...`,
                );
                continue;
            }
            throw err;
        }
    }
    throw new Error("Все AI-провайдеры недоступны");
}

// ============================================================
// Настройка бота и обработчиков
// ============================================================
function isAllowedChat(ctx: Context, env: Env): boolean {
    return ctx.chat?.id === Number(env.ALLOWED_CHAT_ID);
}

function isOwnerPrivate(ctx: Context, env: Env): boolean {
    return (
        ctx.chat?.type === "private" &&
        Boolean(env.OWNER_ID) &&
        ctx.chat.id === Number(env.OWNER_ID)
    );
}

function isAllowedContext(ctx: Context, env: Env): boolean {
    return isAllowedChat(ctx, env) || isOwnerPrivate(ctx, env);
}

function setupHandlers(bot: Bot, env: Env) {
    bot.command("start", (ctx) => {
        if (isAllowedContext(ctx, env)) {
            return ctx.reply(
                "Γεια σου! 👋\n\n" +
                    "Я — собеседник для практики греческого и русского. Просто общайся в чате.\n" +
                    "Команды:\n/help — помощь\n/word — слово дня\n/topic — тема дня",
            );
        }

        return ctx.reply(
            "Γεια σου! 👋\n\n" +
                "Я работаю только в одной группе — там, где практикуют греческий и русский.\n\n" +
                "Вот ссылка: https://t.me/elenikaglossa\n\n" +
                "Зайди туда — и я с радостью пообщаюсь с тобой! 🇬🇷🇷🇺",
        );
    });

    bot.command("help", (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        return ctx.reply(
            "Как я работаю:\n\n" +
                "📝 *Текст*\n" +
                "• Отвечаю на сообщения в этой группе.\n" +
                "• Если вижу ошибку — не исправляю прямо, а отвечаю естественной фразой.\n" +
                "• В диалогах двух людей не вмешиваюсь.\n\n" +
                "🎤 *Голос*\n" +
                "• Отправь голосовое — распознаю речь и отвечу голосом + текстом.\n" +
                "• Голосовые ответы ограничены лимитом (~90 в месяц).\n" +
                "• Когда лимит кончается — отвечаю только текстом.\n\n" +
                "📅 *Тема и слово дня*\n" +
                "• Каждый день в 9:00 МСК присылаю тему и слово дня.\n" +
                "• /word — показать слово дня.\n" +
                "• /topic — показать тему дня.\n\n" +
                "⚠️ *Ограничения*\n" +
                "• Работаю только в этой группе!\n" +
                "• Не умею генерировать картинки и видео — только общаюсь.\n" +
                "• Отвечаю коротко (1–3 предложения), чтобы не засорять чат.",
            { parse_mode: "Markdown" },
        );
    });

    bot.command("word", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        const state = await loadState(env);
        if (!state.currentWord)
            return ctx.reply("Слово дня ещё не сгенерировано.");
        const w = state.currentWord;
        await ctx.reply(
            `📖 <b>Слово дня:</b> <code>${w.greek}</code>\n\n` +
                `Перевод: <tg-spoiler>${w.translation}</tg-spoiler>\n` +
                `Пример: <tg-spoiler>${w.example}</tg-spoiler>`,
            { parse_mode: "HTML" },
        );
    });

    bot.command("topic", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        const state = await loadState(env);
        if (!state.currentTopic)
            return ctx.reply("Тема дня ещё не сгенерирована.");
        await ctx.reply(`📌 <b>Тема дня:</b> ${state.currentTopic}`, {
            parse_mode: "HTML",
        });
    });

    // ============================================================
    // Реакция на стикеры
    // ============================================================
    // Обычные стикеры
    bot.on("message:sticker", (ctx) => handleSticker(ctx, env));

    // Видео-стикеры
    bot.on("message:video", async (ctx) => {
        if (ctx.message.video && "sticker" in ctx.message) {
            await handleSticker(ctx, env);
        }
    });

    // Анимированные стикеры (.tgs)
    bot.on("message:animation", async (ctx) => {
        // У animation нет emoji, но если это стикер — он придёт как message:sticker
        // Здесь можно обрабатывать GIF, но для стикеров это не нужно
    });

    bot.on("message:text", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;

        const text = ctx.message.text;
        if (text.startsWith("/")) return;
        if (ctx.message.from?.is_bot) return;

        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;

        const isMentioned = text.includes(`@${botUsername}`);
        const isReplyToBot =
            ctx.message.reply_to_message?.from?.id === bot.botInfo.id;
        const isDirect = isMentioned || isReplyToBot;

        const isReplyingToHuman =
            !isReplyToBot &&
            Boolean(ctx.message.reply_to_message) &&
            !ctx.message.reply_to_message?.from?.is_bot &&
            ctx.message.reply_to_message?.from?.id !== ctx.message.from?.id;

        console.log(
            `[${chatId}] ${ctx.message.from?.first_name}: ${text} (direct=${isDirect}, dialog=${isReplyingToHuman})`,
        );

        // Диалог двух людей — не мешаем
        if (isReplyingToHuman) {
            console.log(`[${chatId}] пропускаю (диалог людей)`);
            return;
        }

        // Отвечаем сразу — и на прямое обращение, и на общий текст
        try {
            const cleanText = isDirect
                ? text.replace(`@${botUsername}`, "").trim() || text
                : text;

            const contextText = ctx.message.reply_to_message?.text;
            const state = await loadState(env);
            const rawName = ctx.message.from?.first_name;
            const userName = isReadableName(rawName) ? rawName : undefined;
            const history = getHistory(chatId);

            const answer = await askAI(
                env,
                cleanText,
                contextText,
                userName,
                state.currentTopic,
                state.currentWord?.greek,
                history,
            );

            if (answer) {
                appendHistory(chatId, "user", cleanText, userName);
                appendHistory(chatId, "assistant", answer);
                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
                console.log(`[${chatId}] ответил`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка при ответе:`, err);
        }
    });

    // Добавь этот обработчик в setupHandlers
    bot.on("message:voice", async (ctx) => {
        // 1. Проверяем чат и наличие ключа Groq
        if (!isAllowedContext(ctx, env)) return;

        if (ctx.message.from?.is_bot) return;

        // ГЛАВНОЕ УСЛОВИЕ: если нет ключа Groq — молчим, не падаем
        if (!env.GROQ_API_KEY) {
            console.log(
                `[${ctx.chat.id}] голосовое получено, но GROQ_API_KEY не настроен`,
            );
            return;
        }

        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;

        try {
            // 2. Получаем файл из Telegram
            const file = await ctx.api.getFile(ctx.message.voice.file_id);
            if (!file.file_path) {
                throw new Error("Не удалось получить путь к файлу");
            }

            // 3. Скачиваем файл
            const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
            const audioResponse = await fetch(fileUrl);
            const audioBlob = await audioResponse.blob();

            // 4. Отправляем в Groq Whisper
            const formData = new FormData();
            formData.append("file", audioBlob, "voice.ogg");
            formData.append("model", "whisper-large-v3-turbo");
            // Можно указать язык, если хочешь принудительно, но лучше дать модели определить
            // formData.append("language", "el"); // или "ru"

            const groqResponse = await fetch(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${env.GROQ_API_KEY}`,
                    },
                    body: formData,
                },
            );

            if (!groqResponse.ok) {
                const errText = await groqResponse.text();
                throw new Error(
                    `Groq API error: ${groqResponse.status} ${errText}`,
                );
            }

            const transcription = (await groqResponse.json()) as {
                text?: string;
            };
            const transcribedText = transcription.text?.trim();

            if (!transcribedText) {
                console.log(`[${chatId}] не удалось распознать речь`);
                return;
            }

            console.log(`[${chatId}] распознано: ${transcribedText}`);

            // 5. Передаём текст в твой существующий AI для ответа
            const state = await loadState(env);

            const rawName = ctx.message.from?.first_name;
            const userName = isReadableName(rawName) ? rawName : undefined;
            const history = getHistory(chatId);

            const answer = await askAI(
                env,
                transcribedText,
                undefined, // context (no reply)
                userName,
                state.currentTopic,
                state.currentWord?.greek,
                history,
            );

            if (answer) {
                appendHistory(chatId, "user", transcribedText, userName);
                appendHistory(chatId, "assistant", answer);
                const audioBytes = await textToSpeech(env, answer);
                if (audioBytes) {
                    try {
                        const caption =
                            answer.length > 1000
                                ? answer.slice(0, 997) + "..."
                                : answer;
                        await ctx.replyWithVoice(
                            new InputFile(audioBytes, "reply.ogg"),
                            {
                                caption,
                                reply_parameters: { message_id: messageId },
                            },
                        );
                        console.log(`[${chatId}] ответил голосом + текст`);
                        return;
                    } catch (ttsErr) {
                        console.error(
                            `[${chatId}] не удалось отправить голосовое:`,
                            ttsErr,
                        );
                    }
                }

                // Fallback — текстом (или для группы)
                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
                console.log(`[${chatId}] ответил на голосовое (текстом)`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка обработки голосового:`, err);
            // Не отвечаем пользователю с ошибкой, просто логируем
        }
    });

    bot.on("message:photo", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        if (ctx.message.from?.is_bot) return;

        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        const caption = ctx.message.caption?.trim() ?? "";

        console.log(`[${chatId}] ФОТО ПОЛУЧЕНО, caption="${caption}"`);

        try {
            const photos = ctx.message.photo;
            const bestPhoto = photos[photos.length - 1];

            const file = await ctx.api.getFile(bestPhoto.file_id);
            if (!file.file_path) throw new Error("Нет file_path");

            const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
            const imgRes = await fetch(fileUrl);
            const arrayBuffer = await imgRes.arrayBuffer();
            const base64 = arrayBufferToBase64(arrayBuffer);

            console.log(`[${chatId}] спрашиваю Z.AI...`);
            const description = await askAIWithImage(env, base64, "image/jpeg");
            if (!description) {
                console.log(`[${chatId}] Z.AI не смог описать фото`);
                return;
            }
            console.log(`[${chatId}] Z.AI описал: ${description}`);

            const state = await loadState(env);
            const rawName = ctx.message.from?.first_name;
            const userName = isReadableName(rawName) ? rawName : undefined;

            // Если есть подпись — передаём её вместе с описанием
            const userText = caption
                ? `[Подпись пользователя к фото]: "${caption}"\n[Описание фото]: "${description}"`
                : `[Пользователь отправил фото. Описание: "${description}"]`;

            const history = getHistory(chatId);

            const answer = await askAI(
                env,
                userText,
                undefined,
                userName,
                state.currentTopic,
                state.currentWord?.greek,
                history,
            );

            if (answer) {
                appendHistory(chatId, "user", userText, userName);
                appendHistory(chatId, "assistant", answer);
                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
                console.log(`[${chatId}] ответил на фото`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка обработки фото:`, err);
        }
    });
}

// ============================================================
// Инициализация бота (один раз на изолят)
// ============================================================
async function getBot(env: Env): Promise<Bot> {
    if (botInstance) return botInstance;

    const bot = new Bot(env.BOT_TOKEN);
    await bot.init();

    bot.use(async (ctx, next) => {
        if (ctx.message?.text?.startsWith("/start")) {
            await next();
            return;
        }

        if (!isAllowedContext(ctx, env)) return;

        // Автоматические ответы — только в General
        if (ctx.message?.message_thread_id !== undefined) return;

        await next();
    });

    botUsername = bot.botInfo.username;
    setupHandlers(bot, env);
    botInstance = bot;

    console.log(`🤖 Бот инициализирован как @${botUsername}`);
    return bot;
}

// ============================================================
// TTS: ElevenLabs (George)
// ============================================================
const ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George

async function textToSpeech(
    env: Env,
    text: string,
): Promise<Uint8Array | null> {
    if (!env.ELEVENLABS_API_KEY) {
        console.log("[TTS] ELEVENLABS_API_KEY не настроен");
        return null;
    }

    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=opus_48000_64`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": env.ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        speed: 0.9,
                    },
                }),
            },
        );

        if (!response.ok) {
            const err = await response.text();
            console.error(`[TTS] ElevenLabs error: ${response.status} ${err}`);
            return null;
        }

        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    } catch (err) {
        console.error("[TTS] Ошибка:", err);
        return null;
    }
}

function isReadableName(name?: string): boolean {
    if (!name) return false;
    // Только буквы (любой алфавит), пробелы и дефисы. Минимум 2 символа.
    return /^[\p{L}\s-]{2,30}$/u.test(name);
}

// ============================================================
// Vision: Z.AI (primary, free but unstable)
// ============================================================
async function tryZAI(
    env: Env,
    imageBase64: string,
    mimeType: string = "image/jpeg",
    retries = 2,
): Promise<string | null> {
    if (!env.ZAI_API_KEY) {
        console.log("[Vision] ZAI_API_KEY не настроен");
        return null;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const client = new OpenAI({
                apiKey: env.ZAI_API_KEY,
                baseURL: "https://api.z.ai/api/paas/v4",
            });

            const res = await client.chat.completions.create({
                model: "glm-4.6v-flash",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Describe what is in this image in 1-2 short sentences. Be natural and friendly. Respond in English.",
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimeType};base64,${imageBase64}`,
                                },
                            },
                        ],
                    },
                ],
                max_tokens: 200,
            });

            return res.choices[0]?.message?.content?.trim() ?? null;
        } catch (err: any) {
            const status = err?.status;
            console.log(
                `[Vision] Z.AI attempt ${attempt + 1} failed: ${status}`,
            );
            if ((status === 400 || status === 429) && attempt < retries) {
                await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
                continue;
            }
            console.error("[Vision] Z.AI final error:", err);
            return null;
        }
    }
    return null;
}

// ============================================================
// Vision: Groq (fallback, stable but uses tokens)
// ============================================================
async function tryGroqVision(
    env: Env,
    imageBase64: string,
    mimeType: string = "image/jpeg",
): Promise<string | null> {
    if (!env.GROQ_API_KEY) {
        console.log("[Vision] GROQ_API_KEY не настроен");
        return null;
    }

    try {
        const client = new OpenAI({
            apiKey: env.GROQ_API_KEY,
            baseURL: "https://api.groq.com/openai/v1",
        });

        const res = await client.chat.completions.create({
            model: "qwen/qwen3.8-27b",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Describe what is in this image in 1-2 short sentences. Be natural and friendly. Respond in English.",
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${mimeType};base64,${imageBase64}`,
                            },
                        },
                    ],
                },
            ],
            max_tokens: 200,
        });

        return res.choices[0]?.message?.content?.trim() ?? null;
    } catch (err) {
        console.error("[Vision] Groq error:", err);
        return null;
    }
}

// ============================================================
// Vision: fallback wrapper (Z.AI → Groq)
// ============================================================
async function askAIWithImage(
    env: Env,
    imageBase64: string,
    mimeType: string = "image/jpeg",
): Promise<string | null> {
    // 1. Пробуем Z.AI (бесплатно, но нестабильно)
    if (env.ZAI_API_KEY) {
        console.log("[Vision] Пробую Z.AI...");
        const zaiResult = await tryZAI(env, imageBase64, mimeType);
        if (zaiResult) {
            console.log("[Vision] Z.AI ответил");
            return zaiResult;
        }
        console.log("[Vision] Z.AI не сработал, переключаюсь на Groq...");
    }

    // 2. Fallback на Groq (стабильно, но тратит лимит)
    if (env.GROQ_API_KEY) {
        console.log("[Vision] Пробую Groq...");
        const groqResult = await tryGroqVision(env, imageBase64, mimeType);
        if (groqResult) {
            console.log("[Vision] Groq ответил");
            return groqResult;
        }
    }

    console.log("[Vision] Все vision-провайдеры недоступны");
    return null;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

// ============================================================
// Реакция на стикеры (обычные, анимированные, видео)
// ============================================================
async function handleSticker(ctx: Context, env: Env) {
    if (!isAllowedContext(ctx, env)) return;
    if (ctx.message?.from?.is_bot) return;

    const sticker = ctx.message?.sticker;
    if (!sticker) return;

    const emoji = sticker.emoji ?? "🙂"; // fallback, если эмодзи нет
    const chatId = ctx.chat!.id;
    const messageId = ctx.message!.message_id;

    try {
        const state = await loadState(env);
        const rawName = ctx.message?.from?.first_name;
        const userName = isReadableName(rawName) ? rawName : undefined;

        const stickerText = `[Пользователь отправил стикер с эмодзи: ${emoji}]`;

        const history = getHistory(chatId);

        const answer = await askAI(
            env,
            stickerText,
            undefined,
            userName,
            state.currentTopic,
            state.currentWord?.greek,
            history,
        );

        if (answer) {
            appendHistory(chatId, "user", stickerText, userName);
            appendHistory(chatId, "assistant", answer);
            await ctx.reply(answer, {
                reply_parameters: { message_id: messageId },
            });
            console.log(`[${chatId}] ответил на стикер ${emoji}`);
        }
    } catch (err) {
        console.error(`[${chatId}] ошибка при ответе на стикер:`, err);
    }
}

// ============================================================
// Экспорт для Cloudflare Workers
// ============================================================
export default {
    async fetch(
        request: Request,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<Response> {
        const bot = await getBot(env);
        const handler = webhookCallback(bot, "cloudflare-mod");
        return await handler(request);
    },

    async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log("[cron] Запуск ежедневной проверки...");
        const bot = await getBot(env);

        try {
            const state = await loadState(env);
            const today = new Date().toISOString().slice(0, 10);
            if (state.lastTopicDate === today) {
                console.log("[cron] Тема уже сгенерирована на сегодня");
                return;
            }

            // Выбираем первого доступного провайдера
            const client = env.GEMINI_API_KEY
                ? new OpenAI({
                      apiKey: env.GEMINI_API_KEY,
                      baseURL:
                          "https://generativelanguage.googleapis.com/v1beta/openai/",
                  })
                : new OpenAI({
                      apiKey: env.GROQ_API_KEY!,
                      baseURL: "https://api.groq.com/openai/v1",
                  });
            const model = env.GEMINI_API_KEY
                ? "gemini-3.5-flash-lite"
                : "openai/gpt-oss-20b";

            const newState = await generateDailyTopic(
                client,
                model,
                env,
                state,
            );

            if (newState.currentTopic) {
                await bot.api.sendMessage(
                    Number(env.ALLOWED_CHAT_ID),
                    formatDailyMessage(newState),
                    { parse_mode: "HTML" },
                );
                console.log("[cron] Тема отправлена в чат");
            }
        } catch (err) {
            console.error("[cron] Ошибка:", err);
        }
    },
};
