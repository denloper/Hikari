import type { AnimeTitle, EpisodeRef, StreamQuality, StreamResult, Translation } from "../../shared/types";
import { httpJson, httpText } from "./http";
import { BROWSER_UA, absUrl, decodeEntities, episodeNumber, pickBest, yearOfAnime } from "./titles";

const SITE = "https://sameband.studio";
const CATALOG_TTL_MS = 30 * 60 * 1000;

interface SbHit {
  title: string;
  url: string;
  year?: number;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Referer: `${SITE}/`,
    Origin: SITE,
    Accept: "text/html,application/json,*/*",
    ...extra
  };
}

function parseCards(html: string): SbHit[] {
  const out: SbHit[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<article class="shortstory/);
  for (const block of blocks.slice(1)) {
    const title = decodeEntities(
      block.match(/class="name-ru[^"]*"[^>]*>([^<]+)/i)?.[1]?.trim() ||
        block.match(/class="poster"[^>]*title="([^"]+)"/i)?.[1] ||
        ""
    );
    const href =
      block.match(/<a class="image"[^>]*href="([^"]+)"/i)?.[1] ||
      block.match(/href="((?:https?:\/\/sameband\.studio)?\/anime\/[^"]+)"/i)?.[1];
    if (!title || !href) continue;
    const url = absUrl(SITE, href);
    if (seen.has(url)) continue;
    seen.add(url);
    const year = Number(block.match(/(\d{4})\s*г/i)?.[1]);
    out.push({
      title,
      url,
      year: year >= 1960 && year <= 2100 ? year : undefined
    });
  }
  return out;
}

async function searchSb(query: string): Promise<SbHit[]> {
  const story = query.trim();
  if (story.length < 4) return [];
  try {
    const html = await httpText(`${SITE}/index.php?do=search`, {
      method: "POST",
      headers: headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({
        do: "search",
        subaction: "search",
        search_start: "0",
        full_search: "0",
        result_from: "1",
        story
      }).toString(),
      timeoutMs: 6000
    });
    return parseCards(html);
  } catch {
    return [];
  }
}

let catalogCache: SbHit[] = [];
let catalogAt = 0;

async function catalogHits(): Promise<SbHit[]> {
  if (catalogCache.length && Date.now() - catalogAt < CATALOG_TTL_MS) return catalogCache;
  const html = await httpText(`${SITE}/anime`, { headers: headers(), timeoutMs: 8000 });
  catalogCache = parseCards(html);
  catalogAt = Date.now();
  return catalogCache;
}

interface SbListItem {
  title?: string;
  file?: string;
}

function qualitiesFromFile(file: string): StreamQuality[] {
  const out: StreamQuality[] = [];
  for (const part of file.split(",")) {
    const m = part.trim().match(/^\[(\d+)p\](.+)$/);
    if (!m) continue;
    out.push({ height: Number(m[1]), url: absUrl(SITE, m[2]) });
  }
  out.sort((a, b) => b.height - a.height);
  return out;
}

function searchQueries(anime: AnimeTitle): string[] {
  const out: string[] = [];
  for (const raw of [anime.russian, anime.name]) {
    const full = (raw || "").trim();
    if (full.length >= 4 && !out.includes(full)) out.push(full);
    const words = full.split(/\s+/).filter((w) => w.length >= 4);
    const hint = words[words.length - 1];
    if (hint && !out.includes(hint)) out.push(hint);
  }
  return out;
}

function pickHit(hits: SbHit[], anime: AnimeTitle): SbHit | null {
  return pickBest(hits, (item) => [item.title], [anime.russian, anime.name], {
    year: yearOfAnime(anime.airedOn),
    yearOf: (item) => item.year
  });
}

export async function findSameBand(anime: AnimeTitle): Promise<Translation[]> {
  const seen = new Set<string>();
  const hits: SbHit[] = [];
  const queries = searchQueries(anime).slice(0, 2);
  for (const query of queries) {
    try {
      for (const item of await searchSb(query)) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        hits.push(item);
      }
    } catch {
      /* DLE часто пустой */
    }
    if (hits.length) break;
  }

  let hit = pickHit(hits, anime);
  if (!hit) {
    try {
      hit = pickHit(await catalogHits(), anime);
    } catch {
      return [];
    }
  }
  if (!hit) return [];

  let page: string;
  try {
    page = await httpText(hit.url, { headers: headers(), timeoutMs: 15000 });
  } catch {
    return [];
  }
  const iframe =
    page.match(/<iframe[^>]+src="([^"]*\/v\/play\/[^"]+)"/i)?.[1] ||
    page.match(/class="player[\s\S]{0,4000}?<iframe[^>]+src="([^"]+)"/i)?.[1];
  if (!iframe) return [];
  const playerUrl = absUrl(SITE, iframe);

  let playerHtml: string;
  try {
    playerHtml = await httpText(playerUrl, { headers: headers({ Referer: hit.url }), timeoutMs: 15000 });
  } catch {
    return [];
  }
  const listPath = playerHtml.match(/Playerjs[\s\S]{0,400}?file:\s*["']([^"']+)["']/)?.[1];
  if (!listPath) return [];

  let list: SbListItem[] = [];
  try {
    list = await httpJson<SbListItem[]>(absUrl(SITE, listPath), {
      headers: headers({ Accept: "application/json" }),
      timeoutMs: 15000
    });
  } catch {
    return [];
  }
  if (!Array.isArray(list) || !list.length) return [];

  const episodes: EpisodeRef[] = list
    .map((item, i): EpisodeRef | null => {
      const qualities = qualitiesFromFile(item.file || "");
      if (!qualities.length) return null;
      return {
        number: episodeNumber(item.title || "", i + 1),
        title: `Серия ${episodeNumber(item.title || "", i + 1)}`,
        ref: JSON.stringify(qualities)
      };
    })
    .filter((ep): ep is EpisodeRef => Boolean(ep && ep.number > 0))
    .sort((a, b) => a.number - b.number);

  if (!episodes.length) return [];
  return [
    {
      id: `sameband:${hit.url}`,
      title: "Студийная банда",
      type: "voice",
      source: "sameband",
      quality: "1080",
      seasons: [{ number: 1, episodes }],
      lastEpisode: episodes[episodes.length - 1]?.number
    }
  ];
}

export function resolveSameBand(ref: string): StreamResult {
  let qualities: StreamQuality[];
  try {
    qualities = JSON.parse(ref) as StreamQuality[];
  } catch {
    throw new Error("Некорректная ссылка SameBand");
  }
  if (!qualities?.length) throw new Error("У SameBand нет HLS для этой серии");
  return { kind: "hls", qualities, referer: `${SITE}/` };
}
