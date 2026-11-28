export const FOCUS_CATEGORIES = [
    "бытовые ситуации (транспорт, очередь, соседи, магазин)",
    "гипотетические вопросы (что бы ты сделал, если...)",
    "сравнения и выбор (что лучше: X или Y)",
    "наблюдения за привычками и странностями людей",
    "сезонные и локальные детали (праздники, погода, город)",
    "лёгкие абсурдные или игровые темы",
];

export function pickFocusCategory(): string {
    return FOCUS_CATEGORIES[
        Math.floor(Math.random() * FOCUS_CATEGORIES.length)
    ];
}

export function dedupeExact(topics: string[]): string[] {
    return [
        ...new Map(
            topics.map((topic) => [topic.toLocaleLowerCase(), topic]),
        ).values(),
    ];
}

export function normalizeTopic(t: string): Set<string> {
    return new Set(
        t
            .toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .filter((w) => w.length > 4),
    );
}

export function isSimilar(a: string, b: string): boolean {
    const A = normalizeTopic(a);
    const B = normalizeTopic(b);
    if (A.size === 0 || B.size === 0) return false;
    let overlap = 0;
    for (const w of A) if (B.has(w)) overlap++;
    return overlap / Math.min(A.size, B.size) >= 0.5;
}

export function filterUsableTopics(
    topics: string[],
    recentTopics: string[],
): string[] {
    return topics.filter((topic) => {
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
}
