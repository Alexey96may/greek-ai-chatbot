export function isReadableName(name?: string): boolean {
    if (!name) return false;
    // Только буквы (любой алфавит), пробелы и дефисы. Минимум 2 символа.
    return /^[\p{L}\s-]{2,30}$/u.test(name);
}
