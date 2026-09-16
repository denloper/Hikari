import fs from "node:fs";
import path from "node:path";
import { dialog, BrowserWindow } from "electron";
import type { SubtitleFile } from "../../shared/types";

function readSubtitle(filePath: string): SubtitleFile | null {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  if (ext !== "ass" && ext !== "srt" && ext !== "ssa") return null;
  const content = fs.readFileSync(filePath, "utf8");
  return {
    path: filePath,
    name: path.basename(filePath),
    ext: ext === "ssa" ? "ass" : ext,
    content
  };
}

export async function pickSubtitle(win: BrowserWindow): Promise<SubtitleFile | null> {
  const res = await dialog.showOpenDialog(win, {
    title: "Выбрать субтитры",
    filters: [{ name: "Субтитры", extensions: ["ass", "srt", "ssa"] }],
    properties: ["openFile"]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return readSubtitle(res.filePaths[0]);
}

export async function pickSubtitleFolder(win: BrowserWindow): Promise<string | null> {
  const res = await dialog.showOpenDialog(win, {
    title: "Папка субтитров",
    properties: ["openDirectory"]
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
}

/** Ищем файл в папке по подстроке (id тайтла, номер серии). */
export function loadSubtitleFromFolder(folder: string, hint: string): SubtitleFile | null {
  if (!folder || !fs.existsSync(folder)) return null;
  const needle = hint.toLowerCase();
  const files = fs.readdirSync(folder).filter((f) => /\.(ass|srt|ssa)$/i.test(f));
  const hit = files.find((f) => f.toLowerCase().includes(needle)) ?? files.find((f) => {
    const parts = needle.split(/[\s_-]+/).filter(Boolean);
    return parts.every((p) => f.toLowerCase().includes(p));
  });
  if (!hit) return null;
  return readSubtitle(path.join(folder, hit));
}
