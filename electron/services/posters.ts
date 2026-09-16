import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { appPosterUrl } from "../../shared/poster";
import type { AnimeCard } from "../../shared/types";
import { HttpError, httpBuffer, httpJson } from "./http";
import { loadConfig } from "./config";

const SHIKI_IMAGE = "https://shikimori.io";
const remoteById = new Map<number, string>();
const inflight = new Map<number, Promise<Buffer | null>>();
const splashInflight = new Map<number, Promise<Buffer | null>>();
const jikanInflight = new Map<number, Promise<string>>();
const anilistInflight = new Map<number, Promise<string>>();
let posterSlots = 0;
const posterWait: Array<() => void> = [];
const POSTER_CONCURRENCY = 4;

function posterDir(): string {
  const dir = path.join(app.getPath("userData"), "posters");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function localPosterPath(animeId: number): string {
  return path.join(posterDir(), `${animeId}.jpg`);
}

export function localSplashPath(animeId: number): string {
  return path.join(posterDir(), `${animeId}-splash.jpg`);
}

async function withPosterSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (posterSlots >= POSTER_CONCURRENCY) {
    await new Promise<void>((ok) => posterWait.push(ok));
  }
  posterSlots += 1;
  try {
    return await fn();
  } finally {
    posterSlots -= 1;
    posterWait.shift()?.();
  }
}

export function shikiPosterUrl(animeId: number): string {
  return `${SHIKI_IMAGE}/system/animes/original/${animeId}.jpg`;
}

function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 24) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return true;
  return false;
}

function readLocal(animeId: number): Buffer | null {
  const file = localPosterPath(animeId);
  try {
    if (!fs.existsSync(file)) return null;
    const buf = fs.readFileSync(file);
    if (isImageBuffer(buf)) return buf;
    fs.unlinkSync(file);
    return null;
  } catch {
    return null;
  }
}

function isUsableRemote(url?: string): boolean {
  return Boolean(url && url.startsWith("http") && !url.includes("missing_"));
}

export function publicPosterUrl(animeId: number, remote?: string): string {
  let url = (remote || "").trim();
  if (url.includes("missing_") || url.startsWith("hikari:") || url.startsWith("file:")) url = "";
  if (url.startsWith("//")) url = `https:${url}`;
  if (url.startsWith("/") && !url.includes("missing_")) url = `${SHIKI_IMAGE}${url}`;
  if (isUsableRemote(url)) {
    return url.replace(/^https:\/\/(nyaa\.|desu\.)?shikimori\.(one|me)/, SHIKI_IMAGE);
  }
  return animeId > 0 ? shikiPosterUrl(animeId) : "";
}

export function rememberPosterSource(animeId: number, remote?: string): void {
  if (animeId <= 0) return;
  const url = publicPosterUrl(animeId, remote);
  if (url && !url.endsWith(`/original/${animeId}.jpg`)) {
    remoteById.set(animeId, url);
    return;
  }
  if (url && !remoteById.has(animeId)) remoteById.set(animeId, url);
}

export function pickPoster(animeId: number, remote?: string): { poster: string; posterLocal?: string } {
  rememberPosterSource(animeId, remote);
  const url = appPosterUrl(animeId);
  return { poster: url, posterLocal: url };
}

export function hydrateCard<T extends AnimeCard>(card: T): T {
  const pics = pickPoster(card.id, card.poster);
  return { ...card, poster: pics.poster, posterLocal: pics.posterLocal };
}

export function hydrateLibraryPoster(animeId: number, stored?: string): string {
  rememberPosterSource(animeId, stored);
  return appPosterUrl(animeId);
}

async function lookupJikanImage(animeId: number): Promise<string> {
  const pending = jikanInflight.get(animeId);
  if (pending) return pending;
  const work = import("./jikan")
    .then((mod) => mod.jikanAnimeImage(animeId))
    .catch(() => "")
    .finally(() => jikanInflight.delete(animeId));
  jikanInflight.set(animeId, work);
  return work;
}

