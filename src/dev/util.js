/* Shared helpers for the Developer Lab chunk (Sprint 13). Pure where possible — unit-tested through `lib`. */
export { esc, lsGet, lsSet, uid, clamp, call, btn, pbtn, chip, card, empty, field, area, select, val, setHTML, sleep, extOf, baseName, dirName, win, fmtBytes, utf8, fromUtf8, bytesToB64, b64ToBytes, bytesToB64url } from '../media/shared.js';
export { callRaw, fmtDate, fmtDT, ago, pct, groupBy, textFiles, bar, stats, table, globToRe, matchGlob } from '../team/util.js';
export { fmtMs, download, json, sparkline } from '../perf/util.js';
import { esc } from '../media/shared.js';
import { globToRe } from '../team/util.js';

/** A checkbox row. */
export const toggle = (id, label, checked, attrs = '') => `<label class="pfx-toggle"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${attrs}><span>${label}</span></label>`;
/** <pre> block. */
export const pre = (text, cls = '') => `<pre class="pfx-pre dvx-pre ${cls}" dir="ltr">${esc(text)}</pre>`;
export const code = (s) => `<code dir="ltr">${esc(s)}</code>`;
/** Comma/space separated globs → matcher (empty list → match all). */
export function globMatcher(list) {
    const pats = String(list || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (!pats.length) return () => true;
    const res = pats.map(globToRe);
    return (p) => res.some(r => r.test(String(p || '').replace(/^\/+/, '')));
}
/** Case-insensitive natural compare. */
export const natCmp = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
/** Line/column of a string offset. */
export function lineCol(text, idx) {
    let line = 1, last = 0;
    for (let i = 0; i < idx && i < text.length; i++) if (text.charCodeAt(i) === 10) { line++; last = i + 1; }
    return { line, col: idx - last + 1 };
}
/** Myers-free LCS line diff (O(n·m) bounded) → ops [{t:'=', '+', '-', a, b, text}]. */
export function lineDiff(aText, bText, max = 4e6) {
    const a = String(aText ?? '').split('\n'), b = String(bText ?? '').split('\n');
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const A = a.slice(s, ea), B = b.slice(s, eb), ops = [];
    for (let i = 0; i < s; i++) ops.push({ t: '=', a: i + 1, b: i + 1, text: a[i] });
    if (A.length * B.length > max) {
        A.forEach((t, i) => ops.push({ t: '-', a: s + i + 1, text: t }));
        B.forEach((t, i) => ops.push({ t: '+', b: s + i + 1, text: t }));
    } else {
        const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
        for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
        let i = 0, j = 0;
        while (i < n || j < m) {
            if (i < n && j < m && A[i] === B[j]) { ops.push({ t: '=', a: s + i + 1, b: s + j + 1, text: A[i] }); i++; j++; }
            else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { ops.push({ t: '+', b: s + j + 1, text: B[j] }); j++; }
            else { ops.push({ t: '-', a: s + i + 1, text: A[i] }); i++; }
        }
    }
    for (let i = ea, j = eb; i < a.length; i++, j++) ops.push({ t: '=', a: i + 1, b: j + 1, text: a[i] });
    return ops;
}
export const diffCounts = (ops) => ({ add: ops.filter(o => o.t === '+').length, del: ops.filter(o => o.t === '-').length });
/** Side-by-side diff table (context lines collapsed beyond `ctx`). */
export function diffHTML(ops, ctx = 3) {
    const keep = new Set();
    ops.forEach((o, i) => { if (o.t !== '=') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep.add(k); });
    if (!keep.size) return '<div class="gh-empty">لا توجد فروق</div>';
    let html = '', gap = false;
    ops.forEach((o, i) => {
        if (!keep.has(i)) { if (!gap) { html += '<tr class="dvx-gap"><td colspan="3">⋯</td></tr>'; gap = true; } return; }
        gap = false;
        html += `<tr class="dvx-d${o.t === '+' ? 'add' : o.t === '-' ? 'del' : 'eq'}"><td class="dvx-ln">${o.a || ''}</td><td class="dvx-ln">${o.b || ''}</td><td dir="ltr"><span class="dvx-sign">${o.t === '=' ? ' ' : o.t}</span>${esc(o.text)}</td></tr>`;
    });
    return `<div class="dvx-diffwrap"><table class="dvx-diff">${html}</table></div>`;
}
/** Simple word-casing helpers used by templates and folder refactors. */
export const words = (s) => String(s || '').replace(/\.[^.]+$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9\u0600-\u06FF]+/).filter(Boolean);
export const CASES = {
    kebab: (s) => words(s).map(w => w.toLowerCase()).join('-'),
    snake: (s) => words(s).map(w => w.toLowerCase()).join('_'),
    camel: (s) => words(s).map((w, i) => i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join(''),
    pascal: (s) => words(s).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(''),
    upper: (s) => words(s).map(w => w.toUpperCase()).join('_')
};
