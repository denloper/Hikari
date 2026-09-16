import fs from "node:fs";
import path from "node:path";
import { app, session } from "electron";
import type { WebContents, WebFrameMain } from "electron";
import { ElectronBlocker, fromElectronDetails } from "@ghostery/adblocker-electron";
import { loadConfig } from "./config";

/** Сети, которые тащат баннеры и VAST. Видео-CDN сюда не входят. */
const DENY_HOSTS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "googletagservices.com",
  "googletagmanager.com",
  "adservice.google.com",
  "2mdn.net",
  "ads.youtube.com",
  "an.yandex.ru",
  "adfstat.yandex.ru",
  "awaps.yandex.ru",
  "awaps.yandex.net",
  "yandexadexchange.net",
  "adfox.ru",
  "adfox.yandex.ru",
  "adriver.ru",
  "adhigh.net",
  "smi2.ru",
  "smi2.net",
  "targetads.io",
  "hybrid.ai",
  "otm-r.com",
  "getintent.com",
  "relap.io",
  "utarget.ru",
  "luxup.ru",
  "luxadv.com",
  "rotaban.ru",
  "ad.mail.ru",
  "rs.mail.ru",
  "buzzoola.com",
  "videonow.ru",
  "nativeroll.tv",
  "moatads.com",
  "criteo.com",
  "criteo.net",
  "taboola.com",
  "outbrain.com",
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "smartadserver.com",
  "serving-sys.com",
  "imasdk.googleapis.com",
  "securepubads.g.doubleclick.net",
  "pagead2.googlesyndication.com",
  "target.my.com",
  "ads.vk.com",
  "ad.mail.ru",
  "mc.yandex.ru"
];

const ALLOW_HOSTS = [
  "cloud.kodik-storage.com",
  "cloud.kodik.info",
  "solodcdn.com",
  "anilibria.tv",
  "anilibria.top",
  "libria.fun",
  "sameband.studio",
  "dreamerscast.com",
  "animetop.info",
  "yani.tv",
  "yummyani.me",
  "shikimori.io",
  "shikimori.one",
  "shikimori.me",
  "cdnlibs.org"
];

const EXTRA = `
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||adservice.google.com^
||2mdn.net^
||an.yandex.ru^
||yandex.ru/ads^
||yandex.ru/an^
||adfox.ru^
||adriver.ru^
||hybrid.ai^
||buzzoola.com^
||videonow.ru^
||imasdk.googleapis.com^
||kodik.info/advert^
||kodikplayer.com/advert^
||aniqit.com/advert^
||kodik.cc/advert^
`;

/** Режет VAST из /ftor и сразу жмёт пропуск преролла Kodik. */
const FRAME_JS = `(function(){
  if (window.__hikariAdblock) return;
  var href = String(location.href || "");
  var host = String(location.hostname || "");
  var player = /kodik|aniqit|yummy|yani/.test(host + href) || location.protocol === "data:";
  if (!player) return;
  window.__hikariAdblock = 1;
  function scrub(obj){
    if (!obj || typeof obj !== "object") return obj;
    if (obj.links && (obj.vast || obj.reserve_vast || obj.script)) {
      try { delete obj.vast; } catch (e) {}
      try { delete obj.reserve_vast; } catch (e) {}
      try { delete obj.script; } catch (e) {}
    }
    return obj;
  }
  try {
    var _parse = JSON.parse;
    JSON.parse = function(){ return scrub(_parse.apply(this, arguments)); };
  } catch (e) {}
  try {
    var rx = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
    if (rx && rx.get) {
      Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
        configurable: true,
        get: function(){
          var text = rx.get.call(this);
          var url = String(this.responseURL || "");
          if (/ftor/i.test(url)) {
            try { return JSON.stringify(scrub(_parse(text))); } catch (e) {}
          }
          return text;
        }
      });
    }
  } catch (e) {}
  try {
    var _fetch = window.fetch;
    if (_fetch) {
      window.fetch = function(){
        return _fetch.apply(this, arguments).then(function(res){
          var url = String(res.url || "");
          if (!/ftor/i.test(url)) return res;
          return res.text().then(function(text){
            try { text = JSON.stringify(scrub(JSON.parse(text))); } catch (e) {}
            return new Response(text, { status: res.status, headers: res.headers });
          });
        });
      };
    }
  } catch (e) {}
  function wrapJq(){
    if (!window.$ || !$.extend || $.extend.__hikari) return;
    var ex = $.extend;
    $.extend = function(){
      for (var i = 0; i < arguments.length; i++) scrub(arguments[i]);
      return ex.apply(this, arguments);
    };
    $.extend.__hikari = 1;
  }
  function muteSettings(){
    wrapJq();
    var ps = window.playerSettings;
    if (!ps || typeof ps !== "object") return;
    try {
      ps.forceAdvertCount = false;
      ps.onlyAdvert = false;
      ps.vast = "";
      ps.reserve_vast = "";
    } catch (e) {}
  }
  function adOn(){
    var t = (document.body && (document.body.innerText || document.body.textContent)) || "";
    return /рекламу можна|рекламу можно|пропустити через|пропустить через|можна пропустити|можно пропустить|skip ad in/i.test(t);
  }
  function skip(){
    muteSettings();
    var nodes = document.querySelectorAll("div,span,button,a,p,label");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.childElementCount > 4) continue;
      var t = String(el.innerText || el.textContent || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
      if (!t || t.length > 90) continue;
      if (/реклам|пропустити|пропустить|skip\\s*ad/i.test(t) && /сек|sec|через|after|можна|можно/i.test(t)) {
        try { el.click(); } catch (e) {}
        if (el.parentElement) try { el.parentElement.click(); } catch (e2) {}
      }
    }
    document.querySelectorAll(".pjsadskip,.kr-adv-skip,.ima-skip-button,.skip-button,.skip_button").forEach(function(el){
      try { el.click(); } catch (e) {}
    });
    if (!adOn()) return;
    document.querySelectorAll("video").forEach(function(v){
      try {
        if (v.duration && isFinite(v.duration) && v.duration > 0 && v.duration < 180) v.currentTime = v.duration;
      } catch (e) {}
    });
  }
  muteSettings();
  skip();
  try {
    new MutationObserver(skip).observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}
  setInterval(skip, 400);
})();`;

