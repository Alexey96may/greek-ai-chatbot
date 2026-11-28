import type { Context } from "grammy";
import type { Env } from "../types";

export function isAllowedChat(ctx: Context, env: Env): boolean {
    const allowedId = Number(env.ALLOWED_CHAT_ID);
    if (!env.ALLOWED_CHAT_ID || Number.isNaN(allowedId)) {
        return false;
    }
    return ctx.chat?.id === allowedId;
}

export function isOwnerPrivate(ctx: Context, env: Env): boolean {
    return (
        ctx.chat?.type === "private" &&
        Boolean(env.OWNER_ID) &&
        ctx.chat.id === Number(env.OWNER_ID)
    );
}

export function isAllowedContext(ctx: Context, env: Env): boolean {
    return isAllowedChat(ctx, env) || isOwnerPrivate(ctx, env);
}
