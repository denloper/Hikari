import type {
  AnimeCard,
  AnimeTitle,
  CatalogFilters,
  CatalogMeta,
  EpisodeRef,
  ScheduleDay,
  StreamResult,
  Translation
} from "../../shared/types";
import { cacheGet, cacheGetStale, cacheSet } from "./store";
import { httpJson } from "./http";
import { publicPosterUrl } from "./posters";

const API = "https://anilibria.top/api/v1";
const CDN = "https://anilibria.top";

interface AniName {
  main?: string;
  english?: string;
  alternative?: string;
}

interface AniEpisode {
  id: string;
  name?: string;
  ordinal?: number;
  hls_480?: string;
  hls_720?: string;
  hls_1080?: string;
}

interface AniShikimori {
  id?: number;
  rating?: number;
}

interface AniMal {
  id?: number;
}

interface AniPoster {
  src?: string;
  preview?: string;
  optimized?: { src?: string; preview?: string };
}

interface AniGenre {
  name?: string;
}

interface AniPublishDay {
  value?: number;
  description?: string;
}

interface AniRelease {
  id: number | string;
  name?: AniName;
  year?: number;
  type?: { value?: string; description?: string };
  description?: string;
  episodes_total?: number;
  is_ongoing?: boolean;
  shikimori?: AniShikimori;
  mal?: AniMal;
  poster?: AniPoster;
  genres?: AniGenre[];
  episodes?: AniEpisode[];
  age_rating?: { label?: string };
  publish_day?: AniPublishDay;
}

interface ScheduleItem {
  release?: AniRelease;
  next_release_episode_number?: number | null;
  published_release_episode?: { ordinal?: number };
}

const WEEKDAY_LABELS = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

