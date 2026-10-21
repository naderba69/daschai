/* Shared helpers for the Team & Analytics chunk (Sprint 11). Pure where possible — unit-tested through `lib`. */
export { esc, lsGet, lsSet, uid, clamp, call, btn, pbtn, chip, card, empty, field, area, select, val, setHTML, bytesToB64, b64ToBytes, bytesToB64url, utf8, fromUtf8, sha256Hex, sleep, extOf, baseName, win } from '../media/shared.js';
import { esc } from '../media/shared.js';


/** onclick/onchange call with a raw JS expression appended: callRaw('tmSetRole', ['bob'], 'this.value') */
export const callRaw = (method, args, raw) => esc(`app.${method}(${[...args.map(a => JSON.stringify(a === undefined ? null : a)), raw].join(',')})`);
export const DAY = 864e5;
export const iso = (t) => new Date(t).toISOString();
export const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
export const fmtDate = (t) => { try { return new Date(t).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return dayKey(t); } };
export const fmtDT = (t) => { try { return new Date(t).toLocaleString('ar', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso(t); } };
export const ago = (t, now = Date.now()) => {
    const s = Math.max(0, Math.round((now - new Date(t).getTime()) / 1000));
    if (s < 60) return 'الآن';
    if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
    if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
    return `قبل ${Math.round(s / 86400)} يوم`;
};
export const hours = (ms) => Math.round((ms || 0) / 36e5 * 100) / 100;
export const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
export const avg = (arr) => (arr.length ? arr.reduce((n, x) => n + x, 0) / arr.length : 0);
export const median = (arr) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const groupBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); (m[k] = m[k] || []).push(x); return m; }, {});
export const textFiles = (map) => Array.from(map || []).filter(([, f]) => f && typeof f.content === 'string' && !f.dataUrl && !f.binary);

/** Horizontal CSS bar. */
export const bar = (value, max, label = '', color = '') => `<div class="tmx-bar" title="${esc(label)}"><div style="width:${max ? Math.max(2, Math.round(value / max * 100)) : 0}%${color ? ';background:' + color : ''}"></div></div>`;
/** Stats grid: [[label, value], …] */
export const stats = (pairs) => `<div class="fmx-stats">${pairs.map(([l, v]) => `<div><b>${v}</b><small>${l}</small></div>`).join('')}</div>`;
/** Simple table: headers + rows of (already escaped) cells. */
export const table = (headers, rows, cls = '') => `<table class="fmx-table ${cls}"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
export const mdTable = (headers, rows) => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map(r => `| ${r.map(c => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`).join('\n')}`;
export const sevBadge = (s) => `<span class="tmx-sev tmx-sev-${esc(s)}">${{ high: 'مرتفع', medium: 'متوسط', low: 'منخفض', info: 'معلومة' }[s] || esc(s)}</span>`;

/** Glob → RegExp for team file rules (supports **, *, ?, trailing / for folders). */
export function globToRe(glob) {
    let g = String(glob || '').trim().replace(/^\/+/, '');
    if (!g) return /^$/;
    if (g.endsWith('/')) g += '**';
    let re = '';
    for (let i = 0; i < g.length; i++) {
        const c = g[i];
        if (c === '*') { if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; } else re += '[^/]*'; }
        else if (c === '?') re += '[^/]';
        else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    // A pattern without a slash matches the basename anywhere (like .gitignore / CODEOWNERS)
    return g.includes('/') ? new RegExp('^' + re + '$') : new RegExp('(^|/)' + re + '$');
}
export const matchGlob = (glob, path) => globToRe(glob).test(String(path || '').replace(/^\/+/, ''));

/** Marker comments embedded in GitHub issue bodies/comments: <!--oxpoll {...}--> */
export const marker = (kind, data) => `<!--ox${kind} ${JSON.stringify(data).replace(/--/g, '-\\u002d')}-->`;
export function readMarker(kind, text) {
    const m = new RegExp(`<!--ox${kind} ([\\s\\S]*?)-->`).exec(String(text || ''));
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
}
export const stripMarkers = (text) => String(text || '').replace(/<!--ox\w+ [\s\S]*?-->/g, '').trim();
