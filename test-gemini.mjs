import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    timeout: 25000,
    maxRetries: 0,
});

try {
    console.log("Отправляю сообщение в Gemini...");

    const response = await client.chat.completions.create({
        model: "gemini-3.5-flash-lite",
        messages: [
            {
                role: "user",
                content: "Привет! Ответь по-русски: Gemini работает?",
            },
        ],
    });

    console.log("\nОтвет Gemini:");
    console.log(response.choices[0].message.content);

    console.log("\nИспользование токенов:");
    console.log(response.usage);
} catch (error) {
    console.error("\nОшибка Gemini:");
    console.error("Status:", error.status);
    console.error("Message:", error.message);
    console.error("Code:", error.code);
}
