import type { Bot } from "grammy";
import type { Env } from "../types";
import { isAllowedContext } from "../helpers/context";
import { loadState, saveState } from "../state";

export function setupCommands(bot: Bot, env: Env) {
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
                "• Если попросишь «опиши фото» — дам развёрнутое описание как на экзамене (5–8 предложений, с деталями и эмоциями).\n\n" +
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
