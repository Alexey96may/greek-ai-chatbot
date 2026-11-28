import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    FOCUS_CATEGORIES,
    dedupeExact,
    filterUsableTopics,
    isSimilar,
    normalizeTopic,
    pickFocusCategory,
} from "./topics";

describe("pickFocusCategory", () => {
    it("returns a value from FOCUS_CATEGORIES", () => {
        for (let i = 0; i < 50; i++) {
            expect(FOCUS_CATEGORIES).toContain(pickFocusCategory());
        }
    });

    it("eventually returns different categories", () => {
        // Math.random is not seeded, so just check it can vary
        const seen = new Set<string>();
        for (let i = 0; i < 200; i++) {
            seen.add(pickFocusCategory());
        }
        expect(seen.size).toBeGreaterThan(1);
    });
});

describe("dedupeExact", () => {
    it("returns empty array for empty input", () => {
        expect(dedupeExact([])).toEqual([]);
    });

    it("keeps unique topics as-is", () => {
        expect(dedupeExact(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    });

    it("removes duplicates case-insensitively", () => {
        expect(dedupeExact(["Hello", "hello", "HELLO"])).toEqual(["Hello"]);
    });

    it("keeps first occurrence, preserves its case", () => {
        expect(dedupeExact(["First", "first"])).toEqual(["First"]);
    });
});

describe("normalizeTopic", () => {
    it("lowercases and splits into words", () => {
        const result = normalizeTopic("Hello World");
        expect(result).toEqual(new Set(["hello", "world"]));
    });

    it("drops words with length <= 4", () => {
        const result = normalizeTopic("the quick brown fox");
        // "the" (3), "fox" (3) dropped; "quick" (5), "brown" (5) kept
        expect(result).toEqual(new Set(["quick", "brown"]));
    });

    it("strips punctuation", () => {
        const result = normalizeTopic("hello, world!");
        expect(result).toEqual(new Set(["hello", "world"]));
    });

    it("handles Greek", () => {
        const result = normalizeTopic("Τι τρώτε το πρωί");
        // "Τι" (2), "το" (2) dropped; "πρωί" (4) dropped; "τρώτε" (5) kept
        expect(result).toEqual(new Set(["τρώτε"]));
    });

    it("handles mixed Cyrillic and Greek", () => {
        const result = normalizeTopic("Привет Γεια");
        expect(result).toEqual(new Set(["привет"]));
    });

    it("returns empty Set for empty string", () => {
        expect(normalizeTopic("")).toEqual(new Set());
    });
});

describe("isSimilar", () => {
    it("returns false when either side has no long words", () => {
        expect(isSimilar("Ти то", "Τι το")).toBe(false);
        expect(isSimilar("", "")).toBe(false);
        expect(isSimilar("a b", "hello world")).toBe(false);
    });

    it("returns true for identical long words", () => {
        expect(isSimilar("hello world", "hello world")).toBe(true);
    });

    it("returns true when half the words overlap", () => {
        // A = {hello, world}, B = {hello, friend}
        // overlap 1, min(2,2) = 2, ratio 0.5 >= 0.5 -> true
        expect(isSimilar("hello world", "hello friend")).toBe(true);
    });

    it("returns false when fewer than half overlap", () => {
        // A = {hello, world, again}, B = {hello, friend, other}
        // overlap 1, min(3,3) = 3, ratio 0.33 < 0.5 -> false
        expect(isSimilar("hello world again", "hello friend other")).toBe(
            false,
        );
    });

    it("uses the shorter side for the ratio", () => {
        // A = {hello}, B = {hello, world, again}
        // overlap 1, min(1, 3) = 1, ratio 1.0 -> true
        expect(isSimilar("hello", "hello world again")).toBe(true);
    });

    it("is not fooled by short words", () => {
        // all words <= 4 chars -> both Sets empty -> false
        expect(isSimilar("Τι το με", "Τι το σε")).toBe(false);
    });
});

describe("filterUsableTopics", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
    });

    it("keeps valid topics", () => {
        const result = filterUsableTopics(
            ["valid topic with enough length"],
            [],
        );
        expect(result).toEqual(["valid topic with enough length"]);
    });

    it("drops topics shorter than 10 chars", () => {
        const result = filterUsableTopics(["short"], []);
        expect(result).toEqual([]);
    });

    it("drops topics longer than 100 chars", () => {
        const long = "a".repeat(101);
        const result = filterUsableTopics([long], []);
        expect(result).toEqual([]);
    });

    it("keeps topics exactly 10 chars", () => {
        const exact = "a".repeat(10);
        expect(filterUsableTopics([exact], [])).toEqual([exact]);
    });

    it("keeps topics exactly 100 chars", () => {
        const exact = "a".repeat(100);
        expect(filterUsableTopics([exact], [])).toEqual([exact]);
    });

    it("drops topics similar to recent", () => {
        const result = filterUsableTopics(
            ["hello world again"],
            ["hello world again"],
        );
        expect(result).toEqual([]);
    });

    it("keeps topics not similar to recent", () => {
        const result = filterUsableTopics(
            ["hello world again"],
            ["completely different topic"],
        );
        expect(result).toEqual(["hello world again"]);
    });

    it("logs the drop reason", () => {
        filterUsableTopics(["short"], []);
        expect(logSpy).toHaveBeenCalledWith("[poll] dropped (short): short");
    });

    it("logs similar drop", () => {
        filterUsableTopics(["hello world"], ["hello world"]);
        expect(logSpy).toHaveBeenCalledWith(
            "[poll] dropped (similar): hello world",
        );
    });

    it("logs long drop", () => {
        const long = "a".repeat(101);
        filterUsableTopics([long], []);
        expect(logSpy).toHaveBeenCalledWith(`[poll] dropped (long): ${long}`);
    });

    it("counts code points, not UTF-16 units", () => {
        // 100 emoji + 1 = 101 code points, but 202 UTF-16 units
        // Should be dropped by length > 100
        const withEmoji = "😀".repeat(101);
        const result = filterUsableTopics([withEmoji], []);
        expect(result).toEqual([]);
    });

    it("preserves order of kept topics", () => {
        const result = filterUsableTopics(
            ["aaaa bbbb cccc", "dddd eeee ffff", "gggg hhhh iiii"],
            [],
        );
        expect(result).toEqual([
            "aaaa bbbb cccc",
            "dddd eeee ffff",
            "gggg hhhh iiii",
        ]);
    });
});
