import type { Bot } from "grammy";
import OpenAI from "openai";
import type { Env } from "../types";
import { notifyOwner } from "../helpers/notify";

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
            console.log("[Vision] Z.AI ответил");
            return zaiResult;
        }
        console.log("[Vision] Z.AI не сработал, переключаюсь на Groq...");
    }

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
