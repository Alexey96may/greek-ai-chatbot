export interface Env {
    BOT_TOKEN: string;
    GEMINI_API_KEY: string;
    GROQ_API_KEY?: string;
    ALLOWED_CHAT_ID: string;
    OWNER_ID?: string;
    GREEK_KV: KVNamespace;
}
