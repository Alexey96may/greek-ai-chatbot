import { registerCommands } from "../bot/registerCommands";

const env = {
    BOT_TOKEN: process.env.BOT_TOKEN!,
    ALLOWED_CHAT_ID: process.env.ALLOWED_CHAT_ID!,
    OWNER_ID: process.env.OWNER_ID!,
} as any;

registerCommands(env)
    .then(() => {
        console.log("Готово!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Ошибка регистрации:", error);
        process.exit(1);
    });
