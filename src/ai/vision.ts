import type { Bot } from "grammy";
import OpenAI from "openai";
import type { Env } from "../types";
import { notifyOwner } from "../helpers/notify";

const VISION_TIMEOUT = 20_000;

async function tryZAI(
    env: Env,
    imageBase64: string,
    mimeType: string = "image/jpeg",
): Promise<string | null> {
    if (!env.ZAI_API_KEY) {
        console.log("[Vision] ZAI_API_KEY не настроен");
        return null;
    }

    const client = new OpenAI({
        apiKey: env.ZAI_API_KEY,
        baseURL: "https://api.z.ai/api/paas/v4",
        timeout: VISION_TIMEOUT,
        maxRetries: 0,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            console.log(`[Vision] Z.AI attempt ${attempt + 1}...`);

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

            const result = res.choices[0]?.message?.content?.trim();

            if (result) {
                console.log("[Vision] Z.AI ответил");
                return result;
            }

            console.log("[Vision] Z.AI вернул пустой ответ");
            return null;
        } catch (err: any) {
            const status = err?.status;

            console.error(
                `[Vision] Z.AI attempt ${attempt + 1} failed:`,
                status,
                err?.message ?? err,
            );

            // Лимит запросов — сразу переходим к Groq.
            if (status === 429) {
                console.warn("[Vision] Z.AI rate limit, переключаюсь на Groq");
                return null;
            }

            // Ошибки запроса повторять бессмысленно.
            if (status === 400 || status === 401 || status === 403) {
                return null;
            }

            // Временная ошибка сервера — одна повторная попытка.
            if (
                (status === 500 ||
                    status === 502 ||
                    status === 503 ||
                    status === 504) &&
                attempt === 0
            ) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }

            return null;
        }
    }

    return null;
}

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
        console.log("[Vision] Отправляю запрос в Groq...");

        const client = new OpenAI({
            apiKey: env.GROQ_API_KEY,
            baseURL: "https://api.groq.com/openai/v1",
            timeout: VISION_TIMEOUT,
            maxRetries: 0,
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

        const result = res.choices[0]?.message?.content?.trim();

        if (result) {
            console.log("[Vision] Groq ответил");
            return result;
        }

        console.log("[Vision] Groq вернул пустой ответ");
        return null;
    } catch (err: any) {
        console.error("[Vision] Groq error:", err?.status, err?.message ?? err);

        return null;
    }
}

export async function askAIWithImage(
    env: Env,
    imageBase64: string,
    mimeType: string = "image/jpeg",
    bot?: Bot,
): Promise<string | null> {
    if (env.ZAI_API_KEY) {
        console.log("[Vision] Пробую Z.AI...");

        const zaiResult = await tryZAI(env, imageBase64, mimeType);

        if (zaiResult) {
            return zaiResult;
        }

        console.log("[Vision] Z.AI не сработал, переключаюсь на Groq...");
    }

    if (env.GROQ_API_KEY) {
        console.log("[Vision] Пробую Groq...");

        const groqResult = await tryGroqVision(env, imageBase64, mimeType);

        if (groqResult) {
            return groqResult;
        }
    }

    console.error("[Vision] Все vision-провайдеры недоступны");

    if (bot) {
        try {
            await notifyOwner(
                bot,
                env,
                "vision:all",
                "Все vision-провайдеры недоступны",
            );
        } catch (err) {
            console.error("[Vision] Не удалось уведомить владельца:", err);
        }
    }

    return null;
}
