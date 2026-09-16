import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { app, shell } from "electron";
import type { ShikiAccount, ShikiListStatus, ShikiRate } from "../../shared/types";
import { loadConfig } from "./config";
import { HttpError, httpJson, httpText } from "./http";

const HOSTS = ["https://shikimori.io", "https://shikimori.one", "https://shikimori.me"];
export const SHIKI_REDIRECT = "http://127.0.0.1:36511/oauth";
const AUTH_PORT = 36511;

interface TokenState {
  accessToken: string;
  refreshToken: string;
  createdAt: number;
  user?: ShikiAccount;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
}

interface WhoAmI {
  id?: number;
  nickname?: string;
  avatar?: string;
}

export interface RateDto {
  id?: number;
  target_id?: number;
  status?: string;
  episodes?: number;
  score?: number;
  anime?: {
    id?: number;
    name?: string;
    russian?: string;
    score?: string;
    image?: { original?: string; preview?: string };
  };
}

let origin = HOSTS[0];

function authPath(): string {
  return path.join(app.getPath("userData"), "shiki-oauth.json");
}

function ua(): string {
  return loadConfig().shikimoriUserAgent || "Hikari";
}

function readState(): TokenState | null {
  try {
    const raw = JSON.parse(fs.readFileSync(authPath(), "utf8")) as TokenState;
    if (!raw.accessToken) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeState(state: TokenState | null): void {
  if (!state) {
    try {
      fs.unlinkSync(authPath());
    } catch {
      /* файла могло не быть */
    }
    return;
  }
  fs.writeFileSync(authPath(), JSON.stringify(state, null, 2), "utf8");
}

async function shikiForm<T>(pathName: string, body: URLSearchParams): Promise<T> {
  const headers = {
    "User-Agent": ua(),
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded"
  };
  let last: unknown;
  for (const host of [origin, ...HOSTS.filter((h) => h !== origin)]) {
    try {
      const data = await httpJson<T>(`${host}${pathName}`, {
        method: "POST",
        headers,
        body: body.toString(),
        timeoutMs: 15000
      });
      origin = host;
      return data;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("Shikimori OAuth недоступен");
}

async function shikiAuth<T>(pathName: string, token: string, opts?: { method?: "GET" | "POST" | "PATCH"; body?: string }): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": ua(),
    Accept: "application/json",
    Authorization: `Bearer ${token}`
  };
  if (opts?.body) headers["Content-Type"] = "application/json";
  const method = opts?.method ?? "GET";
  let last: unknown;
  for (const host of [origin, ...HOSTS.filter((h) => h !== origin)]) {
    try {
      const data = await httpJson<T>(`${host}${pathName}`, {
        method,
        headers,
        body: opts?.body,
        timeoutMs: 15000
      });
      origin = host;
      return data;
    } catch (err) {
      last = err;
      if (err instanceof HttpError && err.status === 401) break;
    }
  }
  throw last instanceof Error ? last : new Error("Shikimori API недоступен");
}

async function exchangeCode(code: string): Promise<TokenState> {
  const cfg = loadConfig();
  if (!cfg.shikimoriClientId || !cfg.shikimoriClientSecret) {
    throw new Error("В настройках нужны Client ID и Secret приложения Shikimori");
  }
  const token = await shikiForm<TokenResponse>("/oauth/token", new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.shikimoriClientId,
    client_secret: cfg.shikimoriClientSecret,
    code,
    redirect_uri: SHIKI_REDIRECT
  }));
  if (!token.access_token) throw new Error("Shikimori не вернул токен");
  const state: TokenState = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || "",
    createdAt: Date.now()
  };
  state.user = await fetchWhoAmI(state.accessToken);
  writeState(state);
  return state;
}

async function refreshTokens(state: TokenState): Promise<TokenState> {
  const cfg = loadConfig();
  if (!state.refreshToken) throw new Error("Нет refresh-токена Shikimori");
  const token = await shikiForm<TokenResponse>("/oauth/token", new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cfg.shikimoriClientId,
    client_secret: cfg.shikimoriClientSecret,
    refresh_token: state.refreshToken
  }));
  if (!token.access_token) throw new Error("Не удалось обновить токен Shikimori");
  const next: TokenState = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || state.refreshToken,
    createdAt: Date.now(),
    user: state.user
  };
  try {
    next.user = await fetchWhoAmI(next.accessToken);
  } catch {
    /* оставляем прежний профиль */
  }
  writeState(next);
  return next;
}

async function fetchWhoAmI(token: string): Promise<ShikiAccount> {
  const me = await shikiAuth<WhoAmI>("/api/users/whoami", token);
  if (!me.id || !me.nickname) throw new Error("Не удалось прочитать профиль Shikimori");
  return { id: me.id, nickname: me.nickname, avatar: me.avatar };
}

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  let state = readState();
  if (!state) throw new Error("Сначала войдите в Shikimori");
  try {
    return await fn(state.accessToken);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 401) throw err;
    state = await refreshTokens(state);
    return fn(state.accessToken);
  }
}

