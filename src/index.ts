// src/index.ts
import "dotenv/config";
import { Bot, Context } from "grammy";
import OpenAI from "openai";
import { loadState } from "./state";
import { generateDailyTopic, formatDailyMessage } from "./daily";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN не задан в .env");
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY не задан в .env");
if (!ALLOWED_CHAT_ID) throw new Error("ALLOWED_CHAT_ID не задан в .env");

// Приводим к числу один раз
const ALLOWED_CHAT_ID_NUM = Number(ALLOWED_CHAT_ID);
if (isNaN(ALLOWED_CHAT_ID_NUM)) {
    throw new Error(
        "ALLOWED_CHAT_ID должен быть числом (например, -1001234567890)",
    );
}

const gemini = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
});

const providers: Array<{ name: string; client: OpenAI; model: string }> = [];

if (GEMINI_API_KEY) {
    providers.push({
        name: "gemini",
        client: new OpenAI({
            apiKey: GEMINI_API_KEY,
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
        }),
        model: "gemini-3.5-flash-lite",
    });
}

if (GROQ_API_KEY) {
    providers.push({
        name: "groq",
        client: new OpenAI({
            apiKey: GROQ_API_KEY,
            baseURL: "https://api.groq.com/openai/v1",
        }),
        model: "openai/gpt-oss-20b",
    });
}

if (providers.length === 0) {
    throw new Error(
        "Ни один AI-провайдер не настроен (нужен GEMINI_API_KEY или GROQ_API_KEY)",
    );
}

const bot = new Bot(BOT_TOKEN);
let BOT_USERNAME = "";

// ============================================================
// Хелпер: проверка, что чат разрешён
// ============================================================
function isAllowedChat(ctx: Context): boolean {
    return ctx.chat?.id === ALLOWED_CHAT_ID_NUM;
}

// ============================================================
// Промпт: «Собеседник»
// ============================================================
const COMPANION_SYSTEM_PROMPT = `Ты — дружелюбный участник многонационального чата взаимного изучения языков.
В чате два предметных языка: ГРЕЧЕСКИЙ и РУССКИЙ.
Кто-то учит греческий, кто-то учит русский. Родной язык у всех разный.

ТВОЯ ЗАДАЧА:
Ответь на сообщение так, как ответил бы живой участник чата. Всегда.

ПРАВИЛА:
1. Определи по сообщению, на каком языке пишет человек и какой язык он, скорее всего, изучает.
   - Пишет по-гречески с ошибками или смешивает с русским или другим → вероятно, учит греческий.
   - Пишет по-русски с ошибками или смешивает с греческим → вероятно, учит русский.
   - Пишет на третьем языке → ответь на этом языке, мягко предложи попробовать греческий или русский.
2. Отвечай на том языке, на котором написал человек (или на смешанном — на греческом/русском/том который использует человек).
3. Если в сообщении есть ошибка в предметном языке — НЕ исправляй прямо, НЕ пиши "правильно так".
   Ответь естественной фразой на этом языке с правильной формой.
4. Если ошибки нет — просто поддержи разговор: вопрос, реакция, комментарий.
5. Если человек явно что-то спросил — ответь на вопрос.
6. Тон дружелюбный, ненавязчивый. Отвечай коротко (1–3 предложения).
7. Не переводи всё подряд — только если человек явно просит или смешал языки.

Верни ТОЛЬКО текст ответа, без пояснений.`;

async function askAI(text: string): Promise<string> {
    for (const p of providers) {
        try {
            const res = await p.client.chat.completions.create({
                model: p.model,
                messages: [
                    { role: "system", content: COMPANION_SYSTEM_PROMPT },
                    { role: "user", content: text },
                ],
                max_tokens: 300,
                temperature: 0.7,
            });
            return res.choices[0]?.message?.content?.trim() ?? "";
        } catch (err: any) {
            // Если лимит или недоступность — пробуем следующего
            if (err?.status === 429 || err?.status === 503) {
                console.warn(
                    `[AI] ${p.name} недоступен (${err.status}), пробую следующего...`,
                );
                continue;
            }
            // Другие ошибки (401, 400) — не имеет смысла пробовать другого
            throw err;
        }
    }
    throw new Error("Все AI-провайдеры недоступны");
}

