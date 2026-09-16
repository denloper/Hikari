/** Общие типы IPC между main и renderer. Токены сюда не входят. */

export interface ThemeSettings {
  mode: "dark" | "light";
  accent: string;
  saturation: number;
  swatches: string[];
}

export interface PipBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppConfig {
  kodikToken: string;
  shikimoriUserAgent: string;
  shikimoriClientId: string;
  shikimoriClientSecret: string;
  subtitleFolder: string;
  downloadFolder: string;
  adblock: boolean;
  episodeNotify: boolean;
  preferredStudio: string;
  theme: ThemeSettings;
  pipBounds?: PipBounds;
  discordRpc: boolean;
}

export type UpdateStatus = "idle" | "checking" | "available" | "none" | "downloading" | "ready" | "error";

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  error?: string;
}

export interface DiscordPresence {
  browsing?: boolean;
  animeId?: number;
  title?: string;
  episode?: number;
  season?: number;
  studio?: string;
  poster?: string;
  paused?: boolean;
}

export interface ShikiAccount {
  id: number;
  nickname: string;
  avatar?: string;
}

export type ShikiListStatus = "watching" | "completed" | "planned" | "on_hold" | "dropped" | "rewatching";

export interface ShikiRate {
  id: number;
  animeId: number;
  status: ShikiListStatus;
  episodes: number;
  score: number;
}

export interface StreamSkip {
  start: number;
  end: number;
}

export interface StreamSkips {
  opening?: StreamSkip;
  ending?: StreamSkip;
}

export interface PipSession {
  kind: "hls" | "file" | "embed";
  title: string;
  meta: string;
  hasNext: boolean;
  time: number;
  paused?: boolean;
  stream?: StreamResult;
  quality?: number;
}

export type PipCommand =
  | { type: "return"; time?: number }
  | { type: "next" }
  | { type: "closed"; time?: number }
  | { type: "time"; time: number; paused?: boolean };

export interface CatalogGenre {
  id: number;
  name: string;
}

export type CatalogKind = "tv" | "movie" | "ova" | "ona" | "special";
export type CatalogStatus = "anons" | "ongoing" | "released";
export type CatalogOrder = "popularity" | "ranked" | "aired_on";

export interface CatalogFilters {
  query?: string;
  ongoing?: boolean;
  genreId?: number;
  year?: number;
  kind?: CatalogKind;
  status?: CatalogStatus;
  minScore?: number;
  order?: CatalogOrder;
  page?: number;
}

export interface CatalogMeta {
  genres: CatalogGenre[];
  years: number[];
}

export interface AnimeCard {
  id: number;
  name: string;
  russian: string;
  score: string;
  kind: string;
  status: string;
  episodes: number;
  airedOn: string;
  poster: string;
  posterLocal?: string;
  /** 1 = понедельник … 7 = воскресенье */
  publishDay?: number;
  nextEpisode?: number;
  /** ISO дата/время следующей серии */
  nextEpisodeAt?: string;
  lastEpisode?: number;
}

export interface ScheduleDay {
  weekday: number;
  label: string;
  items: AnimeCard[];
}

export interface AnimeTitle extends AnimeCard {
  description: string;
  genres: string[];
  /** id Шикимори — чтобы чип жанра сразу открыл каталог */
  genreTags?: CatalogGenre[];
  rating: string;
  episodesAired: number;
  duration: number;
}

export interface Translation {
  id: string;
  title: string;
  type: "voice" | "subtitles" | "other";
  source: "kodik" | "anilibria" | "animevost" | "sameband" | "dreamerscast" | "animelib" | "yummyanime";
  quality?: string;
  seasons: Season[];
  lastEpisode?: number;
}

export interface Season {
  number: number;
  episodes: EpisodeRef[];
}

export interface EpisodeRef {
  number: number;
  title?: string;
  /** Для Kodik — embed; для AniLibria — id серии. */
  ref: string;
}

export interface StreamQuality {
  height: number;
  url: string;
}

export interface SubtitleFile {
  path: string;
  name: string;
  ext: "ass" | "srt";
  content: string;
}

export type StreamResult =
  | { kind: "hls"; qualities: StreamQuality[]; referer?: string; subtitle?: SubtitleFile; skips?: StreamSkips }
  | { kind: "file"; qualities: StreamQuality[]; referer?: string; subtitle?: SubtitleFile; skips?: StreamSkips }
  | { kind: "embed"; url: string; skips?: StreamSkips };

export interface ProgressRow {
  animeId: number;
  translationId: string;
  episode: number;
  positionSec: number;
  durationSec: number;
  updatedAt: number;
}

export interface LastWatch {
  animeId: number;
  translationId: string;
  episode: number;
  updatedAt: number;
}

export interface LibraryItem {
  animeId: number;
  title: string;
  poster: string;
  score?: string;
  episode?: number;
  translationTitle?: string;
  at: number;
}

