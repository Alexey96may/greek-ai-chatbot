// src/daily.ts
import OpenAI from "openai";
import type { BotState, DailyWord } from "./state";
import { saveState, todayString } from "./state";

const DAILY_TOPIC_PROMPT = `Ты — помощник в чате взаимного изучения греческого и русского языков.
Придумай интересную тему для обсуждения на сегодня (1 короткое предложение на греческом (в скобках с переводом на русский), до 100 символов).
Тема должна подходить для практики языка: простая, жизненная, вызывающая желание ответить.
Подбери ОДНО греческое слово, связанное с темой (имя существительное или глагол в начальной форме).
К слову дай перевод на русский и короткий пример фразы на греческом.

Верни ТОЛЬКО валидный JSON без markdown:
{
  "topic": "Тема для обсуждения",
  "word": {
    "greek": "λέξη",
    "translation": "слово",
    "example": "Παράδειγμα πρότασης."
  }
}`;

export async function generateDailyTopic(
    ai: OpenAI,
    model: string,
    state: BotState,
): Promise<BotState> {
    const today = todayString();

    const response = await ai.chat.completions.create({
        model,
        messages: [{ role: "user", content: DAILY_TOPIC_PROMPT }],
        max_tokens: 300,
        temperature: 0.8,
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/```$/, "")
        .trim();

    try {
        const parsed = JSON.parse(cleaned) as {
            topic: string;
            word: DailyWord;
        };
        const newState: BotState = {
            ...state,
            lastTopicDate: today,
            currentTopic: parsed.topic,
            currentWord: parsed.word,
            wordRevealed: false,
        };
        await saveState(newState);
        console.log(
            `[daily] Новая тема: ${parsed.topic} | слово: ${parsed.word.greek}`,
        );
        return newState;
    } catch (e) {
        console.error("[daily] Не удалось распарсить ответ ИИ:", raw);
        return state;
    }
}

export function formatDailyMessage(state: BotState): string {
    if (!state.currentTopic || !state.currentWord) {
        return "Тема дня ещё не сгенерирована.";
    }
    const w = state.currentWord;
    return (
        `📌 <b>Тема дня:</b> ${state.currentTopic}\n\n` +
        `📖 <b>Слово дня:</b> <code>${w.greek}</code>\n` +
        `Перевод: <tg-spoiler>${w.translation}</tg-spoiler>\n` +
        `Пример: <tg-spoiler>${w.example}</tg-spoiler>`
    );
}
