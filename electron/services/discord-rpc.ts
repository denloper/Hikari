import { Client } from "@xhayper/discord-rpc";
import { ActivityType } from "discord-api-types/v10";
import type { DiscordPresence } from "../../shared/types";
import { loadConfig } from "./config";
import { discordPosterUrl } from "./posters";

/** Публичный Application ID приложения Hikari. Пользователю его вводить не нужно. */
export const HIKARI_DISCORD_APP_ID = "1538541495949201498";

let client: Client | null = null;
let ready = false;
let connecting = false;
let last: DiscordPresence | null = null;
let startedAt = 0;
let startedKey = "";
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clip(text: string, max = 128): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function clientId(): string {
  return HIKARI_DISCORD_APP_ID;
}

function sessionKey(p: DiscordPresence | null): string {
  if (!p?.title) return "";
  return `${p.animeId || 0}:${p.episode || 0}:${p.studio || ""}`;
}

export function startDiscordRpc(): void {
  void connect();
}

export function applyDiscordConfig(): void {
  const cfg = loadConfig();
  if (!cfg.discordRpc) {
    void shutdownDiscordRpc();
    return;
  }
  void connect(true);
}

export async function shutdownDiscordRpc(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const cur = client;
  client = null;
  ready = false;
  connecting = false;
  if (!cur) return;
  try {
    await cur.user?.clearActivity();
  } catch {
    /* Discord уже закрыт */
  }
  try {
    await cur.destroy();
  } catch {
    /* нет соединения */
  }
}

export function setDiscordPresence(next: DiscordPresence | null): void {
  last = next;
  if (!loadConfig().discordRpc) return;
  void flush();
}

async function connect(force = false): Promise<void> {
  if (!loadConfig().discordRpc) return;
  const id = clientId();
  if (!/^\d{17,20}$/.test(id)) return;
  if (connecting) return;
  if (client && ready && !force) {
    await flush();
    return;
  }
  if (force) await shutdownDiscordRpc();
  connecting = true;
  try {
    const next = new Client({ clientId: id });
    next.on("ready", () => {
      ready = true;
      connecting = false;
      void flush();
    });
    next.on("disconnected", () => {
      ready = false;
      if (client === next) {
        client = null;
        scheduleRetry();
      }
    });
    client = next;
    await next.login();
  } catch {
    connecting = false;
    ready = false;
    client = null;
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (retryTimer || !loadConfig().discordRpc) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect();
  }, 15000);
}

async function flush(): Promise<void> {
  if (!loadConfig().discordRpc) return;
  if (!client || !ready || !client.user) {
    if (!connecting && !client) void connect();
    return;
  }
  const p = last;
  const key = sessionKey(p);
  if (key && key !== startedKey) {
    startedKey = key;
    startedAt = Date.now();
  }
  if (!key) {
    startedKey = "";
    startedAt = 0;
  }
  try {
    if (!p?.title || p.browsing) {
      await client.user.setActivity({
        type: ActivityType.Watching,
        details: "Просматривает тайтлы",
        state: "Hikari",
        largeImageText: "Hikari",
        statusDisplayType: 0
      });
      return;
    }
    const want = sessionKey(p);
    const image = p.animeId ? await discordPosterUrl(p.animeId) : "";
    if (sessionKey(last) !== want) return;
    const ep = p.episode && p.episode > 0 ? `Серия ${p.episode}` : "";
    const studio = p.studio ? clip(p.studio, 64) : "";
    const bits = [p.paused ? "Пауза" : "", ep, studio].filter(Boolean);
    await client.user.setActivity({
      type: ActivityType.Watching,
      details: clip(p.title),
      state: clip(bits.join(" · ") || "Смотрит"),
      startTimestamp: p.paused ? undefined : startedAt || Date.now(),
      largeImageKey: image || undefined,
      largeImageText: clip(p.title, 128),
      statusDisplayType: 2,
      instance: false,
      buttons:
        p.animeId && p.animeId > 0
          ? [{ label: "Shikimori", url: `https://shikimori.io/animes/${p.animeId}` }]
          : undefined
    });
  } catch {
    /* Discord отбросил активность */
  }
}
