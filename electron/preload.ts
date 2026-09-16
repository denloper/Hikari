import { contextBridge, ipcRenderer } from "electron";
import type {
  AnimeTitle,
  AppConfig,
  CatalogFilters,
  DiscordPresence,
  EmbedBounds,
  UpdateState,
  HikariApi,
  LibraryItem,
  PipCommand,
  PipSession,
  ProgressRow
} from "../shared/types";

const api: HikariApi = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg: AppConfig) => ipcRenderer.invoke("config:save", cfg),
  searchAnime: (query: string) => ipcRenderer.invoke("anime:search", query),
  listCatalog: (filters?: CatalogFilters) => ipcRenderer.invoke("anime:catalog", filters),
  getCatalogMeta: () => ipcRenderer.invoke("anime:catalogMeta"),
  getSchedule: () => ipcRenderer.invoke("anime:schedule"),
  getAnime: (id: number) => ipcRenderer.invoke("anime:get", id),
  getTranslations: (anime: AnimeTitle) => ipcRenderer.invoke("anime:translations", anime),
  resolveStream: (args) => ipcRenderer.invoke("stream:resolve", args),
  getProgress: (animeId, translationId, episode) =>
    ipcRenderer.invoke("progress:get", animeId, translationId, episode),
  saveProgress: (row: Omit<ProgressRow, "updatedAt">) => ipcRenderer.invoke("progress:save", row),
  getLastWatch: (animeId) => ipcRenderer.invoke("watch:get", animeId),
  saveLastWatch: (row) => ipcRenderer.invoke("watch:save", row),
  getFavorites: () => ipcRenderer.invoke("fav:list"),
  toggleFavorite: (item: Omit<LibraryItem, "at">) => ipcRenderer.invoke("fav:toggle", item),
  isFavorite: (animeId) => ipcRenderer.invoke("fav:has", animeId),
  getHistory: () => ipcRenderer.invoke("history:list"),
  getContinueWatching: () => ipcRenderer.invoke("watch:continue"),
  listProgress: (animeId, translationId) => ipcRenderer.invoke("progress:list", animeId, translationId),
  addHistory: (item: Omit<LibraryItem, "at">) => ipcRenderer.invoke("history:add", item),
  pickSubtitle: () => ipcRenderer.invoke("sub:pick"),
  loadSubtitleFromFolder: (folder, hint) => ipcRenderer.invoke("sub:fromFolder", folder, hint),
  pickSubtitleFolder: () => ipcRenderer.invoke("sub:folder"),
  showEmbed: (url, bounds: EmbedBounds) => ipcRenderer.invoke("embed:show", url, bounds),
  updateEmbedBounds: (bounds) => ipcRenderer.invoke("embed:bounds", bounds),
  hideEmbed: (keepPip) => ipcRenderer.invoke("embed:hide", keepPip),
  getPipSession: () => ipcRenderer.invoke("pip:getSession"),
  seekEmbed: (seconds) => ipcRenderer.invoke("embed:seek", seconds),
  embedPlayPause: () => ipcRenderer.invoke("embed:playPause"),
  embedGetTime: () => ipcRenderer.invoke("embed:time"),
  getSkipTimes: (malId, episode) => ipcRenderer.invoke("skip:times", malId, episode),
  toggleEmbedPip: () => ipcRenderer.invoke("pip:toggle"),
  embedPipOpen: () => ipcRenderer.invoke("pip:open"),
  openPip: (session) => ipcRenderer.invoke("pip:enter", session),
  closePip: () => ipcRenderer.invoke("pip:close"),
  updatePip: (session) => ipcRenderer.invoke("pip:update", session),
  pipCommand: (cmd) => ipcRenderer.invoke("pip:fromPip", cmd),
  onEmbedPipChange: (cb) => {
    const fn = (_e: unknown, open: boolean) => cb(open);
    ipcRenderer.on("pip:changed", fn);
    return () => {
      ipcRenderer.removeListener("pip:changed", fn);
    };
  },
  onPipCommand: (cb) => {
    const fn = (_e: unknown, cmd: PipCommand) => cb(cmd);
    ipcRenderer.on("pip:command", fn);
    return () => {
      ipcRenderer.removeListener("pip:command", fn);
    };
  },
  onPipSession: (cb) => {
    const fn = (_e: unknown, session: PipSession | null) => cb(session);
    ipcRenderer.on("pip:session", fn);
    return () => {
      ipcRenderer.removeListener("pip:session", fn);
    };
  },
  shikiLogin: () => ipcRenderer.invoke("shiki:login"),
  shikiLoginWithCode: (code) => ipcRenderer.invoke("shiki:loginCode", code),
  shikiLogout: () => ipcRenderer.invoke("shiki:logout"),
  getShikiAccount: () => ipcRenderer.invoke("shiki:account"),
  getShikiList: (status) => ipcRenderer.invoke("shiki:list", status),
  getShikiRate: (animeId) => ipcRenderer.invoke("shiki:rate", animeId),
  setShikiRate: (animeId, patch) => ipcRenderer.invoke("shiki:setRate", animeId, patch),
  listLatestReleases: () => ipcRenderer.invoke("anime:latest"),
  getRelated: (animeId) => ipcRenderer.invoke("anime:related", animeId),
  getWatchStats: () => ipcRenderer.invoke("stats:get"),
  enqueueDownload: (args) => ipcRenderer.invoke("dl:enqueue", args),
  listDownloads: () => ipcRenderer.invoke("dl:list"),
  openDownload: (id) => ipcRenderer.invoke("dl:open", id),
  openDownloadFolder: () => ipcRenderer.invoke("dl:folder"),
  pickDownloadFolder: () => ipcRenderer.invoke("dl:pickFolder"),
  onNotifyOpenTitle: (cb) => {
    const fn = (_e: unknown, animeId: number) => cb(animeId);
    ipcRenderer.on("notify:open-title", fn);
    return () => {
      ipcRenderer.removeListener("notify:open-title", fn);
    };
  },
  onDownloadsChanged: (cb) => {
    const fn = () => cb();
    ipcRenderer.on("downloads:changed", fn);
    return () => {
      ipcRenderer.removeListener("downloads:changed", fn);
    };
  },
  setDiscordPresence: (presence: DiscordPresence | null) => ipcRenderer.invoke("discord:set", presence),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  getUpdateState: () => ipcRenderer.invoke("update:state"),
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (cb) => {
    const fn = (_e: unknown, state: UpdateState) => cb(state);
    ipcRenderer.on("update:state", fn);
    return () => {
      ipcRenderer.removeListener("update:state", fn);
    };
  }
};

contextBridge.exposeInMainWorld("hikari", api);
