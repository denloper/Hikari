import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Копирует воркеры JASSUB в public, чтобы renderer нашёл wasm. */
export function copyJassub() {
  const src = path.join(root, "node_modules", "jassub", "dist");
  const dest = path.join(root, "public", "jassub");
  if (!fs.existsSync(src)) {
    console.warn("jassub dist not found, skip copy");
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    if (fs.statSync(from).isFile()) {
      fs.copyFileSync(from, path.join(dest, name));
    }
  }
}
