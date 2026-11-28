import { afterEach, describe, expect, it } from "vitest";
import { appendHistory, clearHistory, getHistory } from "./history";

afterEach(() => {
    clearHistory();
});

describe("getHistory", () => {
    it("returns empty array for unknown chatId", () => {
        expect(getHistory(42)).toEqual([]);
    });

    it("returns messages after appendHistory", () => {
        appendHistory(1, "user", "hello");
        expect(getHistory(1)).toEqual([
            { role: "user", text: "hello", name: undefined },
        ]);
    });
});

describe("appendHistory", () => {
    it("appends messages in order", () => {
        appendHistory(1, "user", "first");
        appendHistory(1, "assistant", "second");
        expect(getHistory(1).map((m) => m.text)).toEqual(["first", "second"]);
    });

    it("preserves role", () => {
        appendHistory(1, "user", "u");
        appendHistory(1, "assistant", "a");
        expect(getHistory(1).map((m) => m.role)).toEqual(["user", "assistant"]);
    });

    it("stores optional name", () => {
        appendHistory(1, "user", "hi", "Alice");
        expect(getHistory(1)[0].name).toBe("Alice");
    });

    it("leaves name undefined when omitted", () => {
        appendHistory(1, "user", "hi");
        expect(getHistory(1)[0].name).toBeUndefined();
    });

    it("keeps different chats separate", () => {
        appendHistory(1, "user", "for chat 1");
        appendHistory(2, "user", "for chat 2");
        expect(getHistory(1)).toHaveLength(1);
        expect(getHistory(2)).toHaveLength(1);
        expect(getHistory(1)[0].text).toBe("for chat 1");
        expect(getHistory(2)[0].text).toBe("for chat 2");
    });
});

describe("MAX_HISTORY (10)", () => {
    it("keeps all messages when under limit", () => {
        for (let i = 0; i < 10; i++) {
            appendHistory(1, "user", `msg ${i}`);
        }
        expect(getHistory(1)).toHaveLength(10);
        expect(getHistory(1)[0].text).toBe("msg 0");
    });

    it("drops oldest when over limit", () => {
        for (let i = 0; i < 11; i++) {
            appendHistory(1, "user", `msg ${i}`);
        }
        const hist = getHistory(1);
        expect(hist).toHaveLength(10);
        expect(hist[0].text).toBe("msg 1");
        expect(hist[9].text).toBe("msg 10");
    });

    it("keeps last 10 after many appends", () => {
        for (let i = 0; i < 25; i++) {
            appendHistory(1, "user", `msg ${i}`);
        }
        const hist = getHistory(1);
        expect(hist).toHaveLength(10);
        expect(hist[0].text).toBe("msg 15");
        expect(hist[9].text).toBe("msg 24");
    });
});

describe("clearHistory", () => {
    it("clearHistory(chatId) removes only that chat", () => {
        appendHistory(1, "user", "a");
        appendHistory(2, "user", "b");
        clearHistory(1);
        expect(getHistory(1)).toEqual([]);
        expect(getHistory(2)).toHaveLength(1);
    });

    it("clearHistory() removes all chats", () => {
        appendHistory(1, "user", "a");
        appendHistory(2, "user", "b");
        clearHistory();
        expect(getHistory(1)).toEqual([]);
        expect(getHistory(2)).toEqual([]);
    });

    it("clearHistory on unknown chatId is a no-op", () => {
        clearHistory(999);
        expect(getHistory(999)).toEqual([]);
    });
});
