import type { Bot } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { getHistory, appendHistory } from "../helpers/history";
import { isReadableName } from "../helpers/names";
import { markdownToTelegramHtml } from "../helpers/format";
import { askAI } from "../ai/ask";
import { notifyOwner } from "../helpers/notify";
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

        let typingInterval: ReturnType<typeof setInterval> | undefined;

        try {
            const cleanText = isDirect
                ? text.replace(`@${botUsername}`, "").trim() || text
                : text;

            const contextText = ctx.message.reply_to_message?.text;
            const state = await loadState(env);
            const rawName = ctx.message.from?.first_name;
            const userName = isReadableName(rawName) ? rawName : undefined;
            const history = getHistory(chatId);

            // Показываем «печатает…» сразу и обновляем каждые 4 секунды.
            await ctx.api.sendChatAction(chatId, "typing");

            typingInterval = setInterval(() => {
                void ctx.api.sendChatAction(chatId, "typing").catch((err) => {
                    console.error(`[${chatId}] typing action error:`, err);
                });
            }, 4000);

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
                // Небольшая задержка перед отправкой.
                // Чем длиннее ответ, тем дольше бот «печатает».
                const delay = Math.min(3000, Math.max(500, answer.length * 20));

                await new Promise((resolve) => setTimeout(resolve, delay));

                appendHistory(chatId, "user", cleanText, userName);
                appendHistory(
                    chatId,
                    "assistant",
                    answer,
                    `→ ${userName ?? "пользователю"}`,
                );

                await ctx.reply(markdownToTelegramHtml(answer), {
                    parse_mode: "HTML",
                    reply_parameters: { message_id: messageId },
                });

                console.log(`[${chatId}] ответил`);
            }
        } catch (err) {
            console.error(`[${chatId}] ошибка при ответе:`, err);
            await notifyOwner(bot, env, "text:processing", String(err));
        } finally {
            if (typingInterval) {
                clearInterval(typingInterval);
            }
        }
    });
}
