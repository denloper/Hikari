import { Client } from "@xhayper/discord-rpc";
import { ActivityType } from "discord-api-types/v10";
import type { SetActivity } from "@xhayper/discord-rpc";
import type { DiscordPresence } from "../../shared/types";
import { loadConfig } from "./config";
import { discordPosterUrl } from "./posters";

/** Публичный Application ID приложения Hikari. Пользователю его вводить не нужно. */
export const HIKARI_DISCORD_APP_ID = "1538541495949201498";

/** Уже лежит в репозитории — Discord забирает по HTTPS, hikari:// и Шикимори не умеет. */
export const HIKARI_DISCORD_LOGO =
  "https://wsrv.nl/?url=" +
  encodeURIComponent("https://raw.githubusercontent.com/denloper/Hikari/main/build/icon.png?v=lantern") +
  "&w=512&h=512&fit=contain&bg=07080c&output=png";

let client: Client | null = null;
let ready = false;
let connecting = false;
let last: DiscordPresence | null = null;
let startedAt = 0;
let startedKey = "";
let browseStartedAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const posterByAnime = new Map<number, string>();
const posterPending = new Set<number>();
let lastSig = "";
let lastFlushAt = 0;

function clip(text: string, max = 128): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function clientId(): string {
  return HIKARI_DISCORD_APP_ID;
}

function sessionKey(p: DiscordPresence | null): string {
  if (!p?.title || p.browsing) return "";
  return `${p.animeId || 0}:${p.episode || 0}:${p.studio || ""}`;
}

function presenceSig(p: DiscordPresence | null): string {
  if (!p || p.browsing || !p.title) return "browse";
  const bucket = Math.floor(Math.max(0, p.positionSec || 0) / 15);
  return [p.animeId, p.episode, p.studio, p.paused ? 1 : 0, bucket, Math.round(p.durationSec || 0), posterByAnime.get(p.animeId || 0) || ""].join(":");
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
  lastSig = "";
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
    await flush(true);
    return;
  }
  if (force) await shutdownDiscordRpc();
  connecting = true;
  try {
    const next = new Client({ clientId: id });
    next.on("ready", () => {
      ready = true;
      connecting = false;
      lastSig = "";
      void flush(true);
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

function watchTimestamps(p: DiscordPresence): Pick<SetActivity, "startTimestamp" | "endTimestamp"> {
  const pos = p.positionSec;
  const dur = p.durationSec;
  if (typeof pos === "number" && pos >= 0 && dur && dur > 1) {
    const start = Date.now() - Math.floor(pos * 1000);
    return { startTimestamp: start, endTimestamp: start + Math.floor(dur * 1000) };
  }
  if (p.paused) return {};
  return { startTimestamp: startedAt || Date.now() };
}

async function publish(activity: SetActivity): Promise<void> {
  const user = client?.user;
  if (!user) return;
  try {
    await user.setActivity(activity);
  } catch {
    try {
      await user.setActivity({ ...activity, buttons: undefined });
    } catch {
      /* Discord отбросил активность */
    }
  }
}

function previewImage(p: DiscordPresence): string {
  if (p.animeId && posterByAnime.has(p.animeId)) return posterByAnime.get(p.animeId) || HIKARI_DISCORD_LOGO;
  return HIKARI_DISCORD_LOGO;
}

function pullPoster(animeId: number): void {
  if (animeId <= 0 || posterByAnime.has(animeId) || posterPending.has(animeId)) return;
  posterPending.add(animeId);
  void discordPosterUrl(animeId)
    .then((url) => {
      if (url) posterByAnime.set(animeId, url);
    })
    .catch(() => undefined)
    .finally(() => {
      posterPending.delete(animeId);
      void flush(true);
    });
}

async function flush(force = false): Promise<void> {
  if (!loadConfig().discordRpc) return;
  if (!client || !ready || !client.user) {
    if (!connecting && !client) void connect();
    return;
  }
  const p = last;
  const sig = presenceSig(p);
  const now = Date.now();
  if (!force && sig === lastSig && now - lastFlushAt < 2000) return;
  lastSig = sig;
  lastFlushAt = now;

  const key = sessionKey(p);
  if (key && key !== startedKey) {
    startedKey = key;
    startedAt = Date.now();
    browseStartedAt = 0;
  }
  if (!key) {
    startedKey = "";
    startedAt = 0;
    if (!browseStartedAt) browseStartedAt = Date.now();
  }

  if (!p?.title || p.browsing) {
    await publish({
      type: ActivityType.Watching,
      details: "Просматривает тайтлы",
      state: "Каталог",
      startTimestamp: browseStartedAt || Date.now(),
      largeImageKey: HIKARI_DISCORD_LOGO,
      largeImageText: "Hikari",
      statusDisplayType: 0
    });
    return;
  }

  if (p.animeId) pullPoster(p.animeId);
  const image = previewImage(p);
  const ep = p.episode && p.episode > 0 ? `Серия ${p.episode}` : "";
  const studio = p.studio ? clip(p.studio, 64) : "";
  const bits = [p.paused ? "Пауза" : "", ep, studio].filter(Boolean);
  await publish({
    type: ActivityType.Watching,
    details: clip(p.title),
    state: clip(bits.join(" · ") || "Смотрит"),
    ...watchTimestamps(p),
    largeImageKey: image,
    largeImageText: clip(p.title, 128),
    smallImageKey: image === HIKARI_DISCORD_LOGO ? undefined : HIKARI_DISCORD_LOGO,
    smallImageText: image === HIKARI_DISCORD_LOGO ? undefined : "Hikari",
    statusDisplayType: 2
  });
}
