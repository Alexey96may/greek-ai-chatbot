import type { Bot } from "grammy";
import { InputFile } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { notifyOwner } from "../helpers/notify";
import { getHistory, appendHistory } from "../helpers/history";
import { isReadableName } from "../helpers/names";
import { askAI } from "../ai/ask";
import { textToSpeech } from "../ai/tts";
import { loadState } from "../state";

export function setupVoice(bot: Bot, env: Env) {
    bot.on("message:voice", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        if (ctx.message.from?.is_bot) return;

        if (!env.GROQ_API_KEY) {
            console.log(
                `[${ctx.chat.id}] голосовое получено, но GROQ_API_KEY не настроен`,
            );
            return;
        }

        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;

        let typingInterval: ReturnType<typeof setInterval> | undefined;
        let currentAction: "typing" | "record_voice" = "record_voice";

        const sendAction = async () => {
            await ctx.api.sendChatAction(chatId, currentAction);
        };

        const startActionUpdates = () => {
            typingInterval = setInterval(() => {
                void sendAction().catch((err) => {
                    console.error(`[${chatId}] chat action error:`, err);
                });
            }, 4000);
        };

        const setAction = async (action: "typing" | "record_voice") => {
            currentAction = action;
            await sendAction();
        };

        try {
            // Распознавание входящего голосового.
            await setAction("record_voice");
            startActionUpdates();

            const file = await ctx.api.getFile(ctx.message.voice.file_id);
            if (!file.file_path) {
                throw new Error("Не удалось получить путь к файлу");
            }

            const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
            const audioResponse = await fetch(fileUrl);

            if (!audioResponse.ok) {
                throw new Error(
                    `Ошибка загрузки голосового: ${audioResponse.status}`,
                );
            }

            const audioBlob = await audioResponse.blob();

            const formData = new FormData();
            formData.append("file", audioBlob, "voice.ogg");
            formData.append("model", "whisper-large-v3-turbo");

            const groqResponse = await fetch(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${env.GROQ_API_KEY}`,
                    },
                    body: formData,
                },
            );

            if (!groqResponse.ok) {
                const errText = await groqResponse.text();
                await notifyOwner(
                    bot,
                    env,
                    "stt:groq",
                    `${groqResponse.status} ${errText}`,
                );
                throw new Error(
                    `Groq API error: ${groqResponse.status} ${errText}`,
                );
            }

            const transcription = (await groqResponse.json()) as {
                text?: string;
            };
            const transcribedText = transcription.text?.trim();

            if (!transcribedText) {
                console.log(`[${chatId}] не удалось распознать речь`);
                return;
            }

            console.log(`[${chatId}] распознано: ${transcribedText}`);

            // Генерация текстового ответа.
            await setAction("typing");

            const state = await loadState(env);
            const rawName = ctx.message.from?.first_name;
            const userName = isReadableName(rawName) ? rawName : undefined;
            const history = getHistory(chatId);

            const answer = await askAI(
                env,
                transcribedText,
                undefined,
                userName,
                state.currentTopic,
                state.currentWord?.greek,
                history,
                bot,
            );

            if (!answer) return;

            appendHistory(chatId, "user", transcribedText, userName);
            appendHistory(
                chatId,
                "assistant",
                answer,
                `→ ${userName ?? "пользователю"}`,
            );

            // Генерация голосового ответа.
            await setAction("record_voice");

            const audioBytes = await textToSpeech(env, answer, bot);

            if (audioBytes) {
                try {
                    const caption =
                        answer.length > 1000
                            ? answer.slice(0, 997) + "..."
                            : answer;

                    await ctx.replyWithVoice(
                        new InputFile(audioBytes, "reply.ogg"),
                        {
                            caption,
                            reply_parameters: { message_id: messageId },
                        },
                    );

                    console.log(`[${chatId}] ответил голосом + текст`);
                    return;
                } catch (ttsErr) {
                    console.error(
                        `[${chatId}] не удалось отправить голосовое:`,
                        ttsErr,
                    );
                }
            }

            // Если голос не получился — печатает и отправляет текст.
            await setAction("typing");

            const delay = Math.min(3000, Math.max(500, answer.length * 20));

            await new Promise((resolve) => setTimeout(resolve, delay));

            await ctx.reply(answer, {
                reply_parameters: { message_id: messageId },
            });

            console.log(`[${chatId}] ответил на голосовое (текстом)`);
        } catch (err) {
            console.error(`[${chatId}] ошибка обработки голосового:`, err);
            await notifyOwner(bot, env, "voice:processing", String(err));
        } finally {
            if (typingInterval) {
                clearInterval(typingInterval);
            }
        }
    });
}
