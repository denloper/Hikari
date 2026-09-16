import { useEffect, useRef, useState } from "react";
import type { PipSession } from "../../shared/types";
import { VideoPlayer } from "../components/VideoPlayer";
import { IconClose, IconExpand, IconNext, IconPause, IconPlay } from "../components/icons";
import { applyTheme, normalizeTheme } from "../lib/theme";

export function PipPage() {
  const [session, setSession] = useState<PipSession | null>(null);
  const [embedPaused, setEmbedPaused] = useState(false);
  const lastTime = useRef(0);

  useEffect(() => {
    void window.hikari.getConfig().then((cfg) => applyTheme(normalizeTheme(cfg.theme))).catch(() => undefined);
    return window.hikari.onPipSession((next) => {
      setSession(next);
      if (next) lastTime.current = next.time;
    });
  }, []);

  function send(type: "return" | "next" | "closed") {
    void window.hikari.pipCommand({ type, time: lastTime.current });
  }

  async function toggleEmbed() {
    const playing = await window.hikari.embedPlayPause();
    setEmbedPaused(!playing);
  }

  if (!session) {
    return (
      <div className="pip-app">
        <div className="pip-bar">
          <strong>Hikari</strong>
          <button className="icon-btn" type="button" onClick={() => send("closed")} title="Закрыть">
            <IconClose />
          </button>
        </div>
        <div className="pip-body muted">Подключаю окно…</div>
      </div>
    );
  }

  const embed = session.kind === "embed";

  return (
    <div className="pip-app">
      <div className="pip-bar">
        <div className="pip-title">
          <strong>{session.title}</strong>
          <span>{session.meta}</span>
        </div>
        {embed ? (
          <button className="icon-btn" type="button" title="Пауза" onClick={() => void toggleEmbed()}>
            {embedPaused ? <IconPlay /> : <IconPause />}
          </button>
        ) : null}
        {session.hasNext ? (
          <button className="icon-btn" type="button" title="Следующая" onClick={() => send("next")}>
            <IconNext />
          </button>
        ) : null}
        <button className="icon-btn" type="button" title="В плеер" onClick={() => send("return")}>
          <IconExpand />
        </button>
        <button className="icon-btn" type="button" title="Закрыть" onClick={() => send("closed")}>
          <IconClose />
        </button>
      </div>
      <div className="pip-body">
        {embed ? (
          <div className="pip-embed-slot">Встроенный плеер</div>
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
            resumeKey={`${session.title}:${session.meta}`}
            compact
            onExpand={() => send("return")}
            onTogglePip={(time) => {
              lastTime.current = time;
              send("return");
            }}
            onProgress={(t) => {
              lastTime.current = t;
              void window.hikari.pipCommand({ type: "time", time: t });
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
