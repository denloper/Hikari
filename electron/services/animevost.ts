import type { AnimeTitle, EpisodeRef, StreamQuality, StreamResult, Translation } from "../../shared/types";
import { httpJson } from "./http";
import { BROWSER_UA, episodeNumber, pickBest, splitStudioTitle, yearOfAnime } from "./titles";

const API = "https://api.animevost.org/v1";

interface AvItem {
  id: number;
  title: string;
  year?: string | number;
}

interface AvSearch {
  data?: AvItem[];
}

interface AvEpisode {
  name?: string;
  hd?: string;
  std?: string;
}

function preferHttps(url: string): string {
  return url.replace(/^http:\/\//i, "https://");
}

async function avPost<T>(path: string, body: Record<string, string>): Promise<T> {
  return httpJson<T>(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": BROWSER_UA
    },
    body: new URLSearchParams(body).toString(),
    timeoutMs: 12000
  });
}

async function searchAv(query: string): Promise<AvItem[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await avPost<AvSearch>("/search", { name: q });
  return res.data ?? [];
}

export async function findAnimeVost(anime: AnimeTitle): Promise<Translation[]> {
  const seen = new Set<number>();
  const items: AvItem[] = [];
  for (const q of [anime.russian, anime.name]) {
    if (!q) continue;
    try {
      for (const item of await searchAv(q)) {
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    } catch {
      /* зеркало поиска могло не ответить */
    }
  }
  const hit = pickBest(items.slice(0, 20), (item) => splitStudioTitle(item.title), [anime.russian, anime.name], {
    year: yearOfAnime(anime.airedOn),
    yearOf: (item) => {
      const year = Number(item.year);
      return year >= 1960 ? year : undefined;
    }
  });
  if (!hit) return [];

  let playlist: AvEpisode[] = [];
  try {
    playlist = await avPost<AvEpisode[]>("/playlist", { id: String(hit.id) });
  } catch {
    return [];
  }
  if (!Array.isArray(playlist) || !playlist.length) return [];

  const episodes: EpisodeRef[] = playlist
    .map((ep, i): EpisodeRef | null => {
      const hd = ep.hd ? preferHttps(ep.hd) : "";
      const std = ep.std ? preferHttps(ep.std) : "";
      if (!hd && !std) return null;
      return {
        number: episodeNumber(ep.name || "", i + 1),
        title: ep.name,
        ref: JSON.stringify({ hd, std })
      };
    })
    .filter((ep): ep is EpisodeRef => Boolean(ep && ep.number > 0))
    .sort((a, b) => a.number - b.number);

  if (!episodes.length) return [];
  return [
    {
      id: `animevost:${hit.id}`,
      title: "AnimeVost",
      type: "voice",
      source: "animevost",
      quality: "720",
      seasons: [{ number: 1, episodes }],
      lastEpisode: episodes[episodes.length - 1]?.number
    }
  ];
}

export function resolveAnimeVost(ref: string): StreamResult {
  let parsed: { hd?: string; std?: string };
  try {
    parsed = JSON.parse(ref) as { hd?: string; std?: string };
  } catch {
    throw new Error("Некорректная ссылка AnimeVost");
  }
  const qualities: StreamQuality[] = [];
  if (parsed.hd) qualities.push({ height: 720, url: parsed.hd });
  if (parsed.std) qualities.push({ height: 480, url: parsed.std });
  if (!qualities.length) throw new Error("У AnimeVost нет файла для этой серии");
  return { kind: "file", qualities, referer: "https://animevost.org/" };
}