let engine: ElectronBlocker | null = null;
let on = false;
let filterOn = false;
let preloadId: string | undefined;
let ghosteryTried = false;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function listed(host: string, list: string[]): boolean {
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

function denyPath(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathName = u.pathname.toLowerCase();
    if (host === "yandex.ru" || host.endsWith(".yandex.ru")) {
      if (/^\/(ads|an)(\/|$)/.test(pathName)) return true;
    }
    if (/kodik|aniqit/.test(host) && /\/(advert|vast|vpaid|vmap)(\/|$|\.)/.test(pathName)) return true;
    if (/\/(vast|vpaid|vmap)([/?]|$)/i.test(pathName) || /[?&](vast|vmap)=/i.test(url)) return true;
    return false;
  } catch {
    return false;
  }
}

function shouldCancel(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (listed(host, DENY_HOSTS) || denyPath(url)) return true;
  if (listed(host, ALLOW_HOSTS)) return false;
  return false;
}

function onBeforeRequest(
  details: Electron.OnBeforeRequestListenerDetails,
  cb: (r: Electron.CallbackResponse) => void
): void {
  try {
    if (!on) {
      cb({});
      return;
    }
    const url = details.url;
    if (!url.startsWith("http")) {
      cb({});
      return;
    }
    if (shouldCancel(url)) {
      cb({ cancel: true });
      return;
    }
    if (listed(hostOf(url), ALLOW_HOSTS)) {
      cb({});
      return;
    }
    if (engine) {
      const req = fromElectronDetails(details);
      if (req.isMainFrame()) {
        cb({});
        return;
      }
      const hit = engine.match(req);
      if (hit.redirect) {
        cb({ redirectURL: hit.redirect.dataUrl });
        return;
      }
      if (hit.match) {
        cb({ cancel: true });
        return;
      }
    }
    cb({});
  } catch {
    cb({});
  }
}

function attachFilter(): void {
  if (filterOn) return;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, onBeforeRequest);
  filterOn = true;
}

function preloadPath(): string {
  const file = path.join(app.getPath("userData"), "adblock-preload.js");
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== FRAME_JS) {
    fs.writeFileSync(file, FRAME_JS, "utf8");
  }
  return file;
}

function attachPreload(): void {
  if (preloadId) return;
  try {
    preloadId = session.defaultSession.registerPreloadScript({
      type: "frame",
      filePath: preloadPath()
    });
  } catch (err) {
    console.warn("Hikari adblock: preload", err);
  }
}

function detachPreload(): void {
  if (!preloadId) return;
  try {
    session.defaultSession.unregisterPreloadScript(preloadId);
  } catch {
    /* уже снят */
  }
  preloadId = undefined;
}

async function ghosteryFetch(url: string): Promise<{
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  json: () => Promise<unknown>;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Hikari" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`adblock list ${res.status}`);
    return {
      text: () => res.text(),
      arrayBuffer: () => res.arrayBuffer(),
      json: () => res.json()
    };
  } finally {
    clearTimeout(timer);
  }
}

async function loadGhostery(): Promise<void> {
  if (ghosteryTried) return;
  ghosteryTried = true;
  try {
    const extra = ElectronBlocker.parse(EXTRA);
    const pre = await Promise.race([
      ElectronBlocker.fromPrebuiltAdsAndTracking(ghosteryFetch, {
        path: path.join(app.getPath("userData"), "adblock.bin"),
        read: (p) => fs.promises.readFile(p),
        write: (p, data) => fs.promises.writeFile(p, data)
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000))
    ]);
    engine = ElectronBlocker.merge([pre, extra]);
    console.log("Hikari adblock: EasyList готов");
  } catch (err) {
    engine = ElectronBlocker.parse(EXTRA);
    console.warn("Hikari adblock: локальные правила", err instanceof Error ? err.message : err);
  }
}

function injectFrame(frame: WebFrameMain): void {
  if (frame.isDestroyed()) return;
  void frame.executeJavaScript(FRAME_JS, true).catch(() => undefined);
}

export function watchEmbedAds(wc: WebContents): void {
  const paint = (): void => {
    if (!on) return;
    try {
      for (const frame of wc.mainFrame.framesInSubtree) injectFrame(frame);
    } catch {
      /* кадр ещё не готов */
    }
  };
  wc.on("did-finish-load", paint);
  wc.on("did-frame-finish-load", paint);
  wc.on("dom-ready", paint);
  wc.on("frame-created", (_e, details) => {
    if (details.frame) injectFrame(details.frame);
  });
}

export function enableAdblock(): void {
  if (on) return;
  if (!engine) engine = ElectronBlocker.parse(EXTRA);
  attachFilter();
  attachPreload();
  on = true;
  void loadGhostery();
  console.log("Hikari adblock: включён");
}

export function disableAdblock(): void {
  on = false;
  detachPreload();
}

export function applyAdblock(): void {
  if (loadConfig().adblock) enableAdblock();
  else disableAdblock();
}

export function adblockOn(): boolean {
  return on;
}
