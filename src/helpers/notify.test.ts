import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { Env } from "../types";
import { clearNotifyCache, notifyOwner } from "./notify";

function fakeBot() {
    return {
        api: {
            sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
        },
    } as unknown as Bot & {
        api: { sendMessage: ReturnType<typeof vi.fn> };
    };
}

function env(overrides: Partial<Env> = {}): Env {
    return {
        OWNER_ID: "123456789",
        ...overrides,
    } as Env;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    clearNotifyCache();
});

afterEach(() => {
    vi.useRealTimers();
    clearNotifyCache();
});

describe("notifyOwner", () => {
    it("does nothing when OWNER_ID is empty", async () => {
        const bot = fakeBot();
        await notifyOwner(bot, env({ OWNER_ID: "" }), "k", "text");
        expect(bot.api.sendMessage).not.toHaveBeenCalled();
    });

    it("sends a message to OWNER_ID", async () => {
        const bot = fakeBot();
        await notifyOwner(bot, env(), "k", "text");
        expect(bot.api.sendMessage).toHaveBeenCalledOnce();
        expect(bot.api.sendMessage).toHaveBeenCalledWith(
            123456789,
            expect.stringContaining("Ошибка бота"),
            expect.objectContaining({ parse_mode: "Markdown" }),
        );
    });

    it("includes errorKey and errorText in the message", async () => {
        const bot = fakeBot();
        await notifyOwner(bot, env(), "my-key", "boom");
        const [, text] = bot.api.sendMessage.mock.calls[0];
        expect(text).toContain("my-key");
        expect(text).toContain("boom");
    });

    it("truncates errorText to 500 chars", async () => {
        const bot = fakeBot();
        const long = "x".repeat(2000);
        await notifyOwner(bot, env(), "k", long);
        const [, text] = bot.api.sendMessage.mock.calls[0];
        expect(text).toContain("x".repeat(500));
        expect(text).not.toContain("x".repeat(501));
    });

    it("suppresses duplicate errorKey within cooldown", async () => {
        const bot = fakeBot();
        await notifyOwner(bot, env(), "k", "first");
        await notifyOwner(bot, env(), "k", "second");
        expect(bot.api.sendMessage).toHaveBeenCalledOnce();
    });

    it("allows same errorKey after cooldown", async () => {
        const bot = fakeBot();
        await notifyOwner(bot, env(), "k", "first");
        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
        await notifyOwner(bot, env(), "k", "second");
        expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("does not suppress different errorKeys", async () => {
        const bot = fakeBot();
        await notifyOwner(bot, env(), "k1", "a");
        await notifyOwner(bot, env(), "k2", "b");
        expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    });

    it("swallows sendMessage errors", async () => {
        const bot = fakeBot();
        bot.api.sendMessage.mockRejectedValueOnce(new Error("network"));
        await expect(
            notifyOwner(bot, env(), "k", "text"),
        ).resolves.toBeUndefined();
    });

    it("still sets cooldown when sendMessage throws", async () => {
        // Pins current behavior: cooldown is set BEFORE sendMessage,
        // so a failed send still suppresses the next attempt for 5 min.
        const bot = fakeBot();
        bot.api.sendMessage.mockRejectedValueOnce(new Error("network"));
        await notifyOwner(bot, env(), "k", "first");
        await notifyOwner(bot, env(), "k", "second");
        // Second call suppressed by cooldown, not sent
        expect(bot.api.sendMessage).toHaveBeenCalledOnce();
    });
});
