import { Bot } from "grammy";
import { loadState, saveState } from "./state";
import { generatePollTopics } from "./daily";
import OpenAI from "openai";
import type { Env } from "./types";

export async function createEveningPoll(
    bot: Bot,
    env: Env,
    force = false,
): Promise<"created" | "disabled" | "exists"> {
    const state = await loadState(env);

    if (!state.pollEnabled && !force) {
        console.log("[poll] Голосование выключено");
        return "disabled";
    }

    if (state.currentPoll) {
        console.log("[poll] Опрос уже создан");
        return "exists";
    }

    const options = await withAIFallback(env, (client, model) =>
        generatePollTopics(client, model, 4, state.recentTopics),
    );

    const safeOptions = options
        .map((t) => {
            const chars = [...t];
            return chars.length > 100 ? chars.slice(0, 97).join("") + "..." : t;
        })
        .slice(0, 10);

    if (safeOptions.length < 2) {
        throw new Error("Недостаточно тем для создания голосования");
    }

    const pollMessage = await bot.api.sendPoll(
        Number(env.ALLOWED_CHAT_ID),
        "Ποιο θέμα να συζητήσουμε αύριο; (Какую тему обсудим завтра?)",
        safeOptions,
        {
            is_anonymous: true,
            allows_multiple_answers: false,
        },
    );

    state.currentPoll = {
        messageId: pollMessage.message_id,
        options: safeOptions,
    };

    await saveState(env, state);

    console.log("[poll] Опрос создан");
    return "created";
}

export async function withAIFallback<T>(
    env: Env,
    generate: (client: OpenAI, model: string) => Promise<T>,
): Promise<T> {
    const providers: Array<{
        name: string;
        client: OpenAI;
        model: string;
    }> = [];

    if (env.GEMINI_API_KEY) {
        providers.push({
            name: "gemini",
            client: new OpenAI({
                apiKey: env.GEMINI_API_KEY,
                baseURL:
                    "https://generativelanguage.googleapis.com/v1beta/openai/",
                timeout: 25_000,
                maxRetries: 0,
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
                timeout: 25_000,
                maxRetries: 0,
            }),
            model: "openai/gpt-oss-20b",
        });
    }

    if (providers.length === 0) {
        throw new Error("Не настроены GEMINI_API_KEY и GROQ_API_KEY");
    }

    let lastError: unknown;

    for (const provider of providers) {
        try {
            console.log(`[AI] Использую ${provider.name}`);

            const result = await generate(provider.client, provider.model);

            console.log(`[AI] Успешная генерация через ${provider.name}`);
            return result;
        } catch (err) {
            lastError = err;

            const error = err as {
                status?: number;
                code?: string;
                message?: string;
            };

            const retryable =
                [408, 409, 429, 500, 502, 503, 504].includes(
                    error.status ?? 0,
                ) ||
                error.code === "ETIMEDOUT" ||
                error.code === "ECONNRESET" ||
                error.code === "ECONNREFUSED" ||
                error.code === "INVALID_AI_RESPONSE";

            console.error(`[AI] ${provider.name} не сработал:`, {
                message: error.message,
                status: error.status,
                code: error.code,
            });

            if (!retryable) {
                throw err;
            }

            console.warn(`[AI] Ошибка временная, пробую следующего провайдера`);
        }
    }

    throw lastError ?? new Error("Все AI-провайдеры недоступны");
}
