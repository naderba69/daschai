/* PNG app icons without native deps (Sprint 12 — #941/#942 TWA + iOS need real PNG icons).
   Rasterises the ✦ logo (4-point star on a rounded dark tile) with 4× supersampling and encodes PNG with zlib. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
function encodePNG(w, h, rgba) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** Point-in-polygon (even-odd). */
function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
}
/** 4-point star with concave sides (sampled curve), centred at (cx, cy), outer radius r. */
function starPoly(cx, cy, r) {
    const pts = [], tips = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let k = 0; k < 4; k++) {
        const [ax, ay] = tips[k], [bx, by] = tips[(k + 1) % 4];
        for (let s = 0; s < 16; s++) { // quadratic curve tip → tip pulled towards the centre
            const t = s / 16, u = 1 - t, qx = (ax + bx) * 0.16, qy = (ay + by) * 0.16;
            pts.push([cx + r * (u * u * ax + 2 * u * t * qx + t * t * bx), cy + r * (u * u * ay + 2 * u * t * qy + t * t * by)]);
        }
    }
    return pts;
}
function renderIcon(size, { maskable = false } = {}) {
    const S = 4, rgba = Buffer.alloc(size * size * 4);
    const radius = maskable ? 0 : size * 0.22, starR = size * (maskable ? 0.3 : 0.38);
    const poly = starPoly(size / 2, size / 2, starR);
    const bg = [19, 19, 20], c1 = [138, 180, 248], c2 = [197, 138, 249];
    const inRound = (x, y) => {
        if (!radius) return true;
        const dx = Math.max(radius - x, 0, x - (size - radius)), dy = Math.max(radius - y, 0, y - (size - radius));
        return dx * dx + dy * dy <= radius * radius;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let a = 0, st = 0;
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
            const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S;
            if (inRound(px, py)) { a++; if (inside(poly, px, py)) st++; }
        }
        const t = (x + y) / (2 * size), cov = st / (S * S), alpha = a / (S * S);
        const col = [0, 1, 2].map(i => Math.round(bg[i] * (1 - cov / Math.max(alpha, 1e-9)) + (c1[i] * (1 - t) + c2[i] * t) * (cov / Math.max(alpha, 1e-9))));
        const o = (y * size + x) * 4;
        rgba[o] = col[0]; rgba[o + 1] = col[1]; rgba[o + 2] = col[2]; rgba[o + 3] = Math.round(alpha * 255);
    }
    return encodePNG(size, size, rgba);
}
const ICONS = [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180], ['badge-96.png', 96]];
/** Writes icons/ once (they are committed); returns the list of files. */
function ensureIcons(root, force = false) {
    const dir = path.join(root, 'icons');
    fs.mkdirSync(dir, { recursive: true });
    const out = [];
    for (const [name, size, maskable] of ICONS) {
        const f = path.join(dir, name);
        if (force || !fs.existsSync(f)) fs.writeFileSync(f, renderIcon(size, { maskable }));
        out.push('icons/' + name);
    }
    return out;
}
module.exports = { ensureIcons, renderIcon, encodePNG, crc32 };
if (require.main === module) console.log(ensureIcons(path.join(__dirname, '..'), process.argv.includes('--force')));
