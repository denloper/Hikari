import { Notification } from "electron";
import { loadConfig } from "./config";
import { getFavorites, getSeenEpisode, setSeenEpisode } from "./store";
import { getSchedule, listLatestReleases, listShikiUserList } from "./shikimori";

function showNote(title: string, episode: number, animeId: number, open: (id: number) => void): void {
  if (!Notification.isSupported()) return;
  const note = new Notification({
    title: "Hikari",
    body: `${title} · серия ${episode}`
  });
  note.on("click", () => open(animeId));
  note.show();
}

/** Новые серии в «Смотрю» и избранном. Первый проход только запоминает текущий эп. */
export async function checkNewEpisodes(open: (id: number) => void): Promise<void> {
  if (!loadConfig().episodeNotify) return;
  const follow = new Map<number, string>();
  try {
    for (const row of await listShikiUserList("watching")) follow.set(row.animeId, row.title);
  } catch {
    /* без Шикимори смотрим избранное */
  }
  for (const row of getFavorites()) {
    if (!follow.has(row.animeId)) follow.set(row.animeId, row.title);
  }
  if (!follow.size) return;

  const aired = new Map<number, { title: string; episode: number }>();
  try {
    for (const day of await getSchedule()) {
      for (const a of day.items) {
        const episode = a.lastEpisode || (a.nextEpisode ? a.nextEpisode - 1 : 0);
        if (episode > 0) aired.set(a.id, { title: a.russian || a.name, episode });
      }
    }
  } catch {
    /* календарь молчит */
  }
  try {
    for (const a of await listLatestReleases()) {
      const episode = a.lastEpisode || 0;
      if (episode > 0 && !aired.has(a.id)) aired.set(a.id, { title: a.russian || a.name, episode });
    }
  } catch {
    /* лента релизов недоступна */
  }

  for (const [id, title] of follow) {
    const hit = aired.get(id);
    if (!hit) continue;
    const seen = getSeenEpisode(id);
    if (seen == null) {
      setSeenEpisode(id, hit.episode);
      continue;
    }
    if (hit.episode > seen) {
      setSeenEpisode(id, hit.episode);
      showNote(hit.title || title, hit.episode, id, open);
    }
  }
}
