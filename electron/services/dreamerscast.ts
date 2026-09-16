import type { AnimeTitle, EpisodeRef, StreamQuality, StreamResult, Translation } from "../../shared/types";
import { httpJson, httpText } from "./http";
import { BROWSER_UA, absUrl, episodeNumber, pickBest, yearOfAnime } from "./titles";

const SITE = "https://dreamerscast.com";

interface DcRelease {
  id: number;
  russian?: string | null;
  original?: string;
  dateissue?: number;
  url: string;
}

interface DcSearch {
  releases?: DcRelease[];
}

interface DcFileItem {
  title?: string;
  file?: string;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    Referer: `${SITE}/`,
    Origin: SITE,
    Accept: "application/json,text/html,*/*",
    ...extra
  };
}

async function searchDc(query: string): Promise<DcRelease[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const res = await httpJson<DcSearch>(`${SITE}/`, {
    method: "POST",
    headers: headers({
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    }),
    body: new URLSearchParams({
      search: q,
      status: "",
      pageSize: "16",
      pageNumber: "1"
    }).toString(),
    timeoutMs: 15000
  });
  return res.releases ?? [];
}

function decodePlayer(html: string): DcFileItem[] {
  const m = html.match(/Playerjs\(\s*["']#2([\s\S]*?)["']\s*\)/);
  if (!m) return [];
  const b64 = m[1].replace(/\/\/[^=]+==/g, "");
  const json = Buffer.from(b64, "base64").toString("utf8");
  const data = JSON.parse(json) as { file?: DcFileItem[] };
  return Array.isArray(data.file) ? data.file : [];
}

function hlsFromFile(file: string): string {
  const urls = file.match(/https?:\/\/[^\s]+/g) ?? [];
  return urls.find((u) => u.includes("/hls/") && u.includes(".m3u8")) || urls.find((u) => u.includes(".m3u8")) || "";
}

export async function findDreamerscast(anime: AnimeTitle): Promise<Translation[]> {
  const seen = new Set<number>();
  const items: DcRelease[] = [];
  for (const q of [anime.russian, anime.name]) {
    if (!q) continue;
    try {
      for (const item of await searchDc(q)) {
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    } catch {
      /* поиск Dreamerscast мог не ответить */
    }
  }
  const hit = pickBest(items, (item) => [item.russian || "", item.original || ""], [anime.russian, anime.name], {
    year: yearOfAnime(anime.airedOn),
    yearOf: (item) => (item.dateissue && item.dateissue >= 1960 ? item.dateissue : undefined)
  });
  if (!hit?.url) return [];

  let page: string;
  try {
    page = await httpText(absUrl(SITE, hit.url), { headers: headers(), timeoutMs: 15000 });
  } catch {
    return [];
  }

  let files: DcFileItem[] = [];
  try {
    files = decodePlayer(page);
  } catch {
    return [];
  }

  const episodes: EpisodeRef[] = files
    .map((item, i): EpisodeRef | null => {
      const hls = hlsFromFile(item.file || "");
      if (!hls) return null;
      return {
        number: episodeNumber(item.title || "", i + 1),
        title: item.title,
        ref: hls
      };
    })
    .filter((ep): ep is EpisodeRef => Boolean(ep && ep.number > 0))
    .sort((a, b) => a.number - b.number);

  if (!episodes.length) return [];
  return [
    {
      id: `dreamerscast:${hit.id}`,
      title: "Dreamerscast",
      type: "voice",
      source: "dreamerscast",
      quality: "1080",
      seasons: [{ number: 1, episodes }],
      lastEpisode: episodes[episodes.length - 1]?.number
    }
  ];
}

export function resolveDreamerscast(ref: string): StreamResult {
  if (!ref.startsWith("http")) throw new Error("Некорректная ссылка Dreamerscast");
  const qualities: StreamQuality[] = [{ height: 1080, url: ref }];
  return { kind: "hls", qualities, referer: `${SITE}/` };
}
