import { Bot, webhookCallback } from "grammy";
import OpenAI from "openai";
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
        const bot = await getBot(env);
        const handler = webhookCallback(bot, "cloudflare-mod");
        return await handler(request);
    },

    async scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log(`[cron] Сработал триггер: ${controller.cron}`);
        const bot = await getBot(env);

        try {
            if (controller.cron === "0 15 * * *") {
                // Вечер: создать опрос
                await createEveningPoll(bot, env);
            } else if (controller.cron === "0 6 * * *") {
                // Утро: объявить тему
                await announceMorningTopic(bot, env);
            }
        } catch (err) {
            console.error("[cron] Ошибка:", err);
            await notifyOwner(bot, env, "cron:daily", String(err));
        }
    },
};

async function createEveningPoll(bot: Bot, env: Env) {
    const state = await loadState(env);

    if (!state.pollEnabled) {
        console.log("[cron] Голосование выключено");
        return;
    }
    if (state.currentPoll) {
        console.log("[cron] Опрос уже создан");
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

    const options = await generatePollTopics(
        client,
        model,
        4,
        state.recentTopics,
    );
    if (options.length < 2) {
        console.log("[cron] Мало тем, пропускаю опрос");
        return;
    }

    const pollMessage = await bot.api.sendPoll(
        Number(env.ALLOWED_CHAT_ID),
        "Ποιο θέμα να συζητήσουμε αύριο; (Какую тему обсудим завтра?)",
        options,
        { is_anonymous: true, allows_multiple_answers: false },
    );

    state.currentPoll = {
        messageId: pollMessage.message_id,
        options,
    };
    await saveState(env, state);
    console.log("[cron] Опрос создан");
}

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

    // 2. Если темы нет — генерируем как обычно
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

    if (topic) {
        // Есть победитель — генерируем только слово под тему
        const word = await generateWordForTopic(
            client,
            model,
            topic,
            state.recentWords,
        );
        state.currentTopic = topic;
        state.currentWord = word;
        state.recentTopics = [topic, ...state.recentTopics].slice(0, 7);
        if (word)
            state.recentWords = [word.greek, ...state.recentWords].slice(0, 7);
    } else {
        // Нет опроса — генерируем всё как обычно
        const newState = await generateDailyTopic(client, model, env, state);
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
