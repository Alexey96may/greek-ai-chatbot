// src/state.ts
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

export interface DailyWord {
    greek: string;
    translation: string;
    example: string;
}

export interface BotState {
    lastTopicDate: string | null; // "2026-11-12"
    currentTopic: string | null;
    currentWord: DailyWord | null;
    wordRevealed: boolean;
}

const DEFAULT_STATE: BotState = {
    lastTopicDate: null,
    currentTopic: null,
    currentWord: null,
    wordRevealed: false,
};

export async function loadState(): Promise<BotState> {
    try {
        if (!existsSync(STATE_FILE)) {
            await mkdir(DATA_DIR, { recursive: true });
            await writeFile(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2));
            return { ...DEFAULT_STATE };
        }
        const raw = await readFile(STATE_FILE, "utf-8");
        return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch (err) {
        console.error("Не удалось загрузить state:", err);
        return { ...DEFAULT_STATE };
    }
}

export async function saveState(state: BotState): Promise<void> {
    try {
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error("Не удалось сохранить state:", err);
    }
}

export function todayString(): string {
    return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" (UTC)
}
