import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AnimeTitle, EpisodeRef, PipSession, ProgressRow, StreamResult, SubtitleFile, Translation } from "../../shared/types";
import { EpisodeGrid } from "../components/EpisodeGrid";
import { TranslationList } from "../components/TranslationList";
import { VideoPlayer } from "../components/VideoPlayer";
import { IconBack, IconClose, IconEpisodes, IconExpand, IconMinus, IconPip, IconPlus } from "../components/icons";
import { displayName, isEpisodeDone, posterSrc } from "../lib/format";
import { activeSkip, mergeSkips } from "../lib/skips";
import { sortTranslations } from "../lib/studio";

const MINI_MIN = 300;
const MINI_MAX = 720;
const MINI_STEP = 80;

function readMiniW(): number {
  const n = Number(localStorage.getItem("hikari-mini-w"));
  if (!Number.isFinite(n)) return 420;
  return Math.min(MINI_MAX, Math.max(MINI_MIN, n));
}

export function PlayerPage(props: {
  mode: "cinema" | "mini";
  anime: AnimeTitle;
  translation: Translation;
  translations?: Translation[];
  episode: EpisodeRef;
  season: number;
  onBack: () => void;
  onExpand: () => void;
  onClose: () => void;
  onChangeEpisode: (ep: EpisodeRef, season?: number) => void;
  onChangeTranslation?: (t: Translation) => void;
}) {
  const [stream, setStream] = useState<StreamResult | null>(null);
  const [quality, setQuality] = useState(0);
  const [startAt, setStartAt] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [sub, setSub] = useState<SubtitleFile | null>(null);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlMsg, setDlMsg] = useState("");
  const [epsOpen, setEpsOpen] = useState(props.mode === "cinema");
  const [preferredStudio, setPreferredStudio] = useState("");
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [pipOpen, setPipOpen] = useState(false);
  const [miniW, setMiniW] = useState(readMiniW);
  const [embedTime, setEmbedTime] = useState(0);
  const [resumeTick, setResumeTick] = useState(0);
  const lastTime = useRef(0);
  const pipOpenRef = useRef(false);
  const pausedRef = useRef(false);

  const studios = useMemo(
    () => sortTranslations(props.translations?.length ? props.translations : [props.translation], preferredStudio),
    [props.translations, props.translation, preferredStudio]
  );
  const seasonObj = props.translation.seasons.find((s) => s.number === props.season) ?? props.translation.seasons[0];
  const seasons = props.translation.seasons;
  const episodes = seasonObj?.episodes ?? [];
  const nextEp = useMemo(() => {
    const idx = episodes.findIndex((e) => e.number === props.episode.number);
    return idx >= 0 ? episodes[idx + 1] : undefined;
  }, [episodes, props.episode.number]);

  const watched = useMemo(() => {
    const set = new Set<number>();
    for (const row of rows) {
      if (isEpisodeDone(row.positionSec, row.durationSec)) set.add(row.episode);
    }
    return set;
  }, [rows]);

  const title = displayName(props.anime.russian, props.anime.name);
  const meta = `${props.translation.title} · серия ${props.episode.number}`;
  const cinema = props.mode === "cinema";

  const pushDiscord = useCallback(
    (paused: boolean, position?: number, duration?: number) => {
      pausedRef.current = paused;
      void window.hikari.setDiscordPresence({
        animeId: props.anime.id,
        title,
        episode: props.episode.number,
        season: props.season,
        studio: props.translation.title,
        poster: props.anime.poster,
        paused,
        positionSec: position ?? lastTime.current,
        durationSec: duration && duration > 0 ? duration : undefined
      });
    },
    [props.anime.id, props.anime.poster, props.episode.number, props.season, props.translation.title, title]
  );
  const skips = stream?.skips;
  const embedHit = stream?.kind === "embed" ? activeSkip(skips, embedTime) : null;

  useEffect(() => {
    pipOpenRef.current = pipOpen;
  }, [pipOpen]);

  useEffect(() => {
    return window.hikari.onEmbedPipChange(setPipOpen);
  }, []);

  useEffect(() => {
    return window.hikari.onPipCommand((cmd) => {
      if (cmd.type === "time") {
        lastTime.current = cmd.time;
        void window.hikari.saveProgress({
          animeId: props.anime.id,
          translationId: props.translation.id,
          episode: props.episode.number,
          positionSec: cmd.time,
          durationSec: 0
        });
        return;
      }
      if (cmd.type === "next") {
        if (nextEp) props.onChangeEpisode(nextEp);
        return;
      }
      if (cmd.type === "return" || cmd.type === "closed") {
        if (cmd.time && cmd.time > 1) {
          lastTime.current = cmd.time;
          setStartAt(cmd.time);
        }
        setPipOpen(false);
        setResumeTick((n) => n + 1);
      }
    });
  }, [nextEp, props.anime.id, props.episode.number, props.onChangeEpisode, props.translation.id]);

  useEffect(() => {
    void window.hikari.getConfig().then((cfg) => setPreferredStudio(cfg.preferredStudio || "")).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (props.mode === "cinema") setEpsOpen(true);
  }, [props.mode, props.anime.id]);

  function makePipSession(next: StreamResult, time: number): PipSession {
    return {
      kind: next.kind,
      title,
      meta,
      hasNext: Boolean(nextEp),
      time,
      quality: next.kind === "embed" ? 0 : quality || next.qualities[0]?.height || 0,
      stream: next.kind === "embed" ? undefined : next
    };
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      setErr("");
      setStream(null);
      setSub(null);
      setBusy(true);
      try {
        const last = await window.hikari.getProgress(props.anime.id, props.translation.id, props.episode.number);
        if (!dead) {
          const resume = lastTime.current > 1 && pipOpenRef.current ? lastTime.current : last?.positionSec ?? 0;
          setStartAt(resume);
          lastTime.current = resume;
        }
        const resolved = await window.hikari.resolveStream({
          source: props.translation.source,
          ref: props.episode.ref,
          anilibriaEpisodeId: props.translation.source === "anilibria" ? props.episode.ref : undefined
        });
        if (dead) return;
        const extra = await window.hikari.getSkipTimes(props.anime.id, props.episode.number);
        const merged = { ...resolved, skips: mergeSkips(resolved.skips, extra) };
        setStream(merged);
        if (merged.kind === "hls" || merged.kind === "file") {
          setQuality(merged.qualities[0]?.height ?? 0);
          if (merged.subtitle) setSub(merged.subtitle);
        }
        if (pipOpenRef.current) {
          void window.hikari.updatePip(makePipSession(merged, lastTime.current));
        }
        await window.hikari.saveLastWatch({
          animeId: props.anime.id,
          translationId: props.translation.id,
          episode: props.episode.number
        });
        await window.hikari.addHistory({
          animeId: props.anime.id,
          title: displayName(props.anime.russian, props.anime.name),
          poster: posterSrc(props.anime.poster, props.anime.posterLocal, props.anime.id),
          episode: props.episode.number,
          translationTitle: props.translation.title
        });
        const cfg = await window.hikari.getConfig();
        if (cfg.subtitleFolder) {
          const hint = `${props.anime.id}_${props.episode.number}`;
          const found = await window.hikari.loadSubtitleFromFolder(cfg.subtitleFolder, hint);
          if (!dead && found) setSub(found);
        }
        const prog = await window.hikari.listProgress(props.anime.id, props.translation.id);
        if (!dead) setRows(prog);
      } catch (ex) {
        if (!dead) setErr(ex instanceof Error ? ex.message : "Не удалось открыть поток");
      } finally {
        if (!dead) setBusy(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [props.anime, props.episode, props.translation]);

  useEffect(() => {
    if (!stream) return;
    if (stream.kind !== "embed") {
      if (!pipOpen) void window.hikari.hideEmbed();
      return;
    }
    if (pipOpen) {
      void window.hikari.showEmbed(stream.url, { x: 0, y: 0, width: 1, height: 1 });
      return;
    }
    const sync = () => {
      const el = document.querySelector("[data-embed-host='1']") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      void window.hikari.showEmbed(stream.url, {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      });
    };
    const id = window.setTimeout(sync, 50);
    window.addEventListener("resize", sync);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", sync);
    };
  }, [stream, epsOpen, props.mode, pipOpen, miniW]);

  useEffect(() => {
    if (!stream || stream.kind !== "embed" || pipOpen) return;
    const id = window.setInterval(() => {
      void window.hikari
        .embedGetTime()
        .then((t) => {
          setEmbedTime(t);
          lastTime.current = t;
          pushDiscord(pausedRef.current, t);
        })
        .catch(() => undefined);
    }, 700);
    return () => window.clearInterval(id);
  }, [stream, pipOpen, pushDiscord]);

  useEffect(() => {
    const app = document.querySelector(".app") as HTMLElement | null;
    if (props.mode === "mini") app?.style.setProperty("--mini-w", `${miniW}px`);
    else app?.style.removeProperty("--mini-w");
  }, [miniW, props.mode]);

  function applyMiniW(w: number) {
    const next = Math.round(Math.min(MINI_MAX, Math.max(MINI_MIN, w)));
    setMiniW(next);
    localStorage.setItem("hikari-mini-w", String(next));
  }

  function onMiniResize(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = miniW;
    const move = (ev: PointerEvent) => applyMiniW(startW - (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const saveProgress = useCallback(
    (position: number, duration: number) => {
      lastTime.current = position;
      void window.hikari.saveProgress({
        animeId: props.anime.id,
        translationId: props.translation.id,
        episode: props.episode.number,
        positionSec: position,
        durationSec: duration
      });
      pushDiscord(pausedRef.current, position, duration);
    },
    [props.anime.id, props.episode.number, props.translation.id, pushDiscord]
  );

  async function pickSub() {
    const file = await window.hikari.pickSubtitle();
    if (file) setSub(file);
  }

  async function enqueue(clip: "episode" | "opening") {
    setDlBusy(true);
    setDlMsg("");
    const name = displayName(props.anime.russian, props.anime.name);
    const op = stream?.skips?.opening;
    try {
      const item = await window.hikari.enqueueDownload({
        source: props.translation.source,
        ref: props.episode.ref,
        quality,
        anilibriaEpisodeId: props.translation.source === "anilibria" ? props.episode.ref : undefined,
        animeId: props.anime.id,
        title: name,
        episode: props.episode.number,
        filename: clip === "opening" ? `${name} ${props.episode.number} OP` : `${name} ${props.episode.number}`,
        clip,
        fromSec: clip === "opening" ? op?.start : undefined,
        toSec: clip === "opening" ? op?.end : undefined
      });
      setDlMsg(item.status === "error" ? item.error || "Не удалось скачать" : "В очереди · Библиотека → Скачанное");
    } catch (ex) {
      setDlMsg(ex instanceof Error ? ex.message : "Не удалось скачать");
    } finally {
      setDlBusy(false);
    }
  }

  async function togglePip(time = lastTime.current) {
    if (pipOpen) {
      await window.hikari.closePip();
      setPipOpen(false);
      if (time > 1) setStartAt(time);
      return;
    }
    if (!stream) return;
    lastTime.current = time;
    const ok = await window.hikari.openPip(makePipSession(stream, time));
    setPipOpen(ok);
  }

  async function skipEmbed(to: number) {
    const ok = await window.hikari.seekEmbed(to);
    if (ok) setEmbedTime(to);
  }

  function togglePanel() {
    setEpsOpen((v) => !v);
  }

  const skipButtons =
    stream?.kind === "embed" && skips && (skips.opening || skips.ending) ? (
      embedHit ? (
        <button className="ghost" type="button" onClick={() => void skipEmbed(embedHit.to)}>
          {embedHit.kind === "op" ? "Пропустить опенинг" : "Пропустить эндинг"}
        </button>
      ) : (
        <>
          {skips.opening ? (
            <button className="ghost" type="button" onClick={() => void skipEmbed(skips.opening!.end)}>
              Пропустить опенинг
            </button>
          ) : null}
          {skips.ending ? (
            <button className="ghost" type="button" onClick={() => void skipEmbed(skips.ending!.end)}>
              Пропустить эндинг
            </button>
          ) : null}
        </>
      )
    ) : null;

  return (
    <div
      className={props.mode === "cinema" ? "page page-cinema player-page" : "mini-player"}
      style={props.mode === "mini" ? { width: miniW } : undefined}
    >
      {err ? <p className={`error${props.mode === "cinema" ? " cinema-err" : " mini-err"}`}>{err}</p> : null}
      {dlMsg ? <p className={`muted${props.mode === "cinema" ? " cinema-err" : " mini-err"}`}>{dlMsg}</p> : null}
      {props.mode === "cinema" ? (
        <div className="cinema-bar">
          <button className="ghost" type="button" onClick={props.onBack} title="Свернуть и к тайтлу">
            <IconBack /> К тайтлу
          </button>
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <div className="muted">
              {meta}
              {props.episode.title ? ` · ${props.episode.title}` : ""}
              {sub ? ` · ${sub.name}` : ""}
            </div>
          </div>
          <div className="cinema-bar-actions">
            {skipButtons}
            <button
              className={`ghost${epsOpen ? " on" : ""}`}
              type="button"
              onClick={togglePanel}
              title={epsOpen ? "Скрыть список · E" : "Озвучка и серии · E"}
            >
              <IconEpisodes /> {epsOpen ? "Скрыть" : "Список"}
            </button>
            <button className={`ghost${pipOpen ? " on" : ""}`} type="button" onClick={() => void togglePip()} title="Картинка в картинке · P">
              <IconPip />
            </button>
          </div>
        </div>
      ) : (
        <div className="mini-top">
          <button className="mini-title" type="button" onClick={props.onExpand} title="Развернуть">
            <strong>{title}</strong>
            <span>{meta}</span>
          </button>
          <button className={`icon-btn${pipOpen ? " on" : ""}`} type="button" title="Картинка в картинке" onClick={() => void togglePip()}>
            <IconPip />
          </button>
          <button
            className="icon-btn"
            type="button"
            title="Меньше"
            disabled={miniW <= MINI_MIN}
            onClick={() => applyMiniW(miniW - MINI_STEP)}
          >
            <IconMinus />
          </button>
          <button
            className="icon-btn"
            type="button"
            title="Больше"
            disabled={miniW >= MINI_MAX}
            onClick={() => applyMiniW(miniW + MINI_STEP)}
          >
            <IconPlus />
          </button>
          <button className="icon-btn" type="button" title="Развернуть" onClick={props.onExpand}>
            <IconExpand />
          </button>
          <button className="icon-btn" type="button" title="Закрыть" onClick={props.onClose}>
            <IconClose />
          </button>
        </div>
      )}
      {props.mode === "mini" ? (
        <button className="mini-resize" type="button" title="Размер" onPointerDown={onMiniResize} />
      ) : null}
      <div className={props.mode === "cinema" ? "cinema-stage" : "mini-stage"}>
        {pipOpen ? (
          <button className="pip-placeholder" type="button" onClick={() => void togglePip()}>
            Играет в отдельном окне
          </button>
        ) : (
          <VideoPlayer
            stream={stream}
            loading={busy}
            compact={props.mode === "mini"}
            quality={quality}
            onQuality={setQuality}
            startAt={startAt}
            subtitle={sub}
            hasNext={Boolean(nextEp)}
            onNext={() => nextEp && props.onChangeEpisode(nextEp)}
            onPickSubtitle={() => void pickSub()}
            onDownload={stream && stream.kind !== "embed" && props.mode === "cinema" ? () => void enqueue("episode") : undefined}
            onDownloadOpening={
              stream && stream.kind !== "embed" && props.mode === "cinema" ? () => void enqueue("opening") : undefined
            }
            downloading={dlBusy}
            resumeKey={`${props.anime.id}:${props.translation.id}:${props.episode.number}:${resumeTick}`}
            onProgress={saveProgress}
            episodesOpen={epsOpen}
            onToggleEpisodes={cinema ? togglePanel : undefined}
            onExpand={props.onExpand}
            pipOn={pipOpen}
            onTogglePip={(time) => void togglePip(time)}
            onPaused={(paused) => pushDiscord(paused)}
            onEnded={() => {
              if (nextEp) props.onChangeEpisode(nextEp);
            }}
          />
        )}
        {cinema && epsOpen ? (
          <aside className="cinema-eps">
            <div className="cinema-eps-head">
              <h3>Плейлист</h3>
              <button className="icon-btn" type="button" title="Скрыть панель" onClick={togglePanel}>
                <IconClose />
              </button>
            </div>
            <h3>Озвучка</h3>
            <TranslationList
              compact
              items={studios}
              currentId={props.translation.id}
              preferredStudio={preferredStudio}
              onPick={(t) => props.onChangeTranslation?.(t)}
            />
            {seasons.length > 1 ? (
              <div className="chips">
                {seasons.map((s) => (
                  <button
                    key={s.number}
                    className={`chip ${props.season === s.number ? "active" : ""}`}
                    type="button"
                    onClick={() => {
                      const ep = s.episodes.find((e) => e.number === props.episode.number) ?? s.episodes[0];
                      if (ep) props.onChangeEpisode(ep, s.number);
                    }}
                  >
                    Сезон {s.number}
                  </button>
                ))}
              </div>
            ) : null}
            <h3>Серии</h3>
            <EpisodeGrid
              compact
              episodes={episodes}
              current={props.episode.number}
              continueAt={props.episode.number}
              watched={watched}
              onPick={(ep) => props.onChangeEpisode(ep, props.season)}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
