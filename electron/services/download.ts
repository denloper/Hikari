import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { app, dialog, shell, type BrowserWindow } from "electron";
import type { DownloadItem, Translation } from "../../shared/types";
import { loadConfig } from "./config";
import { resolveStream } from "./translations";
import { fetchOpeningSkip } from "./aniskip";
import { getDownload, listDownloads as listDownloadRows, upsertDownload } from "./store";

let hostWin: BrowserWindow | null = null;
const wait: string[] = [];
let busy = false;

export function setDownloadWindow(win: BrowserWindow | null): void {
  hostWin = win;
}

export function defaultDownloadFolder(): string {
  return loadConfig().downloadFolder || path.join(app.getPath("videos"), "Hikari");
}

function fetchBuffer(url: string, referer?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "Hikari",
          Accept: "*/*",
          Referer: referer || url
        }
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          void fetchBuffer(res.headers.location, referer).then(resolve, reject);
          return;
        }
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(25000, () => req.destroy(new Error("timeout")));
  });
}

function absPlaylistUrl(playlistUrl: string, part: string): string {
  if (part.startsWith("http")) return part;
  if (part.startsWith("//")) return `https:${part}`;
  return new URL(part, playlistUrl).href;
}

function timedSegments(body: string): { url: string; start: number; end: number }[] {
  const lines = body.split(/\r?\n/).map((l) => l.trim());
  const out: { url: string; start: number; end: number }[] = [];
  let t = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const dur = /#EXTINF:([\d.]+)/.exec(lines[i]);
    if (!dur) continue;
    const next = lines[i + 1];
    if (!next || next.startsWith("#")) continue;
    const len = Number(dur[1]);
    out.push({ url: next, start: t, end: t + len });
    t += len;
  }
  return out;
}