/** Карточка «Продолжить»: история + прогресс серии. */
export interface ContinueItem extends LibraryItem {
  translationId?: string;
  positionSec: number;
  durationSec: number;
}

export interface RelatedTitle {
  relation: string;
  anime: AnimeCard;
}

export interface WatchStats {
  hours: number;
  episodes: number;
  titles: number;
  completed: number;
}

export type DownloadStatus = "queued" | "downloading" | "done" | "error";

export interface DownloadItem {
  id: string;
  animeId: number;
  title: string;
  episode: number;
  filename: string;
  path: string;
  status: DownloadStatus;
  error?: string;
  at: number;
}

export interface EmbedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HikariApi {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (cfg: AppConfig) => Promise<AppConfig>;
  searchAnime: (query: string) => Promise<AnimeCard[]>;
  listCatalog: (filters?: CatalogFilters) => Promise<AnimeCard[]>;
  getCatalogMeta: () => Promise<CatalogMeta>;
  getSchedule: () => Promise<ScheduleDay[]>;
  getAnime: (id: number) => Promise<AnimeTitle>;
  getTranslations: (anime: AnimeTitle) => Promise<Translation[]>;
  resolveStream: (args: {
    source: Translation["source"];
    ref: string;
    quality?: number;
    anilibriaEpisodeId?: string;
  }) => Promise<StreamResult>;
  getProgress: (animeId: number, translationId: string, episode: number) => Promise<ProgressRow | null>;
  saveProgress: (row: Omit<ProgressRow, "updatedAt">) => Promise<void>;
  getLastWatch: (animeId: number) => Promise<LastWatch | null>;
  saveLastWatch: (row: Omit<LastWatch, "updatedAt">) => Promise<void>;
  getFavorites: () => Promise<LibraryItem[]>;
  toggleFavorite: (item: Omit<LibraryItem, "at">) => Promise<boolean>;
  isFavorite: (animeId: number) => Promise<boolean>;
  getHistory: () => Promise<LibraryItem[]>;
  getContinueWatching: () => Promise<ContinueItem[]>;
  listProgress: (animeId: number, translationId: string) => Promise<ProgressRow[]>;
  addHistory: (item: Omit<LibraryItem, "at">) => Promise<void>;
  pickSubtitle: () => Promise<SubtitleFile | null>;
  loadSubtitleFromFolder: (folder: string, hint: string) => Promise<SubtitleFile | null>;
  pickSubtitleFolder: () => Promise<string | null>;
  showEmbed: (url: string, bounds: EmbedBounds) => Promise<void>;
  updateEmbedBounds: (bounds: EmbedBounds) => Promise<void>;
  hideEmbed: () => Promise<void>;
  seekEmbed: (seconds: number) => Promise<boolean>;
  embedPlayPause: () => Promise<boolean>;
  embedGetTime: () => Promise<number>;
  getSkipTimes: (malId: number, episode: number) => Promise<StreamSkips>;
  toggleEmbedPip: () => Promise<boolean>;
  embedPipOpen: () => Promise<boolean>;
  openPip: (session: PipSession) => Promise<boolean>;
  closePip: () => Promise<void>;
  updatePip: (session: PipSession) => Promise<void>;
  pipCommand: (cmd: PipCommand) => Promise<void>;
  onEmbedPipChange: (cb: (open: boolean) => void) => () => void;
  onPipCommand: (cb: (cmd: PipCommand) => void) => () => void;
  onPipSession: (cb: (session: PipSession | null) => void) => () => void;
  shikiLogin: () => Promise<ShikiAccount>;
  shikiLoginWithCode: (code: string) => Promise<ShikiAccount>;
  shikiLogout: () => Promise<void>;
  getShikiAccount: () => Promise<ShikiAccount | null>;
  getShikiList: (status: ShikiListStatus) => Promise<LibraryItem[]>;
  getShikiRate: (animeId: number) => Promise<ShikiRate | null>;
  setShikiRate: (animeId: number, patch: { status?: ShikiListStatus; episodes?: number; score?: number }) => Promise<ShikiRate | null>;
  listLatestReleases: () => Promise<AnimeCard[]>;
  getRelated: (animeId: number) => Promise<RelatedTitle[]>;
  getWatchStats: () => Promise<WatchStats>;
  enqueueDownload: (args: {
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
  }) => Promise<DownloadItem>;
  listDownloads: () => Promise<DownloadItem[]>;
  openDownload: (id: string) => Promise<void>;
  openDownloadFolder: () => Promise<string>;
  pickDownloadFolder: () => Promise<string | null>;
  onNotifyOpenTitle: (cb: (animeId: number) => void) => () => void;
  onDownloadsChanged: (cb: () => void) => () => void;
  setDiscordPresence: (presence: DiscordPresence | null) => Promise<void>;
  getAppVersion: () => Promise<string>;
  getUpdateState: () => Promise<UpdateState>;
  checkForUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<void>;
  onUpdateState: (cb: (state: UpdateState) => void) => () => void;
}
