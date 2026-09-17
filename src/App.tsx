import { useEffect, useState } from "react";
import type { AnimeTitle, CatalogGenre, ContinueItem, EpisodeRef, ShikiAccount, Translation, UpdateState } from "../shared/types";
import { displayName } from "./lib/format";
import { pickTranslation } from "./lib/studio";
import { AmbientOpening } from "./components/AmbientOpening";
import { ThemeModal } from "./components/ThemeModal";
import { IconLibrary, IconLive, IconSearch, IconSettings, IconTheme, IconUser } from "./components/icons";
import { applyTheme, normalizeTheme } from "./lib/theme";
import { LibraryPage } from "./pages/Library";
import { PlayerPage } from "./pages/Player";
import { OngoingPage } from "./pages/Ongoing";
import { SearchPage } from "./pages/Search";
import { SettingsPage } from "./pages/Settings";
import { TitlePage } from "./pages/Title";

type Tab = "search" | "library" | "settings";
type CatalogPreset = "home" | "ongoing";

interface PlayState {
  anime: AnimeTitle;
  translation: Translation;
  episode: EpisodeRef;
  season: number;
  translations: Translation[];
}

function samePlay(a: PlayState | null, b: PlayState): boolean {
  return Boolean(
    a &&
      a.anime.id === b.anime.id &&
      a.translation.id === b.translation.id &&
      a.episode.number === b.episode.number
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("search");
  const [catalogPreset, setCatalogPreset] = useState<CatalogPreset>("home");
  const [catalogGenre, setCatalogGenre] = useState<CatalogGenre | null>(null);
  const [catalogReset, setCatalogReset] = useState(0);
  const [titleId, setTitleId] = useState<number | null>(null);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [cinema, setCinema] = useState(false);
  const [account, setAccount] = useState<ShikiAccount | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    void window.hikari
      .getConfig()
      .then((cfg) => applyTheme(normalizeTheme(cfg.theme)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!play) void window.hikari.hideEmbed();
  }, [play]);

  useEffect(() => {
    if (!play) {
      void window.hikari.setDiscordPresence({ browsing: true });
      return;
    }
    void window.hikari.setDiscordPresence({
      animeId: play.anime.id,
      title: displayName(play.anime.russian, play.anime.name),
      episode: play.episode.number,
      season: play.season,
      studio: play.translation.title,
      poster: play.anime.poster
    });
  }, [play]);

  useEffect(() => {
    void window.hikari.getShikiAccount().then(setAccount).catch(() => undefined);
  }, [tab]);

  useEffect(() => {
    void window.hikari.getUpdateState().then(setUpdate).catch(() => undefined);
    return window.hikari.onUpdateState(setUpdate);
  }, []);

  useEffect(() => {
    return window.hikari.onNotifyOpenTitle((id) => {
      setTab("search");
      setTitleId(id);
      setCinema(false);
    });
  }, []);

  function goCatalog(preset: CatalogPreset) {
    setTab("search");
    setCatalogPreset(preset);
    setCatalogGenre(null);
    setCatalogReset((n) => n + 1);
    setTitleId(null);
    setCinema(false);
  }

  function goGenre(genre: CatalogGenre) {
    setTab("search");
    setCatalogPreset("home");
    setCatalogGenre(genre);
    setCatalogReset((n) => n + 1);
    setTitleId(null);
    setCinema(false);
  }

  function goHome() {
    goCatalog("home");
  }

  function openTitle(id: number) {
    setCinema(false);
    setTitleId(id);
  }

  function goSettings() {
    setTab("settings");
    setTitleId(null);
    setCinema(false);
  }

  function startPlay(next: PlayState) {
    setPlay((cur) => (samePlay(cur, next) ? cur : next));
    setCinema(true);
  }

  async function playContinue(item: ContinueItem) {
    try {
      const anime = await window.hikari.getAnime(item.animeId);
      const list = await window.hikari.getTranslations(anime);
      const cfg = await window.hikari.getConfig();
      const translation = pickTranslation(list, item.translationId, cfg.preferredStudio);
      if (!translation) {
        openTitle(item.animeId);
        return;
      }
      let season = translation.seasons[0]?.number ?? 1;
      let episode = translation.seasons[0]?.episodes[0];
      for (const s of translation.seasons) {
        const hit = s.episodes.find((e) => e.number === item.episode);
        if (hit) {
          season = s.number;
          episode = hit;
          break;
        }
      }
      if (!episode) {
        openTitle(item.animeId);
        return;
      }
      startPlay({ anime, translation, episode, season, translations: list });
    } catch {
      openTitle(item.animeId);
    }
  }

  return (
    <div className={`app${play && !cinema ? " is-mini" : ""}`}>
      {!cinema && (update.status === "ready" || update.status === "downloading" || update.status === "available") ? (
        <div className="update-banner">
          <span>
            {update.status === "ready"
              ? `Hikari ${update.version} готова. Перезапустить и установить?`
              : update.status === "downloading"
                ? `Скачивается обновление ${update.version || ""} — ${update.percent ?? 0}%`
                : `Найдена Hikari ${update.version}. Скачиваю…`}
          </span>
          {update.status === "ready" ? (
            <button type="button" onClick={() => void window.hikari.installUpdate()}>
              Установить
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="shell">
        {cinema ? null : (
          <aside className="sidebar">
            <button className="brand" type="button" onClick={goHome}>
              <img className="brand-mark" src="./icon.png" alt="" />
              <span className="brand-text">
                <strong>Hikari</strong>
              </span>
            </button>
            <nav className="nav">
              <button
                className={tab === "search" && catalogPreset === "home" && !titleId ? "active" : ""}
                type="button"
                onClick={() => goCatalog("home")}
              >
                <IconSearch />
                Каталог
              </button>
              <button
                className={tab === "search" && catalogPreset === "ongoing" && !titleId ? "active" : ""}
                type="button"
                onClick={() => goCatalog("ongoing")}
              >
                <IconLive />
                Онгоинги
              </button>
              <button
                className={tab === "library" && !titleId ? "active" : ""}
                type="button"
                onClick={() => {
                  setTab("library");
                  setTitleId(null);
                  setCinema(false);
                }}
              >
                <IconLibrary />
                Библиотека
              </button>
            </nav>
            <div className="sidebar-foot">
              <button type="button" onClick={() => setThemeOpen(true)} title="Тема">
                <IconTheme />
                Тема
              </button>
              <button className={tab === "settings" && !titleId ? "active" : ""} type="button" onClick={goSettings}>
                <IconSettings />
                Настройки
              </button>
              <button className="account-btn" type="button" onClick={goSettings} title={account?.nickname || "Войти в Shikimori"}>
                {account?.avatar ? <img src={account.avatar} alt="" /> : <IconUser />}
                <span>{account ? account.nickname : "Войти"}</span>
              </button>
            </div>
          </aside>
        )}
        <main className="content">
          {cinema ? null : titleId ? (
            <TitlePage
              animeId={titleId}
              onBack={() => setTitleId(null)}
              onOpen={openTitle}
              onGenre={goGenre}
              onPlay={(anime, translation, episode, season, translations) =>
                startPlay({ anime, translation, episode, season, translations })
              }
            />
          ) : tab === "library" ? (
            <LibraryPage onOpen={openTitle} onPlayContinue={(item) => void playContinue(item)} />
          ) : tab === "settings" ? (
            <SettingsPage onOpenTheme={() => setThemeOpen(true)} />
          ) : catalogPreset === "ongoing" ? (
            <OngoingPage key={catalogReset} onOpen={openTitle} />
          ) : (
            <SearchPage
              key={catalogReset}
              initialGenre={catalogGenre}
              onOpen={openTitle}
              onPlayContinue={(item) => void playContinue(item)}
              onOpenOngoing={() => goCatalog("ongoing")}
            />
          )}
          {play ? (
            <PlayerPage
              mode={cinema ? "cinema" : "mini"}
              anime={play.anime}
              translation={play.translation}
              translations={play.translations}
              episode={play.episode}
              season={play.season}
              onBack={() => {
                setCinema(false);
                setTitleId(play.anime.id);
              }}
              onExpand={() => setCinema(true)}
              onClose={() => {
                setPlay(null);
                setCinema(false);
              }}
              onChangeEpisode={(ep, season) => setPlay({ ...play, episode: ep, season: season ?? play.season })}
              onChangeTranslation={(translation) => {
                const seasonObj =
                  translation.seasons.find((s) => s.number === play.season) ?? translation.seasons[0];
                const episode =
                  seasonObj?.episodes.find((e) => e.number === play.episode.number) ?? seasonObj?.episodes[0];
                if (!episode || !seasonObj) return;
                setPlay({ ...play, translation, episode, season: seasonObj.number });
              }}
            />
          ) : null}
        </main>
      </div>
      <AmbientOpening duck={Boolean(play)} />
      <ThemeModal open={themeOpen} onClose={() => setThemeOpen(false)} />
    </div>
  );
}
