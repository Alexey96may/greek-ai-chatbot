import type { Bot } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { notifyOwner } from "../helpers/notify";
import { getHistory, appendHistory } from "../helpers/history";
import { isReadableName } from "../helpers/names";
import { arrayBufferToBase64 } from "../helpers/base64";
import { PHOTO_SYSTEM_PROMPT } from "../prompts/photo";
import { askAI } from "../ai/ask";
import { askAIWithImage } from "../ai/vision";
import { loadState } from "../state";

export function setupPhoto(bot: Bot, env: Env) {
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
                PHOTO_SYSTEM_PROMPT,
            );

            if (answer) {
                appendHistory(chatId, "user", userText, userName);
                appendHistory(
                    chatId,
                    "assistant",
                    answer,
                    `→ ${userName ?? "пользователю"}`,
                );
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
