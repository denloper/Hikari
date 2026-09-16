import type { Translation } from "../../shared/types";
import { sourceLabel } from "./format";

export const STUDIO_PRESETS = [
  "AniLibria",
  "AniDUB",
  "AniStar",
  "AnimeVost",
  "Студийная банда",
  "Dreamerscast",
  "AniMedia",
  "JAM",
  "SHIZA Project"
];

const SAME_BAND = /same\s*band|studio\s*band|студийная\s*банда/i;

export function isStudioBand(t: Translation): boolean {
  return t.source === "sameband" || SAME_BAND.test(t.title);
}

export function studiosMatch(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (SAME_BAND.test(left) && SAME_BAND.test(right)) return true;
  return left.toLowerCase() === right.toLowerCase();
}

export function translationMatchesStudio(t: Translation, studio: string): boolean {
  const q = studio.trim();
  if (!q) return false;
  if (SAME_BAND.test(q) && isStudioBand(t)) return true;
  const needle = q.toLowerCase();
  return t.title.toLowerCase().includes(needle) || sourceLabel(t.source).toLowerCase().includes(needle);
}

export function pickTranslation(
  list: Translation[],
  lastId?: string,
  preferredStudio?: string
): Translation | undefined {
  if (lastId) {
    const hit = list.find((t) => t.id === lastId);
    if (hit) return hit;
  }
  if (preferredStudio?.trim()) {
    const hit = list.find((t) => translationMatchesStudio(t, preferredStudio));
    if (hit) return hit;
  }
  return list[0];
}

export function sortTranslations(list: Translation[], preferredStudio?: string): Translation[] {
  if (!preferredStudio?.trim()) return list;
  return [...list].sort((a, b) => {
    const pa = translationMatchesStudio(a, preferredStudio) ? 0 : 1;
    const pb = translationMatchesStudio(b, preferredStudio) ? 0 : 1;
    return pa - pb;
  });
}
