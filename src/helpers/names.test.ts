import { describe, expect, it } from "vitest";
import { isReadableName } from "./names";

describe("isReadableName", () => {
    describe("valid names", () => {
        it("accepts Cyrillic", () => {
            expect(isReadableName("Алексей")).toBe(true);
        });

        it("accepts Greek", () => {
            expect(isReadableName("Αλέξης")).toBe(true);
        });

        it("accepts Latin", () => {
            expect(isReadableName("Alice")).toBe(true);
        });

        it("accepts name with space", () => {
            expect(isReadableName("Алексей Шульга")).toBe(true);
        });

        it("accepts name with hyphen", () => {
            expect(isReadableName("Анна-Мария")).toBe(true);
        });

        it("accepts exactly 2 chars", () => {
            expect(isReadableName("Ян")).toBe(true);
        });

        it("accepts exactly 30 chars", () => {
            expect(isReadableName("a".repeat(30))).toBe(true);
        });
    });

    describe("invalid names", () => {
        it("rejects undefined", () => {
            expect(isReadableName(undefined)).toBe(false);
        });

        it("rejects empty string", () => {
            expect(isReadableName("")).toBe(false);
        });

        it("rejects 1 char", () => {
            expect(isReadableName("A")).toBe(false);
        });

        it("rejects 31 chars", () => {
            expect(isReadableName("a".repeat(31))).toBe(false);
        });

        it("rejects digits", () => {
            expect(isReadableName("User123")).toBe(false);
        });

        it("rejects emoji", () => {
            expect(isReadableName("Alice😀")).toBe(false);
        });

        it("rejects punctuation", () => {
            expect(isReadableName("Alice!")).toBe(false);
        });

        it("rejects underscore", () => {
            expect(isReadableName("Alice_1")).toBe(false);
        });

        it("rejects slash", () => {
            expect(isReadableName("a/b")).toBe(false);
        });
    });

    describe("edge cases (pins current regex behavior)", () => {
        it("accepts newline (\\s matches \\n)", () => {
            // Possibly unintended: \s includes \n, \t, \r
            expect(isReadableName("ab\ncd")).toBe(true);
        });

        it("accepts tab", () => {
            expect(isReadableName("ab\tcd")).toBe(true);
        });

        it("accepts leading/trailing spaces", () => {
            expect(isReadableName(" ab ")).toBe(true);
        });

        it("accepts a name made of spaces only", () => {
            // Possibly unintended: \s{2,30} allows "  "
            expect(isReadableName("  ")).toBe(true);
        });

        it("accepts leading hyphen", () => {
            expect(isReadableName("-ab")).toBe(true);
        });

        it("accepts trailing hyphen", () => {
            expect(isReadableName("ab-")).toBe(true);
        });
    });
});
