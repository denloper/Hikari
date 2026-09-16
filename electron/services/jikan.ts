import { HttpError, httpJson } from "./http";
import { rememberPosterSource } from "./posters";

const API = "https://api.jikan.moe/v4";
const SEASON_TTL = 15 * 60 * 1000;
const DAY_MAP: Record<string, number> = {
  mondays: 1,
  tuesdays: 2,
  wednesdays: 3,
  thursdays: 4,
  fridays: 5,
  saturdays: 6,
  sundays: 7
};

export interface JikanAnime {
  mal_id: number;
  title?: string;
  title_english?: string;
  type?: string;
  status?: string;
  score?: number | null;
  members?: number;
  rating?: string;
  images?: { jpg?: { image_url?: string; large_image_url?: string } };
  broadcast?: { day?: string | null };
  demographics?: { name?: string }[];
  genres?: { name?: string }[];
}

let lastCall = 0;
let seasonCache: { at: number; items: JikanAnime[] } | null = null;
let seasonInflight: Promise<JikanAnime[]> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jikanGet<T>(path: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pause = 450 - (Date.now() - lastCall);
    if (pause > 0) await sleep(pause);
    lastCall = Date.now();
    try {
      return await httpJson<T>(`${API}${path}`, {
        headers: { "User-Agent": "Hikari", Accept: "application/json" },
        timeoutMs: 12000
      });
    } catch (err) {
      last = err;
      if (err instanceof HttpError && err.status === 429) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw last instanceof Error ? last : new Error("Jikan недоступен");
}

export function jikanImage(a: JikanAnime): string {
  return a.images?.jpg?.large_image_url || a.images?.jpg?.image_url || "";
}

export function jikanWeekday(a: JikanAnime): number | undefined {
  const day = DAY_MAP[(a.broadcast?.day || "").toLowerCase()];
  return day || undefined;
}

/** Сериал текущего сезона: идёт сейчас, не детский блок. */
export function isCurrentSeasonal(a: JikanAnime): boolean {
  const type = (a.type || "").toUpperCase();
  if (type !== "TV" && type !== "ONA") return false;
  if ((a.status || "") !== "Currently Airing") return false;
  const demo = (a.demographics ?? []).map((d) => (d.name || "").toLowerCase());
  if (demo.includes("kids")) return false;
  const genres = (a.genres ?? []).map((g) => (g.name || "").toLowerCase());
  if (genres.includes("kids")) return false;
  if ((a.rating || "").startsWith("G -") && (a.members || 0) < 80000) return false;
  return true;
}

export async function jikanAnimeImage(id: number): Promise<string> {
  const res = await jikanGet<{ data?: JikanAnime }>(`/anime/${id}`);
  const url = res.data ? jikanImage(res.data) : "";
  if (url) rememberPosterSource(id, url);
  return url;
}

export async function jikanSeasonNow(): Promise<JikanAnime[]> {
  if (seasonCache && Date.now() - seasonCache.at < SEASON_TTL) return seasonCache.items;
  if (seasonInflight) return seasonInflight;
  seasonInflight = (async () => {
    const out: JikanAnime[] = [];
    const seen = new Set<number>();
    for (let page = 1; page <= 4; page += 1) {
      const res = await jikanGet<{
        data?: JikanAnime[];
        pagination?: { has_next_page?: boolean };
      }>(`/seasons/now?page=${page}&sfw=true`);
      for (const item of res.data ?? []) {
        if (!item.mal_id || seen.has(item.mal_id)) continue;
        seen.add(item.mal_id);
        out.push(item);
        const img = jikanImage(item);
        if (img) rememberPosterSource(item.mal_id, img);
      }
      if (!res.pagination?.has_next_page) break;
    }
    seasonCache = { at: Date.now(), items: out };
    return out;
  })().finally(() => {
    seasonInflight = null;
  });
  return seasonInflight;
}
