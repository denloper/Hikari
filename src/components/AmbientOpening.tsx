import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "../../shared/types";

/** Фоновый опенинг в оболочке, пока не смотрят серию. */
export function AmbientOpening(props: { duck: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [cfg, setCfg] = useState<AppConfig | null>(null);

  useEffect(() => {
    void window.hikari.getConfig().then(setCfg).catch(() => undefined);
    return window.hikari.onConfigChanged(setCfg);
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !cfg) return;
    el.volume = Math.min(1, Math.max(0, (cfg.ambientOpVolume ?? 35) / 100));
    const url = cfg.ambientOpUrl.trim();
    const want = cfg.ambientOpEnabled && Boolean(url) && !props.duck;
    if (!want) {
      el.pause();
      return;
    }
    if (el.getAttribute("src") !== url) {
      el.setAttribute("src", url);
      el.load();
    }
    void el.play().catch(() => undefined);
  }, [cfg, props.duck]);

  return <audio ref={audioRef} loop preload="none" />;
}
