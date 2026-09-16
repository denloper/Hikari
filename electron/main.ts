import { app, BrowserView, BrowserWindow, ipcMain, protocol, session } from "electron";
import path from "node:path";
import { loadConfig, saveConfig } from "./services/config";
import { getAnime, getCatalogMeta, getRelated, getSchedule, listCatalog, listLatestReleases, listShikiUserList, searchAnime } from "./services/shikimori";
import type { AppConfig, CatalogFilters, DiscordPresence, EmbedBounds, PipCommand, PipSession, ShikiListStatus } from "../shared/types";
import { fetchSkipTimes } from "./services/aniskip";
import { applyDiscordConfig, setDiscordPresence, shutdownDiscordRpc, startDiscordRpc } from "./services/discord-rpc";
import { attachUpdater, checkForAppUpdate, getUpdateState, installAppUpdate, startUpdateLoop } from "./services/updater";
import { loadPosterBuffer, loadSplashBuffer } from "./services/posters";
import { jikanSeasonNow } from "./services/jikan";
import { getTranslations, resolveStream } from "./services/translations";
import { enqueueDownload, listDownloads, openDownload, openDownloadFolder, pickDownloadFolder, resumeDownloads, setDownloadWindow } from "./services/download";
import { checkNewEpisodes } from "./services/notify";
import {
  getShikiAccount,
  getShikiRate,
  setShikiRate,
  shikiLoginWithCode,
  shikiLogout,
  startShikiLogin,
  syncShikiWatch
} from "./services/shiki-oauth";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "hikari",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true
    }
  }
]);
import {
  addHistory,
  getContinueWatching,
  getFavorites,
  getHistory,
  getLastWatch,
  getProgress,
  getWatchStats,
  isFavorite,
  listProgress,
  openStore,
  saveLastWatch,
  saveProgress,
  toggleFavorite
} from "./services/store";
import { loadSubtitleFromFolder, pickSubtitle, pickSubtitleFolder } from "./services/subtitles";
import { applyAdblock, watchEmbedAds } from "./services/adblock";

let mainWindow: BrowserWindow | null = null;
let embedView: BrowserView | null = null;
let pipWin: BrowserWindow | null = null;
let pipSession: PipSession | null = null;
let embedUrl = "";
let lastPipTime = 0;
let closingPip = false;
let persistPipTimer: ReturnType<typeof setTimeout> | null = null;
const PIP_RATIO = 16 / 9;
const PIP_DRAG = 12;

function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL);
}

function nativeIcon(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(process.cwd(), "build", "icon.ico");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#07080c",
    title: "Hikari",
    icon: nativeIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // HLS с CDN Kodik/AniLibria часто без CORS — локальный плеер.
      webSecurity: false
    }
  });

  lockWindow(mainWindow);

  if (isDev()) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    embedView = null;
    mainWindow = null;
  });
}

