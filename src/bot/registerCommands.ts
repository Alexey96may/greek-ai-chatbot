import { Bot } from "grammy";
import type { Env } from "../types";

export async function registerCommands(env: Env): Promise<void> {
    const bot = new Bot(env.BOT_TOKEN);

    await bot.init();

    try {
        // Команды для основного чата
        await bot.api.setMyCommands(
            [
                {
                    command: "start",
                    description: "Начать общение",
                },
                {
                    command: "help",
                    description: "Как работает бот",
                },
                {
                    command: "word",
                    description: "Слово дня",
                },
                {
                    command: "topic",
                    description: "Тема дня",
                },
            ],
            {
                scope: {
                    type: "chat",
                    chat_id: Number(env.ALLOWED_CHAT_ID),
                },
            },
        );

        // Команды только для владельца
        await bot.api.setMyCommands(
            [
                {
                    command: "poll",
                    description: "Управление голосованием",
                },
            ],
            {
                scope: {
                    type: "chat",
                    chat_id: Number(env.OWNER_ID),
                },
            },
        );

        console.log("✅ Команды Telegram успешно зарегистрированы");
    } finally {
        await bot.api.close();
    }
}
