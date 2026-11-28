import OpenAI from "openai";
import type { BotState, DailyWord } from "./state";
import { saveState, todayString } from "./state";
import type { Env } from "./types";
import { BASE_DAILY_PROMPT } from "./prompts/daily";
import { buildPollPrompt } from "./prompts/poll";
import {
    dedupeExact,
    filterUsableTopics,
    pickFocusCategory,
} from "./helpers/topics";
import {
    extractJsonArray,
    invalidAIResponse,
    stripMarkdownCodeFence,
} from "./helpers/ai-json";

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
    const cleaned = stripMarkdownCodeFence(raw);

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
    const focusCategory = pickFocusCategory();
    const prompt = buildPollPrompt(count, recentTopics, focusCategory);

    const response = await ai.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200 + count * 100,
        temperature: 0.9,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const topics = parsePollTopics(raw);
    const unique = dedupeExact(topics);
    const usable = filterUsableTopics(unique, recentTopics);

    console.log(
        `[poll] raw=${topics.length} unique=${unique.length} filtered=${usable.length} count=${count} recent=${recentTopics.length} category=${focusCategory}`,
    );

    if (usable.length < count) {
        throw invalidAIResponse(
            `ИИ вернул ${usable.length} тем вместо ${count}`,
            raw,
        );
    }

    return usable;
}

function parsePollTopics(raw: string): string[] {
    let parsed: unknown;

    try {
        const jsonArray = extractJsonArray(raw);
        parsed = JSON.parse(jsonArray);
    } catch {
        console.error("[AI] Не удалось распарсить темы для опроса:", {
            raw: raw.slice(0, 2000),
        });

        throw invalidAIResponse("Не удалось распарсить темы для опроса", raw);
    }

    if (!Array.isArray(parsed)) {
        throw invalidAIResponse("ИИ вернул не массив тем", raw);
    }

    return parsed
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean);
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
    const cleaned = stripMarkdownCodeFence(raw);

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
