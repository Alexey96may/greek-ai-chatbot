// src/index.ts
import { Bot, webhookCallback } from "grammy";
import OpenAI from "openai";
import type { Env } from "./types";
import { isAllowedContext } from "./helpers/context";
import { notifyOwner } from "./helpers/notify";
import { loadState } from "./state";
import { generateDailyTopic, formatDailyMessage } from "./daily";
import { setupHandlers } from "./bot/handlers";

let botInstance: Bot | null = null;
let botUsername = "";

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
    setupHandlers(bot, env, botUsername);
    botInstance = bot;

    console.log(`🤖 Бот инициализирован как @${botUsername}`);
    return bot;
}

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
