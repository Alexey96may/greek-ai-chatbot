export function stripMarkdownCodeFence(raw: string): string {
    return raw
        .trim()
        .replace(/^```[a-z]*\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
}

export function invalidAIResponse(label: string, raw: string): Error {
    const error = new Error(`${label}: ${raw.slice(0, 1500)}`) as Error & {
        code: string;
    };

    error.code = "INVALID_AI_RESPONSE";
    return error;
}

export function extractJsonArray(raw: string): string {
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("[");

    if (start === -1) {
        throw new Error("JSON-массив не найден");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === "[") {
            depth++;
        } else if (char === "]") {
            depth--;
            if (depth === 0) {
                return cleaned.slice(start, i + 1);
            }
        }
    }

    throw new Error("JSON-массив не завершён");
}
