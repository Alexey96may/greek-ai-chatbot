import type { Bot } from "grammy";
import type { Env } from "../types";

const lastErrorNotify = new Map<string, number>();
const ERROR_NOTIFY_COOLDOWN = 5 * 60 * 1000; // 5 минут

export async function notifyOwner(
    bot: Bot,
    env: Env,
    errorKey: string,
    errorText: string,
): Promise<void> {
    if (!env.OWNER_ID) return;

    const now = Date.now();
    const last = lastErrorNotify.get(errorKey) ?? 0;
    if (now - last < ERROR_NOTIFY_COOLDOWN) return;
    lastErrorNotify.set(errorKey, now);

    try {
        await bot.api.sendMessage(
            Number(env.OWNER_ID),
            `⚠️ *Ошибка бота*\n\n` +
                `Тип: \`${errorKey}\`\n` +
                `Время: ${new Date().toISOString()}\n\n` +
                `\`\`\`\n${errorText.slice(0, 500)}\n\`\`\``,
            { parse_mode: "Markdown" },
        );
    } catch (err) {
        console.error("[notifyOwner] не удалось отправить:", err);
    }
}

export function clearNotifyCache(): void {
    lastErrorNotify.clear();
}
