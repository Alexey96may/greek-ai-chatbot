import type { Bot, Context } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { getHistory, appendHistory } from "../helpers/history";
import { isReadableName } from "../helpers/names";
import { askAI } from "../ai/ask";
import { loadState } from "../state";

async function handleSticker(ctx: Context, env: Env, bot: Bot) {
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
            appendHistory(
                chatId,
                "assistant",
                answer,
                `→ ${userName ?? "пользователю"}`,
            );
            await ctx.reply(answer, {
                reply_parameters: { message_id: messageId },
            });
            console.log(`[${chatId}] ответил на стикер ${emoji}`);
        }
    } catch (err) {
        console.error(`[${chatId}] ошибка при ответе на стикер:`, err);
    }
}

export function setupStickers(bot: Bot, env: Env) {
    bot.on("message:sticker", (ctx) => handleSticker(ctx, env, bot));

    bot.on("message:video", async (ctx) => {
        if (ctx.message.video && "sticker" in ctx.message) {
            await handleSticker(ctx, env, bot);
        }
    });
}
