import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { StreamResult, SubtitleFile } from "../../shared/types";
import { formatTime } from "../lib/format";
import { activeSkip } from "../lib/skips";
import { IconDownload, IconEpisodes, IconExpand, IconNext, IconPause, IconPip, IconPlay, IconSubtitles } from "./icons";
import { SubtitleOverlay } from "./SubtitleOverlay";

const HINT_KEY = "hikari.playerHint";

export function VideoPlayer(props: {
  stream: StreamResult | null;
  loading?: boolean;
  quality: number;
  onQuality: (h: number) => void;
  onEnded: () => void;
  onProgress: (position: number, duration: number) => void;
  startAt?: number;
  subtitle: SubtitleFile | null;
  onPickSubtitle: () => void;
  hasNext?: boolean;
  onNext?: () => void;
  onDownload?: () => void;
  onDownloadOpening?: () => void;
  downloading?: boolean;
  resumeKey?: string;
  episodesOpen?: boolean;
  onToggleEpisodes?: () => void;
  compact?: boolean;
  onExpand?: () => void;
  pipOn?: boolean;
  onTogglePip?: (time: number) => void;
  onPaused?: (paused: boolean) => void;
  autoPlay?: boolean;
  expandOnClick?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [fs, setFs] = useState(false);
  const [hide, setHide] = useState(false);
  const [qOpen, setQOpen] = useState(false);
  const [nativePip, setNativePip] = useState(false);
  const [hint, setHint] = useState(() => {
    try {
      return !localStorage.getItem(HINT_KEY);
    } catch {
      return false;
    }
  });
  const hideTimer = useRef<number>(0);
  const lastSave = useRef(0);
  const lastPos = useRef({ t: 0, d: 0 });
  const appliedKey = useRef("");
  const keepTime = useRef(0);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  const mediaUrl =
    props.stream?.kind === "hls" || props.stream?.kind === "file"
      ? props.stream.qualities.find((q) => q.height === props.quality)?.url ||
        props.stream.qualities[0]?.url
      : "";

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !props.stream || !mediaUrl) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (props.stream.kind === "file") {
      video.src = mediaUrl;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    if (props.stream.kind !== "hls") return;
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        xhrSetup: (xhr) => {
          try {
            if (props.stream?.kind === "hls" && props.stream.referer) {
              xhr.setRequestHeader("Referer", props.stream.referer);
            }
          } catch {
            /* запрещённый заголовок в Chromium — Referer ставит main */
          }
        }
      });
      hls.loadSource(mediaUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = mediaUrl;
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [mediaUrl, props.stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => {
      const key = props.resumeKey || mediaUrl;
      if (appliedKey.current !== key) {
        appliedKey.current = key;
        const start = props.startAt ?? 0;
        const dur = video.duration || 0;
        if (dur && start && dur - start < 15) {
          if (props.autoPlay) void video.play().catch(() => undefined);
          return;
        }
        if (start) video.currentTime = start;
        if (props.autoPlay) void video.play().catch(() => undefined);
        return;
      }
      if (keepTime.current > 1) video.currentTime = keepTime.current;
    };
    video.addEventListener("loadedmetadata", onMeta, { once: true });
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, [mediaUrl, props.resumeKey, props.startAt, props.autoPlay]);

  useEffect(() => {
    if (!props.autoPlay) return;
    const video = videoRef.current;
    if (!video) return;
    const play = () => {
      void video.play().catch(() => undefined);
    };
    if (video.readyState >= 2) play();
    video.addEventListener("canplay", play, { once: true });
    return () => video.removeEventListener("canplay", play);
  }, [mediaUrl, props.autoPlay, props.resumeKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const t = video.currentTime;
      const d = video.duration || 0;
      lastPos.current = { t, d };
      keepTime.current = t;
      setTime(t);
      setDuration(d);
      const now = Date.now();
      if (now - lastSave.current > 2000) {
        lastSave.current = now;
        props.onProgress(t, d);
      }
    };
    const onPlay = () => {
      setPaused(false);
      props.onPaused?.(false);
    };
    const onPause = () => {
      setPaused(true);
      props.onPaused?.(true);
      props.onProgress(video.currentTime, video.duration || 0);
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", props.onEnded);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", props.onEnded);
    };
  }, [props.onEnded, props.onProgress]);

  useEffect(() => {
    return () => {
      if (lastPos.current.t > 1) props.onProgress(lastPos.current.t, lastPos.current.d);
    };
  }, [props.onProgress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const video = videoRef.current;
      if (e.code === "KeyE" && props.onToggleEpisodes) {
        e.preventDefault();
        props.onToggleEpisodes();
        return;
      }
      if (!video) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      } else if (e.code === "ArrowRight") {
        video.currentTime += 10;
      } else if (e.code === "ArrowLeft") {
        video.currentTime = Math.max(0, video.currentTime - 10);
      } else if (e.code === "KeyN" && props.onNext) {
        props.onNext();
      } else if (e.code === "KeyF") {
        if (props.compact) props.onExpand?.();
        else toggleFs();
      } else if (e.code === "KeyP") {
        e.preventDefault();
        void togglePip();
      } else if (e.code === "KeyS") {
        const hit = activeSkip(props.stream && props.stream.kind !== "embed" ? props.stream.skips : undefined, video.currentTime);
        if (hit) {
          e.preventDefault();
          video.currentTime = hit.to;
        }
      } else if (e.code === "Escape" && document.fullscreenElement) {
        void document.exitFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onToggleEpisodes, props.onNext, props.compact, props.onExpand, props.onTogglePip, props.stream]);

  useEffect(() => {
    const onFs = () => setFs(Boolean(document.fullscreenElement));
    const onPip = () => setNativePip(Boolean(document.pictureInPictureElement));
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("enterpictureinpicture", onPip);
    document.addEventListener("leavepictureinpicture", onPip);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("enterpictureinpicture", onPip);
      document.removeEventListener("leavepictureinpicture", onPip);
    };
  }, []);

  function toggleFs() {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  }

  function bumpHide() {
    setHide(false);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setHide(true);
      setQOpen(false);
    }, 2500);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }

  async function togglePip() {
    if (props.onTogglePip) {
      props.onTogglePip(videoRef.current?.currentTime ?? lastPos.current.t);
      return;
    }
    const v = videoRef.current;
    if (!v || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* браузер не дал PiP */
    }
  }

  function onShellClick() {
    if (props.compact && props.expandOnClick !== false) {
      props.onExpand?.();
      return;
    }
    togglePlay();
  }

  function dismissHint() {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* нет доступа к storage */
    }
  }

  const qualities = props.stream?.kind === "hls" || props.stream?.kind === "file" ? props.stream.qualities : [];

  if (props.stream?.kind === "embed") {
    return (
      <div className="video-shell" ref={shellRef} data-embed-host="1">
        <div className="video-loading">
          <div>Открыт встроенный плеер</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`video-shell ${fs ? "fs" : ""}${props.compact ? " compact" : ""}`}
      ref={shellRef}
      onMouseMove={bumpHide}
      onClick={onShellClick}
    >
      <video
        ref={(el) => {
          videoRef.current = el;
          setVideoEl(el);
        }}
        playsInline
      />
      <SubtitleOverlay video={videoEl} file={props.subtitle} time={time} />
      {(() => {
        const hit = activeSkip(props.stream?.skips, time);
        if (!hit) return null;
        return (
          <button
            className="skip-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (videoRef.current) videoRef.current.currentTime = hit.to;
            }}
          >
            {hit.kind === "op" ? "Пропустить опенинг" : "Пропустить эндинг"}
          </button>
        );
      })()}
      {hint && !props.compact ? (
        <button className="player-hint" type="button" onClick={(e) => { e.stopPropagation(); dismissHint(); }}>
          <div>
            <strong>Горячие клавиши</strong>
            <p>Пробел — пауза · ← → — 10 сек · F — экран · P — PiP · E — серии · N — следующая</p>
            <span>Нажмите, чтобы скрыть</span>
          </div>
        </button>
      ) : null}
      {props.loading || (!props.stream && !props.loading) ? (
        <div className="video-loading">
          <div className="spinner" />
          <div>{props.loading ? "Подключаю поток…" : "Нет потока"}</div>
        </div>
      ) : null}
      <div className={`controls ${hide && !paused ? "hidden" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (videoRef.current) videoRef.current.currentTime = v;
              setTime(v);
            }}
          />
        </div>
        <div className="row">
          <button className="icon-btn" type="button" onClick={togglePlay} title="Пробел">
            {paused ? <IconPlay /> : <IconPause />}
          </button>
          <span className="muted">
            {formatTime(time)} / {formatTime(duration)}
          </span>
          <input
            className="vol"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              if (videoRef.current) videoRef.current.volume = v;
            }}
          />
          {qualities.length ? (
            <div className="menu-wrap">
              <button className="icon-btn" type="button" onClick={() => setQOpen((v) => !v)}>
                {props.quality || qualities[0]?.height}p
              </button>
              {qOpen ? (
                <div className="pop-menu">
                  {qualities.map((q) => (
                    <button
                      key={q.height}
                      className={props.quality === q.height ? "active" : ""}
                      type="button"
                      onClick={() => {
                        props.onQuality(q.height);
                        setQOpen(false);
                      }}
                    >
                      {q.height}p
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {props.onDownload ? (
            <button className="icon-btn" type="button" title="Скачать серию" onClick={props.onDownload} disabled={props.downloading}>
              <IconDownload />
            </button>
          ) : null}
          {props.onDownloadOpening ? (
            <button
              className="icon-btn"
              type="button"
              title="Скачать опенинг"
              onClick={props.onDownloadOpening}
              disabled={props.downloading}
            >
              OP
            </button>
          ) : null}
          <button className="icon-btn" type="button" title="Субтитры" onClick={props.onPickSubtitle}>
            <IconSubtitles />
          </button>
          {props.onToggleEpisodes ? (
            <button
              className={`icon-btn ${props.episodesOpen ? "on" : ""}`}
              type="button"
              title="Серии · E"
              onClick={props.onToggleEpisodes}
            >
              <IconEpisodes />
            </button>
          ) : null}
          {props.hasNext && !props.compact ? (
            <button className="icon-btn" type="button" onClick={props.onNext} title="N — следующая">
              <IconNext />
            </button>
          ) : null}
          <button
            className={`icon-btn${props.pipOn || nativePip ? " on" : ""}`}
            type="button"
            title="Картинка в картинке · P"
            onClick={() => void togglePip()}
          >
            <IconPip />
          </button>
          {props.compact ? (
            <button className="icon-btn" type="button" onClick={props.onExpand} title="Развернуть">
              <IconExpand />
            </button>
          ) : (
            <button className="icon-btn" type="button" onClick={toggleFs} title="F">
              <IconExpand />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
