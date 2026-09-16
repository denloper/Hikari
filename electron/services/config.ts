import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AppConfig, PipBounds, ThemeSettings } from "../../shared/types";

const DEFAULT_THEME: ThemeSettings = {
  mode: "dark",
  accent: "#8d7cff",
  saturation: 100,
  swatches: ["#8d7cff", "#5865F2", "#57F287", "#FEE75C", "#EB459E", "#ED4245"]
};

const DEFAULTS: AppConfig = {
  kodikToken: "",
  shikimoriUserAgent: "Hikari",
  shikimoriClientId: "",
  shikimoriClientSecret: "",
  subtitleFolder: "",
  downloadFolder: "",
  adblock: true,
  episodeNotify: true,
  preferredStudio: "",
  theme: { ...DEFAULT_THEME, swatches: [...DEFAULT_THEME.swatches] },
  discordRpc: true
};

function configPath(): string {
  return path.join(app.getPath("userData"), "config.json");
}

function readRaw(): Partial<AppConfig> & { anime365Token?: string } {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8")) as Partial<AppConfig> & { anime365Token?: string };
  } catch {
    return {};
  }
}

function normalizeTheme(raw?: Partial<ThemeSettings>): ThemeSettings {
  const accent = String(raw?.accent ?? DEFAULT_THEME.accent).trim() || DEFAULT_THEME.accent;
  const sat = Number(raw?.saturation);
  const swatches = Array.isArray(raw?.swatches)
    ? raw.swatches.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
    : [];
  return {
    mode: raw?.mode === "light" ? "light" : "dark",
    accent,
    saturation: Number.isFinite(sat) ? Math.min(100, Math.max(0, Math.round(sat))) : 100,
    swatches: swatches.length ? swatches : [...DEFAULT_THEME.swatches]
  };
}

function normalizeBounds(raw?: PipBounds): PipBounds | undefined {
  if (!raw) return undefined;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width < 280 || height < 180) return undefined;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export function loadConfig(): AppConfig {
  const parsed = readRaw();
  const cfg: AppConfig = {
    kodikToken: String(parsed.kodikToken ?? "").trim(),
    shikimoriUserAgent: String(parsed.shikimoriUserAgent ?? "").trim() || DEFAULTS.shikimoriUserAgent,
    shikimoriClientId: String(parsed.shikimoriClientId ?? "").trim(),
    shikimoriClientSecret: String(parsed.shikimoriClientSecret ?? "").trim(),
    subtitleFolder: String(parsed.subtitleFolder ?? "").trim(),
    downloadFolder: String(parsed.downloadFolder ?? "").trim(),
    adblock: parsed.adblock !== false,
    episodeNotify: parsed.episodeNotify !== false,
    preferredStudio: String(parsed.preferredStudio ?? "").trim(),
    theme: normalizeTheme(parsed.theme),
    pipBounds: normalizeBounds(parsed.pipBounds),
    discordRpc: parsed.discordRpc !== false
  };
  if ("anime365Token" in parsed) saveConfig(cfg);
  return cfg;
}

export function saveConfig(next: AppConfig): AppConfig {
  const prev = readRaw();
  const dir = path.dirname(configPath());
  fs.mkdirSync(dir, { recursive: true });
  const clean: AppConfig = {
    kodikToken: String(next.kodikToken ?? "").trim(),
    shikimoriUserAgent: String(next.shikimoriUserAgent ?? "").trim() || DEFAULTS.shikimoriUserAgent,
    shikimoriClientId: String(next.shikimoriClientId ?? "").trim(),
    shikimoriClientSecret: String(next.shikimoriClientSecret ?? "").trim(),
    subtitleFolder: String(next.subtitleFolder ?? "").trim(),
    downloadFolder: String(next.downloadFolder ?? "").trim(),
    adblock: next.adblock !== false,
    episodeNotify: next.episodeNotify !== false,
    preferredStudio: String(next.preferredStudio ?? "").trim(),
    theme: normalizeTheme(next.theme ?? prev.theme),
    pipBounds: normalizeBounds(next.pipBounds) ?? normalizeBounds(prev.pipBounds),
    discordRpc: next.discordRpc !== false
  };
  fs.writeFileSync(configPath(), JSON.stringify(clean, null, 2), "utf8");
  return clean;
}
