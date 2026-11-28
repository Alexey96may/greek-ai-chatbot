import { describe, expect, it } from "vitest";
import { arrayBufferToBase64 } from "./base64";

function buf(bytes: number[]): ArrayBuffer {
    return new Uint8Array(bytes).buffer;
}

describe("arrayBufferToBase64", () => {
    it("encodes empty buffer as empty string", () => {
        expect(arrayBufferToBase64(buf([]))).toBe("");
    });

    it("encodes ASCII bytes", () => {
        // "hello" = [104, 101, 108, 108, 111]
        expect(arrayBufferToBase64(buf([104, 101, 108, 108, 111]))).toBe(
            "aGVsbG8=",
        );
    });

    it("encodes single byte", () => {
        // 0x00 -> "AA=="
        expect(arrayBufferToBase64(buf([0]))).toBe("AA==");
    });

    it("encodes bytes > 127 (binary, not UTF-8)", () => {
        // 0xFF 0xFE -> "//4="
        expect(arrayBufferToBase64(buf([0xff, 0xfe]))).toBe("//4=");
    });

    it("handles buffer exactly at chunk boundary (8192 bytes)", () => {
        const bytes = new Array(8192).fill(0x41); // 'A'
        const result = arrayBufferToBase64(buf(bytes));
        // 8192 'A' in base64 = "QUFB..." длиной 10924
        expect(result.length).toBe(Math.ceil(8192 / 3) * 4);
        expect(result.startsWith("QUFB")).toBe(true);
    });

    it("handles buffer larger than one chunk (20000 bytes)", () => {
        const bytes = new Array(20000).fill(0x42); // 'B'
        const result = arrayBufferToBase64(buf(bytes));
        expect(result.length).toBe(Math.ceil(20000 / 3) * 4);
        expect(result.startsWith("QkJC")).toBe(true);
    });

    it("produces same result as Buffer for large input", () => {
        const bytes = Array.from({ length: 20000 }, (_, i) => i % 256);
        const result = arrayBufferToBase64(buf(bytes));
        const expected = Buffer.from(bytes).toString("base64");
        expect(result).toBe(expected);
    });

    it("handles 8191 bytes (just under chunk size)", () => {
        const bytes = new Array(8191).fill(0x43); // 'C'
        const result = arrayBufferToBase64(buf(bytes));
        expect(result.length).toBe(Math.ceil(8191 / 3) * 4);
    });

    it("handles 8193 bytes (just over chunk size)", () => {
        const bytes = new Array(8193).fill(0x44); // 'D'
        const result = arrayBufferToBase64(buf(bytes));
        expect(result.length).toBe(Math.ceil(8193 / 3) * 4);
    });
});
