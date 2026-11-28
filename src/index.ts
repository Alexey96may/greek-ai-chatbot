import { Bot, webhookCallback } from "grammy";
import { createEveningPoll, withAIFallback } from "./poll";
import type { Env } from "./types";
import { isAllowedContext } from "./helpers/context";
import { notifyOwner } from "./helpers/notify";
import { loadState, saveState } from "./state";
import {
    generateDailyTopic,
    generatePollTopics,
    generateWordForTopic,
    formatDailyMessage,
} from "./daily";
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

        // General
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
        if (request.method !== "POST") {
            return new Response("Bot is running", { status: 200 });
        }

        const bot = await getBot(env);
        const handler = webhookCallback(bot, "cloudflare-mod");

        return await handler(request);
    },

    async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log("[cron] START", {
            cron: controller.cron,
            scheduledTime: new Date(controller.scheduledTime).toISOString(),
            actualTime: new Date().toISOString(),
        });

        let bot: Bot | undefined;

        try {
            console.log("[cron] Инициализация бота...");
            bot = await getBot(env);
            console.log("[cron] Бот готов");

            if (controller.cron === "0 15 * * *") {
                console.log("[cron] Запускаю вечерний опрос");
                await createEveningPoll(bot, env);
                console.log("[cron] Вечерний опрос завершён");
            } else if (controller.cron === "0 6 * * *") {
                console.log("[cron] Запускаю утреннюю тему");
                await announceMorningTopic(bot, env);
                console.log("[cron] Утренняя тема завершена");
            } else {
                console.warn("[cron] Неизвестный cron:", controller.cron);
            }

            console.log("[cron] SUCCESS");
        } catch (err) {
            const e = err as {
                name?: string;
                message?: string;
                status?: number;
                code?: string;
                type?: string;
                request_id?: string;
                error?: unknown;
            };

            console.error("[cron] Ошибка:", {
                name: e.name,
                message: e.message,
                status: e.status,
                code: e.code,
                type: e.type,
                request_id: e.request_id,
                providerError: e.error,
            });

            if (bot) {
                try {
                    await notifyOwner(bot, env, "cron:daily", String(err));
                } catch (notifyErr) {
                    console.error(
                        "[cron] Не удалось уведомить владельца:",
                        notifyErr,
                    );
                }
            }
        }
    },
};

async function announceMorningTopic(bot: Bot, env: Env) {
    const state = await loadState(env);
    const today = new Date().toISOString().slice(0, 10);
    if (state.lastTopicDate === today) return;

    let topic: string | null = null;
    let tieNote = "";

    // 1. Пробуем закрыть опрос, если он есть
    if (state.currentPoll && state.pollEnabled) {
        try {
            const poll = await bot.api.stopPoll(
                Number(env.ALLOWED_CHAT_ID),
                state.currentPoll.messageId,
            );

            const totalVotes = poll.options.reduce(
                (sum, o) => sum + (o.voter_count ?? 0),
                0,
            );

            let chosen;

            if (totalVotes === 0) {
                // Никто не голосовал — берём случайную тему
                chosen =
                    poll.options[
                        Math.floor(Math.random() * poll.options.length)
                    ];
                tieNote = `<i>Κανείς δεν ψήφισε — διάλεξα τυχαία!</i>`;
                console.log(
                    `[cron] Никто не голосовал, выбрана случайная тема: ${chosen.text}`,
                );
            } else {
                // Есть голоса — находим лидеров
                const maxVotes = Math.max(
                    ...poll.options.map((o) => o.voter_count ?? 0),
                );
                const leaders = poll.options.filter(
                    (o) => (o.voter_count ?? 0) === maxVotes,
                );

                if (leaders.length > 1) {
                    // Ничья — выбираем случайного из лидеров
                    chosen =
                        leaders[Math.floor(Math.random() * leaders.length)];
                    tieNote = `<i>Επιλέχθηκε τυχαία λόγω ισοψηφίας.</i>`;
                    console.log(
                        `[cron] Ничья среди ${leaders.length} вариантов (${maxVotes} голосов), выбран: ${chosen.text}`,
                    );
                } else {
                    // Явный победитель
                    chosen = leaders[0];
                    console.log(
                        `[cron] Победитель: ${chosen.text} (${chosen.voter_count} голосов)`,
                    );
                }
            }
            topic = chosen.text;

            console.log(`[cron] Победитель: ${topic}`);
        } catch (err) {
            console.error(
                "[cron] Опрос недоступен, генерирую как обычно:",
                err,
            );
        }
    }

    if (topic) {
        // Есть победитель — генерируем только слово под тему
        const word = await withAIFallback(env, (client, model) =>
            generateWordForTopic(client, model, topic!, state.recentWords),
        );
        state.currentTopic = topic;
        state.currentWord = word;
        state.recentTopics = [topic, ...state.recentTopics].slice(0, 7);
        if (word)
            state.recentWords = [word.greek, ...state.recentWords].slice(0, 7);
    } else {
        // Нет опроса — генерируем всё как обычно
        const newState = await withAIFallback(env, (client, model) =>
            generateDailyTopic(client, model, env, state),
        );
        Object.assign(state, newState);
    }

    state.lastTopicDate = today;
    state.currentPoll = null;
    state.wordRevealed = false;
    await saveState(env, state);

    await bot.api.sendMessage(
        Number(env.ALLOWED_CHAT_ID),
        formatDailyMessage(state, tieNote),
        { parse_mode: "HTML" },
    );
    console.log("[cron] Тема объявлена");
}
