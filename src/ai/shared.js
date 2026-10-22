/* Shared helpers for the lazy AI chunk (src/ai/*). Pure functions — unit-tested directly. */
export const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } };
export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const extOf = (p) => { const m = /\.([\w]+)$/.exec(String(p || '')); return m ? m[1].toLowerCase() : ''; };

const PATH_RE = /^[\w@.\-\u0600-\u06FF][\w@.\-/\u0600-\u06FF ]*\.[\w]{1,10}$|^(Dockerfile|Makefile|Procfile|\.env\.example|\.gitignore|\.prettierrc|\.eslintrc|\.editorconfig|\.nvmrc)$/;
const cleanPath = (p) => String(p || '').trim().replace(/^[`*"'\s]+|[`*"':\s]+$/g, '').replace(/^\.\//, '').replace(/^\/+/, '');
export const isSafePath = (p) => !!p && p.length < 200 && !p.split('/').includes('..') && PATH_RE.test(p.split('/').pop()) && !/[<>|]/.test(p);

/**
 * Parse files out of a model reply. Supported forms:
 *   ```js // File: src/a.js        ```js [src/a.js]        ```js title="src/a.js"
 *   ### src/a.js  (or **src/a.js**, `src/a.js`:) on the line right before a fence
 *   first line inside the fence: // file: src/a.js  |  # file: a.py  |  <!-- file: index.html -->
 */
export function parseFileBlocks(text) {
    const out = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(String(text || '')))) {
        const info = m[1].trim();
        let body = m[2];
        let path = '';
        const lang = (info.split(/[\s[{]/)[0] || '').toLowerCase();
        const im = /\[(?:الملف:\s*)?([^\]]+)\]|(?:title|file|filename|path)=["']?([^"'\s]+)|\/\/\s*File:\s*(\S+)|#\s*File:\s*(\S+)/i.exec(info);
        if (im) path = im[1] || im[2] || im[3] || im[4];
        if (!path) {
            const first = body.split('\n')[0];
            const fm = /^\s*(?:\/\/|#|--|\/\*|<!--)\s*(?:file(?:name)?|path|الملف)\s*:\s*([^\s*>]+)/i.exec(first);
            if (fm) { path = fm[1]; body = body.slice(first.length + 1); }
        }
        if (!path) {
            const before = String(text).slice(0, m.index).replace(/\s+$/, '');
            const lastLine = before.slice(before.lastIndexOf('\n') + 1);
            const hm = /^(?:#{1,6}\s*|\*\*|[-*]\s+|\d+\.\s+)?(?:(?:ملف|File|file)\s*:?\s*)?`?([\w@.\-/\u0600-\u06FF]+\.[\w]{1,10}|Dockerfile|Makefile)`?\**\s*:?\s*$/.exec(lastLine.trim());
            if (hm) path = hm[1];
        }
        path = cleanPath(path);
        if (path && isSafePath(path)) {
            const prev = out.findIndex(f => f.path === path);
            const file = { path, content: body.replace(/\n$/, '') + '\n', lang: lang || extOf(path) };
            if (prev >= 0) out[prev] = file; else out.push(file);
        }
    }
    return out;
}

/** First JSON object/array in a reply (fenced or bare). */
export function extractJSON(text) {
    const s = String(text || '');
    const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(s);
    const tryParse = (t) => { try { return JSON.parse(t); } catch (e) { return undefined; } };
    if (fenced) { const v = tryParse(fenced[1].trim()); if (v !== undefined) return v; }
    for (const [open, close] of [['{', '}'], ['[', ']']]) {
        const i = s.indexOf(open);
        if (i < 0) continue;
        let depth = 0, inStr = false, esc = false;
        for (let j = i; j < s.length; j++) {
            const c = s[j];
            if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
            if (c === '"') inStr = true;
            else if (c === open) depth++;
            else if (c === close && --depth === 0) { const v = tryParse(s.slice(i, j + 1)); if (v !== undefined) return v; break; }
        }
    }
    return null;
}

/** Fill {{var}} placeholders; returns the list of missing names too. */
export function fillTemplate(tpl, vars = {}) {
    const missing = [];
    const text = String(tpl || '').replace(/\{\{\s*([\w\u0600-\u06FF-]+)\s*\}\}/g, (_, k) => {
        if (vars[k] == null || vars[k] === '') { if (!missing.includes(k)) missing.push(k); return ''; }
        return String(vars[k]);
    });
    return { text, missing };
}
export const templateVars = (tpl) => Array.from(new Set((String(tpl || '').match(/\{\{\s*([\w\u0600-\u06FF-]+)\s*\}\}/g) || []).map(x => x.replace(/[{}\s]/g, ''))));

/** Strip <think>…</think> blocks a model printed into its answer. */
export function splitThinking(content) {
    const s = String(content || '');
    const parts = [];
    const rest = s.replace(/<(think|thinking|reasoning)>([\s\S]*?)(<\/\1>|$)/gi, (_, __, body) => { parts.push(body.trim()); return ''; });
    return { reasoning: parts.join('\n\n').trim(), content: parts.length ? rest.replace(/^\s+/, '') : s };
}
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
