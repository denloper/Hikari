import { autoUpdater } from "electron-updater";
import type { BrowserWindow } from "electron";
import type { UpdateState } from "../../shared/types";

let host: BrowserWindow | null = null;
let state: UpdateState = { status: "idle" };
let started = false;

function isDev(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL);
}

function send(next: UpdateState): void {
  state = next;
  if (host && !host.isDestroyed()) host.webContents.send("update:state", state);
}

export function getUpdateState(): UpdateState {
  return state;
}

export function attachUpdater(win: BrowserWindow | null): void {
  host = win;
  if (started || isDev()) return;
  started = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => send({ status: "checking" }));
  autoUpdater.on("update-available", (info) => send({ status: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => send({ status: "none", version: autoUpdater.currentVersion.version }));
  autoUpdater.on("download-progress", (p) =>
    send({ status: "downloading", version: state.version, percent: Math.round(p.percent) })
  );
  autoUpdater.on("update-downloaded", (info) => send({ status: "ready", version: info.version }));
  autoUpdater.on("error", (err) => send({ status: "error", error: err instanceof Error ? err.message : String(err) }));
}

export function checkForAppUpdate(): UpdateState {
  if (isDev()) {
    send({ status: "none", version: "dev" });
    return state;
  }
  void autoUpdater.checkForUpdates().catch((err) => {
    send({ status: "error", error: err instanceof Error ? err.message : String(err) });
  });
  return state;
}

export function installAppUpdate(): void {
  if (isDev()) return;
  autoUpdater.quitAndInstall(false, true);
}

export function startUpdateLoop(): void {
  if (isDev()) return;
  setTimeout(() => checkForAppUpdate(), 6000);
  setInterval(() => checkForAppUpdate(), 6 * 60 * 60 * 1000);
}
