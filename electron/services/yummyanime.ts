import type { AnimeTitle, EpisodeRef, StreamResult, StreamSkip, Translation } from "../../shared/types";
import { httpJson } from "./http";
import { resolveKodikHls } from "./kodik";
import { pickBest, yearOfAnime } from "./titles";

const API = "https://api.yani.tv";
/** Первая сторона AniLibria / AnimeVost / Dreamerscast обычно живая. SameBand — нет: их поиск пустой. */
const OWN = /anilibria|animevost|dreamers?\s*cast/i;
const STUDIO_BAND = /same\s*band|studio\s*band|студийная\s*банда/i;

function displayDub(dub: string): string {
  return STUDIO_BAND.test(dub) ? "Студийная банда" : dub;
}

interface YaHit {
  anime_id?: number;
  anime_url?: string;
  title?: string;
  year?: number;
  remote_ids?: { shikimori_id?: number };
}

interface YaVideo {
  number?: string;
  iframe_url?: string;
  skips?: { opening?: { time?: number; length?: number } | null; ending?: { time?: number; length?: number } | null };
  data?: { player?: string; dubbing?: string };
}

interface YaAnime {
  title?: string;
  anime_url?: string;
  year?: number;
  remote_ids?: { shikimori_id?: number };
  videos?: YaVideo[];
}

function skipOf(raw?: { time?: number; length?: number } | null): StreamSkip | undefined {
  if (!raw || raw.length == null) return undefined;
  const start = Number(raw.time) || 0;
  const end = start + Number(raw.length);
  if (end <= start) return undefined;
  return { start, end };
}

function absIframe(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export async function findYummyAnime(anime: AnimeTitle): Promise<Translation[]> {
  const hits: YaHit[] = [];
  const seen = new Set<string>();
  for (const q of [anime.russian, anime.name]) {
    if (!q) continue;
    try {
      const res = await httpJson<{ response?: YaHit[] }>(`${API}/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: "application/json", "User-Agent": "Hikari" },
        timeoutMs: 12000
      });
      for (const item of res.response ?? []) {
        const slug = item.anime_url || "";
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        hits.push(item);
      }
    } catch {
      /* другое имя */
    }
  }
  const year = yearOfAnime(anime.airedOn);
  const exact = hits.filter((item) => Number(item.remote_ids?.shikimori_id) === anime.id);
  const ranked = hits
    .map((item) => ({
      item,
      score: pickBest([item], (it) => [it.title || ""], [anime.russian, anime.name], { year, yearOf: (it) => it.year }) ? 1 : 0
    }))
    .sort((a, b) => b.score - a.score);
  const picked = exact.length
    ? exact
    : (ranked.some((x) => x.score) ? ranked.filter((x) => x.score) : ranked).map((x) => x.item);
  const candidates = picked.slice(0, 3);

  let full: YaAnime | null = null;
  for (const item of candidates) {
    if (!item.anime_url) continue;
    try {
      const res = await httpJson<{ response?: YaAnime }>(
        `${API}/anime/${encodeURIComponent(item.anime_url)}?need_videos=true`,
        { headers: { Accept: "application/json", "User-Agent": "Hikari" }, timeoutMs: 20000 }
      );
      const data = res.response;
      if (data?.remote_ids?.shikimori_id === anime.id) {
        full = data;
        break;
      }
      if (!full && data?.videos?.length) full = data;
    } catch {
      /* следующий кандидат */
    }
  }
  if (full && full.remote_ids?.shikimori_id && full.remote_ids.shikimori_id !== anime.id) return [];
  if (!full?.videos?.length) return [];

  const byDub = new Map<string, YaVideo[]>();
  for (const video of full.videos) {
    if (!/kodik/i.test(video.data?.player || "") || !video.iframe_url) continue;
    const dub = displayDub((video.data?.dubbing || "").replace(/^Озвучка\s+/i, "").trim());
    if (!dub || OWN.test(dub)) continue;
    const list = byDub.get(dub) ?? [];
    list.push(video);
    byDub.set(dub, list);
  }

  const out: Translation[] = [];
  for (const [dub, videos] of byDub) {
    const episodes: EpisodeRef[] = videos
      .map((v): EpisodeRef | null => {
        const number = Number(v.number);
        if (!number || !v.iframe_url) return null;
        return {
          number,
          title: `Серия ${number}`,
          ref: JSON.stringify({
            iframe: absIframe(v.iframe_url),
            opening: skipOf(v.skips?.opening),
            ending: skipOf(v.skips?.ending)
          })
        };
      })
      .filter((ep): ep is EpisodeRef => Boolean(ep))
      .sort((a, b) => a.number - b.number);
    const uniq = new Map<number, EpisodeRef>();
    for (const ep of episodes) if (!uniq.has(ep.number)) uniq.set(ep.number, ep);
    const list = [...uniq.values()];
    if (!list.length) continue;
    out.push({
      id: `yummy:${full.anime_url}:${dub}`,
      title: dub,
      type: /субтитр/i.test(dub) ? "subtitles" : "voice",
      source: "yummyanime",
      quality: "720",
      seasons: [{ number: 1, episodes: list }],
      lastEpisode: list[list.length - 1]?.number
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

export async function resolveYummyAnime(ref: string): Promise<StreamResult> {
  let iframe = "";
  let opening: StreamSkip | undefined;
  let ending: StreamSkip | undefined;
  try {
    const parsed = JSON.parse(ref) as { iframe?: string; opening?: StreamSkip; ending?: StreamSkip };
    iframe = parsed.iframe || "";
    opening = parsed.opening;
    ending = parsed.ending;
  } catch {
    iframe = ref;
  }
  if (!iframe.startsWith("http")) throw new Error("Нет ссылки YummyAnime");
  const stream = await resolveKodikHls(iframe);
  if (stream.kind === "embed") return stream;
  return { ...stream, skips: { opening, ending } };
}