// ============================================================
// Команды (работают только в разрешённой группе)
// ============================================================
bot.command("start", (ctx) => {
    if (!isAllowedChat(ctx)) return;
    return ctx.reply(
        "Γεια σου! 👋\n\n" +
            "Я — собеседник для практики греческого и русского. Просто общайся в чате.\n" +
            "Напиши мне лично или ответь на моё сообщение — отвечу сразу.\n" +
            "В общем чате — отвечу через 3 секунды, чтобы не перебивать.\n\n" +
            "Команды:\n/help — помощь\n/word — слово дня\n/topic — тема дня",
    );
});

bot.command("help", (ctx) => {
    if (!isAllowedChat(ctx)) return;
    return ctx.reply(
        "Как я работаю:\n\n" +
            "• Отвечаю на сообщения в этой группе.\n" +
            "• Если вижу ошибку — не исправляю прямо, а отвечаю естественной фразой.\n" +
            "• Раз в день присылаю тему и слово дня.\n" +
            "• В личных сообщениях я не работаю — только в этой группе.\n",
    );
});

bot.command("word", async (ctx) => {
    if (!isAllowedChat(ctx)) return;
    const state = await loadState();
    if (!state.currentWord) {
        return ctx.reply("Слово дня ещё не сгенерировано.");
    }
    const w = state.currentWord;
    await ctx.reply(
        `📖 <b>Слово дня:</b> <code>${w.greek}</code>\n\n` +
            `Перевод: <tg-spoiler>${w.translation}</tg-spoiler>\n` +
            `Пример: <tg-spoiler>${w.example}</tg-spoiler>`,
        { parse_mode: "HTML" },
    );
});

bot.command("topic", async (ctx) => {
    if (!isAllowedChat(ctx)) return;
    const state = await loadState();
    if (!state.currentTopic) {
        return ctx.reply("Тема дня ещё не сгенерирована.");
    }
    await ctx.reply(`📌 <b>Тема дня:</b> ${state.currentTopic}`, {
        parse_mode: "HTML",
    });
});

// ============================================================
// Основной обработчик
// ============================================================
const scheduledChats = new Set<number>();

bot.on("message:text", async (ctx) => {
    // 0) Чат не разрешён — выходим молча, ничего не тратим
    if (!isAllowedChat(ctx)) return;

    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    if (ctx.message.from?.is_bot) return;

    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;

    const isMentioned = text.includes(`@${BOT_USERNAME}`);
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

    if (isDirect) {
        try {
            const cleanText = text.replace(`@${BOT_USERNAME}`, "").trim();
            const answer = await askAI(cleanText || text);
            if (answer) {
                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
            }
        } catch (err) {
            console.error("Ошибка при прямом ответе:", err);
        }
        return;
    }

    if (isReplyingToHuman) {
        console.log(`[${chatId}] пропускаю (диалог людей)`);
        return;
    }

    if (scheduledChats.has(chatId)) {
        console.log(`[${chatId}] уже запланирован ответ, пропускаю`);
        return;
    }
    scheduledChats.add(chatId);

    setTimeout(async () => {
        scheduledChats.delete(chatId);
        try {
            const answer = await askAI(text);
            if (!answer) return;
            await ctx.api.sendMessage(chatId, answer, {
                reply_parameters: { message_id: messageId },
            });
            console.log(`[${chatId}] ответил на общий текст`);
        } catch (err) {
            console.error(`[${chatId}] ошибка при ответе на общий текст:`, err);
        }
    }, 3000);
});

// ============================================================
// Ежедневная тема: проверка раз в минуту
// ============================================================
async function dailyCheck() {
    try {
        const state = await loadState();
        const today = new Date().toISOString().slice(0, 10);
        if (state.lastTopicDate === today) return;

        console.log("[daily] Новый день — генерирую тему...");
        const newState = await generateDailyTopic(
            providers[0].client,
            providers[0].model,
            state,
        );

        if (newState.currentTopic) {
            await bot.api.sendMessage(
                ALLOWED_CHAT_ID_NUM,
                formatDailyMessage(newState),
                { parse_mode: "HTML" },
            );
            console.log("[daily] Тема отправлена в чат");
        }
    } catch (err) {
        console.error("[daily] Ошибка:", err);
    }
}

setInterval(dailyCheck, 60_000);

// ============================================================
// Запуск
// ============================================================
bot.catch((err) => console.error("Ошибка в боте:", err));

(async () => {
    await bot.init();
    BOT_USERNAME = bot.botInfo.username;
    console.log(
        `🤖 Бот запущен как @${BOT_USERNAME} (только для чата ${ALLOWED_CHAT_ID_NUM})`,
    );
    await dailyCheck();
    await bot.start();
})();
