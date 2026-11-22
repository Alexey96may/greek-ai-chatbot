import type { Bot } from "grammy";
import type { Env } from "../types";
import { setupCommands } from "./commands";
import { setupText } from "./text";
import { setupVoice } from "./voice";
import { setupPhoto } from "./photo";
import { setupStickers } from "./stickers";
import { setupYouTubeHandler } from "./youtube";

export function setupHandlers(bot: Bot, env: Env, botUsername: string) {
    setupCommands(bot, env);
    setupStickers(bot, env);
    setupYouTubeHandler(bot, env);
    setupText(bot, env, botUsername);
    setupVoice(bot, env);
    setupPhoto(bot, env);
}
