import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ThemeSettings } from "../../shared/types";
import { applyTheme, DEFAULT_THEME, hexToHsv, hsvToHex, normalizeTheme, randomAccent, sanitizeHex } from "../lib/theme";
import { IconClose } from "./icons";

export function ThemeModal(props: { open: boolean; onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [hex, setHex] = useState(DEFAULT_THEME.accent);
  const saveTimer = useRef(0);

  useEffect(() => {
    if (!props.open) return;
    void window.hikari.getConfig().then((cfg) => {
      const next = normalizeTheme(cfg.theme);
      setTheme(next);
      setHex(next.accent);
      applyTheme(next);
    });
  }, [props.open]);

  function commit(next: ThemeSettings, persist = true) {
    const clean = normalizeTheme(next);
    setTheme(clean);
    setHex(clean.accent);
    applyTheme(clean);
    if (!persist) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void window.hikari.getConfig().then((cfg) => window.hikari.saveConfig({ ...cfg, theme: clean }));
    }, 350);
  }

  function setAccent(value: string) {
    const accent = sanitizeHex(value);
    if (!accent) {
      setHex(value);
      return;
    }
    commit({ ...theme, accent });
  }

  async function pickScreen() {
    const Eye = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!Eye) return;
    try {
      const res = await new Eye().open();
      setAccent(res.sRGBHex);
    } catch {
      /* отмена пипетки */
    }
  }

  if (!props.open) return null;
  const hsv = hexToHsv(theme.accent);

  return (
    <div className="theme-overlay" onClick={props.onClose}>
      <aside className="theme-panel" onClick={(e) => e.stopPropagation()}>
        <div className="theme-head">
          <h2>Настройте свою тему</h2>
          <button className="icon-btn" type="button" onClick={props.onClose} title="Закрыть">
            <IconClose />
          </button>
        </div>

        <section>
          <h3>Внешний вид</h3>
          <div className="theme-modes">
            <button
              className={`theme-mode${theme.mode === "dark" ? " on" : ""}`}
              type="button"
              onClick={() => commit({ ...theme, mode: "dark" })}
              title="Тёмная"
            >
              <span className="theme-moon" />
            </button>
            <button
              className={`theme-mode${theme.mode === "light" ? " on" : ""}`}
              type="button"
              onClick={() => commit({ ...theme, mode: "light" })}
              title="Светлая"
            >
              <span className="theme-sun" />
            </button>
          </div>
        </section>

        <section>
          <h3>Цвета</h3>
          <ColorField hsv={hsv} onChange={(next) => setAccent(hsvToHex(next.h, next.s, next.v))} />
          <div className="theme-hex-row">
            <span className="theme-swatch" style={{ background: theme.accent }} />
            <input value={hex} onChange={(e) => setAccent(e.target.value)} spellCheck={false} />
            <button className="icon-btn" type="button" title="Пипетка" onClick={() => void pickScreen()}>
              ✎
            </button>
          </div>
          <div className="theme-swatches">
            {theme.swatches.map((c) => (
              <button
                key={c}
                className={`theme-dot${c.toLowerCase() === theme.accent.toLowerCase() ? " on" : ""}`}
                type="button"
                style={{ background: c }}
                onClick={() => setAccent(c)}
              />
            ))}
            <button
              className="theme-dot add"
              type="button"
              title="Добавить цвет"
              onClick={() => {
                const list = [...theme.swatches.filter((c) => c.toLowerCase() !== theme.accent.toLowerCase()), theme.accent].slice(-12);
                commit({ ...theme, swatches: list });
              }}
            >
              +
            </button>
          </div>
          <p className="hint">Добавление цвета</p>
        </section>

        <section>
          <h3>Настройки</h3>
          <label className="theme-sat">
            <span>Насыщенность цвета</span>
            <strong>{theme.saturation}%</strong>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={theme.saturation}
            onChange={(e) => commit({ ...theme, saturation: Number(e.target.value) })}
          />
        </section>

        <div className="theme-actions">
          <button className="ghost" type="button" onClick={() => commit({ ...theme, accent: randomAccent() })}>
            Удивите меня!
          </button>
          <button className="ghost" type="button" onClick={() => commit({ ...DEFAULT_THEME, swatches: [...DEFAULT_THEME.swatches] })}>
            Сброс
          </button>
        </div>
      </aside>
    </div>
  );
}

function ColorField(props: { hsv: { h: number; s: number; v: number }; onChange: (hsv: { h: number; s: number; v: number }) => void }) {
  const box = useRef<HTMLDivElement | null>(null);

  function fromEvent(e: ReactPointerEvent<HTMLDivElement> | PointerEvent) {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    props.onChange({ ...props.hsv, s, v });
  }

  function start(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    fromEvent(e);
    const move = (ev: PointerEvent) => fromEvent(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const hueColor = hsvToHex(props.hsv.h, 1, 1);
  const pos = useMemo(() => ({ x: `${props.hsv.s * 100}%`, y: `${(1 - props.hsv.v) * 100}%` }), [props.hsv.s, props.hsv.v]);

  return (
    <div className="theme-picker">
      <div
        ref={box}
        className="theme-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColor})` }}
        onPointerDown={start}
      >
        <span className="theme-sv-knob" style={{ left: pos.x, top: pos.y }} />
      </div>
      <input
        className="theme-hue"
        type="range"
        min={0}
        max={360}
        value={Math.round(props.hsv.h * 360)}
        onChange={(e) => props.onChange({ ...props.hsv, h: Number(e.target.value) / 360 })}
      />
    </div>
  );
}
