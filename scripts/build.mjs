import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyJassub } from "./jassub.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

copyJassub();

await esbuild({
  entryPoints: [path.join(root, "electron", "main.ts")],
  outfile: path.join(root, "out", "main", "main.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron", "electron-updater", "better-sqlite3", "@ghostery/adblocker-electron"],
  sourcemap: false
});

await esbuild({
  entryPoints: [path.join(root, "electron", "preload.ts")],
  outfile: path.join(root, "out", "preload", "preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: false
});

await viteBuild({
  configFile: path.join(root, "vite.config.ts"),
  root
});

console.log("Build complete: out/");
