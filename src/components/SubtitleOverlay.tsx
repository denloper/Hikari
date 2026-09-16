import { useEffect, useMemo, useRef } from "react";
import JASSUB from "jassub";
import type { SubtitleFile } from "../../shared/types";

interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseTs(raw: string): number {
  const norm = raw.trim().replace(",", ".");
  const parts = norm.split(":");
  if (parts.length < 3) return 0;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2]);
  return h * 3600 + m * 60 + s;
}

function parseSrt(content: string): Cue[] {
  const blocks = content.replace(/\r/g, "").split(/\n\n+/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const [from, to] = timeLine.split("-->");
    const text = lines
      .slice(lines.indexOf(timeLine) + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "");
    cues.push({ start: parseTs(from), end: parseTs(to), text });
  }
  return cues;
}

function jassubUrls() {
  const base = new URL("jassub/", window.location.href).href;
  // В npm-пакете 1.8 лежит wasm.js, отдельного .wasm нет.
  return {
    workerUrl: `${base}jassub-worker.js`,
    wasmUrl: `${base}jassub-worker.wasm.js`,
    legacyWasmUrl: `${base}jassub-worker.wasm.js`
  };
}

export function SubtitleOverlay(props: {
  video: HTMLVideoElement | null;
  file: SubtitleFile | null;
  time: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<JASSUB | null>(null);
  const srtCues = useMemo(() => {
    if (!props.file || props.file.ext !== "srt") return [];
    return parseSrt(props.file.content);
  }, [props.file]);

  useEffect(() => {
    engineRef.current?.destroy();
    engineRef.current = null;
    if (!props.file || props.file.ext !== "ass" || !props.video) return;
    const urls = jassubUrls();
    const inst = new JASSUB({
      video: props.video,
      canvas: canvasRef.current ?? undefined,
      subContent: props.file.content,
      workerUrl: urls.workerUrl,
      wasmUrl: urls.wasmUrl,
      legacyWasmUrl: urls.legacyWasmUrl
    });
    engineRef.current = inst;
    return () => {
      inst.destroy();
      engineRef.current = null;
    };
  }, [props.file, props.video]);

  if (!props.file) return null;

  if (props.file.ext === "ass") {
    return <canvas ref={canvasRef} className="sub-canvas" />;
  }

  const cue = srtCues.find((c) => props.time >= c.start && props.time <= c.end);
  if (!cue) return null;
  return <div className="sub-layer">{cue.text}</div>;
}
