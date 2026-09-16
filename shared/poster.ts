/** Обложки в окне идут только через main, не напрямую с Shikimori. */
export function appPosterUrl(animeId: number): string {
  return animeId > 0 ? `hikari://poster/${animeId}` : "";
}

export function posterAnimeId(url?: string): number {
  const m = (url || "").match(/^hikari:\/\/poster\/(\d+)/);
  return m ? Number(m[1]) : 0;
}
