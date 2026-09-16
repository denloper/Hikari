import type { EpisodeRef, Season, StreamQuality, StreamResult, Translation } from "../../shared/types";
import { loadConfig } from "./config";
import { httpJson, httpText } from "./http";

const KODIK_API = "https://kodikapi.com";

interface KodikTranslation {
  id: number;
  title: string;
  type: string;
}

interface KodikMaterial {
  id: string;
  type: string;
  link: string;
  title: string;
  translation?: KodikTranslation;
  quality?: string;
  last_episode?: number;
  episodes_count?: number;
  seasons?: Record<string, { episodes?: Record<string, string | { link?: string; title?: string }> }>;
}

interface KodikSearchResponse {
  results?: KodikMaterial[];
}

function token(): string {
  return loadConfig().kodikToken.trim();
}

function absUrl(link: string): string {
  if (!link) return "";
  if (link.startsWith("//")) return `https:${link}`;
  if (link.startsWith("http")) return link;
  return `https://kodik.info${link.startsWith("/") ? "" : "/"}${link}`;
}

function parseSeasons(material: KodikMaterial): Season[] {
  const seasons: Season[] = [];
  const raw = material.seasons ?? {};
  const keys = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
  for (const sk of keys) {
    const eps = raw[sk]?.episodes ?? {};
    const episodes: EpisodeRef[] = [];
    for (const ek of Object.keys(eps).sort((a, b) => Number(a) - Number(b))) {
      const val = eps[ek];
      const link = typeof val === "string" ? val : val?.link ?? "";
      const title = typeof val === "string" ? undefined : val?.title;
      episodes.push({
        number: Number(ek),
        title,
        ref: absUrl(link || material.link)
      });
    }
    if (episodes.length) {
      seasons.push({ number: Number(sk), episodes });
    }
  }
  if (!seasons.length && material.link) {
    seasons.push({
      number: 1,
      episodes: [{ number: 1, title: "Смотреть", ref: absUrl(material.link) }]
    });
  }
  return seasons;
}

export async function searchByShikimori(shikimoriId: number): Promise<Translation[]> {
  const t = token();
  if (!t) return [];
  const url =
    `${KODIK_API}/search?token=${encodeURIComponent(t)}` +
    `&shikimori_id=${shikimoriId}&with_seasons=true&with_episodes=true&with_episodes_data=true&limit=100`;
  const data = await httpJson<KodikSearchResponse>(url, {
    headers: { Accept: "application/json" }
  });
  const out: Translation[] = [];
  for (const m of data.results ?? []) {
    const tr = m.translation;
    if (!tr) continue;
    const kind = tr.type === "subtitles" ? "subtitles" : tr.type === "voice" ? "voice" : "other";
    out.push({
      id: `kodik:${tr.id}:${m.id}`,
      title: tr.title,
      type: kind,
      source: "kodik",
      quality: m.quality,
      seasons: parseSeasons(m),
      lastEpisode: m.last_episode
    });
  }
  return out;
}

function pick(html: string, re: RegExp): string {
  return re.exec(html)?.[1] ?? "";
}

function typeFromUrl(url: string): string {
  if (url.includes("/seria/")) return "seria";
  if (url.includes("/video/")) return "video";
  if (url.includes("/season/")) return "season";
  return "";
}

