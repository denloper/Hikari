import type { AnimeCard, AnimeTitle, CatalogFilters, CatalogMeta, RelatedTitle, ScheduleDay } from "../../shared/types";
import { cacheGet, cacheGetStale, cacheSet } from "./store";
import { cachePoster, hydrateCard, pickPoster } from "./posters";
import { HttpError, httpJson } from "./http";
import { loadConfig } from "./config";
import {
  getAnilibriaCatalogMeta,
  getAnilibriaTitle,
  getAnilibriaWeekSchedule,
  listAnilibriaCatalog,
  listAnilibriaLatest,
  searchAnilibria
} from "./anilibria";
import { listShikiRates } from "./shiki-oauth";
import type { LibraryItem, ShikiListStatus } from "../../shared/types";
import { jikanSeasonNow } from "./jikan";

const SHIKI_HOSTS = ["https://shikimori.io", "https://shikimori.one", "https://shikimori.me"];
const SEARCH_TTL = 60 * 60 * 1000;
const TITLE_TTL = 2 * 60 * 60 * 1000;
const CATALOG_TTL = 30 * 60 * 1000;
const SCHEDULE_TTL = 15 * 60 * 1000;
const META_TTL = 24 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

let shikiOrigin = SHIKI_HOSTS[0];

interface ShikiImage {
  original?: string;
  preview?: string;
  x96?: string;
}

interface ShikiAnime {
  id: number;
  name: string;
  russian?: string;
  score?: string;
  kind?: string;
  status?: string;
  episodes?: number;
  episodes_aired?: number;
  duration?: number;
  aired_on?: string;
  next_episode_at?: string;
  description?: string | null;
  rating?: string;
  image?: ShikiImage;
  genres?: { id?: number; name: string; russian?: string }[];
}

interface ShikiGenre {
  id: number;
  name: string;
  russian?: string;
  kind?: string;
  entry_type?: string;
}

interface ShikiCalendarItem {
  next_episode?: number;
  next_episode_at?: string;
  anime?: ShikiAnime;
}

function ua(): string {
  return loadConfig().shikimoriUserAgent || "Hikari";
}

function posterRel(image?: ShikiImage): string {
  const rel = image?.original || image?.preview || image?.x96 || "";
  if (!rel || rel.includes("missing_")) return "";
  return rel;
}

function toCard(a: ShikiAnime): AnimeCard {
  const pics = pickPoster(a.id, posterRel(a.image));
  return {
    id: a.id,
    name: a.name,
    russian: a.russian || a.name,
    score: a.score || "0.0",
    kind: a.kind || "",
    status: a.status || "",
    episodes: a.episodes || 0,
    airedOn: a.aired_on || "",
    poster: pics.poster,
    posterLocal: pics.posterLocal,
    lastEpisode: a.episodes_aired || undefined
  };
}

function stripDescription(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/\[character=\d+\](.*?)\[\/character\]/gis, "$1")
    .replace(/\[anime=\d+\](.*?)\[\/anime\]/gis, "$1")
    .replace(/\[manga=\d+\](.*?)\[\/manga\]/gis, "$1")
    .replace(/\[spoiler(?:=[^\]]*)?\].*?\[\/spoiler\]/gis, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim();
}

