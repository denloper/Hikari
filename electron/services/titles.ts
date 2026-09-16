/** Сравнение названий студийного каталога с карточкой Shikimori. */

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function yearOfAnime(airedOn?: string): number | undefined {
  const year = Number((airedOn || "").slice(0, 4));
  return year >= 1960 && year <= 2100 ? year : undefined;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripHtml(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function normalizeTitle(text: string): string {
  return stripHtml(text)
    .toLowerCase()
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zа-яё0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitStudioTitle(title: string): string[] {
  const raw = stripHtml(title).replace(/\[[^\]]*]/g, "").trim();
  const parts = raw.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : raw ? [raw] : [];
}

const STOP = new Set(["в", "и", "на", "с", "к", "о", "у", "по", "из", "от", "для", "the", "of", "a", "to", "and"]);

function significantTokens(text: string): string[] {
  return normalizeTitle(text)
    .split(" ")
    .filter((w) => w && !STOP.has(w));
}

function tokenSet(text: string): Set<string> {
  return new Set(significantTokens(text));
}

function tokensEqual(a: string, b: string): boolean {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || left.size !== right.size) return false;
  for (const word of left) {
    if (!right.has(word)) return false;
  }
  return true;
}

function extraSeasonMark(candidate: string, target: string): boolean {
  const targetTokens = tokenSet(target);
  return significantTokens(candidate).some((word) => /^\d+$/.test(word) && !targetTokens.has(word));
}

function sequelPenalty(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!long.includes(short)) return 0;
  const extra = long.replace(short, " ").replace(/\s+/g, " ").trim();
  if (!extra) return 0;
  if (/\b(\d+|season|сезон|movie|фильм|ova|ona)\b/i.test(extra)) return -32;
  return -8;
}

export function scoreNames(candidates: string[], targets: string[]): number {
  const cands = candidates.map(normalizeTitle).filter((s) => s.length >= 2);
  const targs = targets.map(normalizeTitle).filter((s) => s.length >= 2);
  let best = 0;
  for (const c of cands) {
    for (const t of targs) {
      if (c === t || tokensEqual(c, t)) {
        best = Math.max(best, 100);
        continue;
      }
      let score = 0;
      if (c.includes(t) || t.includes(c)) {
        const ratio = Math.min(c.length, t.length) / Math.max(c.length, t.length);
        score = Math.round(58 + ratio * 30) + sequelPenalty(c, t);
      } else {
        const cw = tokenSet(c);
        const tw = significantTokens(t).filter((w) => w.length > 2);
        if (cw.size && tw.length) {
          const hit = tw.filter((w) => cw.has(w)).length;
          const cover = hit / tw.length;
          if (cover >= 0.75) score = Math.round(42 + cover * 28) + sequelPenalty(c, t);
        }
      }
      if (score && (extraSeasonMark(c, t) || extraSeasonMark(t, c))) score -= 36;
      best = Math.max(best, score);
    }
  }
  return best;
}

export function pickBest<T>(
  items: T[],
  namesOf: (item: T) => string[],
  targets: string[],
  opts?: { year?: number; yearOf?: (item: T) => number | undefined }
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    let score = scoreNames(namesOf(item), targets);
    const itemYear = opts?.yearOf?.(item);
    if (opts?.year && itemYear) {
      if (itemYear === opts.year) score += 12;
      else if (Math.abs(itemYear - opts.year) === 1) score += 2;
      else score -= 22;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 58 ? best : null;
}

export function episodeNumber(label: string, fallback: number): number {
  const text = stripHtml(label);
  const named = text.match(/(?:серия|episode|ep\.?)\s*(\d+)/i);
  if (named) return Number(named[1]);
  const nums = [...text.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (!nums.length) return fallback;
  const small = nums.find((n) => n > 0 && n < 400);
  return small || fallback;
}

export function absUrl(base: string, href?: string): string {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  try {
    return new URL(href, base.endsWith("/") ? base : `${base}/`).href;
  } catch {
    return `${base}${href.startsWith("/") ? "" : "/"}${href}`;
  }
}
