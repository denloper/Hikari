import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";
import type { ContinueItem, DownloadItem, DownloadStatus, LastWatch, LibraryItem, ProgressRow, WatchStats } from "../../shared/types";
import { hydrateLibraryPoster } from "./posters";

let db: Database.Database | null = null;

export function openStore(): Database.Database {
  if (db) return db;
  const file = path.join(app.getPath("userData"), "hikari.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      anime_id INTEGER NOT NULL,
      translation_id TEXT NOT NULL,
      episode REAL NOT NULL,
      position_sec REAL NOT NULL,
      duration_sec REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (anime_id, translation_id, episode)
    );
    CREATE TABLE IF NOT EXISTS last_watch (
      anime_id INTEGER PRIMARY KEY,
      translation_id TEXT NOT NULL,
      episode REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      anime_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      poster TEXT,
      score TEXT,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      anime_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      poster TEXT,
      episode REAL,
      translation_title TEXT,
      watched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta_cache (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      anime_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      episode REAL NOT NULL,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS episode_seen (
      anime_id INTEGER PRIMARY KEY,
      last_episode INTEGER NOT NULL
    );
  `);
  return db;
}

export function cacheGet<T>(key: string, maxAgeMs: number): T | null {
  const row = openStore()
    .prepare("SELECT json, cached_at FROM meta_cache WHERE key = ?")
    .get(key) as { json: string; cached_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.cached_at > maxAgeMs) return null;
  return JSON.parse(row.json) as T;
}

export function cacheSet(key: string, value: unknown): void {
  openStore()
    .prepare(
      "INSERT INTO meta_cache (key, json, cached_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, cached_at = excluded.cached_at"
    )
    .run(key, JSON.stringify(value), Date.now());
}

export function cacheGetStale<T>(key: string): T | null {
  const row = openStore()
    .prepare("SELECT json FROM meta_cache WHERE key = ?")
    .get(key) as { json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.json) as T;
}

export function getProgress(animeId: number, translationId: string, episode: number): ProgressRow | null {
  const row = openStore()
    .prepare(
      "SELECT anime_id, translation_id, episode, position_sec, duration_sec, updated_at FROM progress WHERE anime_id = ? AND translation_id = ? AND episode = ?"
    )
    .get(animeId, translationId, episode) as
    | {
        anime_id: number;
        translation_id: string;
        episode: number;
        position_sec: number;
        duration_sec: number;
        updated_at: number;
      }
    | undefined;
  if (!row) return null;
  return {
    animeId: row.anime_id,
    translationId: row.translation_id,
    episode: row.episode,
    positionSec: row.position_sec,
    durationSec: row.duration_sec,
    updatedAt: row.updated_at
  };
}

export function saveProgress(row: Omit<ProgressRow, "updatedAt">): void {
  openStore()
    .prepare(
      `INSERT INTO progress (anime_id, translation_id, episode, position_sec, duration_sec, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(anime_id, translation_id, episode)
       DO UPDATE SET position_sec = excluded.position_sec, duration_sec = excluded.duration_sec, updated_at = excluded.updated_at`
    )
    .run(row.animeId, row.translationId, row.episode, row.positionSec, row.durationSec, Date.now());
}

export function getLastWatch(animeId: number): LastWatch | null {
  const row = openStore()
    .prepare("SELECT anime_id, translation_id, episode, updated_at FROM last_watch WHERE anime_id = ?")
    .get(animeId) as
    | { anime_id: number; translation_id: string; episode: number; updated_at: number }
    | undefined;
  if (!row) return null;
  return {
    animeId: row.anime_id,
    translationId: row.translation_id,
    episode: row.episode,
    updatedAt: row.updated_at
  };
}

export function saveLastWatch(row: Omit<LastWatch, "updatedAt">): void {
  openStore()
    .prepare(
      `INSERT INTO last_watch (anime_id, translation_id, episode, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(anime_id) DO UPDATE SET translation_id = excluded.translation_id, episode = excluded.episode, updated_at = excluded.updated_at`
    )
    .run(row.animeId, row.translationId, row.episode, Date.now());
}

export function getFavorites(): LibraryItem[] {
  const rows = openStore()
    .prepare("SELECT anime_id, title, poster, score, added_at FROM favorites ORDER BY added_at DESC")
    .all() as { anime_id: number; title: string; poster: string; score: string; added_at: number }[];
  return rows.map((r) => ({
    animeId: r.anime_id,
    title: r.title,
    poster: hydrateLibraryPoster(r.anime_id, r.poster),
    score: r.score,
    at: r.added_at
  }));
}

export function isFavorite(animeId: number): boolean {
  const row = openStore().prepare("SELECT 1 FROM favorites WHERE anime_id = ?").get(animeId);
  return Boolean(row);
}

export function toggleFavorite(item: Omit<LibraryItem, "at">): boolean {
  const store = openStore();
  if (isFavorite(item.animeId)) {
    store.prepare("DELETE FROM favorites WHERE anime_id = ?").run(item.animeId);
    return false;
  }
  store
    .prepare("INSERT INTO favorites (anime_id, title, poster, score, added_at) VALUES (?, ?, ?, ?, ?)")
    .run(item.animeId, item.title, item.poster, item.score ?? "", Date.now());
  return true;
}

export function getHistory(): LibraryItem[] {
  const rows = openStore()
    .prepare(
      "SELECT anime_id, title, poster, episode, translation_title, watched_at FROM history ORDER BY watched_at DESC LIMIT 200"
    )
    .all() as {
    anime_id: number;
    title: string;
    poster: string;
    episode: number;
    translation_title: string;
    watched_at: number;
  }[];
  return rows.map((r) => ({
    animeId: r.anime_id,
    title: r.title,
    poster: hydrateLibraryPoster(r.anime_id, r.poster),
    episode: r.episode,
    translationTitle: r.translation_title,
    at: r.watched_at
  }));
}

export function listProgress(animeId: number, translationId: string): ProgressRow[] {
  const rows = openStore()
    .prepare(
      "SELECT anime_id, translation_id, episode, position_sec, duration_sec, updated_at FROM progress WHERE anime_id = ? AND translation_id = ?"
    )
    .all(animeId, translationId) as {
    anime_id: number;
    translation_id: string;
    episode: number;
    position_sec: number;
    duration_sec: number;
    updated_at: number;
  }[];
  return rows.map((row) => ({
    animeId: row.anime_id,
    translationId: row.translation_id,
    episode: row.episode,
    positionSec: row.position_sec,
    durationSec: row.duration_sec,
    updatedAt: row.updated_at
  }));
}

export function getContinueWatching(): ContinueItem[] {
  return getHistory().map((item) => {
    const last = getLastWatch(item.animeId);
    const episode = last?.episode ?? item.episode ?? 1;
    const translationId = last?.translationId || "";
    const prog = translationId ? getProgress(item.animeId, translationId, episode) : null;
    return {
      ...item,
      episode,
      translationId: translationId || undefined,
      positionSec: prog?.positionSec ?? 0,
      durationSec: prog?.durationSec ?? 0
    };
  });
}

export function addHistory(item: Omit<LibraryItem, "at">): void {
  openStore()
    .prepare(
      `INSERT INTO history (anime_id, title, poster, episode, translation_title, watched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(anime_id) DO UPDATE SET
         title = excluded.title,
         poster = excluded.poster,
         episode = excluded.episode,
         translation_title = excluded.translation_title,
         watched_at = excluded.watched_at`
    )
    .run(item.animeId, item.title, item.poster, item.episode ?? 0, item.translationTitle ?? "", Date.now());
}

function mapDownload(r: {
  id: string;
  anime_id: number;
  title: string;
  episode: number;
  filename: string;
  path: string;
  status: string;
  error: string | null;
  created_at: number;
}): DownloadItem {
  return {
    id: r.id,
    animeId: r.anime_id,
    title: r.title,
    episode: r.episode,
    filename: r.filename,
    path: r.path,
    status: r.status as DownloadStatus,
    error: r.error || undefined,
    at: r.created_at
  };
}

export function upsertDownload(item: DownloadItem): void {
  openStore()
    .prepare(
      `INSERT INTO downloads (id, anime_id, title, episode, filename, path, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         error = excluded.error,
         path = excluded.path`
    )
    .run(
      item.id,
      item.animeId,
      item.title,
      item.episode,
      item.filename,
      item.path,
      item.status,
      item.error ?? "",
      item.at
    );
}

export function listDownloads(): DownloadItem[] {
  const rows = openStore()
    .prepare(
      "SELECT id, anime_id, title, episode, filename, path, status, error, created_at FROM downloads ORDER BY created_at DESC LIMIT 80"
    )
    .all() as {
    id: string;
    anime_id: number;
    title: string;
    episode: number;
    filename: string;
    path: string;
    status: string;
    error: string | null;
    created_at: number;
  }[];
  return rows.map(mapDownload);
}

export function getDownload(id: string): DownloadItem | null {
  const row = openStore()
    .prepare(
      "SELECT id, anime_id, title, episode, filename, path, status, error, created_at FROM downloads WHERE id = ?"
    )
    .get(id) as
    | {
        id: string;
        anime_id: number;
        title: string;
        episode: number;
        filename: string;
        path: string;
        status: string;
        error: string | null;
        created_at: number;
      }
    | undefined;
  return row ? mapDownload(row) : null;
}

export function getSeenEpisode(animeId: number): number | null {
  const row = openStore().prepare("SELECT last_episode FROM episode_seen WHERE anime_id = ?").get(animeId) as
    | { last_episode: number }
    | undefined;
  return row ? row.last_episode : null;
}

export function setSeenEpisode(animeId: number, episode: number): void {
  openStore()
    .prepare(
      `INSERT INTO episode_seen (anime_id, last_episode) VALUES (?, ?)
       ON CONFLICT(anime_id) DO UPDATE SET last_episode = excluded.last_episode`
    )
    .run(animeId, episode);
}

export function getWatchStats(completed = 0): WatchStats {
  const store = openStore();
  const rows = store
    .prepare("SELECT position_sec, duration_sec FROM progress")
    .all() as { position_sec: number; duration_sec: number }[];
  let watched = 0;
  let episodes = 0;
  for (const row of rows) {
    const dur = row.duration_sec || 0;
    const pos = row.position_sec || 0;
    const done = dur > 0 && dur - pos < 15;
    const use = done ? dur : pos;
    if (use > 20) {
      watched += use;
      episodes += 1;
    }
  }
  const titles = (
    store.prepare("SELECT COUNT(*) AS n FROM history").get() as { n: number }
  ).n;
  return {
    hours: Math.round((watched / 3600) * 10) / 10,
    episodes,
    titles,
    completed
  };
}
