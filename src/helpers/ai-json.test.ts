import { describe, expect, it } from "vitest";
import {
    extractJsonArray,
    invalidAIResponse,
    stripMarkdownCodeFence,
} from "./ai-json";

describe("stripMarkdownCodeFence", () => {
    it("returns plain string as-is (trimmed)", () => {
        expect(stripMarkdownCodeFence('{"a":1}')).toBe('{"a":1}');
        expect(stripMarkdownCodeFence('  {"a":1}  ')).toBe('{"a":1}');
    });

    it("strips ```json fence", () => {
        expect(stripMarkdownCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it("strips bare ``` fence", () => {
        expect(stripMarkdownCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    });

    it("strips fence when trailing newline after closing fence", () => {
        // TODO: currently fails — closing ``` is followed by \n,
        // and .replace(/```$/) runs before .trim(). Fix stripMarkdownCodeFence.
        expect(stripMarkdownCodeFence('```json\n{"a":1}\n```\n')).toBe(
            '{"a":1}',
        );
    });

    it("is case-insensitive for json tag", () => {
        expect(stripMarkdownCodeFence('```JSON\n{"a":1}\n```')).toBe('{"a":1}');
    });
});

describe("extractJsonArray", () => {
    it("returns the array as-is when input is clean JSON array", () => {
        expect(extractJsonArray('["a","b"]')).toBe('["a","b"]');
    });

    it("ignores text before and after the array", () => {
        expect(extractJsonArray('Вот темы:\n["a","b"]\nГотово.')).toBe(
            '["a","b"]',
        );
    });

    it("strips markdown fence before extracting", () => {
        expect(extractJsonArray('```json\n["a","b"]\n```')).toBe('["a","b"]');
    });

    it("handles nested arrays", () => {
        expect(extractJsonArray('[["a"],["b"]]')).toBe('[["a"],["b"]]');
    });

    it("does not confuse ] inside a string with array end", () => {
        const raw = '["topic with ] bracket","other"]';
        expect(extractJsonArray(raw)).toBe(raw);
    });

    it("does not confuse escaped quote with string end", () => {
        const raw = '["topic with \\"quote\\"","other"]';
        expect(extractJsonArray(raw)).toBe(raw);
    });

    it("throws when no array is present", () => {
        expect(() => extractJsonArray("no array here")).toThrow(
            "JSON-массив не найден",
        );
    });

    it("throws when array is not closed", () => {
        expect(() => extractJsonArray('["a","b"')).toThrow(
            "JSON-массив не завершён",
        );
    });

    it("throws on unbalanced brackets inside string (edge)", () => {
        // Строка с [ внутри не должна увеличивать depth
        const raw = '["a [ b","c"]';
        expect(extractJsonArray(raw)).toBe(raw);
    });
});

describe("invalidAIResponse", () => {
    it("sets code INVALID_AI_RESPONSE", () => {
        const err = invalidAIResponse("label", "raw");
        expect(err).toBeInstanceOf(Error);
        expect((err as Error & { code: string }).code).toBe(
            "INVALID_AI_RESPONSE",
        );
    });

    it("includes label and truncated raw in message", () => {
        const err = invalidAIResponse("Не удалось", "x".repeat(2000));
        expect(err.message).toContain("Не удалось");
        expect(err.message.length).toBeLessThan(2000);
    });

    it("truncates raw to 1500 chars", () => {
        const raw = "y".repeat(3000);
        const err = invalidAIResponse("label", raw);
        // label + ": " + 1500 chars
        expect(err.message).toBe(`label: ${"y".repeat(1500)}`);
    });
});
