import type { AnimeTitle, StreamResult, Translation } from "../../shared/types";
import { findAnilibria, resolveAnilibria } from "./anilibria";
import { findAnimelibOriginal, resolveAnimelib } from "./animelib";
import { findAnimeVost, resolveAnimeVost } from "./animevost";
import { loadConfig } from "./config";
import { findDreamerscast, resolveDreamerscast } from "./dreamerscast";
import { resolveKodikHls, searchByShikimori } from "./kodik";
import { findSameBand, resolveSameBand } from "./sameband";
import { findYummyAnime, resolveYummyAnime } from "./yummyanime";

const SOURCE_RANK: Record<Translation["source"], number> = {
  anilibria: 0,
  animevost: 1,
  sameband: 2,
  dreamerscast: 3,
  kodik: 4,
  yummyanime: 5,
  animelib: 6
};

function wrap(label: string, job: Promise<Translation[]>, ms = 12000): Promise<Translation[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout`)), ms);
    job.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : label;
        reject(new Error(`${label}: ${message}`));
      }
    );
  });
}

export async function getTranslations(anime: AnimeTitle): Promise<Translation[]> {
  const jobs: Promise<Translation[]>[] = [
    wrap("AniLibria", findAnilibria(anime).then((t) => (t ? [t] : []))),
    wrap("AnimeVost", findAnimeVost(anime)),
    wrap("SameBand", findSameBand(anime)),
    wrap("Dreamerscast", findDreamerscast(anime)),
    wrap("YummyAnime", findYummyAnime(anime), 18000)
  ];
  if (loadConfig().kodikToken) {
    jobs.push(wrap("Kodik", searchByShikimori(anime.id)));
  }

  const settled = await Promise.allSettled(jobs);
  const list: Translation[] = [];
  const errors: string[] = [];
  for (const item of settled) {
    if (item.status === "fulfilled") list.push(...item.value);
    else errors.push(item.reason instanceof Error ? item.reason.message : String(item.reason));
  }

  // Свой HLS SameBand важнее Kodik-копии из Yummy. Если сайта нет — оставляем Yummy.
  if (list.some((t) => t.source === "sameband")) {
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      if (t.source === "yummyanime" && /same\s*band|studio\s*band|студийная\s*банда/i.test(t.title)) {
        list.splice(i, 1);
      }
    }
  }

  list.sort((a, b) => {
    if (a.source !== b.source) return SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (a.type !== b.type) return a.type === "voice" ? -1 : 1;
    return a.title.localeCompare(b.title, "ru");
  });

  if (!list.some((t) => t.type === "voice")) {
    try {
      const original = await findAnimelibOriginal(anime);
      if (original) list.push(original);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Оригинал недоступен");
    }
  }

  if (!list.length && errors.length) {
    throw new Error(errors.join("; "));
  }
  return list;
}

export async function resolveStream(args: {
  source: Translation["source"];
  ref: string;
  anilibriaEpisodeId?: string;
}): Promise<StreamResult> {
  if (args.source === "anilibria") {
    return resolveAnilibria(args.anilibriaEpisodeId || args.ref);
  }
  if (args.source === "animevost") {
    return resolveAnimeVost(args.ref);
  }
  if (args.source === "sameband") {
    return resolveSameBand(args.ref);
  }
  if (args.source === "dreamerscast") {
    return resolveDreamerscast(args.ref);
  }
  if (args.source === "animelib") {
    return resolveAnimelib(args.ref);
  }
  if (args.source === "yummyanime") {
    return resolveYummyAnime(args.ref);
  }
  return resolveKodikHls(args.ref);
}
