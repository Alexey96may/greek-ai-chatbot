export function markdownToTelegramHtml(text: string): string {
    return (
        text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            // **текст** → <b>текст</b>
            .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
            // *текст* → <i>текст</i>
            .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<i>$1</i>")
            // `текст` → <code>текст</code>
            .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    );
}
