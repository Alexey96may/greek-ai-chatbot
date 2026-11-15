import type { Env } from "./types";

export interface DailyWord {
    greek: string;
    translation: string;
    example: string;
}

export interface BotState {
    lastTopicDate: string | null;
    currentTopic: string | null;
    currentWord: DailyWord | null;
    wordRevealed: boolean;
    recentTopics: string[];
    recentWords: string[];
    pollEnabled: boolean;
    currentPoll: {
        messageId: number;
        options: string[];
    } | null;
}

const DEFAULT_STATE: BotState = {
    lastTopicDate: null,
    currentTopic: null,
    currentWord: null,
    wordRevealed: false,
    recentTopics: [],
    recentWords: [],
    pollEnabled: true,
    currentPoll: null,
};

const KV_KEY = "bot_state";

export async function loadState(env: Env): Promise<BotState> {
    try {
        const raw = await env.GREEK_KV.get(KV_KEY);
        if (!raw) return { ...DEFAULT_STATE };
        return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch (err) {
        console.error("Не удалось загрузить state из KV:", err);
        return { ...DEFAULT_STATE };
    }
}

export async function saveState(env: Env, state: BotState): Promise<void> {
    try {
        await env.GREEK_KV.put(KV_KEY, JSON.stringify(state));
    } catch (err) {
        console.error("Не удалось сохранить state в KV:", err);
    }
}

export function todayString(): string {
    return new Date().toISOString().slice(0, 10);
}
