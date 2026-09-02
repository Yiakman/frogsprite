#!/usr/bin/env node
// Rebuild public/templates/anthro8.json + review contact sheets from the source sheets in
// public/templates/src/. Zero dependencies — PNG decode/encode on node:zlib, same as the app's
// own zip/apng writers. The browser build (public/run.local) stays the canonical builder; this
// exists so the committed JSON and artifacts can be regenerated without a browser.
//
//   node templates/rebuild-anthro8.mjs
//
// Source of truth for the mapping: the standing sheet's cell order was established by eye
// signature + torso correlation against the direction-named walk sheets (see
// examples/iso-anthro8-template.md). Palette indices are the ones the editor's nearest-colour
// snap produces for the two source hexes, verified in-page through a probe sprite.
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public/templates/src');
const OUT_JSON = join(ROOT, 'public/templates/anthro8.json');
const OUT_ART = join(ROOT, 'anthro8/dist/contact');

const GRID = 64, DX = 16, DY = 16, MS_WALK = 120, MS_STAND = 150;
const PURPLE = 119; // #ab47bc -> #9933cc (verified in-page via paint probe)
const YELLOW = 207; // #ffde69 -> #ffcc66
const SHEETS = ['east', 'west', 'north', 'south', 'north-east', 'north-west', 'south-east', 'south-west'];
// standing sheet cells: a clockwise rotation SE S SW W NW N NE E (evidence in the doc)
const STAND_ORDER = ['south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east'];
const RGB = { [PURPLE]: [0x99, 0x33, 0xcc], [YELLOW]: [0xff, 0xcc, 0x66] };

// ---- PNG decode (8-bit RGB/RGBA, no interlace — what these sheets are) ----
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth} interlace ${interlace}`);
  const bpp = color === 6 ? 4 : color === 2 ? 3 : color === 3 ? 1 : 0;
  if (!bpp) throw new Error(`unsupported colour type ${color}`);
  const raw = inflateSync(Buffer.concat(idat, idat.reduce((n, c) => n + c.length, 0)));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  let at = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < h; y++) {
    const filter = raw[at++];
    const line = raw.subarray(at, at + stride); at += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1; else if (filter === 4) v += paeth(a, b, c);
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * bpp;
      if (color === 3) {
        const p = cur[s];
        out[o] = plte[p * 3]; out[o + 1] = plte[p * 3 + 1]; out[o + 2] = plte[p * 3 + 2];
        out[o + 3] = trns && p < trns.length ? trns[p] : 255;
      } else {
        out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2];
        out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
      }
    }
    cur.copy(prev);
  }
  return { w, h, data: out };
}
// ---- PNG encode (RGBA, filter 0) ----
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = ~0;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---- cells: source RGBA -> { w, h, idx } index grids (0 transparent) ----
function cellIndex(img, cell) {
  const idx = new Uint8Array(32 * 48); // 119/207 exceed Int8 range — unsigned on purpose
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 256 + cell * 32 + x) * 4;
    if (img.data[i + 3] < 128) continue;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (r === 0xab && g === 0x47 && b === 0xbc) idx[y * 32 + x] = PURPLE;
    else if (r === 0xff && g === 0xde && b === 0x69) idx[y * 32 + x] = YELLOW;
    else throw new Error(`unexpected colour ${r},${g},${b} at cell ${cell} (${x},${y})`);
  }
  return idx;
}
const placed = (cell) => {
  const g = new Uint8Array(GRID * GRID);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
    const v = cell[y * 32 + x];
    if (v) g[(DY + y) * GRID + DX + x] = v;
  }
  return g;
};

// ---- build ----
const walkCells = {}, standCells = [];
for (const d of SHEETS) {
  const img = decodePNG(readFileSync(join(SRC, `walk-${d}.png`)));
  if (img.w !== 256 || img.h !== 48) throw new Error(`walk-${d}: ${img.w}x${img.h}, expected 256x48`);
  walkCells[d] = Array.from({ length: 8 }, (_, f) => cellIndex(img, f));
}
{
  const img = decodePNG(readFileSync(join(SRC, 'standing.png')));
  if (img.w !== 256 || img.h !== 48) throw new Error(`standing: ${img.w}x${img.h}, expected 256x48`);
  for (let c = 0; c < 8; c++) standCells.push(cellIndex(img, c));
}

const sprites = [], animations = [];
for (const d of SHEETS) {
  for (let f = 0; f < 8; f++) {
    const name = `walk-${d}-f${f}`;
    sprites.push({ name, layers: [{ name: 'layer-0', pixels: [...placed(walkCells[d][f])] }] });
  }
}
STAND_ORDER.forEach((d, c) => {
  sprites.push({ name: `stand-${d}`, layers: [{ name: 'layer-0', pixels: [...placed(standCells[c])] }] });
});
// same interleaved order the in-page build produces: walk-d then stand-d per direction
for (const d of SHEETS) {
  animations.push({ name: `walk-${d}`, frames: Array.from({ length: 8 }, (_, f) => ({ sprite: `walk-${d}-f${f}`, ms: MS_WALK })) });
  animations.push({ name: `stand-${d}`, frames: [{ sprite: `stand-${d}`, ms: MS_STAND }] });
}

const json = JSON.stringify({ name: 'anthro8', grid: GRID, sprites, animations });
writeFileSync(OUT_JSON, json);
console.log(`wrote ${OUT_JSON} (${(json.length / 1024).toFixed(0)} KB, ${sprites.length} sprites, ${animations.length} animations)`);

// ---- review artifacts: one contact sheet + one strip per family ----
mkdirSync(OUT_ART, { recursive: true });
const blit = (rgba, W, idx, ox, oy, scale) => {
  for (let y = 0; y < 48; y++) for (let x = 0; x < 32; x++) {
    const v = idx[y * 32 + x];
    if (!v) continue;
    const [r, g, b] = RGB[v];
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
      const o = ((oy + y * scale + sy) * W + ox + x * scale + sx) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
};
const CELL = 32 * 4, GAP = 8; // scale 4
const strip = (cells, name) => {
  const W = cells.length * CELL + (cells.length + 1) * GAP, H = CELL + 2 * GAP;
  const rgba = Buffer.alloc(W * H * 4);
  cells.forEach((c, i) => blit(rgba, W, c, GAP + i * CELL, GAP, 4));
  const p = join(OUT_ART, name);
  writeFileSync(p, encodePNG(W, H, rgba));
  console.log('wrote ' + p);
};
strip(standCells, 'anthro8-standing.png');
for (const d of SHEETS) strip(walkCells[d], `anthro8-walk-${d}.png`);
{
  const rows = [standCells, ...SHEETS.map(d => walkCells[d])];
  const W = 8 * CELL + 9 * GAP, H = rows.length * (CELL + GAP) + GAP;
  const rgba = Buffer.alloc(W * H * 4);
  rows.forEach((cells, r) => cells.forEach((c, i) => blit(rgba, W, c, GAP + i * CELL, GAP + r * (CELL + GAP), 4)));
  const p = join(OUT_ART, 'anthro8-contact.png');
  writeFileSync(p, encodePNG(W, H, rgba));
  console.log('wrote ' + p);
}
