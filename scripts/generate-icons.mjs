import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

// Small deterministic PNG icons. No image libraries or build dependencies.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function roundedRect(x, y, left, top, right, bottom, radius) {
  const dx = Math.max(left + radius - x, 0, x - right + radius);
  const dy = Math.max(top + radius - y, 0, y - bottom + radius);
  return x >= left && x <= right && y >= top && y <= bottom && dx * dx + dy * dy <= radius * radius;
}

function icon(size, stop) {
  const rgba = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const samples = [];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = (x + (sx + 0.5) / 4) / size;
        const py = (y + (sy + 0.5) / 4) / size;
        const inTile = roundedRect(px, py, 0.035, 0.035, 0.965, 0.965, 0.24);
        const mark = stop
          ? roundedRect(px, py, 0.30, 0.30, 0.70, 0.70, 0.045)
          : (px - 0.5) ** 2 + (py - 0.5) ** 2 <= 0.245 ** 2;
        samples.push(!inTile ? [0, 0, 0, 0] : mark ? (stop ? [255, 255, 255, 255] : [248, 76, 86, 255]) : stop ? [220, 38, 48, 255] : [24, 29, 40, 255]);
      }
      const offset = y * (1 + size * 4) + 1 + x * 4;
      for (let c = 0; c < 4; c++) rgba[offset + c] = Math.round(samples.reduce((sum, pixel) => sum + pixel[c], 0) / samples.length);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rgba)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

const directory = new URL("../icons/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  for (const state of ["record", "stop"]) {
    await writeFile(new URL(`${state}-${size}.png`, directory), icon(size, state === "stop"));
  }
}
console.log("Generated record and stop icons at 16, 32, 48, and 128 px.");
