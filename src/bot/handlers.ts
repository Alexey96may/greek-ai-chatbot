import { Bot, Context, InputFile } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { notifyOwner } from "../helpers/notify";
import { getHistory, appendHistory } from "../helpers/history";
import { isReadableName } from "../helpers/names";
import { arrayBufferToBase64 } from "../helpers/base64";
import { askAI } from "../ai/ask";
import { askAIWithImage } from "../ai/vision";
import { textToSpeech } from "../ai/tts";
import { loadState } from "../state";

export function setupHandlers(bot: Bot, env: Env, botUsername: string) {
    bot.command("start", (ctx) => {
        if (isAllowedContext(ctx, env)) {
            return ctx.reply(
                "Γεια σου! 👋\n\n" +
                    "Я — собеседник для практики греческого и русского. Просто общайся в чате.\n" +
                    "Команды:\n/help — помощь\n/word — слово дня\n/topic — тема дня",
            );
        }

        return ctx.reply(
            "Γεια σου! 👋\n\n" +
                "Я работаю только в одной группе — там, где практикуют греческий и русский.\n\n" +
                "Вот ссылка: https://t.me/elenikaglossa\n\n" +
                "Зайди туда — и я с радостью пообщаюсь с тобой! 🇬🇷🇷🇺",
        );
    });

    bot.command("help", (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        return ctx.reply(
            "Как я работаю:\n\n" +
                "📝 *Текст*\n" +
                "• Отвечаю на сообщения в этой группе.\n" +
                "• Если вижу ошибку — не исправляю прямо, а отвечаю естественной фразой.\n" +
                "• В диалогах двух людей не вмешиваюсь.\n\n" +
                "🎤 *Голос*\n" +
                "• Отправь голосовое — распознаю речь и отвечу голосом + текстом.\n" +
                "• Голосовые ответы ограничены лимитом (~90 в месяц).\n" +
                "• Когда лимит кончается — отвечаю только текстом.\n\n" +
                "🖼️ *Фото*\n" +
                "• Могу посмотреть фото и описать, что на нём. Но это получается не всегда!\n" +
                "• Если попросишь «опиши фото» — дам развёрнутое описание как на экзамене (5–8 предложений, с деталями и эмоциями).\n" +
                "📅 *Тема и слово дня*\n" +
                "• Каждый день в 9:00 МСК присылаю тему и слово дня.\n" +
                "• /word — показать слово дня.\n" +
                "• /topic — показать тему дня.\n\n" +
                "⚠️ *Ограничения*\n" +
                "• Работаю только в этой группе (в общей теме)!\n" +
                "• Не умею генерировать картинки и видео — только общаюсь.\n" +
                "• Могу забыть контекст беседы.\n",
            { parse_mode: "Markdown" },
        );
    });

    bot.command("word", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        const state = await loadState(env);
        if (!state.currentWord)
            return ctx.reply("Слово дня ещё не сгенерировано.");
        const w = state.currentWord;
        await ctx.reply(
            `📖 <b>Слово дня:</b> <code>${w.greek}</code>\n\n` +
                `Перевод: <tg-spoiler>${w.translation}</tg-spoiler>\n` +
                `Пример: <tg-spoiler>${w.example}</tg-spoiler>`,
            { parse_mode: "HTML" },
        );
    });

    bot.command("topic", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        const state = await loadState(env);
        if (!state.currentTopic)
            return ctx.reply("Тема дня ещё не сгенерирована.");
        await ctx.reply(`📌 <b>Тема дня:</b> ${state.currentTopic}`, {
            parse_mode: "HTML",
        });
    });

    bot.on("message:sticker", (ctx) =>
        handleSticker(ctx, env, bot, botUsername),
    );

    bot.on("message:video", async (ctx) => {
        if (ctx.message.video && "sticker" in ctx.message) {
            await handleSticker(ctx, env, bot, botUsername);
        }
    });

    bot.on("message:text", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;

        const text = ctx.message.text;
        if (text.startsWith("/")) return;
        if (ctx.message.from?.is_bot) return;

        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;

        const isMentioned = text.includes(`@${botUsername}`);
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

        if (isReplyingToHuman) {
            console.log(`[${chatId}] пропускаю (диалог людей)`);
            return;
        }

        try {
            const cleanText = isDirect
                ? text.replace(`@${botUsername}`, "").trim() || text
                : text;

            const contextText = ctx.message.reply_to_message?.text;
            const state = await loadState(env);
            const rawName = ctx.message.from?.first_name;
            const userName = isReadableName(rawName) ? rawName : undefined;
            const history = getHistory(chatId);

            const answer = await askAI(
                env,
                cleanText,
                contextText,
                userName,
                state.currentTopic,
                state.currentWord?.greek,
                history,
                bot,
            );

            if (answer) {
                appendHistory(chatId, "user", cleanText, userName);
                appendHistory(chatId, "assistant", answer);
                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
                console.log(`[${chatId}] ответил`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка при ответе:`, err);
        }
    });

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

        try {
            const file = await ctx.api.getFile(ctx.message.voice.file_id);
            if (!file.file_path) {
                throw new Error("Не удалось получить путь к файлу");
            }

            const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
            const audioResponse = await fetch(fileUrl);
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

            if (answer) {
                appendHistory(chatId, "user", transcribedText, userName);
                appendHistory(chatId, "assistant", answer);
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

                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
                console.log(`[${chatId}] ответил на голосовое (текстом)`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка обработки голосового:`, err);
            await notifyOwner(bot, env, "voice:processing", String(err));
        }
    });

    bot.on("message:photo", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        if (ctx.message.from?.is_bot) return;

        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        const caption = ctx.message.caption?.trim() ?? "";

        console.log(`[${chatId}] ФОТО ПОЛУЧЕНО, caption="${caption}"`);

        try {
            const photos = ctx.message.photo;
            const bestPhoto = photos[photos.length - 1];

            const file = await ctx.api.getFile(bestPhoto.file_id);
            if (!file.file_path) throw new Error("Нет file_path");

            const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
            const imgRes = await fetch(fileUrl);
            const arrayBuffer = await imgRes.arrayBuffer();
            const base64 = arrayBufferToBase64(arrayBuffer);

            console.log(`[${chatId}] спрашиваю Z.AI...`);
            const description = await askAIWithImage(
                env,
                base64,
                "image/jpeg",
                bot,
            );
            if (!description) {
                console.log(`[${chatId}] Z.AI не смог описать фото`);
                return;
            }
            console.log(`[${chatId}] Z.AI описал: ${description}`);

            const state = await loadState(env);
            const rawName = ctx.message.from?.first_name;
            const userName = isReadableName(rawName) ? rawName : undefined;

            const userText = caption
                ? `[Подпись пользователя к фото]: "${caption}"\n[Описание фото]: "${description}"`
                : `[Пользователь отправил фото. Описание: "${description}"]`;

            const history = getHistory(chatId);

            const answer = await askAI(
                env,
                userText,
                undefined,
                userName,
                state.currentTopic,
                state.currentWord?.greek,
                history,
                bot,
            );

            if (answer) {
                appendHistory(chatId, "user", userText, userName);
                appendHistory(chatId, "assistant", answer);
                await ctx.reply(answer, {
                    reply_parameters: { message_id: messageId },
                });
                console.log(`[${chatId}] ответил на фото`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка обработки фото:`, err);
            await notifyOwner(bot, env, "photo:processing", String(err));
        }
    });
}

async function handleSticker(
    ctx: Context,
    env: Env,
    bot: Bot,
    botUsername: string,
) {
    if (!isAllowedContext(ctx, env)) return;
    if (ctx.message?.from?.is_bot) return;

    const sticker = ctx.message?.sticker;
    if (!sticker) return;

    const emoji = sticker.emoji ?? "🙂";
    const chatId = ctx.chat!.id;
    const messageId = ctx.message!.message_id;

    try {
        const state = await loadState(env);
        const rawName = ctx.message?.from?.first_name;
        const userName = isReadableName(rawName) ? rawName : undefined;

        const stickerText = `[Пользователь отправил стикер с эмодзи: ${emoji}]`;

        const history = getHistory(chatId);

        const answer = await askAI(
            env,
            stickerText,
            undefined,
            userName,
            state.currentTopic,
            state.currentWord?.greek,
            history,
            bot,
        );

        if (answer) {
            appendHistory(chatId, "user", stickerText, userName);
            appendHistory(chatId, "assistant", answer);
            await ctx.reply(answer, {
                reply_parameters: { message_id: messageId },
            });
            console.log(`[${chatId}] ответил на стикер ${emoji}`);
        }
    } catch (err) {
        console.error(`[${chatId}] ошибка при ответе на стикер:`, err);
    }
}