async function shikiGet<T>(path: string): Promise<T> {
  const headers = {
    "User-Agent": ua(),
    Accept: "application/json"
  };
  const hosts = [shikiOrigin, ...SHIKI_HOSTS.filter((h) => h !== shikiOrigin)];
  let last: unknown;
  for (const host of hosts) {
    try {
      const data = await httpJson<T>(`${host}${path}`, { headers, timeoutMs: 10000 });
      shikiOrigin = host;
      return data;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Shikimori недоступен");
}

function toCards(list: ShikiAnime[]): AnimeCard[] {
  const cards = list.map(toCard);
  for (const a of list) {
    void cachePoster(a.id, posterRel(a.image));
  }
  return cards;
}

function hydrateCards(list?: AnimeCard[] | null): AnimeCard[] {
  return (list ?? []).map(hydrateCard);
}

function hydrateDays(days?: ScheduleDay[] | null): ScheduleDay[] {
  return (days ?? []).map((day) => ({ ...day, items: hydrateCards(day.items) }));
}

function withNextAir<T extends AnimeCard>(card: T): T {
  if (card.nextEpisodeAt && card.nextEpisode) return card;
  const days = cacheGetStale<ScheduleDay[]>("shiki:schedule:week") ?? [];
  for (const day of days) {
    const hit = day.items.find((a) => a.id === card.id);
    if (!hit) continue;
    return {
      ...card,
      nextEpisode: card.nextEpisode || hit.nextEpisode,
      nextEpisodeAt: card.nextEpisodeAt || hit.nextEpisodeAt,
      publishDay: card.publishDay || hit.publishDay
    };
  }
  return card;
}

function mergeUnique(chunks: ShikiAnime[][]): ShikiAnime[] {
  const seen = new Set<number>();
  const out: ShikiAnime[] = [];
  for (const chunk of chunks) {
    for (const a of chunk) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

function hasFilters(f?: CatalogFilters): boolean {
  if (!f) return false;
  return Boolean(
    f.query?.trim() ||
      f.ongoing ||
      f.genreId ||
      f.year ||
      f.kind ||
      f.status ||
      f.minScore ||
      f.order
  );
}

function catalogCacheKey(f?: CatalogFilters): string {
  const page = Math.max(1, f?.page ?? 1);
  if (!hasFilters(f) && page === 1) return "shiki:catalog:home";
  const q = (f?.query ?? "").trim().toLowerCase();
  return `shiki:catalog:f:${f?.ongoing ? 1 : 0}:${f?.genreId ?? 0}:${f?.year ?? 0}:${f?.kind ?? ""}:${f?.status ?? ""}:${f?.minScore ?? 0}:${f?.order ?? ""}:${page}:${q}`;
}

function animeQuery(filters: CatalogFilters | undefined, page: number): string {
  const p = new URLSearchParams();
  p.set("limit", "50");
  p.set("page", String(page));
  const order = filters?.order || (filters?.ongoing ? "ranked" : "popularity");
  p.set("order", order);
  if (filters?.query?.trim()) p.set("search", filters.query.trim());
  if (filters?.status) p.set("status", filters.status);
  else if (filters?.ongoing) p.set("status", "ongoing");
  if (filters?.kind) p.set("kind", filters.kind);
  if (filters?.minScore) p.set("score", String(filters.minScore));
  if (filters?.genreId) p.set("genre", String(filters.genreId));
  if (filters?.year) p.set("season", String(filters.year));
  return `/api/animes?${p.toString()}`;
}

async function listShikiCatalog(filters?: CatalogFilters): Promise<AnimeCard[]> {
  void jikanSeasonNow().catch(() => undefined);
  const page = Math.max(1, filters?.page ?? 1);
  if (!hasFilters(filters)) {
    if (page > 1) {
      return toCards(await shikiGet<ShikiAnime[]>(`/api/animes?limit=50&page=${page}&order=popularity`));
    }
    const [popular, ongoing] = await Promise.all([
      shikiGet<ShikiAnime[]>("/api/animes?limit=50&order=popularity"),
      shikiGet<ShikiAnime[]>("/api/animes?limit=30&status=ongoing&order=ranked")
    ]);
    return toCards(mergeUnique([ongoing, popular]));
  }
  return toCards(await shikiGet<ShikiAnime[]>(animeQuery(filters, page)));
}

function weekdayOf(iso?: string): number | undefined {
  if (!iso) return undefined;
  const js = new Date(iso).getDay();
  if (Number.isNaN(js)) return undefined;
  return js === 0 ? 7 : js;
}

async function listShikiSchedule(): Promise<ScheduleDay[]> {
  const raw = await shikiGet<ShikiCalendarItem[]>("/api/calendar");
  const buckets = new Map<number, AnimeCard[]>();
  for (let day = 1; day <= 7; day += 1) buckets.set(day, []);
  const seen = new Set<number>();

  for (const item of raw ?? []) {
    const anime = item.anime;
    if (!anime?.id || seen.has(anime.id)) continue;
    const weekday = weekdayOf(item.next_episode_at);
    if (!weekday) continue;
    seen.add(anime.id);
    const card = toCard(anime);
    buckets.get(weekday)?.push({
      ...card,
      publishDay: weekday,
      nextEpisode: item.next_episode || undefined,
      nextEpisodeAt: item.next_episode_at || anime.next_episode_at,
      lastEpisode: anime.episodes_aired || undefined
    });
    void cachePoster(anime.id, posterRel(anime.image));
  }

  return Array.from({ length: 7 }, (_, i) => {
    const weekday = i + 1;
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday],
      items: buckets.get(weekday) ?? []
    };
  });
}

async function getShikiCatalogMeta(): Promise<CatalogMeta> {
  const genres = await shikiGet<ShikiGenre[]>("/api/genres");
  const yearNow = new Date().getFullYear();
  const years: number[] = [];
  for (let y = yearNow; y >= 1970; y -= 1) years.push(y);
  return {
    genres: (genres ?? [])
      .filter((g) => g.entry_type === "Anime")
      .map((g) => ({ id: g.id, name: g.russian || g.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    years
  };
}

export async function getSchedule(): Promise<ScheduleDay[]> {
  const key = "shiki:schedule:week";
  void jikanSeasonNow().catch(() => undefined);
  const cached = cacheGet<ScheduleDay[]>(key, SCHEDULE_TTL);
  if (cached?.some((d) => d.items.length)) return hydrateDays(cached);
  try {
    const days = await listShikiSchedule();
    if (days.some((d) => d.items.length)) {
      cacheSet(key, days);
      return days;
    }
  } catch {
    /* запасной источник */
  }
  try {
    const days = hydrateDays(await getAnilibriaWeekSchedule());
    if (days.some((d) => d.items.length)) cacheSet(key, days);
    return days;
  } catch {
    return hydrateDays(cacheGetStale<ScheduleDay[]>(key));
  }
}

export async function getCatalogMeta(): Promise<CatalogMeta> {
  const key = "shiki:catalog:meta";
  const cached = cacheGet<CatalogMeta>(key, META_TTL);
  if (cached?.genres.length) return cached;
  try {
    const meta = await getShikiCatalogMeta();
    if (meta.genres.length) {
      cacheSet(key, meta);
      return meta;
    }
  } catch {
    /* запасной источник */
  }
  try {
    const meta = await getAnilibriaCatalogMeta();
    if (meta.genres.length) cacheSet(key, meta);
    return meta;
  } catch {
    return cacheGetStale<CatalogMeta>(key) ?? { genres: [], years: [] };
  }
}

export async function listCatalog(filters?: CatalogFilters): Promise<AnimeCard[]> {
  const key = catalogCacheKey(filters);
  const cached = cacheGet<AnimeCard[]>(key, CATALOG_TTL);
  if (cached?.length) return hydrateCards(cached);

  try {
    const cards = await listShikiCatalog(filters);
    if (cards.length) {
      cacheSet(key, cards);
      return cards;
    }
    if (hasFilters(filters)) return cards;
  } catch {
    /* запасной источник */
  }

  try {
    const cards = hydrateCards(await listAnilibriaCatalog(filters));
    if (cards.length) {
      cacheSet(key, cards);
      return cards;
    }
  } catch {
    /* ниже stale / ошибка */
  }

  const stale = hydrateCards(cacheGetStale<AnimeCard[]>(key));
  if (stale.length) return stale;
  if (hasFilters(filters)) return [];
  throw new Error("Не удалось загрузить каталог. Проверьте интернет.");
}

export async function searchAnime(query: string): Promise<AnimeCard[]> {
  const q = query.trim();
  if (!q) return listCatalog();
  const key = `shiki:search:${q.toLowerCase()}`;
  const cached = cacheGet<AnimeCard[]>(key, SEARCH_TTL);
  if (cached?.length) return hydrateCards(cached);
  try {
    const list = await shikiGet<ShikiAnime[]>(
      `/api/animes?search=${encodeURIComponent(q)}&limit=50&order=popularity`
    );
    const cards = toCards(list);
    if (cards.length) {
      cacheSet(key, cards);
      return cards;
    }
  } catch {
    /* запасной источник */
  }
  try {
    const cards = hydrateCards(await searchAnilibria(q));
    if (cards.length) {
      cacheSet(key, cards);
      return cards;
    }
  } catch (err) {
    const stale = hydrateCards(cacheGetStale<AnimeCard[]>(key));
    if (stale.length) return stale;
    const extra = err instanceof HttpError ? ` (HTTP ${err.status})` : "";
    throw new Error(`Поиск не удался${extra}.`);
  }
  const stale = hydrateCards(cacheGetStale<AnimeCard[]>(key));
  if (stale.length) return stale;
  return [];
}

export async function getAnime(id: number): Promise<AnimeTitle> {
  const key = `shiki:anime:${id}`;
  const cached = cacheGet<AnimeTitle>(key, TITLE_TTL);
  if (cached) return withNextAir(hydrateCard(cached));
  try {
    const a = await shikiGet<ShikiAnime>(`/api/animes/${id}`);
    void cachePoster(a.id, posterRel(a.image));
    const title: AnimeTitle = {
      ...toCard(a),
      nextEpisode: a.status === "ongoing" && a.episodes_aired ? a.episodes_aired + 1 : undefined,
      nextEpisodeAt: a.next_episode_at,
      description: stripDescription(a.description),
      genres: (a.genres ?? []).map((g) => g.russian || g.name).filter(Boolean),
      genreTags: (a.genres ?? [])
        .map((g) => ({
          id: Number(g.id) || 0,
          name: (g.russian || g.name || "").trim()
        }))
        .filter((g) => g.name),
      rating: a.rating || "",
      episodesAired: a.episodes_aired || a.episodes || 0,
      duration: a.duration || 0
    };
    cacheSet(key, title);
    return withNextAir(title);
  } catch {
    const stale = cacheGetStale<AnimeTitle>(key);
    if (stale) return withNextAir(hydrateCard(stale));
    const fromAni = await getAnilibriaTitle(id);
    if (fromAni) return withNextAir(fromAni);
    throw new Error("Не удалось загрузить тайтл. Проверьте сеть.");
  }
}

export async function getRelated(id: number): Promise<RelatedTitle[]> {
  const key = `shiki:related:${id}`;
  const cached = cacheGet<RelatedTitle[]>(key, TITLE_TTL);
  if (cached) return cached.map((row) => ({ ...row, anime: hydrateCard(row.anime) }));
  try {
    const raw = await shikiGet<
      { relation_russian?: string; relation?: string; anime?: ShikiAnime | null }[]
    >(`/api/animes/${id}/related`);
    const out: RelatedTitle[] = [];
    for (const row of raw ?? []) {
      if (!row.anime?.id) continue;
      out.push({
        relation: row.relation_russian || row.relation || "связанное",
        anime: toCard(row.anime)
      });
      void cachePoster(row.anime.id, posterRel(row.anime.image));
    }
    cacheSet(key, out);
    return out.map((row) => ({ ...row, anime: hydrateCard(row.anime) }));
  } catch {
    return (cacheGetStale<RelatedTitle[]>(key) ?? []).map((row) => ({
      ...row,
      anime: hydrateCard(row.anime)
    }));
  }
}

export async function listLatestReleases(): Promise<AnimeCard[]> {
  try {
    return hydrateCards(await listAnilibriaLatest());
  } catch {
    return [];
  }
}

export async function listShikiUserList(status: ShikiListStatus): Promise<LibraryItem[]> {
  const rows = await listShikiRates(status);
  const out: LibraryItem[] = [];
  for (const row of rows ?? []) {
    const anime = row.anime;
    const id = Number(anime?.id || row.target_id);
    if (!id) continue;
    const card = anime
      ? toCard({
          id,
          name: anime.name || "",
          russian: anime.russian,
          score: anime.score,
          image: anime.image,
          kind: "",
          status: "",
          episodes: 0
        })
      : null;
    out.push({
      animeId: id,
      title: card?.russian || card?.name || anime?.russian || anime?.name || `#${id}`,
      poster: card?.poster || "",
      score: card?.score || (row.score ? String(row.score) : ""),
      episode: row.episodes,
      translationTitle: status,
      at: Date.now()
    });
  }
  return out;
}
