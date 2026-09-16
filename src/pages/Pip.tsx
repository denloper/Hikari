import { useEffect, useRef, useState } from "react";
import type { PipSession } from "../../shared/types";
import { VideoPlayer } from "../components/VideoPlayer";
import { applyTheme, normalizeTheme } from "../lib/theme";

export function PipPage() {
  const [session, setSession] = useState<PipSession | null>(null);
  const lastTime = useRef(0);
  const lastDuration = useRef(0);

  useEffect(() => {
    void window.hikari.getConfig().then((cfg) => applyTheme(normalizeTheme(cfg.theme))).catch(() => undefined);
    void window.hikari.getPipSession().then((next) => {
      if (!next) return;
      setSession(next);
      lastTime.current = next.time;
    });
    return window.hikari.onPipSession((next) => {
      setSession(next);
      if (next) lastTime.current = next.time;
    });
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function send(type: "return" | "next" | "closed") {
    void window.hikari.pipCommand({ type, time: lastTime.current });
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
    <div className="pip-app">
      <div className="pip-drag" />
      <div className="pip-body">
        {embed ? (
          <button
            className="pip-embed-slot"
            type="button"
            title="Пауза · P — в плеер"
            onClick={() => void window.hikari.embedPlayPause()}
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
    </div>
  );
}
