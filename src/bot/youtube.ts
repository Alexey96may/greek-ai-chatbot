import type { Bot } from "grammy";
import type { Env } from "../types";
import { getHistory, appendHistory } from "../helpers/history";
import { notifyOwner } from "../helpers/notify";
import { YOUTUBE_SYSTEM_PROMPT } from "../prompts/youtube";

const GEMINI_MODEL = "gemini-3.5-flash-lite";

function extractYouTubeUrl(text: string): string | null {
    const urls = text.match(/https?:\/\/[^\s<>]+/gi) ?? [];

    for (const rawUrl of urls) {
        const cleaned = rawUrl.replace(/[.,!?;)\]}]+$/, "");

        try {
            const url = new URL(cleaned);
            const hostname = url.hostname.toLowerCase();

            let videoId: string | null = null;

            if (hostname === "youtu.be" || hostname === "www.youtu.be") {
                videoId = url.pathname.split("/").filter(Boolean)[0];
            } else if (
                hostname === "youtube.com" ||
                hostname === "www.youtube.com" ||
                hostname === "m.youtube.com"
            ) {
                if (url.pathname === "/watch") {
                    videoId = url.searchParams.get("v");
                } else {
                    const match = url.pathname.match(
                        /^\/(?:shorts|live|embed)\/([a-zA-Z0-9_-]+)/,
                    );

                    videoId = match?.[1] ?? null;
                }
            }

            if (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
                return `https://www.youtube.com/watch?v=${videoId}`;
            }
        } catch {
            continue;
        }
    }

    return null;
}

function extractInstruction(
    text: string,
    url: string,
    botUsername: string,
): string {
    return text
        .replace(/https?:\/\/[^\s<>]+/gi, (match) => {
            const cleaned = match.replace(/[.,!?;)\]}]+$/, "");

            return extractYouTubeUrl(cleaned) === url ? "" : match;
        })
        .replaceAll(`@${botUsername}`, "")
        .trim();
}

async function analyzeYouTube(
    env: Env,
    url: string,
    instruction: string,
    history: ReturnType<typeof getHistory>,
): Promise<string> {
    if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY не настроен");
    }

    const userPrompt = instruction
        ? `ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ:\n${instruction}`
        : `Пользователь отправил только ссылку без инструкции.

Сделай краткий, но содержательный пересказ видео.
Определи основной язык речи и используй его,
если это русский или греческий.`;

    const historyContext = history
        .map((msg) => `${msg.name ?? msg.role}: ${msg.text}`)
        .join("\n");

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": env.GEMINI_API_KEY,
            },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: YOUTUBE_SYSTEM_PROMPT }],
                },
                contents: [
                    {
                        role: "user",
                        parts: [
                            {
                                fileData: {
                                    fileUri: url,
                                    mimeType: "video/mp4",
                                },
                            },
                            {
                                text: `
ИСТОРИЯ ПЕРЕПИСКИ:
${historyContext || "История пока отсутствует."}

${userPrompt}

Выполни задачу непосредственно по содержанию видео.
`,
                            },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: 0.4,
                    maxOutputTokens: 8192,
                },
            }),
        },
    );

    if (!response.ok) {
        const errorText = await response.text();

        console.error(
            "[YouTube] Gemini API error:",
            response.status,
            errorText,
        );

        throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
        candidates?: Array<{
            content?: {
                parts?: Array<{
                    text?: string;
                }>;
            };
        }>;
    };

    const result = data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .filter(Boolean)
        .join("\n")
        .trim();

    if (!result) {
        throw new Error("Gemini вернул пустой ответ");
    }

    return result;
}

function splitMessage(text: string, maxLength = 3900): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf("\n", maxLength);

        if (splitAt < maxLength * 0.5) {
            splitAt = remaining.lastIndexOf(" ", maxLength);
        }

        if (splitAt < maxLength * 0.5) {
            splitAt = maxLength;
        }

        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) {
        chunks.push(remaining);
    }

    return chunks;
}

export function setupYouTubeHandler(bot: Bot, env: Env): void {
    bot.on("message:text", async (ctx, next) => {
        const message = ctx.message;

        if (message.from?.is_bot) return;

        const text = message.text;
        const url = extractYouTubeUrl(text);

        // Если YouTube-ссылки нет, передаём сообщение дальше.
        if (!url) {
            await next();
            return;
        }

        const instruction = extractInstruction(text, url, bot.botInfo.username);

        const chatId = ctx.chat.id;
        const messageId = message.message_id;

        const userName = message.from?.first_name ?? "unknown";

        // Получаем всю текущую историю из history.ts.
        const history = getHistory(chatId);

        console.log(
            `[YouTube] ${userName}: ${url} | instruction: ${
                instruction || "default summary"
            }`,
        );

        try {
            await ctx.api.sendChatAction(chatId, "typing");

            const result = await analyzeYouTube(env, url, instruction, history);

            appendHistory(chatId, "user", text, userName);
            appendHistory(chatId, "assistant", result, `→ ${userName}`);

            const chunks = splitMessage(result);

            for (const chunk of chunks) {
                await ctx.reply(chunk, {
                    reply_parameters: {
                        message_id: messageId,
                    },
                });
            }

            console.log(`[YouTube] Анализ завершён для ${userName}`);
        } catch (err) {
            console.error("[YouTube] Error:", err);

            try {
                await notifyOwner(
                    bot,
                    env,
                    "text-youtube:processing",
                    String(err),
                );
            } catch (notifyError) {
                console.error(
                    "[YouTube] Owner notification failed:",
                    notifyError,
                );
            }

            await ctx.reply(
                "Не удалось проанализировать видео 😕\nПопробуй ещё раз немного позже.",
                {
                    reply_parameters: {
                        message_id: messageId,
                    },
                },
            );
        }
    });
}