function attachPosterProtocol(): void {
  session.defaultSession.protocol.handle("hikari", async (request) => {
    try {
      const parsed = new URL(request.url);
      if (parsed.hostname === "embed") {
        const target = parsed.searchParams.get("u") ?? "";
        if (!/^https?:\/\//i.test(target)) {
          return new Response("bad embed", { status: 400 });
        }
        return new Response(embedHtml(target), {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      if (parsed.hostname === "splash") {
        const id = Number(parsed.pathname.replace(/^\//, "").split("/")[0]);
        const buf = await loadSplashBuffer(id);
        if (!buf) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
        return new Response(Uint8Array.from(buf), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=86400"
          }
        });
      }
      if (parsed.hostname !== "poster") {
        return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      const id = Number(parsed.pathname.replace(/^\//, "").split("/")[0]);
      const buf = await loadPosterBuffer(id);
      if (!buf) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      return new Response(Uint8Array.from(buf), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400"
        }
      });
    } catch {
      return new Response("error", { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  });
}

function attachCdnHeaders(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    const u = details.url;
    const headers = { ...details.requestHeaders };
    if (u.includes("kodik") || u.includes("aniqit") || u.includes("cloud.kodik")) {
      headers.Referer = headers.Referer || "https://kodik.info/";
      headers.Origin = headers.Origin || "https://kodik.info";
    }
    if (u.includes("anilibria") || u.includes("libria")) {
      headers.Referer = headers.Referer || "https://anilibria.top/";
      headers.Origin = headers.Origin || "https://anilibria.top";
    }
    if (u.includes("animevost") || u.includes("animetop.info")) {
      headers.Referer = headers.Referer || "https://animevost.org/";
      headers.Origin = headers.Origin || "https://animevost.org";
    }
    if (u.includes("sameband")) {
      headers.Referer = headers.Referer || "https://sameband.studio/";
      headers.Origin = headers.Origin || "https://sameband.studio";
    }
    if (u.includes("dreamerscast")) {
      headers.Referer = headers.Referer || "https://dreamerscast.com/";
      headers.Origin = headers.Origin || "https://dreamerscast.com";
    }
    if (u.includes("shikimori")) {
      headers.Referer = headers.Referer || "https://shikimori.io/";
      headers.Origin = headers.Origin || "https://shikimori.io";
    }
    if (u.includes("yani.tv") || u.includes("yummyani") || u.includes("aniboom") || u.includes("cdnvideohub")) {
      headers.Referer = headers.Referer || "https://yummyani.me/";
      headers.Origin = headers.Origin || "https://yummyani.me";
    }
    cb({ requestHeaders: headers });
  });
}

/** Kodik рисует фейковую 404, если плеер открыт не во iframe. hikari:// — чтобы adblock видел кадры. */
function embedHtml(url: string): string {
  const safe = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "");
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000}</style></head><body>` +
    `<iframe src="${safe}" allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>` +
    `</body></html>`
  );
}

function lockWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, next) => {
    const ok =
      next.startsWith("file:") ||
      next.startsWith("hikari:") ||
      Boolean(process.env.ELECTRON_RENDERER_URL && next.startsWith(process.env.ELECTRON_RENDERER_URL));
    if (!ok) e.preventDefault();
  });
}

function embedHref(url: string): string {
  return `hikari://embed/?u=${encodeURIComponent(url)}`;
}

function ensureEmbedView(): BrowserView | null {
  if (!mainWindow) return null;
  if (!embedView) {
    embedView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    watchEmbedAds(embedView.webContents);
    embedView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
  return embedView;
}

function pinPip(): void {
  if (!pipWin || pipWin.isDestroyed()) return;
  pipWin.setAlwaysOnTop(true, "screen-saver");
  pipWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function layoutPip(): void {
  if (!pipWin || pipWin.isDestroyed() || !embedView || pipSession?.kind !== "embed") return;
  const [w, h] = pipWin.getContentSize();
  const top = PIP_DRAG;
  embedView.setBounds({ x: 0, y: top, width: Math.max(1, w), height: Math.max(80, h - top) });
  embedView.setAutoResize({ width: true, height: true });
  void runInEmbedFrames(
    `(function(){var v=document.querySelector("video");if(!v)return false;v.style.objectFit="contain";v.style.objectPosition="center";v.style.width="100%";v.style.height="100%";return true;})()`
  );
}

function persistPipBounds(): void {
  if (persistPipTimer) clearTimeout(persistPipTimer);
  persistPipTimer = setTimeout(() => {
    persistPipTimer = null;
    if (!pipWin || pipWin.isDestroyed()) return;
    const b = pipWin.getBounds();
    const cfg = loadConfig();
    saveConfig({ ...cfg, pipBounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
  }, 400);
}

function closePip(): void {
  if (!pipWin || pipWin.isDestroyed()) {
    pipWin = null;
    pipSession = null;
    return;
  }
  closingPip = true;
  persistPipBounds();
  const win = pipWin;
  pipWin = null;
  pipSession = null;
  win.close();
}

function returnEmbedToMain(): void {
  if (!embedView || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    embedView.setAutoResize({ width: false, height: false });
  } catch {
    /* view ещё без окна */
  }
  try {
    mainWindow.addBrowserView(embedView);
  } catch {
    /* уже в главном окне */
  }
}

function sendPipSession(): void {
  if (pipWin && !pipWin.isDestroyed()) {
    pipWin.webContents.send("pip:session", pipSession);
  }
}

function attachPipMedia(session: PipSession): void {
  if (!pipWin || pipWin.isDestroyed()) return;
  if (session.kind === "embed" && embedView) {
    try {
      mainWindow?.removeBrowserView(embedView);
    } catch {
      /* view уже снят */
    }
    try {
      pipWin.addBrowserView(embedView);
    } catch {
      /* уже в PiP */
    }
    layoutPip();
    return;
  }
  if (embedView) {
    try {
      pipWin.removeBrowserView(embedView);
    } catch {
      /* не было в PiP */
    }
  }
}

async function runInEmbedFrames(code: string): Promise<unknown[]> {
  if (!embedView) return [];
  const frames = embedView.webContents.mainFrame.framesInSubtree;
  const out: unknown[] = [];
  for (const frame of frames) {
    try {
      out.push(await frame.executeJavaScript(code, true));
    } catch {
      /* чужой кадр без video */
    }
  }
  return out;
}

async function seekEmbed(sec: number): Promise<boolean> {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return false;
  const hits = await runInEmbedFrames(
    `(function(){var v=document.querySelector("video");if(!v)return false;v.currentTime=${n};return true;})()`
  );
  return hits.some(Boolean);
}

async function embedPlayPause(): Promise<boolean> {
  const hits = await runInEmbedFrames(
    `(function(){var v=document.querySelector("video");if(!v)return null;if(v.paused){void v.play();return true;}v.pause();return false;})()`
  );
  const last = [...hits].reverse().find((x) => x === true || x === false);
  return last === true;
}

async function embedGetTime(): Promise<number> {
  const hits = await runInEmbedFrames(
    `(function(){var v=document.querySelector("video");return v&&Number.isFinite(v.currentTime)?v.currentTime:-1;})()`
  );
  const t = hits.map(Number).find((n) => Number.isFinite(n) && n >= 0);
  return t ?? 0;
}

function rendererPipUrl(): { url?: string; file?: string } {
  if (isDev()) return { url: `${process.env.ELECTRON_RENDERER_URL}#/pip` };
  return { file: path.join(__dirname, "../renderer/index.html") };
}

function openPipWindow(session: PipSession): boolean {
  if (!mainWindow) return false;
  pipSession = session;
  lastPipTime = session.time || lastPipTime;
  if (pipWin && !pipWin.isDestroyed()) {
    attachPipMedia(session);
    sendPipSession();
    pinPip();
    pipWin.showInactive();
    mainWindow.webContents.send("pip:changed", true);
    return true;
  }
  closingPip = false;
  const saved = loadConfig().pipBounds;
  const startW = saved?.width ?? 480;
  const startH = Math.round(startW / PIP_RATIO) + PIP_DRAG;
  pipWin = new BrowserWindow({
    width: startW,
    height: startH,
    x: saved?.x,
    y: saved?.y,
    minWidth: 280,
    minHeight: Math.round(280 / PIP_RATIO),
    alwaysOnTop: true,
    frame: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#07080c",
    title: "Hikari",
    icon: nativeIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false
    }
  });
  lockWindow(pipWin);
  pinPip();
  pipWin.setAspectRatio(PIP_RATIO, { width: 0, height: PIP_DRAG });
  pipWin.on("resize", () => {
    layoutPip();
    persistPipBounds();
  });
  pipWin.on("move", persistPipBounds);
  pipWin.on("blur", () => pinPip());
  pipWin.on("focus", () => pinPip());
  pipWin.once("ready-to-show", () => {
    attachPipMedia(session);
    layoutPip();
    sendPipSession();
    pinPip();
    pipWin?.showInactive();
  });
  pipWin.on("closed", () => {
    persistPipBounds();
    pipWin = null;
    pipSession = null;
    returnEmbedToMain();
    if (!closingPip) {
      mainWindow?.webContents.send("pip:command", { type: "closed", time: lastPipTime } satisfies PipCommand);
    }
    closingPip = false;
    mainWindow?.webContents.send("pip:changed", false);
  });
  pipWin.webContents.on("did-finish-load", () => sendPipSession());
  const loc = rendererPipUrl();
  if (loc.url) void pipWin.loadURL(loc.url);
  else if (loc.file) void pipWin.loadFile(loc.file, { hash: "/pip" });
  attachPipMedia(session);
  mainWindow.webContents.send("pip:changed", true);
  return true;
}

function toggleEmbedPip(): boolean {
  if (pipWin) {
    closePip();
    returnEmbedToMain();
    mainWindow?.webContents.send("pip:changed", false);
    return false;
  }
  return openPipWindow({
    kind: "embed",
    key: "embed",
    title: "Hikari",
    meta: "",
    hasNext: false,
    time: 0
  });
}

function handlePipCommand(cmd: PipCommand): void {
  if (cmd.type === "time") {
    lastPipTime = cmd.time;
    mainWindow?.webContents.send("pip:command", cmd);
    return;
  }
  if (cmd.type === "next") {
    lastPipTime = 0;
    mainWindow?.webContents.send("pip:command", cmd);
    return;
  }
  if (cmd.type === "return" || cmd.type === "closed") {
    if (typeof cmd.time === "number" && cmd.time > 0) lastPipTime = cmd.time;
    mainWindow?.webContents.send("pip:command", { ...cmd, time: lastPipTime });
    if (pipWin) {
      closePip();
      returnEmbedToMain();
    }
  }
}

function showEmbed(url: string, bounds: EmbedBounds): void {
  if (!mainWindow) return;
  const view = ensureEmbedView();
  if (!view) return;
  if (embedUrl !== url) {
    embedUrl = url;
    void view.webContents.loadURL(embedHref(url));
  }
  if (pipWin && pipSession?.kind === "embed") {
    attachPipMedia(pipSession);
    layoutPip();
    return;
  }
  try {
    mainWindow.addBrowserView(view);
  } catch {
    /* уже добавлен */
  }
  view.setBounds(bounds);
}

function updateEmbedBounds(bounds: EmbedBounds): void {
  if (pipWin) return;
  embedView?.setBounds(bounds);
}

function hideEmbed(keepPip = false): void {
  embedUrl = "";
  const view = embedView;
  embedView = null;
  if (!keepPip) closePip();
  if (!view) return;
  if (pipWin && !pipWin.isDestroyed()) {
    try {
      pipWin.removeBrowserView(view);
    } catch {
      /* view не в PiP */
    }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.removeBrowserView(view);
    } catch {
      /* view уже снят */
    }
  }
  try {
    view.webContents.close();
  } catch {
    /* view уже закрыт */
  }
}

function registerIpc(): void {
  ipcMain.handle("config:get", () => loadConfig());
  ipcMain.handle("config:save", (_e, cfg: AppConfig) => {
    const next = saveConfig(cfg);
    applyAdblock();
    applyDiscordConfig();
    return next;
  });

  ipcMain.handle("anime:search", (_e, query: string) => searchAnime(query));
  ipcMain.handle("anime:catalog", (_e, filters?: CatalogFilters) => listCatalog(filters));
  ipcMain.handle("anime:catalogMeta", () => getCatalogMeta());
  ipcMain.handle("anime:schedule", () => getSchedule());
  ipcMain.handle("anime:get", (_e, id: number) => getAnime(id));
  ipcMain.handle("anime:translations", (_e, anime) => getTranslations(anime));
  ipcMain.handle("stream:resolve", (_e, args) => resolveStream(args));
  ipcMain.handle("progress:get", (_e, animeId: number, translationId: string, episode: number) =>
    getProgress(animeId, translationId, episode)
  );
  ipcMain.handle("progress:save", (_e, row) => saveProgress(row));
  ipcMain.handle("watch:get", (_e, animeId: number) => getLastWatch(animeId));
  ipcMain.handle("watch:save", (_e, row) => {
    saveLastWatch(row);
    void getAnime(row.animeId)
      .then((title) => syncShikiWatch(row.animeId, row.episode, title.episodesAired || title.episodes))
      .catch(() => syncShikiWatch(row.animeId, row.episode));
  });

  ipcMain.handle("fav:list", () => getFavorites());
  ipcMain.handle("fav:toggle", (_e, item) => toggleFavorite(item));
  ipcMain.handle("fav:has", (_e, animeId: number) => isFavorite(animeId));
  ipcMain.handle("history:list", () => getHistory());
  ipcMain.handle("history:add", (_e, item) => addHistory(item));
  ipcMain.handle("watch:continue", () => getContinueWatching());
  ipcMain.handle("progress:list", (_e, animeId: number, translationId: string) =>
    listProgress(animeId, translationId)
  );

  ipcMain.handle("sub:pick", () => (mainWindow ? pickSubtitle(mainWindow) : null));
  ipcMain.handle("sub:folder", () => (mainWindow ? pickSubtitleFolder(mainWindow) : null));
  ipcMain.handle("sub:fromFolder", (_e, folder: string, hint: string) => loadSubtitleFromFolder(folder, hint));

  ipcMain.handle("embed:show", (_e, url: string, bounds: EmbedBounds) => showEmbed(url, bounds));
  ipcMain.handle("embed:bounds", (_e, bounds: EmbedBounds) => updateEmbedBounds(bounds));
  ipcMain.handle("embed:hide", (_e, keepPip?: boolean) => hideEmbed(Boolean(keepPip)));
  ipcMain.handle("pip:getSession", () => pipSession);
  ipcMain.handle("embed:seek", (_e, sec: number) => seekEmbed(sec));
  ipcMain.handle("embed:playPause", () => embedPlayPause());
  ipcMain.handle("embed:time", () => embedGetTime());
  ipcMain.handle("skip:times", (_e, malId: number, episode: number) => fetchSkipTimes(malId, episode));
  ipcMain.handle("pip:toggle", () => toggleEmbedPip());
  ipcMain.handle("pip:open", () => Boolean(pipWin));
  ipcMain.handle("pip:enter", (_e, session: PipSession) => openPipWindow(session));
  ipcMain.handle("pip:close", () => {
    mainWindow?.webContents.send("pip:command", { type: "closed", time: lastPipTime } satisfies PipCommand);
    closePip();
    returnEmbedToMain();
  });
  ipcMain.handle("pip:update", (_e, session: PipSession) => {
    pipSession = session;
    if (pipWin && !pipWin.isDestroyed()) {
      attachPipMedia(session);
      sendPipSession();
    }
  });
  ipcMain.handle("pip:fromPip", (_e, cmd: PipCommand) => {
    handlePipCommand(cmd);
  });

  ipcMain.handle("shiki:login", () => startShikiLogin());
  ipcMain.handle("shiki:loginCode", (_e, code: string) => shikiLoginWithCode(code));
  ipcMain.handle("shiki:logout", () => shikiLogout());
  ipcMain.handle("shiki:account", () => getShikiAccount());
  ipcMain.handle("shiki:list", (_e, status: ShikiListStatus) => listShikiUserList(status));
  ipcMain.handle("shiki:rate", (_e, animeId: number) => getShikiRate(animeId));
  ipcMain.handle("shiki:setRate", (_e, animeId: number, patch) => setShikiRate(animeId, patch));
  ipcMain.handle("anime:latest", () => listLatestReleases());
  ipcMain.handle("anime:related", (_e, id: number) => getRelated(id));
  ipcMain.handle("stats:get", async () => {
    let completed = 0;
    try {
      completed = (await listShikiUserList("completed")).length;
    } catch {
      /* без Шикимори считаем только локальный прогресс */
    }
    return getWatchStats(completed);
  });
  ipcMain.handle("dl:enqueue", (_e, args) => enqueueDownload(args));
  ipcMain.handle("dl:list", () => listDownloads());
  ipcMain.handle("dl:open", (_e, id: string) => openDownload(id));
  ipcMain.handle("dl:folder", () => openDownloadFolder());
  ipcMain.handle("dl:pickFolder", () => (mainWindow ? pickDownloadFolder(mainWindow) : null));
  ipcMain.handle("discord:set", (_e, presence: DiscordPresence | null) => {
    setDiscordPresence(presence);
  });
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:state", () => getUpdateState());
  ipcMain.handle("update:check", () => checkForAppUpdate());
  ipcMain.handle("update:install", () => installAppUpdate());
}

function openFromNotify(animeId: number): void {
  mainWindow?.webContents.send("notify:open-title", animeId);
  mainWindow?.show();
  mainWindow?.focus();
}

function startNotifyLoop(): void {
  setTimeout(() => void checkNewEpisodes(openFromNotify), 8000);
  setInterval(() => void checkNewEpisodes(openFromNotify), 30 * 60 * 1000);
}

app.whenReady().then(() => {
  openStore();
  attachPosterProtocol();
  attachCdnHeaders();
  registerIpc();
  applyAdblock();
  void jikanSeasonNow().catch(() => undefined);
  createWindow();
  setDownloadWindow(mainWindow);
  attachUpdater(mainWindow);
  resumeDownloads();
  startNotifyLoop();
  startDiscordRpc();
  startUpdateLoop();
});

app.on("before-quit", () => {
  void shutdownDiscordRpc();
});

app.on("window-all-closed", () => {
  hideEmbed();
  app.quit();
});
