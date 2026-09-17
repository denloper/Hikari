import { useEffect, useRef, useState } from "react";
import type { PipSession } from "../../shared/types";
import { VideoPlayer } from "../components/VideoPlayer";
import { IconExpand, IconNext, IconPause, IconPlay } from "../components/icons";
import { applyTheme, normalizeTheme } from "../lib/theme";

export function PipPage() {
  const [session, setSession] = useState<PipSession | null>(null);
  const [hot, setHot] = useState(false);
  const [skipButtons, setSkipButtons] = useState(true);
  const [embedPaused, setEmbedPaused] = useState(false);
  const lastTime = useRef(0);
  const lastDuration = useRef(0);

  useEffect(() => {
    void window.hikari.getConfig().then((cfg) => {
      applyTheme(normalizeTheme(cfg.theme));
      setSkipButtons(cfg.pipSkipButtons !== false);
    }).catch(() => undefined);
    void window.hikari.getPipSession().then((next) => {
      if (!next) return;
      setSession(next);
      lastTime.current = next.time;
    });
    const offSession = window.hikari.onPipSession((next) => {
      setSession(next);
      if (next) lastTime.current = next.time;
    });
    const offHover = window.hikari.onPipHover(setHot);
    const offCfg = window.hikari.onConfigChanged((cfg) => {
      applyTheme(normalizeTheme(cfg.theme));
      setSkipButtons(cfg.pipSkipButtons !== false);
    });
    return () => {
      offSession();
      offHover();
      offCfg();
    };
  }, []);

  useEffect(() => {
    if (!session || session.kind !== "embed") return;
    const id = window.setInterval(() => {
      void window.hikari
        .embedGetTime()
        .then((t) => {
          if (t < 0) return;
          lastTime.current = t;
          void window.hikari.pipCommand({ type: "time", time: t });
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(id);
  }, [session]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" || e.code === "KeyP") {
        e.preventDefault();
        void window.hikari.pipCommand({ type: "return", time: lastTime.current });
        return;
      }
      if (e.code === "KeyN") {
        e.preventDefault();
        send("next");
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        void skipBy(-10);
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        void skipBy(10);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  function send(type: "return" | "next" | "closed") {
    void window.hikari.pipCommand({ type, time: lastTime.current });
  }

  async function skipBy(delta: number) {
    if (!session || session.kind !== "embed") {
      window.dispatchEvent(new CustomEvent("hikari-pip-seek", { detail: delta }));
      return;
    }
    const t = Math.max(0, lastTime.current + delta);
    lastTime.current = t;
    await window.hikari.seekEmbed(t);
    void window.hikari.pipCommand({ type: "time", time: t });
  }

  async function toggleEmbed() {
    const playing = await window.hikari.embedPlayPause();
    setEmbedPaused(!playing);
  }

  if (!session) {
    return (
      <div className="pip-app">
        <div className="pip-drag" />
        <div className="pip-body muted">Подключаю окно…</div>
      </div>
    );
  }

  const embed = session.kind === "embed";

  return (
    <div className={`pip-app${hot ? " is-hot" : ""}`}>
      <div className="pip-drag" />
      <div className="pip-body">
        {embed ? (
          <button
            className="pip-embed-slot"
            type="button"
            title="Пауза · P — в плеер"
            onClick={() => void toggleEmbed()}
            onDoubleClick={() => send("return")}
          >
            Встроенный плеер
          </button>
        ) : session.stream && session.stream.kind !== "embed" ? (
          <VideoPlayer
            stream={session.stream}
            quality={session.quality || session.stream.qualities[0]?.height || 0}
            onQuality={() => undefined}
            startAt={session.time}
            subtitle={null}
            onPickSubtitle={() => undefined}
            hasNext={session.hasNext}
            onNext={() => send("next")}
            resumeKey={session.key}
            compact
            hovered={hot}
            showSkip10={skipButtons}
            autoPlay
            expandOnClick={false}
            onExpand={() => send("return")}
            onTogglePip={(time) => {
              lastTime.current = time;
              send("return");
            }}
            onProgress={(t, d) => {
              lastTime.current = t;
              lastDuration.current = d;
              void window.hikari.pipCommand({ type: "time", time: t, duration: d });
            }}
            onEnded={() => send("next")}
          />
        ) : (
          <div className="muted">Нет потока</div>
        )}
      </div>
      {embed ? (
        <div className="pip-hud" aria-hidden={!hot}>
          {skipButtons ? (
            <button type="button" className="icon-btn" title="Назад 10 сек" onClick={() => void skipBy(-10)}>
              −10
            </button>
          ) : null}
          <button type="button" className="icon-btn" title="Пауза" onClick={() => void toggleEmbed()}>
            {embedPaused ? <IconPlay /> : <IconPause />}
          </button>
          {skipButtons ? (
            <button type="button" className="icon-btn" title="Вперёд 10 сек" onClick={() => void skipBy(10)}>
              +10
            </button>
          ) : null}
          {session.hasNext ? (
            <button type="button" className="icon-btn" title="Следующая серия · N" onClick={() => send("next")}>
              <IconNext />
            </button>
          ) : null}
          <button type="button" className="icon-btn" title="В плеер · P" onClick={() => send("return")}>
            <IconExpand />
          </button>
        </div>
      ) : null}
    </div>
  );
}
