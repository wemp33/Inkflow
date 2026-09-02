// Draws the Inkflow mark as geometry: a serif capital "I" in ink on the cream
// ground of the app, so every icon size rasterises exactly, with no font and
// no source image. The same constants emit the SVG path used in index.html.
//
//   node tools/gen-icons.mjs
//
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const GROUND = [0xf7, 0xf2, 0xe8]; // cream, same as --paper in index.html
const INK    = [0x1d, 0x1a, 0x17]; // near-black, same as --ink

// ---------------------------------------------------------------- geometry --
// Units of H, the glyph height. The glyph is centred on (0,0); y grows down.
const STEM    = 0.220;  // stem width
const SERIF_W = 0.640;  // serif width
const SERIF_T = 0.130;  // serif thickness
const BRACKET = 0.060;  // how far the bracket fillet reaches from the stem
const GLYPH_W = SERIF_W;
const GLYPH_H = 1.0;

// Concave quarter-circle fillet between stem and serif.
const inBracket = (x, y) => {
  const ax = Math.abs(x) - STEM / 2;              // distance out from the stem
  if (ax < 0 || ax > BRACKET) return false;
  const top = -0.5 + SERIF_T, bot = 0.5 - SERIF_T;
  for (const [edge, dir] of [[top, 1], [bot, -1]]) {
    const ay = (y - edge) * dir;                  // distance in from the serif
    if (ay < 0 || ay > BRACKET) continue;
    const dx = BRACKET - ax, dy = BRACKET - ay;   // outside the circle = filled
    if (dx * dx + dy * dy >= BRACKET * BRACKET) return true;
  }
  return false;
};

const inGlyph = (x, y) => {
  if (Math.abs(y) > GLYPH_H / 2 || Math.abs(x) > GLYPH_W / 2) return false;
  if (Math.abs(x) <= STEM / 2) return true;                            // stem
  if (Math.abs(y) >= 0.5 - SERIF_T) return true;                       // serifs
  return inBracket(x, y);
};

// SVG path from the same constants (fillets as quarter arcs), in a 0..1 box.
export function svgPath() {
  const s = STEM / 2, w = SERIF_W / 2, t = SERIF_T, b = BRACKET;
  const X = v => (v + 0.5).toFixed(4), Y = v => (v + 0.5).toFixed(4);
  const yT = -0.5 + t, yB = 0.5 - t, r = b.toFixed(4);
  return [
    `M${X(-w)} ${Y(-0.5)} H${X(w)} V${Y(yT)} H${X(s + b)}`,
    `A${r} ${r} 0 0 0 ${X(s)} ${Y(yT + b)}`,
    `V${Y(yB - b)} A${r} ${r} 0 0 0 ${X(s + b)} ${Y(yB)}`,
    `H${X(w)} V${Y(0.5)} H${X(-w)} V${Y(yB)} H${X(-s - b)}`,
    `A${r} ${r} 0 0 0 ${X(-s)} ${Y(yB - b)}`,
    `V${Y(yT + b)} A${r} ${r} 0 0 0 ${X(-s - b)} ${Y(yT)}`,
    `H${X(-w)} Z`,
  ].join(' ');
}

// ------------------------------------------------------------- rasteriser --
const SS = 4;

function render(size, heightFraction) {
  const H = size * heightFraction;
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { px[i * 3] = GROUND[0]; px[i * 3 + 1] = GROUND[1]; px[i * 3 + 2] = GROUND[2]; }
  const step = 1 / SS;
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (pxi + (sx + 0.5) * step - size / 2) / H;
        const y = (py + (sy + 0.5) * step - size / 2) / H;
        if (inGlyph(x, y)) hits++;
      }
      if (!hits) continue;
      const c = hits / (SS * SS), o = (py * size + pxi) * 3;
      for (let k = 0; k < 3; k++) px[o + k] = Math.round(GROUND[k] + (INK[k] - GROUND[k]) * c);
    }
  }
  return px;
}

// -------------------------------------------------------------- PNG writer --
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function toPng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = size * 3, raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// -------------------------------------------------------------------- emit --
const JOBS = [
  ['icons/icon-180.png', 180, 0.62],
  ['icons/icon-192.png', 192, 0.62],
  ['icons/icon-512.png', 512, 0.62],
  ['icons/icon-maskable-192.png', 192, 0.48],
  ['icons/icon-maskable-512.png', 512, 0.48],
];
mkdirSync(join(ROOT, 'icons'), { recursive: true });
for (const [rel, size, frac] of JOBS) {
  const png = toPng(size, render(size, frac));
  writeFileSync(join(ROOT, rel), png);
  console.log(`${rel}  ${size}x${size}  ${png.length} bytes`);
}
console.log('svg path:', svgPath());