function toRate(row: RateDto, fallbackAnimeId: number): ShikiRate | null {
  const id = Number(row.id);
  const animeId = Number(row.target_id) || fallbackAnimeId;
  if (!id || !animeId) return null;
  return {
    id,
    animeId,
    status: (row.status as ShikiListStatus) || "watching",
    episodes: Number(row.episodes) || 0,
    score: Number(row.score) || 0
  };
}

export function getShikiAccount(): ShikiAccount | null {
  return readState()?.user ?? null;
}

export function shikiLogout(): void {
  writeState(null);
}

export async function shikiLoginWithCode(code: string): Promise<ShikiAccount> {
  const state = await exchangeCode(code.trim());
  if (!state.user) throw new Error("Вход в Shikimori не удался");
  return state.user;
}

export async function startShikiLogin(): Promise<ShikiAccount> {
  const cfg = loadConfig();
  if (!cfg.shikimoriClientId || !cfg.shikimoriClientSecret) {
    throw new Error("Укажите Client ID и Secret в настройках, Redirect URI: " + SHIKI_REDIRECT);
  }
  const authUrl =
    `${origin}/oauth/authorize?client_id=${encodeURIComponent(cfg.shikimoriClientId)}` +
    `&redirect_uri=${encodeURIComponent(SHIKI_REDIRECT)}` +
    `&response_type=code&scope=${encodeURIComponent("user_rates")}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || "/", SHIKI_REDIRECT);
        const code = url.searchParams.get("code");
        const err = url.searchParams.get("error");
        if (err || !code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<p>Вход отменён. Можно закрыть вкладку.</p>");
          finish(() => reject(new Error(err || "Код авторизации не получен")));
          return;
        }
        const user = await shikiLoginWithCode(code);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<p>Hikari: вход как ${user.nickname}. Вкладку можно закрыть.</p>`);
        finish(() => resolve(user));
      } catch (ex) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<p>Ошибка входа. Смотрите Hikari.</p>");
        finish(() => reject(ex instanceof Error ? ex : new Error("Ошибка входа")));
      }
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error("Время входа вышло. Повторите или вставьте код вручную.")));
    }, 180000);
    server.listen(AUTH_PORT, "127.0.0.1", () => {
      void shell.openExternal(authUrl);
    });
    server.on("error", (ex) => finish(() => reject(ex)));
  });
}

export async function getShikiRate(animeId: number): Promise<ShikiRate | null> {
  const user = getShikiAccount();
  if (!user) return null;
  return withToken(async (token) => {
    const rows = await shikiAuth<RateDto[]>(
      `/api/v2/user_rates?user_id=${user.id}&target_id=${animeId}&target_type=Anime`,
      token
    );
    return toRate(rows?.[0] ?? {}, animeId);
  });
}

export async function setShikiRate(
  animeId: number,
  patch: { status?: ShikiListStatus; episodes?: number; score?: number }
): Promise<ShikiRate | null> {
  const user = getShikiAccount();
  if (!user) return null;
  return withToken(async (token) => {
    const rows = await shikiAuth<RateDto[]>(
      `/api/v2/user_rates?user_id=${user.id}&target_id=${animeId}&target_type=Anime`,
      token
    );
    const current = toRate(rows?.[0] ?? {}, animeId);
    const body = JSON.stringify({
      user_rate: {
        user_id: user.id,
        target_id: animeId,
        target_type: "Anime",
        status: patch.status ?? current?.status ?? "watching",
        episodes: patch.episodes ?? current?.episodes ?? 0,
        score: patch.score ?? current?.score ?? 0
      }
    });
    const row = current
      ? await shikiAuth<RateDto>(`/api/v2/user_rates/${current.id}`, token, { method: "PATCH", body })
      : await shikiAuth<RateDto>("/api/v2/user_rates", token, { method: "POST", body });
    return toRate(row, animeId);
  });
}

export async function listShikiRates(status: ShikiListStatus): Promise<RateDto[]> {
  const user = getShikiAccount();
  if (!user) return [];
  return withToken((token) =>
    shikiAuth<RateDto[]>(`/api/users/${user.id}/anime_rates?status=${encodeURIComponent(status)}&limit=50`, token)
  );
}

/** Пишем прогресс на Шикимори: текущая серия, статус «смотрю» / «просмотрено». */
export async function syncShikiWatch(animeId: number, episode: number, totalEpisodes?: number): Promise<void> {
  if (!getShikiAccount() || episode < 1) return;
  const done = Boolean(totalEpisodes && episode >= totalEpisodes);
  await setShikiRate(animeId, {
    status: done ? "completed" : "watching",
    episodes: episode
  });
}

