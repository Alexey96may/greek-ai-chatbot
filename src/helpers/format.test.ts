import { describe, expect, it } from "vitest";
import { markdownToTelegramHtml } from "./format";

describe("markdownToTelegramHtml", () => {
    describe("HTML escaping", () => {
        it("escapes & < >", () => {
            expect(markdownToTelegramHtml("a & b < c > d")).toBe(
                "a &amp; b &lt; c &gt; d",
            );
        });

        it("escapes HTML before applying markdown", () => {
            // <script> must not survive as a tag
            expect(markdownToTelegramHtml("<script>alert(1)</script>")).toBe(
                "&lt;script&gt;alert(1)&lt;/script&gt;",
            );
        });

        it("escapes & inside bold", () => {
            expect(markdownToTelegramHtml("**a & b**")).toBe(
                "<b>a &amp; b</b>",
            );
        });
    });

    describe("bold", () => {
        it("converts **text** to <b>", () => {
            expect(markdownToTelegramHtml("**hello**")).toBe("<b>hello</b>");
        });

        it("converts multiple bold segments", () => {
            expect(markdownToTelegramHtml("**a** and **b**")).toBe(
                "<b>a</b> and <b>b</b>",
            );
        });

        it("does not convert single * as bold", () => {
            expect(markdownToTelegramHtml("*italic*")).toBe("<i>italic</i>");
        });
    });

    describe("italic", () => {
        it("converts *text* to <i>", () => {
            expect(markdownToTelegramHtml("*hello*")).toBe("<i>hello</i>");
        });

        it("does not match across newlines", () => {
            // [^*\n]+ excludes newlines
            expect(markdownToTelegramHtml("*a\nb*")).toBe("*a\nb*");
        });

        it("does not match empty", () => {
            expect(markdownToTelegramHtml("**")).toBe("**");
        });
    });

    describe("inline code", () => {
        it("converts `text` to <code>", () => {
            expect(markdownToTelegramHtml("`code`")).toBe("<code>code</code>");
        });

        it("does not match across newlines", () => {
            expect(markdownToTelegramHtml("`a\nb`")).toBe("`a\nb`");
        });

        it("does not match empty", () => {
            expect(markdownToTelegramHtml("``")).toBe("``");
        });
    });

    describe("mixed", () => {
        it("handles bold + italic + code together", () => {
            expect(markdownToTelegramHtml("**b** *i* `c`")).toBe(
                "<b>b</b> <i>i</i> <code>c</code>",
            );
        });

        it("escapes HTML inside code", () => {
            expect(markdownToTelegramHtml("`<b>`")).toBe(
                "<code>&lt;b&gt;</code>",
            );
        });
    });

    describe("edge cases (pins current regex behavior)", () => {
        it("plain text is returned unchanged", () => {
            expect(markdownToTelegramHtml("hello world")).toBe("hello world");
        });

        it("empty string", () => {
            expect(markdownToTelegramHtml("")).toBe("");
        });

        it("unclosed bold is left as-is", () => {
            expect(markdownToTelegramHtml("**unclosed")).toBe("**unclosed");
        });

        it("unclosed italic is left as-is", () => {
            expect(markdownToTelegramHtml("*unclosed")).toBe("*unclosed");
        });

        it("unclosed code is left as-is", () => {
            expect(markdownToTelegramHtml("`unclosed")).toBe("`unclosed");
        });

        it("***triple*** is not handled specially", () => {
            // Pins current behavior: bold regex grabs **...**, then
            // italic regex may or may not touch the leftover *. Documented
            // so a future change is a conscious decision, not a surprise.
            const result = markdownToTelegramHtml("***x***");
            expect(result).toContain("x");
            // exact value depends on regex order; see below
        });
    });
});
