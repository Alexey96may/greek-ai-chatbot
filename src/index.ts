// src/index.ts
import { Bot, Context, webhookCallback } from "grammy";
import OpenAI from "openai";
import { loadState } from "./state";
import { generateDailyTopic, formatDailyMessage } from "./daily";
import type { Env } from "./types";

// Кэш в рамках одного изолята
let botInstance: Bot | null = null;
let botUsername = "";

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

    for (const p of providers) {
        try {
            const userContent = context
                ? `[Предыдущее сообщение, на которое отвечает пользователь]: "${context}"\n\n[Новое сообщение пользователя]: ${text}`
                : text;

            const res = await p.client.chat.completions.create({
                model: p.model,
                messages: [
                    { role: "system", content: COMPANION_SYSTEM_PROMPT },
                    { role: "user", content: userContent },
                ],
                max_tokens: 300,
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

function setupHandlers(bot: Bot, env: Env) {
    bot.command("start", (ctx) => {
        if (!isAllowedChat(ctx, env)) return;
        return ctx.reply(
            "Γεια σου! 👋\n\n" +
                "Я — собеседник для практики греческого и русского. Просто общайся в чате.\n" +
                "Команды:\n/help — помощь\n/word — слово дня\n/topic — тема дня",
        );
    });

    bot.command("help", (ctx) => {
        if (!isAllowedChat(ctx, env)) return;
        return ctx.reply(
            "Как я работаю:\n" +
                "• Отвечаю на сообщения в этой группе.\n" +
                "• Если вижу ошибку — не исправляю прямо, а отвечаю естественной фразой.\n" +
                "• Раз в день присылаю тему и слово дня.",
        );
    });

    bot.command("word", async (ctx) => {
        if (!isAllowedChat(ctx, env)) return;
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
        if (!isAllowedChat(ctx, env)) return;
        const state = await loadState(env);
        if (!state.currentTopic)
            return ctx.reply("Тема дня ещё не сгенерирована.");
        await ctx.reply(`📌 <b>Тема дня:</b> ${state.currentTopic}`, {
            parse_mode: "HTML",
        });
    });

    bot.on("message:text", async (ctx) => {
        if (!isAllowedChat(ctx, env)) return;

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

            const answer = await askAI(env, cleanText, contextText);
            if (answer) {
                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
                console.log(`[${chatId}] ответил`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка при ответе:`, err);
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
    botUsername = bot.botInfo.username;
    setupHandlers(bot, env);
    botInstance = bot;

    console.log(`🤖 Бот инициализирован как @${botUsername}`);
    return bot;
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