function paramsFromPlayer(html: string): Record<string, string> {
  const raw = pick(html, /urlParams\s*=\s*'(\{[^']+\})'/);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) out[k] = String(v ?? "");
      return out;
    } catch {
      /* разберём поля ниже */
    }
  }
  return {
    d: pick(html, /\bd:\s*['"]([^'"]+)/),
    d_sign: pick(html, /d_sign:\s*['"]([^'"]+)/),
    pd: pick(html, /\bpd:\s*['"]([^'"]+)/),
    pd_sign: pick(html, /pd_sign:\s*['"]([^'"]+)/),
    ref: pick(html, /\bref:\s*['"]([^'"]+)/),
    ref_sign: pick(html, /ref_sign:\s*['"]([^'"]+)/)
  };
}

/** Сдвиг Цезаря + base64, как в плеере Kodik. Подбираем сдвиг по префиксу http. */
function decodeSrc(encrypted: string): string | null {
  for (const shift of [18, 13, 17, 16, 15, 14, 19, 20, 21, 22]) {
    let rotated = "";
    for (const ch of encrypted) {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) {
        rotated += String.fromCharCode(((code - 65 + shift) % 26) + 65);
      } else if (code >= 97 && code <= 122) {
        rotated += String.fromCharCode(((code - 97 + shift) % 26) + 97);
      } else {
        rotated += ch;
      }
    }
    try {
      const plain = Buffer.from(rotated, "base64").toString("utf8");
      if (plain.startsWith("http") || plain.startsWith("//")) {
        return plain.startsWith("//") ? `https:${plain}` : plain;
      }
    } catch {
      /* следующий сдвиг */
    }
  }
  if (encrypted.startsWith("http")) return encrypted;
  return null;
}

function toHlsUrl(src: string): string {
  if (src.includes(":hls:manifest.m3u8")) return src;
  if (src.endsWith(".m3u8")) return src;
  if (src.includes(".mp4")) return `${src}:hls:manifest.m3u8`;
  return src;
}

interface VideoInfoLinks {
  links?: Record<string, { src: string; type?: string }[]>;
  skip?: { opening?: number[] | { start?: number; end?: number }; ending?: number[] | { start?: number; end?: number } };
  opening?: number[] | { start?: number; end?: number; time?: number; length?: number };
  ending?: number[] | { start?: number; end?: number; time?: number; length?: number };
}

function skipFromUnknown(raw: unknown): { start: number; end: number } | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw) && raw.length >= 2) {
    const start = Number(raw[0]);
    const end = Number(raw[1]);
    if (end > start) return { start, end };
  }
  if (typeof raw === "object") {
    const o = raw as { start?: number; end?: number; time?: number; length?: number };
    if (o.end != null && o.start != null && o.end > o.start) return { start: Number(o.start), end: Number(o.end) };
    if (o.length != null) {
      const start = Number(o.time) || 0;
      const end = start + Number(o.length);
      if (end > start) return { start, end };
    }
  }
  return undefined;
}

async function postVideoInfo(origin: string, paths: string[], body: URLSearchParams, referer: string): Promise<VideoInfoLinks | null> {
  for (const p of paths) {
    const url = `${origin}${p}`;
    try {
      const json = await httpJson<VideoInfoLinks>(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
          Origin: origin,
          Referer: referer
        },
        body: body.toString(),
        timeoutMs: 7000
      });
      if (json?.links && Object.keys(json.links).length) return json;
    } catch {
      /* пробуем следующий путь */
    }
  }
  return null;
}

function collectAjaxPaths(html: string, playerJs: string): string[] {
  const preferred = ["/ftor", "/get-video-info", "/gvi"];
  const extra: string[] = [];
  const blob = `${html}\n${playerJs}`;
  for (const m of blob.matchAll(/['"](\/[A-Za-z0-9_-]{2,24})['"]/g)) {
    const p = m[1];
    if (p.includes(".") || p.startsWith("/assets") || p.startsWith("/css")) continue;
    if (preferred.includes(p) || extra.includes(p)) continue;
    extra.push(p);
    if (extra.length >= 2) break;
  }
  return [...preferred, ...extra];
}

export async function resolveKodikHls(embedUrl: string): Promise<StreamResult> {
  const pageUrl = absUrl(embedUrl);
  if (!pageUrl) {
    return { kind: "embed", url: embedUrl };
  }
  try {
    const html = await httpText(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 Hikari",
        Accept: "text/html",
        Referer: pageUrl.includes("yummy") || pageUrl.includes("kodikplayer") ? "https://yummyani.me/" : "https://kodik.info/"
      },
      timeoutMs: 8000
    });
    const p = paramsFromPlayer(html);
    /* У Yummy ссылка /season/..., а ftor ждёт seria id/hash из vInfo. */
    const type =
      pick(html, /vInfo\.type\s*=\s*['"]([^'"]+)/) ||
      pick(html, /videoInfo\.type\s*[:=]\s*['"]([^'"]+)/) ||
      pick(html, /\btype\s*[:=]\s*['"](seria|video|season)['"]/) ||
      typeFromUrl(pageUrl);
    const hash =
      pick(html, /vInfo\.hash\s*=\s*['"]([^'"]+)/) ||
      pick(html, /videoInfo\.hash\s*[:=]\s*['"]([^'"]+)/) ||
      pick(html, /seasonHash\s*=\s*["']([^"']+)/) ||
      pick(html, /\bhash\s*=\s*['"]([a-f0-9]{16,})['"]/);
    const id =
      pick(html, /vInfo\.id\s*=\s*['"]([^'"]+)/) ||
      pick(html, /videoInfo\.id\s*[:=]\s*['"]([^'"]+)/) ||
      pick(html, /seasonId\s*=\s*Number\((\d+)\)/) ||
      pick(html, /\bid\s*=\s*['"](\d+)['"]/);
    const d = p.d || pick(html, /\bd:\s*['"]([^'"]+)/);
    const dSign = p.d_sign || pick(html, /d_sign:\s*['"]([^'"]+)/);
    const pd = p.pd || pick(html, /\bpd:\s*['"]([^'"]+)/);
    const pdSign = p.pd_sign || pick(html, /pd_sign:\s*['"]([^'"]+)/);
    const ref = p.ref || pick(html, /\bref:\s*['"]([^'"]+)/);
    const refSign = p.ref_sign || pick(html, /ref_sign:\s*['"]([^'"]+)/);

    const origin = new URL(pageUrl).origin;
    let playerJs = "";
    const scriptSrc =
      pick(html, /<script[^>]+src=['"]([^'"]*\/assets\/js\/[^'"]+)['"]/) ||
      pick(html, /<script[^>]+src=['"]([^'"]*player[^'"]*\.js)['"]/);
    if (scriptSrc) {
      const jsUrl = scriptSrc.startsWith("http")
        ? scriptSrc
        : scriptSrc.startsWith("//")
          ? `https:${scriptSrc}`
          : `${origin}${scriptSrc}`;
      try {
        playerJs = await httpText(jsUrl, { headers: { Referer: pageUrl }, timeoutMs: 6000 });
      } catch {
        playerJs = "";
      }
    }

    const body = new URLSearchParams({
      id,
      hash,
      type,
      d,
      d_sign: dSign,
      pd,
      pd_sign: pdSign,
      ref,
      ref_sign: refSign,
      bad_user: "false",
      cdn_is_working: "true"
    });

    const paths = collectAjaxPaths(html, playerJs);
    const origins = [...new Set([origin, "https://kodikplayer.com"])];
    let info: VideoInfoLinks | null = null;
    for (const host of origins) {
      info = await postVideoInfo(host, ["/ftor"], body, pageUrl);
      if (info?.links && Object.keys(info.links).length) break;
    }
    if (!info?.links) {
      const rest = paths.filter((p) => p !== "/ftor");
      for (const host of origins) {
        info = await postVideoInfo(host, rest, body, pageUrl);
        if (info?.links && Object.keys(info.links).length) break;
      }
    }
    const qualities: StreamQuality[] = [];
    if (info?.links) {
      for (const [height, items] of Object.entries(info.links)) {
        const src = items?.[0]?.src;
        if (!src) continue;
        const decoded = decodeSrc(src);
        if (!decoded) continue;
        qualities.push({
          height: Number(height) || 0,
          url: toHlsUrl(decoded)
        });
      }
    }
    qualities.sort((a, b) => b.height - a.height);
    if (qualities.length) {
      const opening = skipFromUnknown(info?.skip?.opening ?? info?.opening);
      const ending = skipFromUnknown(info?.skip?.ending ?? info?.ending);
      return {
        kind: "hls",
        qualities,
        referer: pageUrl,
        skips: opening || ending ? { opening, ending } : undefined
      };
    }
  } catch {
    /* уйдём в официальный embed */
  }
  return { kind: "embed", url: pageUrl };
}