function isMalHost(url: string): boolean {
  return url.includes("myanimelist.net") || url.includes("myanimelist.cdn");
}

function isShikiHost(url: string): boolean {
  return /shikimori\.(io|one|me)/.test(url);
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const buf = await httpBuffer(
      url,
      {
        "User-Agent": "Hikari",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: isMalHost(url)
          ? "https://myanimelist.net/"
          : url.includes("anilibria") || url.includes("libria")
            ? "https://anilibria.top/"
            : url.includes("anilist")
              ? "https://anilist.co/"
              : `${SHIKI_IMAGE}/`
      },
      isShikiHost(url) ? 8000 : 10000
    );
    return isImageBuffer(buf) ? buf : null;
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 429)) return null;
    return null;
  }
}

async function trySave(animeId: number, url: string, seen: Set<string>): Promise<Buffer | null> {
  if (!url || seen.has(url) || url.includes("missing_")) return null;
  seen.add(url);
  const buf = await fetchImage(url);
  if (!buf) return null;
  fs.writeFileSync(localPosterPath(animeId), buf);
  return buf;
}

async function lookupAniListImage(malId: number): Promise<string> {
  const pending = anilistInflight.get(malId);
  if (pending) return pending;
  const work = httpJson<{ data?: { Media?: { coverImage?: { extraLarge?: string; large?: string } } } }>(
    "https://graphql.anilist.co",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query ($id: Int) { Media(idMal: $id, type: ANIME) { coverImage { extraLarge large } } }",
        variables: { id: malId }
      }),
      timeoutMs: 8000
    }
  )
    .then((res) => res.data?.Media?.coverImage?.extraLarge || res.data?.Media?.coverImage?.large || "")
    .catch(() => "")
    .finally(() => anilistInflight.delete(malId));
  anilistInflight.set(malId, work);
  return work;
}

async function downloadPoster(animeId: number, remoteUrl: string): Promise<Buffer | null> {
  const seen = new Set<string>();
  const remembered = remoteById.get(animeId) || "";
  const guessed = publicPosterUrl(animeId, remoteUrl);
  const shikiUrls = [
    remembered,
    guessed,
    shikiPosterUrl(animeId),
    `${SHIKI_IMAGE}/system/animes/original/${animeId}.jpg`,
    `${SHIKI_IMAGE}/system/animes/preview/${animeId}.jpg`,
    `${SHIKI_IMAGE}/system/animes/x96/${animeId}.jpg`
  ];

  // Новые id на shikimori.io часто без файла. Сначала внешние обложки.
  const preferMal = isMalHost(remembered) || animeId >= 45000;

  if (remembered && !isShikiHost(remembered)) {
    const buf = await trySave(animeId, remembered, seen);
    if (buf) return buf;
  }

  if (preferMal) {
    const anilist = await lookupAniListImage(animeId);
    const fromAni = await trySave(animeId, anilist, seen);
    if (fromAni) return fromAni;
    const mal = isMalHost(remembered) ? "" : await lookupJikanImage(animeId);
    const fromMal = await trySave(animeId, mal, seen);
    if (fromMal) return fromMal;
  }

  for (const url of shikiUrls) {
    const buf = await trySave(animeId, url, seen);
    if (buf) return buf;
  }

  if (!preferMal) {
    const anilist = await lookupAniListImage(animeId);
    const fromAni = await trySave(animeId, anilist, seen);
    if (fromAni) return fromAni;
    const mal = await lookupJikanImage(animeId);
    const fromMal = await trySave(animeId, mal, seen);
    if (fromMal) return fromMal;
  }
  return null;
}

async function fetchScreenshotUrl(animeId: number): Promise<string> {
  const hosts = ["https://shikimori.io", "https://shikimori.one", "https://shikimori.me"];
  const headers = {
    "User-Agent": loadConfig().shikimoriUserAgent || "Hikari",
    Accept: "application/json"
  };
  for (const host of hosts) {
    try {
      const list = await httpJson<{ original?: string }[]>(`${host}/api/animes/${animeId}/screenshots`, {
        headers,
        timeoutMs: 8000
      });
      const rel = list?.[0]?.original || list?.[1]?.original || "";
      if (!rel) continue;
      if (rel.startsWith("http")) return rel;
      return `${host}${rel.startsWith("/") ? "" : "/"}${rel}`;
    } catch {
      /* другой хост */
    }
  }
  return "";
}

