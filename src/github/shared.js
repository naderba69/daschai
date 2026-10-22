/* Shared helpers for the GitHub Pro chunk (Sprint 9). Pure functions are unit-tested through `lib`. */

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** onclick="…" that calls app[method](...values) without quoting pitfalls (values stored by index). */
export const call = (app, method, ...vals) => `app.ghCall('${method}'${vals.map(v => ',' + app.ghRef(v)).join('')})`;

export const encRef = (b) => String(b).split('/').map(encodeURIComponent).join('/');
export const encPath = (p) => String(p).replace(/^[/\\]+/, '').split('/').map(encodeURIComponent).join('/');

export const fmtBytes = (n) => {
    n = +n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
};
export const fmtNum = (n) => (+n || 0).toLocaleString('en-US');
export const shortSha = (s) => String(s || '').slice(0, 7);
export const headline = (msg) => String(msg || '').split('\n')[0];

/** Valid git ref name (branch / tag) — mirrors git check-ref-format essentials. */
export function isValidRefName(name) {
    const n = String(name || '');
    if (!n || n.length > 200) return false;
    if (/^[/.-]|[/.]$|\.\.|@\{|\/\/|[\s~^:?*[\\\x00-\x1f\x7f]|\.lock(\/|$)/.test(n)) return false;
    return n !== '@';
}

/** Repo name rules on GitHub: letters, digits, - _ . (max 100). */
export const isValidRepoName = (n) => /^[A-Za-z0-9._-]{1,100}$/.test(String(n || '')) && !/^\.+$/.test(n);

/**
 * Parse "owner/repo", https://github.com/owner/repo(.git)(/tree/branch/…), git@github.com:owner/repo.git,
 * gitlab.com/group/sub/project, bitbucket.org/ws/repo → { host, owner, repo, path, branch }.
 */
export function parseRepoInput(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    let host = 'github.com';
    const ssh = /^git@([^:]+):(.+?)(?:\.git)?\/?$/.exec(s);
    if (ssh) { host = ssh[1]; s = ssh[2]; } else {
        const m = /^(?:https?:\/\/)?(?:www\.)?((?:github|gitlab|bitbucket)\.(?:com|org))\/(.+)$/i.exec(s);
        if (m) { host = m[1].toLowerCase(); s = m[2]; } else if (/^https?:\/\//i.test(s)) return null;
    }
    s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
    let branch = '';
    if (host === 'github.com') {
        const t = /^([^/]+)\/([^/]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+).*)?$/.exec(s);
        if (!t) return null;
        branch = t[3] ? decodeURIComponent(t[3]) : '';
        return { host, owner: t[1], repo: t[2], path: `${t[1]}/${t[2]}`, branch };
    }
    if (host === 'gitlab.com') {
        const [proj, rest] = s.split('/-/');
        const parts = proj.replace(/\.git$/, '').split('/').filter(Boolean);
        if (parts.length < 2) return null;
        const tb = rest && /^(?:tree|blob)\/([^/]+)/.exec(rest);
        return { host, owner: parts.slice(0, -1).join('/'), repo: parts[parts.length - 1], path: parts.join('/'), branch: tb ? decodeURIComponent(tb[1]) : '' };
    }
    if (host === 'bitbucket.org') {
        const t = /^([^/]+)\/([^/]+?)(?:\.git)?(?:\/src\/([^/]+).*)?$/.exec(s);
        if (!t) return null;
        return { host, owner: t[1], repo: t[2], path: `${t[1]}/${t[2]}`, branch: t[3] ? decodeURIComponent(t[3]) : '' };
    }
    return null;
}

/** "#12", "fixes #34", "GH-5" → [12, 34, 5] (deduped, in order). */
export function issueRefs(text) {
    const out = [];
    for (const m of String(text || '').matchAll(/(?:^|[\s(,])(?:#|GH-)(\d{1,7})\b/gi)) { const n = +m[1]; if (!out.includes(n)) out.push(n); }
    return out;
}

/** Linkify #123 references in an (already escaped) commit message. */
export function linkIssues(app, escapedText) {
    return escapedText.replace(/(^|[\s(,])#(\d{1,7})\b/g, (all, pre, n) => `${pre}<a href="#" class="ghx-issue-link" onclick="event.preventDefault(); event.stopPropagation(); app.ghOpenIssue(${+n})">#${n}</a>`);
}

/** Group items by local day (YYYY-MM-DD) preserving order. */
export function groupByDay(items, dateOf) {
    const groups = [];
    let cur = null;
    for (const it of items) {
        const d = new Date(dateOf(it));
        const key = isNaN(d) ? 'unknown' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!cur || cur.day !== key) { cur = { day: key, items: [] }; groups.push(cur); }
        cur.items.push(it);
    }
    return groups;
}

export function toCSV(rows) {
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return rows.map(r => r.map(cell).join(',')).join('\n') + '\n';
}

/** Small SVG bar chart (LTR). values: number[]; labels optional (title tooltips). */
export function barsSVG(values, { w = 640, h = 120, color = 'var(--success, #34d399)', labels = [], highlightFrom = -1, highlightColor = '#60a5fa' } = {}) {
    const n = values.length || 1;
    const max = Math.max(1, ...values);
    const bw = w / n;
    const bars = values.map((v, i) => {
        const bh = Math.max(v > 0 ? 2 : 0, (v / max) * (h - 14));
        const fill = highlightFrom >= 0 && i >= highlightFrom ? highlightColor : color;
        return `<rect x="${(i * bw + bw * 0.12).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(1, bw * 0.76).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${fill}"${highlightFrom >= 0 && i >= highlightFrom ? ' opacity="0.65"' : ''}><title>${esc(labels[i] != null ? labels[i] + ': ' : '')}${v}</title></rect>`;
    }).join('');
    return `<svg class="ghx-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="chart" dir="ltr">${bars}<text x="2" y="10" class="ghx-chart-max">${max}</text></svg>`;
}

/** Horizontal bar list (label, value) as HTML. */
export function hbarsHTML(rows, { max, unit = '' } = {}) {
    const m = max || Math.max(1, ...rows.map(r => r[1]));
    return `<div class="ghx-hbars">${rows.map(([label, v, extra]) => `<div class="ghx-hbar"><span class="ghx-hbar-label" dir="ltr" title="${esc(label)}">${esc(label)}</span><span class="ghx-hbar-track"><i style="width:${(v / m * 100).toFixed(1)}%"></i></span><b>${fmtNum(v)}${unit}</b>${extra ? `<small>${extra}</small>` : ''}</div>`).join('')}</div>`;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Run async fn over items with limited concurrency, preserving order. */
export async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

export const b64FromBytes = (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
};
export const bytesFromB64 = (b64) => { const bin = atob(String(b64).replace(/\s+/g, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
