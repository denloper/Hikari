import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const size = 256;
const xor = Buffer.alloc(size * size * 4);
const cx = size / 2;
const cy = size / 2;
const r = size * 0.39;

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const sy = size - 1 - y;
    const d = Math.hypot(x - cx + 0.5, sy - cy + 0.5);
    const i = (y * size + x) * 4;
    if (d <= r) {
      xor[i] = 247;
      xor[i + 1] = 124;
      xor[i + 2] = 139;
      xor[i + 3] = 255;
      if (Math.hypot(x - cx, sy - (cy - size * 0.04)) < size * 0.12) {
        xor[i] = 106;
        xor[i + 1] = 195;
        xor[i + 2] = 232;
        xor[i + 3] = 255;
      }
    } else {
      xor[i] = 20;
      xor[i + 1] = 15;
      xor[i + 2] = 14;
      xor[i + 3] = 255;
    }
  }
}

const andRow = ((size + 31) >> 5) * 4;
const andMask = Buffer.alloc(andRow * size, 0);
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(size, 4);
dib.writeInt32LE(size * 2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(xor.length + andMask.length, 20);
const image = Buffer.concat([dib, xor, andMask]);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(image.length, 14);
header.writeUInt32LE(22, 18);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(root, "build"), { recursive: true });
fs.writeFileSync(path.join(root, "build", "icon.ico"), Buffer.concat([header, image]));
console.log("wrote build/icon.ico");
