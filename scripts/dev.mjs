import { context as esbuildContext } from "esbuild";
import { createServer } from "vite";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { copyJassub } from "./jassub.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

copyJassub();

const mainCtx = await esbuildContext({
  entryPoints: [path.join(root, "electron", "main.ts")],
  outfile: path.join(root, "out", "main", "main.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron", "better-sqlite3", "@ghostery/adblocker-electron"],
  sourcemap: true
});

const preloadCtx = await esbuildContext({
  entryPoints: [path.join(root, "electron", "preload.ts")],
  outfile: path.join(root, "out", "preload", "preload.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: true
});

await mainCtx.watch();
await preloadCtx.watch();
await mainCtx.rebuild();
await preloadCtx.rebuild();

const vite = await createServer({
  configFile: path.join(root, "vite.config.ts"),
  root
});
await vite.listen();
const url = vite.resolvedUrls?.local?.[0] ?? "http://localhost:5173";

const child = spawn(electronPath, ["."], {
  cwd: root,
  env: { ...process.env, ELECTRON_RENDERER_URL: url },
  stdio: "inherit"
});

child.on("exit", async (code) => {
  await vite.close();
  await mainCtx.dispose();
  await preloadCtx.dispose();
  process.exit(code ?? 0);
});
