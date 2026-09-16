import type { ThemeSettings } from "../../shared/types";

export const DEFAULT_THEME: ThemeSettings = {
  mode: "dark",
  accent: "#8d7cff",
  saturation: 100,
  swatches: ["#8d7cff", "#5865F2", "#57F287", "#FEE75C", "#EB459E", "#ED4245"]
};

export function normalizeTheme(raw?: Partial<ThemeSettings> | null): ThemeSettings {
  const accent = sanitizeHex(raw?.accent) || DEFAULT_THEME.accent;
  const sat = Number(raw?.saturation);
  const swatches = Array.isArray(raw?.swatches)
    ? raw.swatches.map(sanitizeHex).filter((x): x is string => Boolean(x)).slice(0, 12)
    : [];
  return {
    mode: raw?.mode === "light" ? "light" : "dark",
    accent,
    saturation: Number.isFinite(sat) ? Math.min(100, Math.max(0, Math.round(sat))) : 100,
    swatches: swatches.length ? swatches : [...DEFAULT_THEME.swatches]
  };
}

export function sanitizeHex(value?: string): string {
  const t = String(value || "").trim();
  const m = t.match(/^#?([0-9a-f]{6})$/i);
  return m ? `#${m[1].toUpperCase()}` : "";
}

export function applyTheme(theme: ThemeSettings): void {
  const t = normalizeTheme(theme);
  const root = document.documentElement;
  const vars = themeVars(t);
  root.style.colorScheme = t.mode;
  root.setAttribute("data-theme", t.mode);
  for (const [key, val] of Object.entries(vars)) {
    root.style.setProperty(key, val);
  }
}

export function themeVars(theme: ThemeSettings): Record<string, string> {
  const light = theme.mode === "light";
  const sat = theme.saturation / 100;
  const accent = applySat(theme.accent, sat);
  const { h, s, l } = hexToHsl(accent);
  const accent2 = hslToHex(h, clamp01(s * 0.55 + 0.2), light ? 0.38 : 0.82);
  const soft = `hsla(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round((light ? 0.48 : 0.62) * 100)}%, ${light ? 0.18 : 0.16})`;
  const wash = light ? 0.97 : 0.035;
  return {
    "--bg": mixHex(light ? "#F4F5FB" : "#07080C", accent, light ? 0.04 : 0.06),
    "--bg-2": mixHex(light ? "#EEF0F8" : "#0C0D14", accent, light ? 0.05 : 0.05),
    "--bg-elev": mixHex(light ? "#FFFFFF" : "#12131C", accent, light ? 0.03 : 0.04),
    "--bg-card": mixHex(light ? "#FFFFFF" : "#161822", accent, light ? 0.04 : 0.05),
    "--line": light ? "rgba(20, 22, 34, 0.08)" : "rgba(255, 255, 255, 0.07)",
    "--line-strong": light ? "rgba(20, 22, 34, 0.14)" : "rgba(255, 255, 255, 0.12)",
    "--text": light ? "#1A1B22" : "#F4F2FB",
    "--muted": light ? "#5C5E72" : "#9B9AAF",
    "--accent": accent,
    "--accent-2": accent2,
    "--accent-soft": soft,
    "--shadow": light ? "0 18px 50px rgba(20, 22, 34, 0.12)" : "0 18px 50px rgba(0, 0, 0, 0.38)",
    "--wash": String(wash)
  };
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const map = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q]
  ][i % 6];
  return rgbToHex(map[0], map[1], map[2]);
}

export function randomAccent(): string {
  return hsvToHex(Math.random(), 0.55 + Math.random() * 0.4, 0.72 + Math.random() * 0.22);
}

function applySat(hex: string, sat: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, clamp01(s * sat), l);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  if (h < 0) h += 1;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return rgbToHex(f(0), f(8), f(4));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = sanitizeHex(hex) || "#8D7CFF";
  return {
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
