/* Shared helpers for the Performance & Mobile chunk (Sprint 12). Pure where possible — unit-tested through `lib`. */
export { esc, lsGet, lsSet, uid, clamp, call, btn, pbtn, chip, card, empty, field, area, select, val, setHTML, sleep, extOf, baseName, win, fmtBytes, bytesToB64, b64ToBytes, utf8, fromUtf8, sha256Hex, newCanvas, canvasToBlob, ctx2d, fileInput, filesOf, blobBytes, dataUrlToBytes, bytesToDataUrl, isTextEntry, mimeOf, kindOf } from '../media/shared.js';
export { callRaw, DAY, dayKey, fmtDate, fmtDT, ago, pct, avg, median, groupBy, textFiles, bar, stats, table, mdTable, sevBadge } from '../team/util.js';
import { esc } from '../media/shared.js';

export const fmtMs = (ms) => (ms == null || isNaN(ms) ? '—' : ms >= 1000 ? (ms / 1000).toFixed(2) + ' ث' : Math.round(ms) + ' ms');
export const percentile = (arr, p) => {
    const a = (arr || []).filter(x => x != null && !isNaN(x)).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
};
/** Least squares y = a + b·x → { a, b, r2 } */
export function linreg(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return { a: ys[0] || 0, b: 0, r2: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; syy += ys[i] * ys[i]; }
    const d = n * sxx - sx * sx;
    const b = d ? (n * sxy - sx * sy) / d : 0, a = (sy - b * sx) / n;
    const vy = n * syy - sy * sy;
    const r2 = d && vy ? Math.pow(n * sxy - sx * sy, 2) / (d * vy) : 0;
    return { a, b, r2 };
}
/** Inline SVG sparkline. */
export function sparkline(values, { w = 260, h = 48, color = '#8ab4f8', fill = true } = {}) {
    const v = (values || []).map(Number).filter(x => !isNaN(x));
    if (v.length < 2) return '<svg class="pfx-spark" width="' + w + '" height="' + h + '"></svg>';
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const pts = v.map((y, i) => [(i / (v.length - 1)) * (w - 2) + 1, h - 2 - ((y - min) / span) * (h - 4)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return `<svg class="pfx-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${fill ? `<path d="${d} L${w - 1} ${h} L1 ${h} Z" fill="${color}" opacity=".15"/>` : ''}<path d="${d}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}
/** Rating badge for a metric value against [good, poor] thresholds. */
export const rate = (v, [good, poor]) => (v == null ? 'na' : v <= good ? 'good' : v <= poor ? 'ni' : 'poor');
export const rateBadge = (v, th, fmt = (x) => x) => { const r = rate(v, th); return `<span class="pfx-rate pfx-${r}">${v == null ? '—' : esc(fmt(v))}</span>`; };
export const RATE_LABEL = { good: 'جيد', ni: 'يحتاج تحسين', poor: 'ضعيف', na: 'غير متاح' };
/** Download text/blob through the app helper. */
export const download = (app, name, content, type = 'text/plain') => app.downloadBlob(content instanceof Blob ? content : new Blob([content], { type }), name);
export const json = (x) => JSON.stringify(x, null, 2);
/** Semver compare (major.minor.patch, ignores pre-release tags) → -1 | 0 | 1 */
export function semverCmp(a, b) {
    const pa = String(a || '0').replace(/^[^\d]*/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0), pb = String(b || '0').replace(/^[^\d]*/, '').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1; }
    return 0;
}
export const semverDiff = (from, to) => {
    const a = String(from || '').replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0), b = String(to || '').replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
    return b[0] > a[0] ? 'major' : b[1] > a[1] ? 'minor' : b[2] > a[2] ? 'patch' : 'none';
};
