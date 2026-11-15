// src/index.ts
import { COMPANION_SYSTEM_PROMPT } from "./prompts";
import {
    getHistory,
    appendHistory,
    type HistoryMessage,
} from "./helpers/history";
import { isReadableName } from "./helpers/names";
import { arrayBufferToBase64 } from "./helpers/base64";

import { Bot, Context, webhookCallback, InputFile } from "grammy";
import OpenAI from "openai";
import { loadState } from "./state";
import { generateDailyTopic, formatDailyMessage } from "./daily";

import type { Env } from "./types";

// Кэш в рамках одного изолята
let botInstance: Bot | null = null;
let botUsername = "";

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
    history?: HistoryMessage[],
    bot?: Bot,
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

            if (bot) {
                await notifyOwner(
                    bot,
                    env,
                    `ai:${p.name}`,
                    String(err?.message ?? err),
                );
            }

            throw err;
        }
    }
    if (bot) {
        await notifyOwner(bot, env, "ai:all", "Все AI-провайдеры недоступны");
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
                "🖼️ *Фото*\n" +
                "• Могу посмотреть фото и описать, что на нём. Но это получается не всегда!\n" +
                "• Если попросишь «опиши фото» — дам развёрнутое описание как на экзамене (5–8 предложений, с деталями и эмоциями).\n" +
                "📅 *Тема и слово дня*\n" +
                "• Каждый день в 9:00 МСК присылаю тему и слово дня.\n" +
                "• /word — показать слово дня.\n" +
                "• /topic — показать тему дня.\n\n" +
                "⚠️ *Ограничения*\n" +
                "• Работаю только в этой группе (в общей теме)!\n" +
                "• Не умею генерировать картинки и видео — только общаюсь.\n" +
                "• Могу забыть контекст беседы.\n" +
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
    bot.on("message:sticker", (ctx) => handleSticker(ctx, env, bot));

    // Видео-стикеры
    bot.on("message:video", async (ctx) => {
        if (ctx.message.video && "sticker" in ctx.message) {
            await handleSticker(ctx, env, bot);
        }
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
                bot,
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
                await notifyOwner(
                    bot,
                    env,
                    "stt:groq",
                    `${groqResponse.status} ${errText}`,
                );
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
                bot,
            );

            if (answer) {
                appendHistory(chatId, "user", transcribedText, userName);
                appendHistory(chatId, "assistant", answer);
                const audioBytes = await textToSpeech(env, answer, bot);
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
            await notifyOwner(bot, env, "voice:processing", String(err));
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
            const description = await askAIWithImage(
                env,
                base64,
                "image/jpeg",
                bot,
            );
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
                bot,
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
            await notifyOwner(bot, env, "photo:processing", String(err));
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
// Error notifications for the owner (with anti-spam)
// ============================================================
const lastErrorNotify = new Map<string, number>(); // key → timestamp
const ERROR_NOTIFY_COOLDOWN = 5 * 60 * 1000; // 5 минут между одинаковыми ошибками

async function notifyOwner(
    bot: Bot,
    env: Env,
    errorKey: string, // например "vision:zai" или "ai:groq"
    errorText: string, // текст ошибки
): Promise<void> {
    if (!env.OWNER_ID) return;

    const now = Date.now();
    const last = lastErrorNotify.get(errorKey) ?? 0;
    if (now - last < ERROR_NOTIFY_COOLDOWN) return; // не спамим
    lastErrorNotify.set(errorKey, now);

    try {
        await bot.api.sendMessage(
            Number(env.OWNER_ID),
            `⚠️ *Ошибка бота*\n\n` +
                `Тип: \`${errorKey}\`\n` +
                `Время: ${new Date().toISOString()}\n\n` +
                `\`\`\`\n${errorText.slice(0, 500)}\n\`\`\``,
            { parse_mode: "Markdown" },
        );
    } catch (err) {
        console.error("[notifyOwner] не удалось отправить:", err);
    }
}

// ============================================================
// TTS: ElevenLabs (George)
// ============================================================
const ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George

async function textToSpeech(
    env: Env,
    text: string,
    bot?: Bot,
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
            if (bot)
                await notifyOwner(
                    bot,
                    env,
                    "tts:elevenlabs",
                    `${response.status} ${err}`,
                );
            return null;
        }

        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    } catch (err) {
        console.error("[TTS] Ошибка:", err);
        return null;
    }
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
    bot?: Bot,
): Promise<string | null> {
    // 1. Z.AI (бесплатно, но нестабильно)
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

    if (bot) {
        await notifyOwner(
            bot,
            env,
            "vision:all",
            "Все vision-провайдеры недоступны",
        );
    }

    console.log("[Vision] Все vision-провайдеры недоступны");
    return null;
}

// ============================================================
// Реакция на стикеры (обычные, анимированные, видео)
// ============================================================
async function handleSticker(ctx: Context, env: Env, bot: Bot) {
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
            bot,
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
            await notifyOwner(bot, env, "cron:daily", String(err));
        }
    },
};