async function downloadHls(
  masterUrl: string,
  dest: string,
  referer?: string,
  range?: { fromSec: number; toSec: number }
): Promise<void> {
  const text = (await fetchBuffer(masterUrl, referer)).toString("utf8");
  let playlistUrl = masterUrl;
  let body = text;
  if (text.includes("#EXT-X-STREAM-INF")) {
    const lines = text.split(/\r?\n/);
    let chosen = "";
    let best = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const h = /RESOLUTION=\d+x(\d+)/.exec(lines[i]);
      if (h && lines[i + 1] && !lines[i + 1].startsWith("#")) {
        const height = Number(h[1]);
        if (height > best) {
          best = height;
          chosen = lines[i + 1].trim();
        }
      }
    }
    if (!chosen) {
      const first = lines.find((l, i) => i && !l.startsWith("#") && l.trim());
      chosen = first?.trim() || "";
    }
    if (!chosen) throw new Error("В HLS нет качества");
    playlistUrl = absPlaylistUrl(masterUrl, chosen);
    body = (await fetchBuffer(playlistUrl, referer)).toString("utf8");
  }
  let segs = timedSegments(body).map((s) => ({ ...s, url: absPlaylistUrl(playlistUrl, s.url) }));
  if (!segs.length) {
    segs = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((url, i) => ({ url: absPlaylistUrl(playlistUrl, url), start: i, end: i + 1 }));
  }
  if (range) {
    segs = segs.filter((s) => s.end > range.fromSec && s.start < range.toSec);
  }
  if (!segs.length) throw new Error(range ? "В этом отрезке нет сегментов" : "В плейлисте нет сегментов");
  const out = fs.createWriteStream(dest);
  try {
    for (const seg of segs) {
      const buf = await fetchBuffer(seg.url, referer);
      await new Promise<void>((resolve, reject) => {
        out.write(buf, (err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim() || "episode";
}

function ping(): void {
  hostWin?.webContents.send("downloads:changed");
}

async function runOne(id: string): Promise<void> {
  const item = getDownload(id);
  if (!item) return;
  const next = { ...item, status: "downloading" as const, error: "" };
  upsertDownload(next);
  ping();
  try {
    const job = JSON.parse(item.filename) as {
      source: Translation["source"];
      ref: string;
      quality?: number;
      anilibriaEpisodeId?: string;
      label: string;
      clip?: "episode" | "opening";
      fromSec?: number;
      toSec?: number;
      animeId?: number;
      episode?: number;
    };
    const stream = await resolveStream({
      source: job.source,
      ref: job.ref,
      anilibriaEpisodeId: job.anilibriaEpisodeId
    });
    if (stream.kind === "embed") throw new Error("Этот поток только во встроенном плеере");
    const pick = stream.qualities.find((q) => q.height === job.quality) || stream.qualities[0];
    if (!pick?.url) throw new Error("Нет файла для скачивания");
    let range: { fromSec: number; toSec: number } | undefined;
    if (job.clip === "opening") {
      const skip =
        job.fromSec != null && job.toSec != null && job.toSec > job.fromSec
          ? { start: job.fromSec, end: job.toSec }
          : stream.skips?.opening || (await fetchOpeningSkip(job.animeId || item.animeId, job.episode || item.episode));
      if (!skip) throw new Error("Нет меток опенинга для этой серии");
      if (stream.kind === "file" && !pick.url.includes(".m3u8")) {
        throw new Error("Опенинг можно вырезать только из HLS");
      }
      range = { fromSec: skip.start, toSec: skip.end };
    }
    const ext = pick.url.includes(".m3u8") || range ? "ts" : "mp4";
    const dest = item.path.endsWith(".ts") || item.path.endsWith(".mp4") ? item.path : `${item.path}.${ext}`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (stream.kind === "file" && !pick.url.includes(".m3u8") && !range) {
      fs.writeFileSync(dest, await fetchBuffer(pick.url, stream.referer));
    } else {
      await downloadHls(pick.url, dest, stream.referer, range);
    }
    upsertDownload({ ...next, path: dest, status: "done", filename: job.label });
  } catch (err) {
    upsertDownload({
      ...next,
      status: "error",
      error: err instanceof Error ? err.message : "Не удалось скачать"
    });
  }
  ping();
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    while (wait.length) {
      const id = wait.shift();
      if (id) await runOne(id);
    }
  } finally {
    busy = false;
  }
}

export function enqueueDownload(args: {
  source: Translation["source"];
  ref: string;
  quality?: number;
  anilibriaEpisodeId?: string;
  animeId: number;
  title: string;
  episode: number;
  filename: string;
  clip?: "episode" | "opening";
  fromSec?: number;
  toSec?: number;
}): DownloadItem {
  const label = args.filename.replace(/[<>:"/\\|?*]+/g, " ").trim() || "episode";
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const dest = path.join(defaultDownloadFolder(), safeName(label));
  const item: DownloadItem = {
    id,
    animeId: args.animeId,
    title: args.title,
    episode: args.episode,
    filename: JSON.stringify({
      source: args.source,
      ref: args.ref,
      quality: args.quality,
      anilibriaEpisodeId: args.anilibriaEpisodeId,
      label,
      clip: args.clip,
      fromSec: args.fromSec,
      toSec: args.toSec,
      animeId: args.animeId,
      episode: args.episode
    }),
    path: dest,
    status: "queued",
    at: Date.now()
  };
  upsertDownload(item);
  wait.push(id);
  void pump();
  ping();
  return { ...item, filename: label };
}

function withLabel(row: DownloadItem): DownloadItem {
  try {
    const job = JSON.parse(row.filename) as { label?: string };
    if (job?.label) return { ...row, filename: job.label };
  } catch {
    /* уже обычное имя файла */
  }
  return row;
}

export function listDownloads(): DownloadItem[] {
  return listDownloadRows().map(withLabel);
}

/** После сбоя снова поставить в очередь незавершённые. */
export function resumeDownloads(): void {
  for (const row of listDownloadRows()) {
    if (row.status === "queued" || row.status === "downloading") wait.push(row.id);
  }
  void pump();
}

export async function openDownload(id: string): Promise<void> {
  const item = getDownload(id);
  if (!item?.path || !fs.existsSync(item.path)) throw new Error("Файл ещё не готов");
  await shell.openPath(item.path);
}

export async function openDownloadFolder(): Promise<string> {
  const dir = defaultDownloadFolder();
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return dir;
}

export async function pickDownloadFolder(win: BrowserWindow): Promise<string | null> {
  const res = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return res.canceled ? null : res.filePaths[0] || null;
}
