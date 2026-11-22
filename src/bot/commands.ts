import type { Bot } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { loadState, saveState } from "../state";

async function replyCommand(ctx: any, text: string, extra: any = {}) {
    // В личке используем обычный ответ
    if (ctx.chat.type === "private") {
        return ctx.reply(text, extra);
    }

    // В группе отвечаем только на эфемерную команду
    const ephemeralMessageId = ctx.message?.ephemeral_message_id;

    if (!ephemeralMessageId) {
        console.warn(
            "[commands] Нет ephemeral_message_id, публичный ответ отменён",
        );
        return;
    }

    return ctx.api.raw.sendMessage({
        chat_id: ctx.chat.id,
        text,
        reply_parameters: {
            ephemeral_message_id: ephemeralMessageId,
        },
        ...extra,
    });
}

export function setupCommands(bot: Bot, env: Env) {
    bot.command("start", (ctx) => {
        if (isAllowedContext(ctx, env)) {
            return replyCommand(
                ctx,
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
        return replyCommand(
            ctx,
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
                "• Если попросишь «опиши фото» — дам развёрнутое описание как на экзамене (5–8 предложений, с деталями и эмоциями).\n\n" +
                "🎬 *YouTube-видео*\n" +
                "• Отправь ссылку на YouTube — проанализирую видео и расскажу, о чём оно.\n" +
                "• Могу сделать краткий пересказ, выделить главные мысли, ответить на вопросы и выписать полезные греческие слова.\n" +
                "• Можно задавать дополнительные вопросы по видео.\n" +
                "• Чем длиннее видео, тем дольше может занять анализ и тем больше бесплатных ресурсов он расходует.\n" +
                "• Очень длинные видео могут не обработаться из-за технических ограничений.\n\n" +
                "📅 *Тема и слово дня*\n" +
                "• Каждый день в 9:00 МСК присылаю тему и слово дня.\n" +
                "• /word — показать слово дня.\n" +
                "• /topic — показать тему дня.\n\n" +
                "📊 *Голосование за тему*\n" +
                "• Каждый вечер в 18:00 МСК присылаю опрос с 4 темами на завтра.\n" +
                "• Голосуйте — утром объявлю победителя.\n" +
                "• Если никто не голосовал — выберу случайную тему.\n\n" +
                "⚠️ *Ограничения*\n" +
                "• Работаю только в этой группе (в общей теме)!\n" +
                "• Не умею генерировать картинки и видео — только анализировать фото и YouTube-видео.\n" +
                "• Могу забыть контекст беседы.\n",
            { parse_mode: "Markdown" },
        );
    });

    bot.command("word", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;
        const state = await loadState(env);
        if (!state.currentWord)
            return replyCommand(ctx, "Слово дня ещё не сгенерировано.");
        const w = state.currentWord;
        await replyCommand(
            ctx,
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
            return replyCommand(ctx, "Тема дня ещё не сгенерирована.");
        await replyCommand(ctx, `📌 <b>Тема дня:</b> ${state.currentTopic}`, {
            parse_mode: "HTML",
        });
    });

    bot.command("poll", async (ctx) => {
        if (!isAllowedContext(ctx, env)) return;

        // Только owner может управлять
        const isOwner =
            ctx.chat?.type === "private" &&
            ctx.chat.id === Number(env.OWNER_ID);
        if (!isOwner) {
            return ctx.reply("Эта команда только для создателя.");
        }

        const arg = ctx.match?.trim().toLowerCase();

        if (arg === "on") {
            const state = await loadState(env);
            state.pollEnabled = true;
            await saveState(env, state);
            return ctx.reply("✅ Голосование за тему дня включено.");
        }

        if (arg === "off") {
            const state = await loadState(env);
            state.pollEnabled = false;
            await saveState(env, state);
            return ctx.reply(
                "⏸️ Голосование за тему дня выключено. Тема будет генерироваться автоматически.",
            );
        }

        // Без аргумента — показать статус
        const state = await loadState(env);
        return ctx.reply(
            `📊 Голосование: ${state.pollEnabled ? "включено" : "выключено"}\n\n` +
                `Управление: /poll on | /poll off`,
        );
    });
}
