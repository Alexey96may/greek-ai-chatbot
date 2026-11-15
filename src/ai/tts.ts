import type { Bot } from "grammy";
import type { Env } from "../types";
import { notifyOwner } from "../helpers/notify";

const ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George

export async function textToSpeech(
    env: Env,
    text: string,
    bot?: Bot,
): Promise<Uint8Array | null> {
    if (!env.ELEVENLABS_API_KEY) {
        console.log("[TTS] ELEVENLABS_API_KEY не настроен");
        return null;
    }

    try {
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=opus_48000_64`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": env.ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75,
                        speed: 0.9,
                    },
                }),
            },
        );

        if (!response.ok) {
            const err = await response.text();
            console.error(`[TTS] ElevenLabs error: ${response.status} ${err}`);
            if (bot)
                await notifyOwner(
                    bot,
                    env,
                    "tts:elevenlabs",
                    `${response.status} ${err}`,
                );
            return null;
        }

        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
    } catch (err) {
        console.error("[TTS] Ошибка:", err);
        return null;
    }
}
