import type { Bot } from "grammy";
import OpenAI from "openai";
import type { Env } from "../types";
import { COMPANION_SYSTEM_PROMPT } from "../prompts";
import type { HistoryMessage } from "../helpers/history";
import { notifyOwner } from "../helpers/notify";

export async function askAI(
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
        ? `${COMPANION_SYSTEM_PROMPT}\n\n[Сейчас пишет: ${userName}. Отвечай именно ему/ей, учитывая историю ниже. В истории могут быть сообщения других участников — не путай их с текущим.]`
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