function absUrl(url?: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${CDN}${url.startsWith("/") ? "" : "/"}${url}`;
}

function absHls(url?: string): string {
  return absUrl(url);
}

function releaseName(r: AniRelease): string {
  return r.name?.main || r.name?.english || "";
}

function posterOf(r: AniRelease): string {
  return absUrl(r.poster?.optimized?.src || r.poster?.src || r.poster?.preview);
}

function cardId(r: AniRelease): number {
  return Number(r.shikimori?.id) || Number(r.id);
}

function publishDayOf(r: AniRelease): number | undefined {
  const day = Number(r.publish_day?.value);
  return day >= 1 && day <= 7 ? day : undefined;
}

function nextAirFromWeekday(weekday?: number): string | undefined {
  if (!weekday || weekday < 1 || weekday > 7) return undefined;
  const now = new Date();
  const js = weekday === 7 ? 0 : weekday;
  const add = (js - now.getDay() + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
  return d.toISOString();
}

function lastEpisodeOf(r: AniRelease): number | undefined {
  const fromList = (r.episodes ?? [])
    .map((e) => Number(e.ordinal) || 0)
    .filter((n) => n > 0);
  if (fromList.length) return Math.max(...fromList);
  return r.episodes_total || undefined;
}

export function releaseToCard(r: AniRelease): AnimeCard {
  return {
    id: cardId(r),
    name: r.name?.english || r.name?.main || "",
    russian: r.name?.main || r.name?.english || "",
    score: r.shikimori?.rating ? r.shikimori.rating.toFixed(2) : "—",
    kind: (r.type?.value || "").toLowerCase(),
    status: r.is_ongoing ? "ongoing" : "released",
    episodes: r.episodes_total || r.episodes?.length || 0,
    airedOn: r.year ? `${r.year}-01-01` : "",
    poster: posterOf(r) || publicPosterUrl(cardId(r)),
    publishDay: publishDayOf(r),
    lastEpisode: lastEpisodeOf(r)
  };
}

export function releaseToTitle(r: AniRelease): AnimeTitle {
  return {
    ...releaseToCard(r),
    description: (r.description || "").replace(/\r/g, ""),
    genres: (r.genres ?? []).map((g) => g.name || "").filter(Boolean),
    rating: r.age_rating?.label || "",
    episodesAired: r.episodes?.length || r.episodes_total || 0,
    duration: 0
  };
}

function rememberTitle(r: AniRelease): AnimeTitle {
  const title = releaseToTitle(r);
  cacheSet(`anime:${title.id}`, title);
  cacheSet(`al:shiki:${title.id}`, r.id);
  return title;
}

const INDEX_KEY = "al:shiki-index";
const INDEX_TTL = 12 * 60 * 60 * 1000;
const API_HEADERS = { Accept: "application/json", "User-Agent": "Hikari" };

type ShikiIndex = Record<string, number>;

let indexMem: ShikiIndex | null = null;
let indexAt = 0;
let indexJob: Promise<ShikiIndex> | null = null;

function putIndex(map: ShikiIndex, r: AniRelease): void {
  const rid = Number(r.id);
  if (!rid) return;
  const sid = Number(r.shikimori?.id);
  const mid = Number(r.mal?.id);
  if (sid) map[String(sid)] = rid;
  if (mid) map[String(mid)] = rid;
}

async function catalogIndexPage(page: number): Promise<{ data?: AniRelease[]; pages: number }> {
  const p = new URLSearchParams();
  p.set("limit", "50");
  p.set("page", String(page));
  p.set("f[sorting]", "RATING_DESC");
  p.set("include", "id,shikimori,mal");
  const res = await httpJson<{ data?: AniRelease[]; meta?: { pagination?: { total_pages?: number } } }>(
    `${API}/anime/catalog/releases?${p.toString()}`,
    { headers: API_HEADERS, timeoutMs: 12000 }
  );
  return { data: res.data, pages: res.meta?.pagination?.total_pages || 1 };
}

async function buildShikiIndex(seed: ShikiIndex): Promise<ShikiIndex> {
  const map: ShikiIndex = { ...seed };
  try {
    const first = await catalogIndexPage(1);
    for (const r of first.data ?? []) putIndex(map, r);
    const rest = Array.from({ length: Math.min(first.pages, 50) - 1 }, (_, i) => i + 2);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, rest.length) }, async () => {
        while (cursor < rest.length) {
          const page = rest[cursor];
          cursor += 1;
          try {
            const res = await catalogIndexPage(page);
            for (const r of res.data ?? []) putIndex(map, r);
          } catch {
            /* одна страница каталога */
          }
        }
      })
    );
    if (Object.keys(map).length) {
      cacheSet(INDEX_KEY, map);
      indexMem = map;
      indexAt = Date.now();
    }
  } catch {
    /* оставим то, что уже было */
  }
  return map;
}

async function getShikiIndex(): Promise<ShikiIndex> {
  if (indexMem && Date.now() - indexAt < INDEX_TTL) return indexMem;
  const cached = cacheGet<ShikiIndex>(INDEX_KEY, INDEX_TTL);
  if (cached && Object.keys(cached).length) {
    indexMem = cached;
    indexAt = Date.now();
    return cached;
  }
  const stale = cacheGetStale<ShikiIndex>(INDEX_KEY) ?? {};
  if (indexJob) return indexJob;
  indexJob = buildShikiIndex(stale).finally(() => {
    indexJob = null;
  });
  return indexJob;
}

export function warmAnilibriaIndex(): void {
  void getShikiIndex();
}

function readyIndex(): ShikiIndex | null {
  if (indexMem && Object.keys(indexMem).length) return indexMem;
  return cacheGetStale<ShikiIndex>(INDEX_KEY);
}

export async function getAnilibriaCatalogMeta(): Promise<CatalogMeta> {
  const [genres, years] = await Promise.all([
    httpJson<{ id: number; name: string }[]>(`${API}/anime/catalog/references/genres`, { timeoutMs: 10000 }),
    httpJson<number[]>(`${API}/anime/catalog/references/years`, { timeoutMs: 10000 })
  ]);
  return {
    genres: (genres ?? []).map((g) => ({ id: g.id, name: g.name })),
    years: (years ?? []).slice().reverse()
  };
}

function hasFilters(f?: CatalogFilters): boolean {
  if (!f) return false;
  return Boolean(f.query?.trim() || f.ongoing || f.genreId || f.year || f.kind || f.status || f.minScore || f.order);
}

async function fetchCatalogPage(filters: CatalogFilters, page: number): Promise<AnimeCard[]> {
  const p = new URLSearchParams();
  p.set("limit", "50");
  p.set("page", String(page));
  if (filters.order === "aired_on" || filters.ongoing || filters.status === "ongoing") {
    p.set("f[sorting]", "FRESH_AT_DESC");
  } else {
    p.set("f[sorting]", "RATING_DESC");
  }
  if (filters.query?.trim()) p.set("f[search]", filters.query.trim());
  const status = filters.status || (filters.ongoing ? "ongoing" : undefined);
  if (status === "ongoing") p.set("f[publish_statuses]", "IS_ONGOING");
  else if (status === "released") p.set("f[publish_statuses]", "IS_FINISHED");
  if (filters.genreId) p.set("f[genres]", String(filters.genreId));
  if (filters.year) {
    p.set("f[years][from_year]", String(filters.year));
    p.set("f[years][to_year]", String(filters.year));
  }
  const res = await httpJson<{ data?: AniRelease[] }>(`${API}/anime/catalog/releases?${p.toString()}`, {
    timeoutMs: 12000
  });
  return (res.data ?? []).map(rememberTitle);
}

function asScheduleItems(raw: unknown): ScheduleItem[] {
  if (Array.isArray(raw)) return raw as ScheduleItem[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: ScheduleItem[] }).data;
  }
  return [];
}

export async function getAnilibriaWeekSchedule(): Promise<ScheduleDay[]> {
  const raw = await httpJson<unknown>(`${API}/anime/schedule/week`, { timeoutMs: 12000 });
  const buckets = new Map<number, AnimeCard[]>();
  for (let day = 1; day <= 7; day += 1) buckets.set(day, []);
  const seen = new Set<number>();

  for (const item of asScheduleItems(raw)) {
    const release = item.release;
    if (!release) continue;
    const card = rememberTitle(release);
    const weekday = card.publishDay ?? 0;
    if (weekday < 1 || weekday > 7 || seen.has(card.id)) continue;
    seen.add(card.id);
    buckets.get(weekday)?.push({
      ...card,
      nextEpisode: item.next_release_episode_number ?? undefined,
      nextEpisodeAt: nextAirFromWeekday(weekday),
      lastEpisode: item.published_release_episode?.ordinal
    });
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

export async function queryAnilibriaCatalog(filters: CatalogFilters): Promise<AnimeCard[]> {
  const page = Math.max(1, filters.page ?? 1);
  return fetchCatalogPage(filters, page);
}

export async function listAnilibriaLatest(): Promise<AnimeCard[]> {
  warmAnilibriaIndex();
  const latest = await httpJson<AniRelease[]>(`${API}/anime/releases/latest`, { timeoutMs: 10000 });
  return (latest ?? []).map(rememberTitle);
}

export async function listAnilibriaCatalog(filters?: CatalogFilters): Promise<AnimeCard[]> {
  if (hasFilters(filters)) {
    return queryAnilibriaCatalog(filters ?? {});
  }
  const [latest, page1, page2] = await Promise.all([
    httpJson<AniRelease[]>(`${API}/anime/releases/latest`, { timeoutMs: 10000 }),
    httpJson<{ data?: AniRelease[] }>(`${API}/anime/catalog/releases?limit=50&page=1`, { timeoutMs: 10000 }),
    httpJson<{ data?: AniRelease[] }>(`${API}/anime/catalog/releases?limit=50&page=2`, { timeoutMs: 10000 }).catch(
      () => ({ data: [] })
    )
  ]);
  const seen = new Set<number>();
  const cards: AnimeCard[] = [];
  for (const r of [...(latest ?? []), ...(page1.data ?? []), ...(page2.data ?? [])]) {
    const id = cardId(r);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cards.push(rememberTitle(r));
  }
  return cards;
}

export async function searchAnilibria(query: string): Promise<AnimeCard[]> {
  const list = await httpJson<AniRelease[]>(
    `${API}/app/search/releases?query=${encodeURIComponent(query)}`,
    { timeoutMs: 10000 }
  );
  return (list ?? []).map(rememberTitle);
}

export async function getAnilibriaTitle(shikimoriOrReleaseId: number): Promise<AnimeTitle | null> {
  try {
    const full = await httpJson<AniRelease>(`${API}/anime/releases/${shikimoriOrReleaseId}`, {
      timeoutMs: 10000
    });
    if (full?.id) return rememberTitle(full);
  } catch {
    /* id мог быть shikimori, не release */
  }
  try {
    const list = await httpJson<AniRelease[]>(`${API}/app/search/releases?query=${shikimoriOrReleaseId}`, {
      timeoutMs: 10000
    });
    const hit = (list ?? []).find((r) => Number(r.shikimori?.id) === shikimoriOrReleaseId || Number(r.id) === shikimoriOrReleaseId);
    if (!hit?.id) return null;
    const full = await httpJson<AniRelease>(`${API}/anime/releases/${hit.id}`, { timeoutMs: 10000 });
    return rememberTitle(full);
  } catch {
    return null;
  }
}

async function translationFromRelease(releaseId: number | string): Promise<Translation | null> {
  let full: AniRelease;
  try {
    full = await httpJson<AniRelease>(`${API}/anime/releases/${releaseId}`, {
      headers: API_HEADERS,
      timeoutMs: 10000
    });
  } catch {
    return null;
  }
  if (!full?.id) return null;
  rememberTitle(full);
  const episodes: EpisodeRef[] = (full.episodes ?? [])
    .map((ep) => ({
      number: Number(ep.ordinal ?? 0),
      title: ep.name,
      ref: ep.id
    }))
    .filter((e) => e.number > 0 && e.ref)
    .sort((a, b) => a.number - b.number);
  if (!episodes.length) return null;
  return {
    id: `anilibria:${full.id}`,
    title: "AniLibria",
    type: "voice",
    source: "anilibria",
    seasons: [{ number: 1, episodes }],
    lastEpisode: episodes[episodes.length - 1]?.number
  };
}

function releaseMatchesAnime(r: AniRelease, animeId: number): boolean {
  return Number(r.shikimori?.id) === animeId || Number(r.mal?.id) === animeId;
}

export async function findAnilibria(anime: AnimeTitle): Promise<Translation | null> {
  warmAnilibriaIndex();
  const cachedId = cacheGetStale<number | string>(`al:shiki:${anime.id}`);
  if (cachedId) {
    const fromCache = await translationFromRelease(cachedId);
    if (fromCache) return fromCache;
  }

  const queries = [anime.russian, anime.name].filter(Boolean);
  for (const q of queries) {
    try {
      const list = await httpJson<AniRelease[]>(`${API}/app/search/releases?query=${encodeURIComponent(q)}`, {
        headers: API_HEADERS,
        timeoutMs: 8000
      });
      const hit = (list ?? []).find((r) => releaseMatchesAnime(r, anime.id));
      if (hit?.id) return translationFromRelease(hit.id);
    } catch {
      /* пробуем другое имя */
    }
  }

  const rid = readyIndex()?.[String(anime.id)];
  if (rid) return translationFromRelease(rid);
  return null;
}

export async function resolveAnilibria(episodeId: string): Promise<StreamResult> {
  const ep = await httpJson<AniEpisode>(`${API}/anime/releases/episodes/${episodeId}`, {
    headers: { Accept: "application/json" }
  });
  const qualities = [
    { height: 1080, url: absHls(ep.hls_1080) },
    { height: 720, url: absHls(ep.hls_720) },
    { height: 480, url: absHls(ep.hls_480) }
  ].filter((q) => q.url);
  if (!qualities.length) {
    throw new Error("У AniLibria нет HLS для этой серии");
  }
  return { kind: "hls", qualities, referer: "https://anilibria.top/" };
}
