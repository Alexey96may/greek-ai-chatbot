export type HistoryMessage = {
    role: "user" | "assistant";
    name?: string;
    text: string;
};

const historyMap = new Map<number, HistoryMessage[]>();
const MAX_HISTORY = 10;

export function getHistory(chatId: number): HistoryMessage[] {
    return historyMap.get(chatId) ?? [];
}

export function appendHistory(
    chatId: number,
    role: "user" | "assistant",
    text: string,
    name?: string,
): void {
    let history = historyMap.get(chatId) ?? [];
    history.push({ role, text, name });
    if (history.length > MAX_HISTORY) {
        history = history.slice(-MAX_HISTORY);
    }
    historyMap.set(chatId, history);
}
