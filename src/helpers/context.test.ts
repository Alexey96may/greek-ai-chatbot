import { describe, expect, it } from "vitest";
import type { Context } from "grammy";
import type { Env } from "../types";
import { isAllowedChat, isAllowedContext, isOwnerPrivate } from "./context";

// Минимальный фейковый Context — только то, что читают функции.
function ctx(chat: { id: number; type: string } | undefined): Context {
    return { chat } as unknown as Context;
}

function env(overrides: Partial<Env> = {}): Env {
    return {
        ALLOWED_CHAT_ID: "-1001234567890",
        OWNER_ID: "123456789",
        ...overrides,
    } as Env;
}

describe("isAllowedChat", () => {
    it("returns true when chat id matches ALLOWED_CHAT_ID", () => {
        expect(
            isAllowedChat(
                ctx({ id: -1001234567890, type: "supergroup" }),
                env(),
            ),
        ).toBe(true);
    });

    it("returns false when chat id does not match", () => {
        expect(isAllowedChat(ctx({ id: 999, type: "group" }), env())).toBe(
            false,
        );
    });

    it("returns false when ctx.chat is undefined", () => {
        expect(isAllowedChat(ctx(undefined), env())).toBe(false);
    });

    it("returns false when ALLOWED_CHAT_ID is empty", () => {
        // Number("") === 0, no real chat has id 0
        expect(
            isAllowedChat(
                ctx({ id: 0, type: "group" }),
                env({ ALLOWED_CHAT_ID: "" }),
            ),
        ).toBe(false);
    });

    it("returns false when ALLOWED_CHAT_ID is non-numeric", () => {
        // Number("abc") === NaN, NaN !== any id
        expect(
            isAllowedChat(
                ctx({ id: 123, type: "group" }),
                env({ ALLOWED_CHAT_ID: "abc" }),
            ),
        ).toBe(false);
    });
});

describe("isOwnerPrivate", () => {
    it("returns true for owner in private chat", () => {
        expect(
            isOwnerPrivate(ctx({ id: 123456789, type: "private" }), env()),
        ).toBe(true);
    });

    it("returns false for non-owner in private chat", () => {
        expect(isOwnerPrivate(ctx({ id: 999, type: "private" }), env())).toBe(
            false,
        );
    });

    it("returns false for owner in a group", () => {
        expect(
            isOwnerPrivate(ctx({ id: 123456789, type: "group" }), env()),
        ).toBe(false);
    });

    it("returns false when OWNER_ID is empty", () => {
        // Boolean("") === false short-circuits
        expect(
            isOwnerPrivate(
                ctx({ id: 123456789, type: "private" }),
                env({ OWNER_ID: "" }),
            ),
        ).toBe(false);
    });

    it("returns false when ctx.chat is undefined", () => {
        expect(isOwnerPrivate(ctx(undefined), env())).toBe(false);
    });
});

describe("isAllowedContext", () => {
    it("returns true for allowed chat", () => {
        expect(
            isAllowedContext(
                ctx({ id: -1001234567890, type: "supergroup" }),
                env(),
            ),
        ).toBe(true);
    });

    it("returns true for owner in private chat", () => {
        expect(
            isAllowedContext(ctx({ id: 123456789, type: "private" }), env()),
        ).toBe(true);
    });

    it("returns false when neither condition holds", () => {
        expect(isAllowedContext(ctx({ id: 999, type: "private" }), env())).toBe(
            false,
        );
    });

    it("returns false when ctx.chat is undefined", () => {
        expect(isAllowedContext(ctx(undefined), env())).toBe(false);
    });
});
