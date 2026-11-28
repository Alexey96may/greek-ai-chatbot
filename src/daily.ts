import OpenAI from "openai";
import type { BotState, DailyWord } from "./state";
import { saveState, todayString } from "./state";
import type { Env } from "./types";
import { BASE_DAILY_PROMPT } from "./prompts/daily";

const FOCUS_CATEGORIES = [
    "бытовые ситуации (транспорт, очередь, соседи, магазин)",
    "гипотетические вопросы (что бы ты сделал, если...)",
    "сравнения и выбор (что лучше: X или Y)",
    "наблюдения за привычками и странностями людей",
    "сезонные и локальные детали (праздники, погода, город)",
    "лёгкие абсурдные или игровые темы",
];

function buildPrompt(state: BotState): string {
    const parts = [BASE_DAILY_PROMPT];

    if (state.recentTopics.length > 0) {
        parts.push(
            `\n\nНЕ повторяй эти недавние темы:\n${state.recentTopics.map((t) => `- ${t}`).join("\n")}`,
        );
    }

    if (state.recentWords.length > 0) {
        parts.push(
            `\n\nНЕ повторяй эти недавние слова:\n${state.recentWords.map((w) => `- ${w}`).join("\n")}`,
        );
    }

    return parts.join("");
}

export async function generateDailyTopic(
    ai: OpenAI,
    model: string,
    env: Env,
    state: BotState,
): Promise<BotState> {
    const today = todayString();

    const response = await ai.chat.completions.create({
        model,
        messages: [{ role: "user", content: buildPrompt(state) }],
        max_tokens: 300,
        temperature: 0.8,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/```$/, "")
        .trim();

    let parsed: unknown;

    try {
        parsed = JSON.parse(cleaned);
    } catch {
        throw invalidAIResponse("Не удалось распарсить ежедневную тему", raw);
    }

    if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as any).topic !== "string" ||
        !(parsed as any).topic.trim() ||
        !isDailyWord((parsed as any).word)
    ) {
        throw invalidAIResponse("ИИ вернул некорректную тему или слово", raw);
    }

    const data = parsed as {
        topic: string;
        word: DailyWord;
    };

    const recentTopics = [data.topic, ...state.recentTopics].slice(0, 30);
    const recentWords = [data.word.greek, ...state.recentWords].slice(0, 30);

    const newState: BotState = {
        ...state,
        lastTopicDate: today,
        currentTopic: data.topic,
        currentWord: data.word,
        wordRevealed: false,
        recentTopics,
        recentWords,
    };

    await saveState(env, newState);

    console.log(
        `[daily] Новая тема: ${data.topic} | слово: ${data.word.greek}`,
    );

    return newState;
}

export function formatDailyMessage(state: BotState, tieNote?: string): string {
    if (!state.currentTopic || !state.currentWord) {
        return "Тема дня ещё не сгенерирована.";
    }
    const w = state.currentWord;
    const tieLine = tieNote ? `\n${tieNote}` : "";
    return (
        `📌 <b>Тема дня:</b> ${state.currentTopic}` +
        tieLine +
        `\n\n📖 <b>Слово дня:</b> <code>${w.greek}</code>\n` +
        `Перевод: <tg-spoiler>${w.translation}</tg-spoiler>\n` +
        `Пример: <tg-spoiler>${w.example}</tg-spoiler>`
    );
}

export async function generatePollTopics(
    ai: OpenAI,
    model: string,
    count: number,
    recentTopics: string[],
): Promise<string[]> {
    const focusCategory =
        FOCUS_CATEGORIES[Math.floor(Math.random() * FOCUS_CATEGORIES.length)];

    const recentList =
        recentTopics.length > 0
            ? `\n\nНЕ повторяй эти недавние темы:\n${recentTopics.map((t) => `- ${t}`).join("\n")}`
            : "";

    const prompt = `Придумай ровно ${count} разных тем для обсуждения на завтра в чате изучения греческого и русского.

Требования:
- Темы должны быть простыми, жизненными и интересными для обсуждения.
- Каждая тема — ОДНО короткое предложение.
- Формат: греческая фраза, затем перевод на русский в скобках.
- ВАЖНО: весь вариант (греческий + перевод в скобках) — строго до 90 символов, иначе Telegram отклонит опрос.
- Греческая фраза — максимум 4–5 слов.
- Все темы должны быть разными.

Разнообразие:
- Старайся охватить разные углы: бытовые ситуации, гипотетические вопросы ("что бы ты сделал, если..."), сравнения/выбор ("что лучше: X или Y"), наблюдения за привычками людей, сезонные/локальные детали, лёгкие абсурдные или игровые темы.
- В этот раз сделай акцент на категории: ${focusCategory}.
- Не повторяй темы из списка ниже и не генерируй близкие по смыслу.


Плохие примеры (не надо): темы только про еду, только про погоду, только про работу, общие вопросы вроде "Что ты любишь делать?".

${recentList}

Верни ТОЛЬКО валидный JSON-массив из ровно ${count} строк.
Не добавляй markdown, пояснения или текст до и после массива.

Пример:
["Τι τρώτε συνήθως για πρωινό; (Что вы обычно едите на завтрак?)", "Πού σας αρέσει να ταξιδεύετε; (Куда вы любите путешествовать?)"]`;

    const response = await ai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200 + count * 100,
        temperature: 0.9,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";

    let parsed: unknown;

    try {
        const jsonArray = extractJsonArray(raw);
        parsed = JSON.parse(jsonArray);
    } catch {
        console.error("[AI] Не удалось распарсить темы для опроса:", {
            model,
            raw: raw.slice(0, 2000),
        });

        throw invalidAIResponse("Не удалось распарсить темы для опроса", raw);
    }

    if (!Array.isArray(parsed)) {
        throw invalidAIResponse("ИИ вернул не массив тем", raw);
    }

    const topics = parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);

    // Удаляем повторяющиеся темы без учёта регистра
    const uniqueTopics = [
        ...new Map(
            topics.map((topic) => [topic.toLocaleLowerCase(), topic]),
        ).values(),
    ].slice(0, count);

    // Отбрасываем темы, близкие по смыслу к недавним, и слишком длинные для Telegram
    // Отбрасываем темы, близкие по смыслу к недавним, и невалидные по длине
    const filteredTopics = uniqueTopics.filter((topic) => {
        const len = [...topic].length;
        const tooShort = len < 10;
        const tooLong = len > 100;
        const similar = recentTopics.some((recent) => isSimilar(topic, recent));

        if (tooShort || tooLong || similar) {
            const reason = tooShort ? "short" : tooLong ? "long" : "similar";
            console.log(`[poll] dropped (${reason}): ${topic}`);
        }

        return !tooShort && !tooLong && !similar;
    });

    console.log(
        `[poll] raw=${topics.length} unique=${uniqueTopics.length} filtered=${filteredTopics.length} count=${count} recent=${recentTopics.length} category=${focusCategory}`,
    );

    if (filteredTopics.length < count) {
        throw invalidAIResponse(
            `ИИ вернул ${filteredTopics.length} тем вместо ${count}`,
            raw,
        );
    }

    return filteredTopics;
}

export async function generateWordForTopic(
    ai: OpenAI,
    model: string,
    topic: string,
    recentWords: string[],
): Promise<DailyWord> {
    const recentList =
        recentWords.length > 0
            ? `\n\nНЕ повторяй эти недавние слова:\n${recentWords.map((w) => `- ${w}`).join("\n")}`
            : "";

    const prompt = `Тема дня в чате изучения греческого: "${topic}".
Подбери ОДНО греческое слово, связанное с этой темой (не сильно простое, имя существительное с артиклем или глагол в начальной форме).
Дай перевод на русский и короткий пример фразы на греческом.${recentList}

Верни ТОЛЬКО валидный JSON без markdown:
{
  "greek": "η λέξη",
  "translation": "слово",
  "example": "Παράδειγμα πρότασης."
}`;

    const response = await ai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.7,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/```$/, "")
        .trim();

    let parsed: unknown;

    try {
        parsed = JSON.parse(cleaned);
    } catch {
        throw invalidAIResponse("Не удалось распарсить слово для темы", raw);
    }

    if (!isDailyWord(parsed)) {
        throw invalidAIResponse("ИИ вернул некорректное слово", raw);
    }

    return parsed;
}

function invalidAIResponse(label: string, raw: string): Error {
    const error = new Error(`${label}: ${raw.slice(0, 1500)}`) as Error & {
        code: string;
    };

    error.code = "INVALID_AI_RESPONSE";
    return error;
}

function isDailyWord(value: unknown): value is DailyWord {
    if (!value || typeof value !== "object") return false;

    const word = value as Record<string, unknown>;

    return (
        typeof word.greek === "string" &&
        word.greek.trim().length > 0 &&
        typeof word.translation === "string" &&
        word.translation.trim().length > 0 &&
        typeof word.example === "string" &&
        word.example.trim().length > 0
    );
}

function normalizeTopic(t: string): Set<string> {
    return new Set(
        t
            .toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .filter((w) => w.length > 4),
    );
}

function isSimilar(a: string, b: string): boolean {
    const A = normalizeTopic(a);
    const B = normalizeTopic(b);
    if (A.size === 0 || B.size === 0) return false;
    let overlap = 0;
    for (const w of A) if (B.has(w)) overlap++;
    return overlap / Math.min(A.size, B.size) >= 0.5;
}

function extractJsonArray(raw: string): string {
    // Убираем Markdown-обёртку, если она есть
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();

    const start = cleaned.indexOf("[");

    if (start === -1) {
        throw new Error("JSON-массив не найден");
    }

    // Ищем конец массива, учитывая строки и экранированные кавычки
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
