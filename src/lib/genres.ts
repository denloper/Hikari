import type { CatalogGenre } from "../../shared/types";

export function normGenreName(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, "е");
}

export function matchGenre(list: CatalogGenre[], name: string, id?: number): CatalogGenre | undefined {
  if (id) {
    const byId = list.find((g) => g.id === id);
    if (byId) return byId;
  }
  const n = normGenreName(name);
  if (!n) return undefined;
  return list.find((g) => normGenreName(g.name) === n);
}

export function titleGenres(anime: { genres: string[]; genreTags?: CatalogGenre[] }): CatalogGenre[] {
  if (anime.genreTags?.length) return anime.genreTags;
  return anime.genres.filter(Boolean).map((name) => ({ id: 0, name }));
}
