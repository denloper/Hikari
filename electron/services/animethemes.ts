import type { OpeningGroup, OpeningTrack } from "../../shared/types";
import { httpJson } from "./http";

const HOST = "https://api.animethemes.moe";
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Hikari Desktop (personal anime player)"
};

interface ThemeAudio {
  link?: string;
}

interface ThemeVideo {
  audio?: ThemeAudio;
  link?: string;
}

interface ThemeEntry {
  videos?: ThemeVideo[];
}

interface ThemeSong {
  title?: string;
}

interface AnimeTheme {
  type?: string;
  sequence?: number | null;
  slug?: string;
  song?: ThemeSong;
  animethemeentries?: ThemeEntry[];
}

interface ThemeAnime {
  name?: string;
  animethemes?: AnimeTheme[];
}

function audioOf(theme: AnimeTheme): string {
  for (const entry of theme.animethemeentries || []) {
    for (const video of entry.videos || []) {
      const url = String(video.audio?.link || "").trim();
      if (url.startsWith("http")) return url;
    }
  }
  return "";
}

function labelOf(theme: AnimeTheme): string {
  const seq = theme.sequence && theme.sequence > 0 ? String(theme.sequence) : "";
  const kind = String(theme.type || "OP").toUpperCase();
  return `${kind}${seq}`;
}

function tracksOf(anime: ThemeAnime): OpeningTrack[] {
  const animeTitle = String(anime.name || "").trim();
  if (!animeTitle) return [];
  const out: OpeningTrack[] = [];
  for (const theme of anime.animethemes || []) {
    if (String(theme.type || "").toUpperCase() !== "OP") continue;
    const audioUrl = audioOf(theme);
    if (!audioUrl) continue;
    const label = labelOf(theme);
    out.push({
      id: `${animeTitle}:${theme.slug || label}:${audioUrl}`,
      animeTitle,
      label,
      song: String(theme.song?.title || "").trim(),
      audioUrl
    });
  }
  return out;
}

function groupsOf(animes: ThemeAnime[]): OpeningGroup[] {
  const groups: OpeningGroup[] = [];
  for (const anime of animes) {
    const tracks = tracksOf(anime);
    if (!tracks.length) continue;
    groups.push({ animeTitle: tracks[0].animeTitle, tracks });
  }
  return groups.slice(0, 8);
}

export async function searchOpenings(query: string): Promise<OpeningGroup[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const searchUrl =
    `${HOST}/search?` +
    new URLSearchParams({
      q,
      "fields[search]": "anime",
      "include[anime]": "animethemes.animethemeentries.videos.audio,animethemes.song"
    }).toString();
  try {
    const data = await httpJson<{ search?: { anime?: ThemeAnime[] } }>(searchUrl, { headers: HEADERS, timeoutMs: 12000 });
    const groups = groupsOf(data.search?.anime || []);
    if (groups.length) return groups;
  } catch {
    /* запасной поиск по /anime */
  }
  const fallback =
    `${HOST}/anime?` +
    new URLSearchParams({
      q,
      "page[size]": "8",
      include: "animethemes.animethemeentries.videos.audio,animethemes.song"
    }).toString();
  const data = await httpJson<{ anime?: ThemeAnime[] }>(fallback, { headers: HEADERS, timeoutMs: 12000 });
  return groupsOf(data.anime || []);
}
