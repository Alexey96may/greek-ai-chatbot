import type { Bot } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { getHistory, appendHistory } from "../helpers/history";
import { isReadableName } from "../helpers/names";
import { askAI } from "../ai/ask";
import { loadState } from "../state";

export function setupText(bot: Bot, env: Env, botUsername: string) {
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
}