async function downloadSplash(animeId: number): Promise<Buffer | null> {
  const seen = new Set<string>();
  const shot = await fetchScreenshotUrl(animeId);
  if (!shot) return null;
  return trySaveSplash(animeId, shot, seen);
}

async function trySaveSplash(animeId: number, url: string, seen: Set<string>): Promise<Buffer | null> {
  if (!url || seen.has(url) || url.includes("missing_")) return null;
  seen.add(url);
  const buf = await fetchImage(url);
  if (!buf) return null;
  fs.writeFileSync(localSplashPath(animeId), buf);
  return buf;
}

export async function loadSplashBuffer(animeId: number): Promise<Buffer | null> {
  if (animeId <= 0) return null;
  try {
    if (fs.existsSync(localSplashPath(animeId))) {
      const buf = fs.readFileSync(localSplashPath(animeId));
      if (isImageBuffer(buf)) return buf;
    }
  } catch {
    /* качаем заново */
  }
  const pending = splashInflight.get(animeId);
  if (pending) return pending;
  const work = downloadSplash(animeId).finally(() => splashInflight.delete(animeId));
  splashInflight.set(animeId, work);
  return work;
}

export async function cachePoster(animeId: number, remoteUrl: string): Promise<string | undefined> {
  rememberPosterSource(animeId, remoteUrl);
  const buf = await loadPosterBuffer(animeId);
  return buf ? appPosterUrl(animeId) : undefined;
}

const discordPosterCache = new Map<number, string>();
const discordPosterInflight = new Map<number, Promise<string>>();

function isDiscordFriendlyPoster(url: string): boolean {
  return /anilist\.co|anilistcdn|myanimelist\.net|wsrv\.nl|weserv\.nl/.test(url);
}

function proxyForDiscord(url: string): string {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=512&output=jpg`;
}

/** Обложка, которую Discord сможет забрать (AniList / MAL, не Шикимори). */
export async function discordPosterUrl(animeId: number): Promise<string> {
  if (animeId <= 0) return "";
  const cached = discordPosterCache.get(animeId);
  if (cached) return cached;
  const pending = discordPosterInflight.get(animeId);
  if (pending) return pending;
  const work = (async () => {
    const remembered = remoteById.get(animeId) || "";
    if (isDiscordFriendlyPoster(remembered)) {
      discordPosterCache.set(animeId, remembered);
      return remembered;
    }
    const anilist = await lookupAniListImage(animeId);
    if (anilist) {
      rememberPosterSource(animeId, anilist);
      discordPosterCache.set(animeId, anilist);
      return anilist;
    }
    const mal = await lookupJikanImage(animeId);
    if (mal) {
      rememberPosterSource(animeId, mal);
      discordPosterCache.set(animeId, mal);
      return mal;
    }
    const fallback = remembered && isUsableRemote(remembered) ? remembered : shikiPosterUrl(animeId);
    const proxied = fallback ? proxyForDiscord(fallback) : "";
    if (proxied) discordPosterCache.set(animeId, proxied);
    return proxied;
  })().finally(() => discordPosterInflight.delete(animeId));
  discordPosterInflight.set(animeId, work);
  return work;
}

export async function loadPosterBuffer(animeId: number, remoteUrl = ""): Promise<Buffer | null> {
  if (animeId <= 0) return null;
  if (remoteUrl) rememberPosterSource(animeId, remoteUrl);
  const cached = readLocal(animeId);
  if (cached) return cached;
  const pending = inflight.get(animeId);
  if (pending) return pending;
  const work = withPosterSlot(() => downloadPoster(animeId, remoteUrl)).finally(() => inflight.delete(animeId));
  inflight.set(animeId, work);
  return work;
}
