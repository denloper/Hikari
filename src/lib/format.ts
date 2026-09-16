export function displayName(russian?: string, name?: string): string {
  return russian || name || "Без названия";
}

export function kindLabel(kind: string): string {
  const map: Record<string, string> = {
    tv: "TV",
    movie: "Фильм",
    ova: "OVA",
    ona: "ONA",
    special: "Спешл",
    tv_special: "TV спешл"
  };
  return map[kind] || kind;
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    released: "вышло",
    ongoing: "онгоинг",
    anons: "анонс"
  };
  return map[status] || status;
}

export function yearOf(airedOn: string): string {
  return airedOn ? airedOn.slice(0, 4) : "";
}

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** «эп. 6 · завтра 23:00» или «скоро эп. 6» */
export function formatNextAir(at?: string, episode?: number): string {
  const ep = episode ? `эп. ${episode}` : "";
  if (!at) return ep ? `скоро ${ep}` : "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return ep ? `скоро ${ep}` : "";
  const diff = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  const time = date.getHours() || date.getMinutes()
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : "";
  const dayMonth = date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "");
  let when = dayMonth;
  if (diff === 0) when = time ? `сегодня ${time}` : "сегодня";
  else if (diff === 1) when = time ? `завтра ${time}` : "завтра";
  else if (diff > 1 && diff < 7) when = `${WEEKDAYS_SHORT[date.getDay()]}, ${dayMonth}`;
  return [ep, when].filter(Boolean).join(" · ");
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  const ss = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function posterSrc(poster?: string, posterLocal?: string, animeId?: number): string {
  if (posterLocal && posterLocal.startsWith("hikari://")) return posterLocal;
  if (poster && poster.startsWith("hikari://")) return poster;
  if (animeId && animeId > 0) return `hikari://poster/${animeId}`;
  if (posterLocal && posterLocal.startsWith("file:///")) return posterLocal;
  return "";
}

export function shikiPoster(id: number): string {
  return id > 0 ? `hikari://poster/${id}` : "";
}

export function cssPoster(src: string): string {
  if (!src) return "none";
  return `url("${src.replace(/\\/g, "/").replace(/"/g, "%22")}")`;
}

export function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    anilibria: "AniLibria",
    animevost: "AnimeVost",
    sameband: "Студийная банда",
    dreamerscast: "Dreamerscast",
    kodik: "Kodik",
    yummyanime: "Yummy",
    animelib: "Оригинал"
  };
  return map[source] || source;
}

export function translationKind(type: string): string {
  if (type === "voice") return "озвучка";
  if (type === "subtitles") return "субтитры";
  return "другое";
}

/** Доля просмотра 0…1. */
export function progressRatio(positionSec?: number, durationSec?: number): number {
  if (!durationSec || durationSec < 20 || !positionSec) return 0;
  return Math.min(1, Math.max(0, positionSec / durationSec));
}

export function isEpisodeDone(positionSec?: number, durationSec?: number): boolean {
  const ratio = progressRatio(positionSec, durationSec);
  return ratio >= 0.9 || Boolean(durationSec && positionSec && durationSec - positionSec < 20);
}
