import type { AnimeTitle, EpisodeRef, Season, StreamResult, Translation } from "../../shared/types";
import { httpJson } from "./http";
import { resolveKodikHls } from "./kodik";
import { BROWSER_UA, pickBest, scoreNames, yearOfAnime } from "./titles";

const API = "https://api.cdnlibs.org/api";
const SITE = "https://anilib.me";

interface AlAnime {
  id?: number;
  rus_name?: string;
  eng_name?: string;
  slug_url?: string;
  releaseDate?: string;
  shikimori_href?: string;
}

interface AlEpisode {
  id: number;
  name?: string;
  number?: string;
  season?: string;
  item_number?: number;
}

interface AlPlayer {
  player?: string;
  src?: string;
  team?: { name?: string };
}

function headers(): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Accept: "application/json",
    Origin: SITE,
    Referer: `${SITE}/`,
    "Site-Id": "5"
  };
}

function shikiIdFromHref(href?: string): number {
  const m = (href || "").match(/animes\/[a-z]*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function yearOfRelease(item: AlAnime): number | undefined {
  const year = Number((item.releaseDate || "").slice(0, 4));
  return year >= 1960 && year <= 2100 ? year : undefined;
}

/** Чем выше — тем ближе к яп. оригиналу с субтитрами. */
function originalScore(team: string): number {
  const n = team.toLowerCase();
  if (!n) return 0;
  if (/shiza/.test(n)) return 100;
  if (/субтит/.test(n) && /рус|ru/.test(n)) return 95;
  if (/\.subtitles$/.test(n) && /crunchy|funi|netflix|hidive|muse/.test(n)) return 88;
  if (/субтит|\.subtitles|сабы|\bsubs?\b/.test(n)) return 75;
  if (/оригинал|original|\braw\b/.test(n)) return 60;
  return 0;
}

function pickOriginalTeam(players: AlPlayer[]): AlPlayer | null {
  let best: AlPlayer | null = null;
  let bestScore = 0;
  for (const player of players) {
    if ((player.player || "") !== "Kodik" || !player.src) continue;
    const score = originalScore(player.team?.name || "");
    if (score > bestScore) {
      bestScore = score;
      best = player;
    }
  }
  return bestScore > 0 ? best : null;
}

async function searchAl(query: string): Promise<AlAnime[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await httpJson<{ data?: AlAnime[] }>(`${API}/anime?q=${encodeURIComponent(q)}`, {
    headers: headers(),
    timeoutMs: 12000
  });
  return res.data ?? [];
}

async function loadAnime(slug: string): Promise<AlAnime | null> {
  try {
    const res = await httpJson<{ data?: AlAnime }>(`${API}/anime/${encodeURIComponent(slug)}`, {
      headers: headers(),
      timeoutMs: 12000
    });
    return res.data ?? null;
  } catch {
    return null;
  }
}

async function loadEpisodes(slug: string): Promise<AlEpisode[]> {
  const res = await httpJson<{ data?: AlEpisode[] }>(`${API}/episodes?anime_id=${encodeURIComponent(slug)}`, {
    headers: headers(),
    timeoutMs: 12000
  });
  return res.data ?? [];
}

async function loadPlayers(episodeId: number): Promise<AlPlayer[]> {
  const res = await httpJson<{ data?: { players?: AlPlayer[] } }>(`${API}/episodes/${episodeId}`, {
    headers: headers(),
    timeoutMs: 12000
  });
  return res.data?.players ?? [];
}

async function matchAnime(anime: AnimeTitle): Promise<AlAnime | null> {
  const seen = new Set<string>();
  const items: AlAnime[] = [];
  for (const q of [anime.russian, anime.name]) {
    if (!q) continue;
    try {
      for (const item of await searchAl(q)) {
        const slug = item.slug_url || "";
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        items.push(item);
      }
    } catch {
      /* одно из имён могло не найтись */
    }
  }
  if (!items.length) return null;

  const year = yearOfAnime(anime.airedOn);
  const ranked = items
    .map((item) => {
      let score = scoreNames([item.rus_name || "", item.eng_name || ""], [anime.russian, anime.name]);
      const itemYear = yearOfRelease(item);
      if (year && itemYear) {
        if (itemYear === year) score += 12;
        else if (Math.abs(itemYear - year) === 1) score += 2;
        else score -= 22;
      }
      return { item, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const { item } of ranked.slice(0, 5)) {
    const full = item.slug_url ? await loadAnime(item.slug_url) : null;
    if (!full?.slug_url) continue;
    const sid = shikiIdFromHref(full.shikimori_href);
    if (sid === anime.id) return full;
  }

  const loose = pickBest(items, (it) => [it.rus_name || "", it.eng_name || ""], [anime.russian, anime.name], {
    year,
    yearOf: yearOfRelease
  });
  return loose?.slug_url ? loadAnime(loose.slug_url) : null;
}

function toSeasons(episodes: AlEpisode[], team: string): Season[] {
  const buckets = new Map<number, EpisodeRef[]>();
  for (const ep of episodes) {
    const number = Number(ep.number) || Number(ep.item_number) || 0;
    if (!ep.id || number <= 0) continue;
    const season = Number(ep.season) || 1;
    const list = buckets.get(season) ?? [];
    list.push({
      number,
      title: ep.name,
      ref: JSON.stringify({ episodeId: ep.id, team })
    });
    buckets.set(season, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, eps]) => ({
      number,
      episodes: eps.sort((a, b) => a.number - b.number)
    }))
    .filter((s) => s.episodes.length);
}

/** Японский оригинал с субтитрами, если на тайтле нет русских озвучек. */
export async function findAnimelibOriginal(anime: AnimeTitle): Promise<Translation | null> {
  const hit = await matchAnime(anime);
  if (!hit?.slug_url) return null;
  const sid = shikiIdFromHref(hit.shikimori_href);
  if (sid && sid !== anime.id) return null;

  const episodes = await loadEpisodes(hit.slug_url);
  if (!episodes.length) return null;

  let team = "";
  for (const ep of episodes.slice(0, 4)) {
    const player = pickOriginalTeam(await loadPlayers(ep.id));
    if (player?.team?.name) {
      team = player.team.name;
      break;
    }
  }
  if (!team) return null;

  const seasons = toSeasons(episodes, team);
  if (!seasons.length) return null;
  const last = seasons.flatMap((s) => s.episodes).at(-1)?.number;

  return {
    id: `animelib:${hit.id}:${team}`,
    title: /оригинал|original|raw/i.test(team) ? "Оригинал" : `Оригинал · ${team}`,
    type: "subtitles",
    source: "animelib",
    quality: "720",
    seasons,
    lastEpisode: last
  };
}

export async function resolveAnimelib(ref: string): Promise<StreamResult> {
  let episodeId = 0;
  let team = "";
  try {
    const parsed = JSON.parse(ref) as { episodeId?: number; team?: string };
    episodeId = Number(parsed.episodeId) || 0;
    team = parsed.team || "";
  } catch {
    throw new Error("Некорректная ссылка оригинала");
  }
  if (!episodeId) throw new Error("Нет серии оригинала");

  const players = await loadPlayers(episodeId);
  const exact = players.find((p) => p.player === "Kodik" && p.src && p.team?.name === team);
  const player = exact || pickOriginalTeam(players);
  if (!player?.src) throw new Error("Для этой серии нет японского оригинала");

  const url = player.src.startsWith("//") ? `https:${player.src}` : player.src;
  return resolveKodikHls(url);
}
