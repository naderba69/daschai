/**
 * OX-Alpha Studio — code intelligence helpers (pure functions, no DOM/CodeMirror).
 * Heuristic, regex/tokeniser based: fast, offline, language-agnostic enough for a
 * browser IDE. Not a type checker — callers present results as suggestions.
 */

export const extOf = (p) => { const n = String(p || '').split('/').pop(); return n.includes('.') ? n.split('.').pop().toLowerCase() : ''; };
export const baseName = (p) => String(p || '').split('/').pop();
export const dirName = (p) => { const i = String(p || '').lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };

const JS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte'];
const CLIKE = [...JS, 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'kt', 'kts', 'swift', 'php', 'dart', 'scala', 'groovy'];
const HASH = ['py', 'rb', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'r', 'pl', 'ps1', 'dockerfile', 'env', 'mk', 'cmake', 'conf', 'ini'];
export const isJS = (p) => JS.includes(extOf(p));
export const isPy = (p) => extOf(p) === 'py';
export const isCodeFile = (p) => CLIKE.includes(extOf(p)) || HASH.includes(extOf(p)) || ['css', 'scss', 'less', 'html', 'htm', 'sql', 'lua'].includes(extOf(p));

// ====================================================================== MASKING
/**
 * Replace the *contents* of comments and strings with spaces (newlines kept) so that
 * identifier searches don't match inside them. Template literal `${…}` stays visible.
 */
export function maskCode(text, path) {
    const ext = extOf(path);
    const out = text.split('');
    const n = text.length;
    const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
    const isHtml = ['html', 'htm', 'xml', 'svg', 'md'].includes(ext);
    if (isHtml) {
        text.replace(/<!--[\s\S]*?-->/g, (m, i) => { blank(i, i + m.length); return m; });
        return out.join('');
    }
    const hashComments = HASH.includes(ext);
    const slashComments = !hashComments || ext === 'php';
    const dashComments = ['sql', 'lua'].includes(ext);
    const py = ext === 'py';
    const backtick = JS.includes(ext) || ext === 'go';
    let i = 0;
    const tplStack = [];
    while (i < n) {
        const c = text[i], d = text[i + 1];
        if (tplStack.length && c === '}' && tplStack[tplStack.length - 1] === 0) {
            tplStack.pop();
            // resume template string after ${ … }
            i = scanTemplate(i + 1);
            continue;
        }
        if (tplStack.length) { if (c === '{') tplStack[tplStack.length - 1]++; else if (c === '}') tplStack[tplStack.length - 1]--; }
        if (slashComments && c === '/' && d === '/') { const e = text.indexOf('\n', i); const end = e < 0 ? n : e; blank(i + 2, end); i = end; continue; }
        if ((slashComments || ext === 'css' || ext === 'scss' || ext === 'less' || dashComments) && c === '/' && d === '*') { const e = text.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i + 2, end - 2); i = end; continue; }
        if ((hashComments || ext === 'php') && c === '#' && !(ext === 'php' && d === '[')) { const e = text.indexOf('\n', i); const end = e < 0 ? n : e; blank(i + 1, end); i = end; continue; }
        if (dashComments && c === '-' && d === '-') { const e = text.indexOf('\n', i); const end = e < 0 ? n : e; blank(i + 2, end); i = end; continue; }
        if (py && (text.startsWith('"""', i) || text.startsWith("'''", i))) { const q = text.slice(i, i + 3); const e = text.indexOf(q, i + 3); const end = e < 0 ? n : e + 3; blank(i + 3, end - 3); i = end; continue; }
        if (backtick && c === '`') { i = scanTemplate(i + 1); continue; }
        if (c === '"' || (c === "'" && !(ext === 'rs' && /[a-z_]/i.test(d || '') && text[i + 2] !== "'"))) {
            let j = i + 1;
            while (j < n && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') j++; j++; }
            blank(i + 1, j);
            i = j + 1; continue;
        }
        i++;
    }
    function scanTemplate(j) {
        const start = j;
        while (j < n && text[j] !== '`') {
            if (text[j] === '\\') { j += 2; continue; }
            if (text[j] === '$' && text[j + 1] === '{') { blank(start, j); tplStack.push(0); return j + 2; }
            j++;
        }
        blank(start, j);
        return j + 1;
    }
    return out.join('');
}

const lineStarts = (text) => { const s = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') s.push(i + 1); return s; };
export function posToLineCol(text, pos, starts = lineStarts(text)) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: pos - starts[lo] + 1 };
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ====================================================================== SYMBOLS (#147-#150)
const KW = new Set('if for while switch catch return function class new typeof await yield else do try finally with delete in of instanceof void super this import export from const let var static get set async def lambda elif except raise pass not and or is None True False print'.split(' '));
const SYMBOL_RULES = {
    js: [
        [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm, 'function'],
        [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, 'class'],
        [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=>/gm, 'function'],
        [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm, 'variable'],
        [/^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/gm, 'interface'],
        [/^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/gm, 'type'],
        [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/gm, 'enum'],
        [/^[ \t]+(?:(?:public|private|protected|static|readonly|override|async|get|set)\s+)*\*?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{;]+)?\{/gm, 'method']
    ],
    py: [[/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm, 'function'], [/^\s*class\s+([A-Za-z_]\w*)/gm, 'class'], [/^([A-Za-z_]\w*)\s*(?::[^=\n]+)?=(?!=)/gm, 'variable']],
    go: [[/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm, 'function'], [/^type\s+([A-Za-z_]\w*)/gm, 'type'], [/^(?:var|const)\s+([A-Za-z_]\w*)/gm, 'variable']],
    rs: [[/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/gm, 'function'], [/^\s*(?:pub\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)/gm, 'type']],
    rb: [[/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?]?)/gm, 'function'], [/^\s*(?:class|module)\s+([A-Z]\w*)/gm, 'class']],
    php: [[/^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+([A-Za-z_]\w*)/gm, 'function'], [/^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)/gm, 'class']],
    java: [[/^\s*(?:(?:public|private|protected|static|final|abstract|sealed|data|open|internal)\s+)*(?:class|interface|enum|record|object)\s+([A-Za-z_]\w*)/gm, 'class'], [/^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|override|suspend)\s+)*(?:fun\s+)?(?:<[^>]+>\s*)?(?:[\w<>[\],.?]+\s+)?([a-zA-Z_]\w*)\s*\([^)]*\)\s*(?::\s*[\w<>?,. ]+)?\s*(?:throws [\w, .]+)?\s*\{/gm, 'method']],
    c: [[/^(?:[\w*&<>:,]+\s+)+\**([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:const\s*)?\{/gm, 'function'], [/^\s*(?:typedef\s+)?(?:struct|class|enum|union)\s+([A-Za-z_]\w*)/gm, 'type'], [/^#define\s+([A-Za-z_]\w*)/gm, 'macro']],
    css: [[/^\s*(--[\w-]+)\s*:/gm, 'variable'], [/^\s*(\$[\w-]+)\s*:/gm, 'variable'], [/^\s*@mixin\s+([\w-]+)/gm, 'function']]
};
const FAMILY = { js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js', py: 'py', go: 'go', rs: 'rs', rb: 'rb', php: 'php', java: 'java', kt: 'java', kts: 'java', cs: 'java', scala: 'java', dart: 'java', swift: 'java', c: 'c', h: 'c', cpp: 'c', hpp: 'c', cc: 'c', css: 'css', scss: 'css', less: 'css' };
export const familyOf = (p) => FAMILY[extOf(p)] || null;

export function extractSymbols(text, path) {
    const fam = familyOf(path);
    if (!fam || !text) return [];
    const masked = maskCode(text, path);
    const starts = lineStarts(text);
    const seen = new Set();
    const out = [];
    for (const [re, kind] of SYMBOL_RULES[fam]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(masked))) {
            const name = m[1];
            if (!name || KW.has(name)) continue;
            const at = m.index + m[0].indexOf(name);
            const { line, col } = posToLineCol(text, at, starts);
            const key = name + ':' + line;
            if (seen.has(key)) continue;
            seen.add(key);
            const lineText = text.slice(starts[line - 1], (starts[line] || text.length + 1) - 1);
            out.push({ name, kind, line, col, pos: at, signature: lineText.trim().slice(0, 200), exported: /^\s*export\b/.test(lineText) || (fam === 'py' && !name.startsWith('_')), indent: /^\s*/.exec(lineText)[0].length });
        }
    }
    return out.sort((a, b) => a.pos - b.pos);
}

/** Docstring / JSDoc / preceding comment block for a symbol line (1-based). */
export function docFor(text, line, path) {
    const lines = text.split('\n');
    if (familyOf(path) === 'py') {
        const next = (lines[line] || '').trim();
        const m = /^(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(lines.slice(line, line + 12).join('\n').trim());
        if (/^("""|''')/.test(next) && m) return m[1].trim().slice(0, 600);
    }
    const buf = [];
    for (let i = line - 2; i >= 0 && buf.length < 15; i--) {
        const l = lines[i].trim();
        if (/^(\/\/|#|\*|\/\*\*|\/\*|\*\/)/.test(l)) buf.unshift(l.replace(/^(\/\*\*|\/\*|\*\/|\*|\/\/|#)\s?/, '').replace(/\*\/$/, '').trim());
        else break;
    }
    return buf.filter(Boolean).join('\n').slice(0, 600);
}

/** Word-boundary occurrences outside comments/strings. */
export function findOccurrences(text, word, path, { includeStringsAndComments = false } = {}) {
    if (!word) return [];
    const hay = includeStringsAndComments ? text : maskCode(text, path);
    const re = new RegExp('(?<![\\w$])' + escRe(word) + '(?![\\w$])', 'g');
    const starts = lineStarts(text);
    const out = [];
    let m;
    while ((m = re.exec(hay))) {
        const { line, col } = posToLineCol(text, m.index, starts);
        out.push({ index: m.index, line, col, lineText: text.slice(starts[line - 1], (starts[line] || text.length + 1) - 1) });
    }
    return out;
}

/** Project-wide symbol index with simple per-file caching (key = content length + timestamp). */
export class SymbolIndex {
    constructor() { this.cache = new Map(); }
    fileSymbols(path, text, stamp) {
        const key = (stamp || 0) + ':' + text.length;
        const c = this.cache.get(path);
        if (c && c.key === key) return c.symbols;
        const symbols = extractSymbols(text, path);
        this.cache.set(path, { key, symbols });
        return symbols;
    }
    definitions(files, word, preferPath) {
        const out = [];
        for (const [path, f] of files) {
            if (!f || typeof f.content !== 'string' || !familyOf(path)) continue;
            this.fileSymbols(path, f.content, f.timestamp).forEach(s => { if (s.name === word) out.push({ path, ...s }); });
        }
        const rank = (d) => (d.path === preferPath ? 0 : 1) * 10 + (d.kind === 'variable' ? 2 : d.kind === 'method' ? 1 : 0);
        return out.sort((a, b) => rank(a) - rank(b));
    }
    references(files, word, opts) {
        const out = [];
        for (const [path, f] of files) {
            if (!f || typeof f.content !== 'string' || !isCodeFile(path)) continue;
            findOccurrences(f.content, word, path, opts).forEach(o => out.push({ path, ...o }));
        }
        return out;
    }
    allNames(files, limit = 4000) {
        const names = new Set();
        for (const [path, f] of files) {
            if (!f || typeof f.content !== 'string' || !familyOf(path)) continue;
            this.fileSymbols(path, f.content, f.timestamp).forEach(s => names.add(s.name));
            if (names.size > limit) break;
        }
        return Array.from(names);
    }
}

/** Plan a project-wide rename (#150). Returns [{path, count, content}] */
export function planRename(files, oldName, newName, opts = {}) {
    if (!/^[A-Za-z_$][\w$]*$/.test(newName || '')) throw new Error('اسم غير صالح');
    const plan = [];
    for (const [path, f] of files) {
        if (!f || typeof f.content !== 'string' || !isCodeFile(path)) continue;
        const occ = findOccurrences(f.content, oldName, path, opts);
        if (!occ.length) continue;
        let content = f.content;
        for (let i = occ.length - 1; i >= 0; i--) content = content.slice(0, occ[i].index) + newName + content.slice(occ[i].index + oldName.length);
        plan.push({ path, count: occ.length, content, lines: occ.map(o => o.line) });
    }
    return plan;
}

// ====================================================================== IMPORTS (#234, #235, #243-#245)
/** Parse import specifiers. Each entry has the exact [start,end) of the spec text inside its quotes. */
export function parseImports(text, path) {
    const ext = extOf(path);
    const out = [];
    const masked = (JS.includes(ext) || ['css', 'scss', 'less'].includes(ext)) ? maskCode(text, path) : text;
    const push = (spec, start, kind, names = [], stmtStart = start, stmtEnd = start + spec.length) => out.push({ spec, start, end: start + spec.length, kind, names, stmtStart, stmtEnd });
    if (JS.includes(ext)) {
        // Strings are blanked in `masked`, so locate statements there and read specs from `text`
        const reStmt = /\b(import|export)\s*(type\s+)?([\s\S]*?)\s*\bfrom\s*(['"])|\bimport\s*(['"])|\b(?:require|import)\s*\(\s*(['"`])/g;
        let m;
        while ((m = reStmt.exec(masked))) {
            const q = m[4] || m[5] || m[6];
            const qPos = m.index + m[0].length - 1;
            const close = text.indexOf(q, qPos + 1);
            if (close < 0 || text.slice(qPos + 1, close).includes('\n')) continue;
            const spec = text.slice(qPos + 1, close);
            let kind = 'import', names = [];
            if (m[1]) {
                kind = m[1] === 'export' ? 'export' : 'import';
                const clause = text.slice(m.index + m[1].length + (m[2] || '').length, m.index + m[0].length - 1).replace(/\bfrom\s*['"]?$/, '').trim();
                names = parseImportClause(clause);
                if (m[2]) names.forEach(x => { x.typeOnly = true; });
            } else if (m[5]) kind = 'side-effect';
            else kind = /require/.test(m[0]) ? 'require' : 'dynamic';
            if (kind === 'require') {
                // const x = require('y') / const { a } = require('y')
                const before = text.slice(Math.max(0, text.lastIndexOf('\n', m.index) + 1), m.index);
                const rm = /(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
                if (rm) names = rm[1].startsWith('{') ? rm[1].slice(1, -1).split(',').map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split(':').map(x => x.trim()); return { imported: a, local: b || a }; }) : [{ imported: 'default', local: rm[1] }];
            }
            let stmtEnd = text.indexOf('\n', close); if (stmtEnd < 0) stmtEnd = text.length;
            push(spec, qPos + 1, kind, names, m.index, stmtEnd);
        }
    } else if (['css', 'scss', 'less'].includes(ext)) {
        let m; const re = /@(?:import|use|forward)\s+(?:url\()?\s*(['"])([^'"\n]+)\1|url\(\s*(['"]?)([^'")\n]+)\3\s*\)/g;
        while ((m = re.exec(text))) {
            if (masked.slice(m.index, m.index + 4).trim() === '') continue;
            const spec = m[2] || m[4]; push(spec, m.index + m[0].indexOf(spec), m[2] ? 'import' : 'url');
        }
    } else if (['html', 'htm', 'vue', 'svelte'].includes(ext)) {
        let m; const re = /\b(src|href)\s*=\s*(['"])([^'"\n]+)\2/g;
        while ((m = re.exec(text))) push(m[3], m.index + m[0].indexOf(m[3], m[1].length + 2), m[1]);
    } else if (ext === 'py') {
        let m; const re = /^[ \t]*(?:from\s+([\w.]+)\s+import\s+([^\n#]+)|import\s+([^\n#]+))/gm;
        while ((m = re.exec(text))) {
            if (m[1]) {
                const names = m[2].replace(/[()\\]/g, ' ').split(',').map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split(/\s+as\s+/); return { imported: a.trim(), local: (b || a).trim() }; });
                push(m[1], m.index + m[0].indexOf(m[1]), 'from', names, m.index, m.index + m[0].length);
            } else {
                m[3].split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
                    const [a, b] = s.split(/\s+as\s+/);
                    push(a.trim(), m.index + m[0].indexOf(a.trim()), 'import', [{ imported: a.trim(), local: (b || a.split('.')[0]).trim() }], m.index, m.index + m[0].length);
                });
            }
        }
    }
    return out;
}

export function parseImportClause(clause) {
    const names = [];
    let c = clause.trim();
    if (!c) return names;
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(c);
    if (ns) { names.push({ imported: '*', local: ns[1] }); c = c.replace(ns[0], ''); }
    const brace = /\{([\s\S]*?)\}/.exec(c);
    if (brace) {
        brace[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
            const typeOnly = /^type\s+/.test(s); s = s.replace(/^type\s+/, '');
            const [a, b] = s.split(/\s+as\s+/).map(x => x.trim());
            names.push({ imported: a, local: b || a, typeOnly });
        });
        c = c.replace(brace[0], '');
    }
    const def = /^\s*([A-Za-z_$][\w$]*)/.exec(c.replace(/,/g, ' '));
    if (def && def[1] !== 'type') names.unshift({ imported: 'default', local: def[1] });
    return names;
}

const RESOLVE_EXT = ['', '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.json', '.vue', '.svelte', '.css', '.scss', '/index.js', '/index.ts', '/index.jsx', '/index.tsx', '/index.mjs'];
export function joinPath(base, rel) {
    const parts = (base ? base.split('/') : []).concat(rel.split('/'));
    const out = [];
    for (const p of parts) { if (!p || p === '.') continue; if (p === '..') { if (!out.length) return null; out.pop(); } else out.push(p); }
    return out.join('/');
}
export function resolveImport(fromPath, spec, has) {
    if (!spec || !(spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/'))) return null;
    const clean = spec.split(/[?#]/)[0];
    const base = clean.startsWith('/') ? clean.slice(1) : joinPath(dirName(fromPath), clean);
    if (base == null) return null;
    for (const e of RESOLVE_EXT) { const p = base + e; if (has(p)) return p; }
    return null;
}
export function resolvePyModule(fromPath, mod, has) {
    const lead = /^\.+/.exec(mod);
    let baseDir = '';
    let rest = mod;
    if (lead) { baseDir = dirName(fromPath); for (let i = 1; i < lead[0].length; i++) baseDir = dirName(baseDir); rest = mod.slice(lead[0].length); }
    const rel = rest.replace(/\./g, '/');
    const cands = [joinPath(baseDir, rel) + '.py', joinPath(baseDir, rel) + '/__init__.py'];
    if (!lead) cands.push(...cands.map(c => c), rel + '.py', rel + '/__init__.py');
    return cands.find(c => c && has(c)) || null;
}

/** Relative spec from one file to another, keeping the original style (extension/index omitted or not). */
export function relativeSpec(fromPath, toPath, original = './x.js') {
    const from = dirName(fromPath).split('/').filter(Boolean);
    let target = toPath;
    const origClean = original.split(/[?#]/)[0];
    const suffix = original.slice(origClean.length);
    const origLast = origClean.split('/').pop();
    const origHasExt = /\.[a-z0-9]+$/i.test(origLast);
    if (/\/index\.[a-z]+$/i.test(target) && !/index(\.[a-z]+)?$/i.test(origLast)) target = dirName(target);
    else if (!origHasExt) target = target.replace(/\.(js|ts|jsx|tsx|mjs|cjs)$/i, '');
    const to = target.split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const up = from.length - i;
    const rel = (up ? '../'.repeat(up) : './') + to.slice(i).join('/');
    return (original.startsWith('/') ? '/' + target : rel) + suffix;
}

/**
 * After files moved (mapping old→new), rewrite relative imports everywhere (#243, #244).
 * `files` is a Map of the project *before* the move (old paths → {content}).
 * Returns { updates: [{path(new), content, count}], total }.
 */
export function computeImportUpdates(files, mapping) {
    const oldSet = new Set(files.keys());
    const has = (p) => oldSet.has(p);
    const newPathOf = (p) => mapping.get(p) || p;
    const updates = [];
    let total = 0;
    for (const [oldPath, f] of files) {
        if (!f || typeof f.content !== 'string') continue;
        const imps = parseImports(f.content, oldPath).filter(x => x.spec.startsWith('.') || x.spec.startsWith('/'));
        if (!imps.length) continue;
        const movedSelf = mapping.has(oldPath);
        let content = f.content, count = 0;
        for (let k = imps.length - 1; k >= 0; k--) {
            const imp = imps[k];
            const target = resolveImport(oldPath, imp.spec, has);
            if (!target) continue;
            if (!movedSelf && !mapping.has(target)) continue;
            const spec = relativeSpec(newPathOf(oldPath), newPathOf(target), imp.spec);
            if (spec === imp.spec) continue;
            content = content.slice(0, imp.start) + spec + content.slice(imp.end);
            count++;
        }
        if (count) { updates.push({ path: newPathOf(oldPath), content, count }); total += count; }
    }
    return { updates, total };
}

/** Files that import `target` (#245 safe delete, #234 dependencies). */
export function findImporters(files, target) {
    const has = (p) => files.has(p);
    const out = [];
    for (const [path, f] of files) {
        if (path === target || !f || typeof f.content !== 'string') continue;
        if (isPy(path)) {
            parseImports(f.content, path).forEach(imp => { if (resolvePyModule(path, imp.spec, has) === target) out.push({ path, line: posToLineCol(f.content, imp.start).line, spec: imp.spec }); });
            continue;
        }
        parseImports(f.content, path).forEach(imp => {
            if (resolveImport(path, imp.spec, has) === target) out.push({ path, line: posToLineCol(f.content, imp.start).line, spec: imp.spec });
        });
    }
    return out;
}

// ====================================================================== UNUSED CODE (#235-#237)
const PY_SPECIAL = new Set(['__init__', '__main__', 'main', 'setUp', 'tearDown']);
/**
 * Unused imports / variables / functions as lint diagnostics.
 * refCount(name) → occurrences across *other* project files (optional; enables #237).
 */
export function unusedDiagnostics(text, path, { refCount } = {}) {
    const out = [];
    const fam = familyOf(path);
    if (fam !== 'js' && fam !== 'py') return out;
    const masked = maskCode(text, path);
    const countIn = (name) => { const re = new RegExp('(?<![\\w$.])' + escRe(name) + '(?![\\w$])', 'g'); return (masked.match(re) || []).length; };
    const countAny = (name) => { const re = new RegExp('(?<![\\w$])' + escRe(name) + '(?![\\w$])', 'g'); return (masked.match(re) || []).length; };
    const isVueLike = ['vue', 'svelte'].includes(extOf(path));
    // Unused imports
    parseImports(text, path).forEach(imp => {
        if (!['import', 'from', 'require'].includes(imp.kind) || isVueLike) return;
        const stmt = masked.slice(imp.stmtStart, imp.stmtEnd);
        imp.names.forEach(n => {
            if (!n.local || n.local === '*' || /[^\w$]/.test(n.local)) return;
            const inStmt = (stmt.match(new RegExp('(?<![\\w$])' + escRe(n.local) + '(?![\\w$])', 'g')) || []).length;
            const uses = countAny(n.local) - inStmt;
            const usedInJsx = fam === 'js' && new RegExp('<' + escRe(n.local) + '[\\s/>.]').test(text);
            if (uses <= 0 && !usedInJsx && !(n.local === 'React' && /<[A-Za-z]/.test(text))) {
                const at = imp.stmtStart + Math.max(0, stmt.search(new RegExp('(?<![\\w$])' + escRe(n.local) + '(?![\\w$])')));
                out.push({ from: at, to: at + n.local.length, severity: 'warning', message: `استيراد غير مستخدم: ${n.local}`, kind: 'unused-import', name: n.local, source: 'ox' });
            }
        });
    });
    if (fam === 'js') {
        // Unused local declarations (simple identifiers only, not exported)
        const re = /(^|[;{}\s(])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]+)?(=|;|\n)/g;
        let m;
        while ((m = re.exec(masked))) {
            const name = m[2];
            const lineStart = masked.lastIndexOf('\n', m.index) + 1;
            if (/^\s*export\b/.test(masked.slice(lineStart, m.index + m[0].length))) continue;
            if (/=\s*require\s*\(/.test(masked.slice(m.index, m.index + m[0].length + 30))) continue;
            if (countAny(name) <= 1 && !new RegExp('<' + escRe(name) + '[\\s/>.]').test(text) && name !== '_' && !name.startsWith('_')) {
                const at = m.index + m[0].indexOf(name, m[1].length);
                out.push({ from: at, to: at + name.length, severity: 'warning', message: `متغير غير مستخدم: ${name}`, kind: 'unused-variable', name, source: 'ox' });
            }
        }
    }
    // Unused top-level functions (never referenced in this file nor elsewhere in the project)
    extractSymbols(text, path).filter(s => s.kind === 'function' && s.indent === 0).forEach(s => {
        if (fam === 'js' && s.exported) return;
        if (fam === 'py' && (s.name.startsWith('test') || PY_SPECIAL.has(s.name) || s.name.startsWith('__'))) return;
        const local = countIn(s.name) + (fam === 'js' ? (masked.match(new RegExp('\\.' + escRe(s.name) + '(?![\\w$])', 'g')) || []).length : 0);
        if (local > 1) return;
        const elsewhere = refCount ? refCount(s.name, path) : 0;
        if (elsewhere > 0) return;
        out.push({ from: s.pos, to: s.pos + s.name.length, severity: 'info', message: `دالة غير مستخدمة في المشروع: ${s.name}`, kind: 'unused-function', name: s.name, source: 'ox' });
    });
    return out.sort((a, b) => a.from - b.from);
}

// ====================================================================== TEXT TRANSFORMS (#183-#185)
const words = (s) => s.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z\d\u0600-\u06FF]+/).filter(Boolean);
export const CASES = {
    upper: ['أحرف كبيرة UPPER', s => s.toUpperCase()],
    lower: ['أحرف صغيرة lower', s => s.toLowerCase()],
    title: ['Title Case', s => s.toLowerCase().replace(/(^|[\s_-])([a-z])/g, (m, a, b) => a + b.toUpperCase())],
    camel: ['camelCase', s => words(s).map((w, i) => i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()).join('')],
    pascal: ['PascalCase', s => words(s).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')],
    snake: ['snake_case', s => words(s).map(w => w.toLowerCase()).join('_')],
    constant: ['CONSTANT_CASE', s => words(s).map(w => w.toUpperCase()).join('_')],
    kebab: ['kebab-case', s => words(s).map(w => w.toLowerCase()).join('-')],
    toggle: ['عكس الحالة', s => s.replace(/[A-Za-z]/g, c => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))]
};
export function changeCase(text, mode) {
    const f = CASES[mode]; if (!f) return text;
    if (['camel', 'pascal', 'snake', 'constant', 'kebab'].includes(mode)) {
        // "hello world" (a plain phrase) → one identifier; "user_name, other-value" → each identifier
        if (/^[A-Za-z\d\u0600-\u06FF]+(?: [A-Za-z\d\u0600-\u06FF]+)+$/.test(text.trim())) return f[1](text.trim());
        return text.replace(/[A-Za-z\d_\-\u0600-\u06FF]+/g, w => f[1](w));
    }
    return f[1](text);
}
export const SORTS = {
    asc: 'تصاعدي A→Z', desc: 'تنازلي Z→A', natural: 'طبيعي (أرقام)', insensitive: 'دون مراعاة الحالة', length: 'حسب الطول',
    reverse: 'عكس الترتيب', unique: 'إزالة المكرر', shuffle: 'خلط عشوائي'
};
export function sortLines(text, mode = 'asc', rnd = Math.random) {
    const trailing = text.endsWith('\n');
    let lines = (trailing ? text.slice(0, -1) : text).split('\n');
    const coll = new Intl.Collator(undefined, { numeric: mode === 'natural', sensitivity: mode === 'insensitive' ? 'base' : 'variant' });
    switch (mode) {
        case 'asc': case 'natural': case 'insensitive': lines.sort(coll.compare); break;
        case 'desc': lines.sort((a, b) => coll.compare(b, a)); break;
        case 'length': lines.sort((a, b) => a.length - b.length || coll.compare(a, b)); break;
        case 'reverse': lines.reverse(); break;
        case 'unique': lines = lines.filter((l, i) => lines.indexOf(l) === i); break;
        case 'shuffle': for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [lines[i], lines[j]] = [lines[j], lines[i]]; } break;
        default: break;
    }
    return lines.join('\n') + (trailing ? '\n' : '');
}
export const trimTrailing = (text) => text.replace(/[ \t]+$/gm, '');
export function fileStats(text) {
    const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
    return { lines: text ? text.split('\n').length : 1, words: (text.match(/[\p{L}\p{N}_$]+/gu) || []).length, chars: text.length, bytes: enc };
}

// ====================================================================== CLASS GENERATORS (#186, #187)
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** Smallest indentation step used in the file (2 or 4 spaces, or a tab). */
export function indentUnit(text) {
    if (/^\t/m.test(text)) return '\t';
    let min = 0;
    String(text).split('\n').forEach(l => { const n = /^ */.exec(l)[0].length; if (n && l.trim() && (!min || n < min)) min = n; });
    return ' '.repeat(min && min <= 8 ? min : 4);
}
/** Find the class enclosing `pos` and its fields. */
export function classAt(text, pos, path) {
    const fam = familyOf(path);
    const masked = maskCode(text, path);
    if (fam === 'py') {
        const lines = text.split('\n');
        const { line } = posToLineCol(text, Math.min(pos, text.length));
        for (let i = line - 1; i >= 0; i--) {
            const m = /^(\s*)class\s+([A-Za-z_]\w*)/.exec(lines[i]);
            if (!m) continue;
            const ind = m[1].length;
            let end = i + 1;
            while (end < lines.length && (!lines[end].trim() || /^\s*/.exec(lines[end])[0].length > ind)) end++;
            if (line - 1 >= end) return null;
            const body = lines.slice(i + 1, end);
            const fields = [];
            const add = (name, type) => { if (!fields.some(f => f.name === name)) fields.push({ name, type: type || '' }); };
            body.forEach(l => { const a = /^\s+([A-Za-z_]\w*)\s*:\s*([^=\n]+?)\s*(?:=.*)?$/.exec(l); if (a && !/^\s+(def|return|if|for)\b/.test(l)) add(a[1], a[2].trim()); });
            body.forEach(l => { const a = /self\.([A-Za-z_]\w*)\s*(?::\s*([^=\n]+?))?\s*=/.exec(l); if (a) add(a[1], a[2]); });
            const bodyIndent = (body.find(l => l.trim()) || '').match(/^\s*/)[0] || ' '.repeat(ind + 4);
            let insertLine = end; while (insertLine > i + 1 && !lines[insertLine - 1].trim()) insertLine--;
            const insertPos = lines.slice(0, insertLine).join('\n').length;
            return { lang: 'py', unit: indentUnit(text), name: m[2], fields, indent: bodyIndent, insertPos, hasInit: body.some(l => /def\s+__init__/.test(l)), bodyStart: lines.slice(0, i + 1).join('\n').length + 1 };
        }
        return null;
    }
    const re = /\bclass\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
    let m, best = null;
    while ((m = re.exec(masked))) {
        const open = m.index + m[0].length - 1;
        let depth = 0, close = -1;
        for (let i = open; i < masked.length; i++) { if (masked[i] === '{') depth++; else if (masked[i] === '}') { depth--; if (!depth) { close = i; break; } } }
        if (close < 0) close = masked.length;
        if (pos > open && pos <= close) best = { name: m[1], open, close, start: m.index };
    }
    if (!best) return null;
    const body = text.slice(best.open + 1, best.close);
    const mbody = masked.slice(best.open + 1, best.close);
    const fields = [];
    const add = (name, type, priv) => { if (!fields.some(f => f.name === name)) fields.push({ name, type: (type || '').trim(), priv }); };
    const lang = ['java', 'kt', 'cs', 'dart', 'scala'].includes(extOf(path)) ? 'java' : (['ts', 'tsx'].includes(extOf(path)) ? 'ts' : 'js');
    // top-level class body statements only (depth 0 inside body)
    let depth = 0, stmt = '', stmts = [];
    for (let i = 0; i < mbody.length; i++) {
        const ch = mbody[i];
        if (ch === '{') { if (depth === 0) { stmts.push(stmt); stmt = ''; } depth++; continue; }
        if (ch === '}') { depth--; continue; }
        if (depth === 0) { if (ch === ';' || ch === '\n') { stmts.push(stmt); stmt = ''; } else stmt += ch; }
    }
    stmts.push(stmt);
    stmts.map(s => s.trim()).filter(Boolean).forEach(s => {
        if (/\(/.test(s) && !/=/.test(s.split('(')[0])) return; // method signature
        if (lang === 'java') {
            const j = /^(?:(?:private|protected|public|static|final|readonly)\s+)*([\w<>[\],.? ]+?)\s+([A-Za-z_]\w*)\s*(?:=.*)?$/.exec(s);
            if (j && !/^(return|class|new)$/.test(j[1])) add(j[2], j[1], /private/.test(s));
            return;
        }
        const f = /^(?:(?:private|protected|public|static|readonly|declare)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*(?::\s*([^=]+?))?\s*(?:=.*)?$/.exec(s);
        if (f && !['constructor', 'get', 'set', 'static', 'async'].includes(f[1])) add(f[1], f[2], /private|^#/.test(s));
    });
    const ctor = /constructor\s*\(([^)]*)\)\s*\{/.exec(mbody);
    if (ctor) {
        const cbStart = ctor.index + ctor[0].length;
        const cb = body.slice(cbStart, cbStart + 3000);
        let mm; const re2 = /this\.(#?[A-Za-z_$][\w$]*)\s*=/g;
        while ((mm = re2.exec(cb))) add(mm[1], '', mm[1].startsWith('_') || mm[1].startsWith('#'));
    }
    const firstLine = body.split('\n').find(l => l.trim()) || '    ';
    const indent = /^\s*/.exec(firstLine)[0] || '    ';
    let insertPos = best.close;
    while (insertPos > best.open && /\s/.test(text[insertPos - 1])) insertPos--;
    return { lang, unit: indentUnit(text), name: best.name, fields, indent, insertPos, hasConstructor: !!ctor, open: best.open, close: best.close };
}

export function generateAccessors(info) {
    if (!info) return '';
    const I = info.indent, U = info.unit || '    ';
    if (info.lang === 'py') {
        return '\n' + info.fields.filter(f => !f.name.startsWith('__')).map(f => {
            const pub = f.name.replace(/^_+/, '');
            const attr = f.name.startsWith('_') ? f.name : '_' + f.name;
            const ann = f.type ? ` -> ${f.type}` : '';
            return `\n${I}@property\n${I}def ${pub}(self)${ann}:\n${I}${U}return self.${attr}\n\n${I}@${pub}.setter\n${I}def ${pub}(self, value${f.type ? ': ' + f.type : ''}) -> None:\n${I}${U}self.${attr} = value\n`;
        }).join('');
    }
    if (info.lang === 'java') {
        return info.fields.map(f => `\n\n${I}public ${f.type || 'Object'} ${/^bool/i.test(f.type) ? 'is' : 'get'}${cap(f.name)}() {\n${I}${U}return this.${f.name};\n${I}}\n\n${I}public void set${cap(f.name)}(${f.type || 'Object'} ${f.name}) {\n${I}${U}this.${f.name} = ${f.name};\n${I}}`).join('') + '\n';
    }
    const ts = info.lang === 'ts';
    return info.fields.map(f => {
        const raw = f.name;
        if (raw.startsWith('#') || raw.startsWith('_')) {
            const pub = raw.replace(/^[#_]+/, '');
            const type = ts && f.type ? `: ${f.type}` : '';
            return `\n\n${I}get ${pub}()${type} {\n${I}${U}return this.${raw};\n${I}}\n\n${I}set ${pub}(value${type}) {\n${I}${U}this.${raw} = value;\n${I}}`;
        }
        const type = ts && f.type ? `: ${f.type}` : '';
        return `\n\n${I}get${cap(raw)}()${type} {\n${I}${U}return this.${raw};\n${I}}\n\n${I}set${cap(raw)}(value${type})${ts ? ': void' : ''} {\n${I}${U}this.${raw} = value;\n${I}}`;
    }).join('') + '\n';
}

export function generateConstructor(info) {
    if (!info) return '';
    const I = info.indent, U = info.unit || '    ';
    if (info.lang === 'py') {
        const params = info.fields.map(f => `${f.name.replace(/^_+/, '')}${f.type ? ': ' + f.type : ''}`).join(', ');
        return `\n\n${I}def __init__(self${params ? ', ' + params : ''}) -> None:\n` + (info.fields.length ? info.fields.map(f => `${I}${U}self.${f.name} = ${f.name.replace(/^_+/, '')}`).join('\n') : `${I}${U}pass`) + '\n';
    }
    if (info.lang === 'java') {
        return `\n\n${I}public ${info.name}(${info.fields.map(f => `${f.type || 'Object'} ${f.name}`).join(', ')}) {\n` + info.fields.map(f => `${I}${U}this.${f.name} = ${f.name};`).join('\n') + `\n${I}}\n`;
    }
    const ts = info.lang === 'ts';
    const params = info.fields.map(f => `${f.name.replace(/^[#_]+/, '')}${ts && f.type ? ': ' + f.type : ''}`).join(', ');
    return `\n\n${I}constructor(${params}) {\n` + info.fields.map(f => `${I}${U}this.${f.name} = ${f.name.replace(/^[#_]+/, '')};`).join('\n') + `\n${I}}\n`;
}

// ====================================================================== JSON → TYPES / MODELS (#188, #189)
function mergeTypes(a, b) {
    if (!a) return b; if (!b) return a;
    if (a.kind === 'object' && b.kind === 'object') {
        const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
        const fields = {};
        keys.forEach(k => {
            const fa = a.fields[k], fb = b.fields[k];
            fields[k] = { type: mergeTypes(fa && fa.type, fb && fb.type), optional: !fa || !fb || fa.optional || fb.optional };
        });
        return { kind: 'object', fields, name: a.name };
    }
    if (a.kind === 'array' && b.kind === 'array') return { kind: 'array', item: mergeTypes(a.item, b.item) };
    if (a.kind === b.kind && a.kind !== 'union') return a.kind === 'number' ? { kind: 'number', int: a.int && b.int } : a;
    if (a.kind === 'null') return { ...b, nullable: true };
    if (b.kind === 'null') return { ...a, nullable: true };
    const list = [...(a.kind === 'union' ? a.types : [a]), ...(b.kind === 'union' ? b.types : [b])];
    const uniq = []; list.forEach(x => { if (!uniq.some(u => u.kind === x.kind)) uniq.push(x); });
    return uniq.length === 1 ? uniq[0] : { kind: 'union', types: uniq };
}
export function inferType(v) {
    if (v === null) return { kind: 'null' };
    if (Array.isArray(v)) return { kind: 'array', item: v.reduce((acc, x) => mergeTypes(acc, inferType(x)), null) };
    switch (typeof v) {
        case 'string': return { kind: 'string', date: /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) };
        case 'number': return { kind: 'number', int: Number.isInteger(v) };
        case 'boolean': return { kind: 'boolean' };
        case 'object': { const fields = {}; Object.keys(v).forEach(k => { fields[k] = { type: inferType(v[k]), optional: false }; }); return { kind: 'object', fields }; }
        default: return { kind: 'any' };
    }
}
const pascal = (s) => { const r = String(s).replace(/[^A-Za-z0-9]+(.)?/g, (m, c) => (c ? c.toUpperCase() : '')).replace(/^./, c => c.toUpperCase()); return /^\d/.test(r) ? 'T' + r : r || 'Item'; };
const singular = (s) => s.replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/s$/, '');
const snakeName = (s) => s.replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
const camelName = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };

function collectObjects(type, name, acc) {
    if (!type) return;
    if (type.kind === 'object') {
        const nm = pascal(name);
        let unique = nm, n = 2;
        while (acc.some(o => o.name === unique)) unique = nm + n++;
        type.name = unique;
        acc.push({ name: unique, type });
        Object.entries(type.fields).forEach(([k, f]) => collectObjects(f.type, k, acc));
    } else if (type.kind === 'array') collectObjects(type.item, singular(name), acc);
    else if (type.kind === 'union') type.types.forEach(t2 => collectObjects(t2, name, acc));
}
const SAFE_TS_KEY = /^[A-Za-z_$][\w$]*$/;
const EMIT = {
    ts: {
        label: 'TypeScript interfaces',
        type(t) {
            if (!t) return 'unknown';
            const base = { string: 'string', number: 'number', boolean: 'boolean', null: 'null', any: 'any', object: t.name, array: `${this.type(t.item).includes('|') ? `(${this.type(t.item)})` : this.type(t.item)}[]`, union: (t.types || []).map(x => this.type(x)).join(' | ') }[t.kind] || 'unknown';
            return t.nullable ? `${base} | null` : base;
        },
        obj(o) { return `export interface ${o.name} {\n${Object.entries(o.type.fields).map(([k, f]) => `  ${SAFE_TS_KEY.test(k) ? k : JSON.stringify(k)}${f.optional ? '?' : ''}: ${this.type(f.type)};`).join('\n')}\n}`; }
    },
    zod: null,
    py: {
        label: 'Python dataclasses',
        header: 'from __future__ import annotations\nfrom dataclasses import dataclass\nfrom typing import Any, List, Optional, Union\n',
        type(t) {
            if (!t) return 'Any';
            const base = { string: 'str', number: t.int ? 'int' : 'float', boolean: 'bool', null: 'None', any: 'Any', object: t.name, array: `List[${this.type(t.item)}]`, union: `Union[${(t.types || []).map(x => this.type(x)).join(', ')}]` }[t.kind] || 'Any';
            return t.nullable ? `Optional[${base}]` : base;
        },
        obj(o) {
            const f = Object.entries(o.type.fields).sort((a, b) => (a[1].optional ? 1 : 0) - (b[1].optional ? 1 : 0));
            return `@dataclass\nclass ${o.name}:\n${f.length ? f.map(([k, x]) => `    ${snakeName(k)}: ${x.optional ? `Optional[${this.type(x.type)}] = None` : this.type(x.type)}`).join('\n') : '    pass'}`;
        },
        reverse: true
    },
    go: {
        label: 'Go structs',
        type(t) {
            if (!t) return 'interface{}';
            const base = { string: t.date ? 'time.Time' : 'string', number: t.int ? 'int64' : 'float64', boolean: 'bool', null: 'interface{}', any: 'interface{}', object: t.name, array: `[]${this.type(t.item)}`, union: 'interface{}' }[t.kind] || 'interface{}';
            return t.nullable && !['interface{}'].includes(base) && !base.startsWith('[]') ? '*' + base : base;
        },
        obj(o) { return `type ${o.name} struct {\n${Object.entries(o.type.fields).map(([k, f]) => `\t${pascal(k)} ${this.type(f.type)} \`json:"${k}${f.optional ? ',omitempty' : ''}"\``).join('\n')}\n}`; }
    },
    rust: {
        label: 'Rust structs (serde)',
        header: 'use serde::{Deserialize, Serialize};\n',
        type(t) {
            if (!t) return 'serde_json::Value';
            const base = { string: 'String', number: t.int ? 'i64' : 'f64', boolean: 'bool', null: 'serde_json::Value', any: 'serde_json::Value', object: t.name, array: `Vec<${this.type(t.item)}>`, union: 'serde_json::Value' }[t.kind] || 'serde_json::Value';
            return t.nullable ? `Option<${base}>` : base;
        },
        obj(o) { return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${o.name} {\n${Object.entries(o.type.fields).map(([k, f]) => `    ${snakeName(k) !== k ? `#[serde(rename = "${k}")]\n    ` : ''}pub ${snakeName(k)}: ${f.optional ? `Option<${this.type(f.type)}>` : this.type(f.type)},`).join('\n')}\n}`; }
    },
    kotlin: {
        label: 'Kotlin data classes',
        type(t) {
            if (!t) return 'Any?';
            const base = { string: 'String', number: t.int ? 'Long' : 'Double', boolean: 'Boolean', null: 'Any', any: 'Any', object: t.name, array: `List<${this.type(t.item)}>`, union: 'Any' }[t.kind] || 'Any';
            return t.nullable ? base + '?' : base;
        },
        obj(o) { return `data class ${o.name}(\n${Object.entries(o.type.fields).map(([k, f]) => `    val ${camelName(k)}: ${this.type(f.type)}${f.optional && !this.type(f.type).endsWith('?') ? '? = null' : ''}`).join(',\n')}\n)`; }
    },
    csharp: {
        label: 'C# classes',
        type(t) {
            if (!t) return 'object';
            const base = { string: t.date ? 'DateTime' : 'string', number: t.int ? 'long' : 'double', boolean: 'bool', null: 'object', any: 'object', object: t.name, array: `List<${this.type(t.item)}>`, union: 'object' }[t.kind] || 'object';
            return t.nullable ? base + '?' : base;
        },
        obj(o) { return `public class ${o.name}\n{\n${Object.entries(o.type.fields).map(([k, f]) => `    [JsonPropertyName("${k}")]\n    public ${this.type(f.type)}${f.optional && !this.type(f.type).endsWith('?') ? '?' : ''} ${pascal(k)} { get; set; }`).join('\n\n')}\n}`; }
    },
    java: {
        label: 'Java classes',
        type(t) {
            if (!t) return 'Object';
            return { string: 'String', number: t.int ? 'Long' : 'Double', boolean: 'Boolean', null: 'Object', any: 'Object', object: t.name, array: `List<${this.type(t.item)}>`, union: 'Object' }[t.kind] || 'Object';
        },
        obj(o) { return `public class ${o.name} {\n${Object.entries(o.type.fields).map(([k, f]) => `    private ${this.type(f.type)} ${camelName(k)};`).join('\n')}\n}`; }
    }
};
delete EMIT.zod;
export const MODEL_LANGS = Object.fromEntries(Object.entries(EMIT).map(([k, v]) => [k, v.label]));
export const MODEL_EXT = { ts: 'ts', py: 'py', go: 'go', rust: 'rs', kotlin: 'kt', csharp: 'cs', java: 'java' };
export function jsonToTypes(input, lang = 'ts', rootName = 'Root') {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    const em = EMIT[lang];
    if (!em) throw new Error('لغة غير مدعومة: ' + lang);
    let root = inferType(value);
    const objs = [];
    if (root.kind === 'array') { collectObjects(root.item, singular(rootName) === rootName ? rootName + 'Item' : singular(rootName), objs); }
    else collectObjects(root, rootName, objs);
    if (!objs.length) return `${lang === 'ts' ? `export type ${pascal(rootName)} = ${em.type(root)};` : `// ${em.type(root)}`}\n`;
    const order = em.reverse ? objs.slice().reverse() : objs;
    let body = order.map(o => em.obj(o)).join('\n\n');
    if (lang === 'ts' && root.kind === 'array') body += `\n\nexport type ${pascal(rootName)} = ${em.type(root)};`;
    let header = em.header || '';
    if (lang === 'go' && body.includes('time.Time')) header = 'import "time"\n';
    if (lang === 'csharp') header = 'using System;\nusing System.Collections.Generic;\nusing System.Text.Json.Serialization;\n';
    if (lang === 'java' && body.includes('List<')) header = 'import java.util.List;\n';
    return (header ? header + '\n' : '') + body + '\n';
}

// ====================================================================== CommonJS → ESM (#145)
export function cjsToEsm(code) {
    let out = code, changes = 0;
    const rep = (re, fn) => { out = out.replace(re, (...a) => { changes++; return fn(...a); }); };
    rep(/^(\s*)(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\(\s*(['"])([^'"]+)\3\s*\)\s*;?/gm, (m, ind, names, q, spec) =>
        `${ind}import { ${names.split(',').map(s => s.trim()).filter(Boolean).map(s => { const [a, b] = s.split(':').map(x => x.trim()); return b ? `${a} as ${b}` : a; }).join(', ')} } from ${q}${spec}${q};`);
    rep(/^(\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"]+)\3\s*\)\.([A-Za-z_$][\w$]*)\s*;?/gm, (m, ind, local, q, spec, prop) =>
        `${ind}import { ${prop === local ? prop : `${prop} as ${local}`} } from ${q}${spec}${q};`);
    rep(/^(\s*)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"]+)\3\s*\)\s*;?/gm, (m, ind, local, q, spec) => `${ind}import ${local} from ${q}${spec}${q};`);
    rep(/^(\s*)require\(\s*(['"])([^'"]+)\2\s*\)\s*;?/gm, (m, ind, q, spec) => `${ind}import ${q}${spec}${q};`);
    rep(/^(\s*)module\.exports\s*=\s*\{\s*([\w$\s,]+?)\s*,?\s*\}\s*;?/gm, (m, ind, names) => `${ind}export { ${names.split(',').map(s => s.trim()).filter(Boolean).join(', ')} };`);
    rep(/^(\s*)(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/gm, (m, ind, name, val) => (name === val ? `${ind}export { ${name} };` : `${ind}export const ${name} = ${val};`));
    rep(/^(\s*)(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*(async\s+)?function\b\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*\(/gm, (m, ind, name, as) => `${ind}export ${as || ''}function ${name}(`);
    rep(/^(\s*)(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=\s*/gm, (m, ind, name) => `${ind}export const ${name} = `);
    rep(/^(\s*)module\.exports\s*=\s*/gm, (m, ind) => `${ind}export default `);
    out = out.replace(/^(['"])use strict\1;?\s*\n/, () => { changes++; return ''; });
    return { code: out, changes };
}

// ====================================================================== VS CODE SETTINGS (#207)
export function parseJSONC(text) {
    let s = '', i = 0, inStr = false;
    while (i < text.length) {
        const c = text[i], d = text[i + 1];
        if (inStr) { s += c; if (c === '\\') { s += d; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
        if (c === '"') { inStr = true; s += c; i++; continue; }
        if (c === '/' && d === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
        if (c === '/' && d === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
        s += c; i++;
    }
    return JSON.parse(s.replace(/,(\s*[}\]])/g, '$1'));
}
export function fromVSCodeSettings(text, themeNames = []) {
    const v = typeof text === 'string' ? parseJSONC(text) : text;
    const out = {}, applied = [], ignored = [];
    const map = {
        'editor.fontSize': (x) => { out.fontSize = Math.max(9, Math.min(32, +x || 13)); },
        'editor.fontFamily': (x) => { const first = String(x).split(',')[0].trim().replace(/^['"]|['"]$/g, ''); if (first) out.fontFamily = first; },
        'editor.lineHeight': (x) => { const n = +x; if (n > 0) out.lineHeight = n < 4 ? n : +(n / (out.fontSize || +v['editor.fontSize'] || 14)).toFixed(2); },
        'editor.fontLigatures': (x) => { out.ligatures = !!x && x !== 'false'; },
        'editor.tabSize': (x) => { out.tabSize = Math.max(1, Math.min(8, +x || 2)); },
        'editor.wordWrap': (x) => { out.wrap = x === 'on' || x === 'bounded' || x === 'wordWrapColumn'; },
        'editor.lineNumbers': (x) => { out.lineNumbers = x === 'relative' ? 'relative' : x === 'off' ? 'off' : 'on'; },
        'editor.minimap.enabled': (x) => { out.minimap = !!x; },
        'editor.renderWhitespace': (x) => { out.whitespace = x === 'all' || x === 'boundary' || x === 'trailing'; },
        'editor.guides.indentation': (x) => { out.indentGuides = !!x; },
        'editor.renderIndentGuides': (x) => { out.indentGuides = !!x; },
        'editor.bracketPairColorization.enabled': (x) => { out.bracketColors = !!x; },
        'editor.formatOnSave': (x) => { out.formatOnSave = !!x; },
        'files.trimTrailingWhitespace': (x) => { out.trimOnSave = !!x; },
        'editor.quickSuggestions': (x) => { out.autocomplete = x !== false && x !== 'off'; },
        'editor.inlineSuggest.enabled': (x) => { out.inlineAI = !!x; },
        'emmet.showExpandedAbbreviation': (x) => { out.emmet = x !== 'never'; },
        'editor.colorDecorators': (x) => { out.colorSwatches = !!x; },
        'editor.hover.enabled': (x) => { out.hoverInfo = !!x; },
        'workbench.colorTheme': (x) => {
            const name = String(x).toLowerCase();
            const guess = [['dracula', 'dracula'], ['monokai', 'monokai'], ['one dark', 'one-dark'], ['nord', 'nord'], ['tokyo', 'tokyo-night'], ['solarized light', 'solarized-light'], ['solarized', 'solarized-dark'], ['github light', 'github-light'], ['light', 'github-light'], ['github', 'github-dark'], ['dark', 'github-dark']].find(([k]) => name.includes(k));
            if (guess && (!themeNames.length || themeNames.includes(guess[1]))) out.theme = guess[1];
            else return false; // unknown theme → reported as ignored
        }
    };
    Object.entries(v).forEach(([k, x]) => {
        if (map[k]) { if (map[k](x) === false) ignored.push(k); else applied.push(k); }
        else if (k.startsWith('vim.')) { out.keymap = 'vim'; if (!applied.includes('vim.*')) applied.push('vim.*'); }
        else if (k.startsWith('emacs')) { out.keymap = 'emacs'; applied.push(k); }
        else ignored.push(k);
    });
    if (v['editor.fontSize'] && v['editor.lineHeight'] && +v['editor.lineHeight'] >= 4) out.lineHeight = +(+v['editor.lineHeight'] / +v['editor.fontSize']).toFixed(2);
    return { settings: out, applied, ignored };
}
/** VS Code keybindings.json → our keybinding map (only commands we know). */
const VSC_CMDS = {
    'editor.action.copyLinesDownAction': 'copyLineDown', 'editor.action.copyLinesUpAction': 'copyLineUp', 'editor.action.moveLinesUpAction': 'moveLineUp',
    'editor.action.moveLinesDownAction': 'moveLineDown', 'editor.action.deleteLines': 'deleteLine', 'editor.action.commentLine': 'toggleComment',
    'editor.action.formatDocument': 'format', 'editor.action.revealDefinition': 'gotoDefinition', 'editor.action.goToReferences': 'findReferences',
    'editor.action.rename': 'renameSymbol', 'editor.action.addSelectionToNextFindMatch': 'selectNextOccurrence', 'editor.action.selectHighlights': 'selectAllOccurrences',
    'editor.action.insertCursorAbove': 'addCursorAbove', 'editor.action.insertCursorBelow': 'addCursorBelow', 'editor.foldAll': 'foldAll', 'editor.unfoldAll': 'unfoldAll',
    'workbench.action.files.save': 'save', 'editor.action.gotoLine': 'gotoLine', 'actions.find': 'openSearch', 'editor.action.toggleWordWrap': 'toggleWrap'
};
export function fromVSCodeKeybindings(text) {
    const arr = typeof text === 'string' ? parseJSONC(text) : text;
    const out = {};
    (Array.isArray(arr) ? arr : []).forEach(b => {
        const cmd = VSC_CMDS[b && b.command];
        if (!cmd || !b.key || /\s/.test(b.key.trim())) return;
        const key = b.key.split('+').map(p => ({ ctrl: 'Mod', cmd: 'Mod', shift: 'Shift', alt: 'Alt', meta: 'Meta' })[p.toLowerCase()] || (p.length === 1 ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1))).join('-');
        out[key] = cmd;
    });
    return out;
}

// ====================================================================== FAKE DATA (#170)
const AR_FIRST = ['محمد', 'أحمد', 'فاطمة', 'مريم', 'يوسف', 'سارة', 'علي', 'نور', 'خالد', 'ليلى', 'عمر', 'هدى', 'آدم', 'رنا', 'سليم', 'إيمان'];
const AR_LAST = ['بن علي', 'الطرابلسي', 'الحسيني', 'الزين', 'المنصوري', 'العبيدي', 'الشريف', 'القاسمي', 'الهاشمي', 'بوعزيزي'];
const EN_FIRST = ['Liam', 'Emma', 'Noah', 'Olivia', 'Ava', 'Elijah', 'Sophia', 'Lucas', 'Mia', 'Amelia', 'Ethan', 'Harper', 'Leo', 'Zoe'];
const EN_LAST = ['Smith', 'Johnson', 'Brown', 'Garcia', 'Miller', 'Davis', 'Martinez', 'Lopez', 'Wilson', 'Anderson', 'Taylor', 'Moore'];
const CITIES_AR = ['تونس', 'صفاقس', 'سوسة', 'القاهرة', 'الرباط', 'الجزائر', 'عمّان', 'بيروت', 'الرياض', 'دبي'];
const CITIES_EN = ['London', 'Paris', 'Berlin', 'Tunis', 'Madrid', 'Toronto', 'Tokyo', 'Austin', 'Lisbon', 'Dubai'];
const PRODUCTS = ['Laptop', 'Keyboard', 'Mouse', 'Monitor', 'Headphones', 'Webcam', 'Desk Lamp', 'USB Hub', 'SSD 1TB', 'Microphone'];
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
const LOREM_AR = 'هذا نص تجريبي يستخدم لملء المساحات في التصاميم والنماذج قبل وضع المحتوى الحقيقي النهائي للمشروع'.split(' ');
export function seededRandom(seed = Date.now()) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
export const FAKE_KINDS = { users: 'مستخدمون', products: 'منتجات', posts: 'منشورات', orders: 'طلبات', uuids: 'UUIDs', numbers: 'أرقام', dates: 'تواريخ', lorem: 'نص تجريبي' };
export function fakeData(kind = 'users', count = 5, { format = 'json', seed, locale = 'en' } = {}) {
    const r = seededRandom(seed == null ? Date.now() : seed);
    const pick = (a) => a[Math.floor(r() * a.length)];
    const int = (a, b) => a + Math.floor(r() * (b - a + 1));
    const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const v = Math.floor(r() * 16); return (c === 'x' ? v : (v & 3) | 8).toString(16); });
    const date = () => new Date(Date.UTC(2023 + int(0, 2), int(0, 11), int(1, 28), int(0, 23), int(0, 59))).toISOString();
    const ar = locale === 'ar';
    const n = Math.max(1, Math.min(1000, count | 0));
    const rows = [];
    for (let i = 1; i <= n; i++) {
        switch (kind) {
            case 'users': {
                const f = pick(ar ? AR_FIRST : EN_FIRST), l = pick(ar ? AR_LAST : EN_LAST);
                const latin = ar ? pick(EN_FIRST).toLowerCase() + '.' + pick(EN_LAST).toLowerCase() : `${f}.${l}`.toLowerCase();
                rows.push({ id: i, name: `${f} ${l}`, email: `${latin}${int(1, 99)}@example.com`, phone: `+216 ${int(20, 99)} ${int(100, 999)} ${int(100, 999)}`, age: int(18, 70), city: pick(ar ? CITIES_AR : CITIES_EN), active: r() > 0.25, createdAt: date() });
                break;
            }
            case 'products': rows.push({ id: i, sku: 'SKU-' + int(10000, 99999), name: pick(PRODUCTS), price: +(int(5, 2000) + r()).toFixed(2), stock: int(0, 500), rating: +(1 + r() * 4).toFixed(1) }); break;
            case 'posts': rows.push({ id: i, userId: int(1, 50), title: Array.from({ length: int(3, 7) }, () => pick(ar ? LOREM_AR : LOREM)).join(' '), body: Array.from({ length: int(12, 30) }, () => pick(ar ? LOREM_AR : LOREM)).join(' '), likes: int(0, 999), publishedAt: date() }); break;
            case 'orders': rows.push({ id: uuid(), customerId: int(1, 200), items: int(1, 6), total: +(int(10, 900) + r()).toFixed(2), status: pick(['pending', 'paid', 'shipped', 'delivered', 'cancelled']), createdAt: date() }); break;
            case 'uuids': rows.push({ id: uuid() }); break;
            case 'numbers': rows.push({ value: int(0, 10000) }); break;
            case 'dates': rows.push({ date: date() }); break;
            default: rows.push({ text: Array.from({ length: int(8, 20) }, () => pick(ar ? LOREM_AR : LOREM)).join(' ') });
        }
    }
    const flat = rows.length && Object.keys(rows[0]).length === 1 ? rows.map(x => Object.values(x)[0]) : null;
    switch (format) {
        case 'csv': { const keys = Object.keys(rows[0]); const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)); return [keys.join(','), ...rows.map(o => keys.map(k => q(o[k])).join(','))].join('\n') + '\n'; }
        case 'sql': { const keys = Object.keys(rows[0]); const v = (x) => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 'TRUE' : 'FALSE') : `'${String(x).replace(/'/g, "''")}'`); return rows.map(o => `INSERT INTO ${kind} (${keys.join(', ')}) VALUES (${keys.map(k => v(o[k])).join(', ')});`).join('\n') + '\n'; }
        case 'js': return `const ${kind} = ${JSON.stringify(flat || rows, null, 2)};\n`;
        case 'python': return `${kind} = ${JSON.stringify(flat || rows, null, 4).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None')}\n`;
        default: return JSON.stringify(flat || rows, null, 2) + '\n';
    }
}

// ====================================================================== ENV FILES (#159)
export function parseDotEnv(text) {
    const out = {};
    String(text || '').split('\n').forEach(l => {
        const m = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)?\s*$/.exec(l);
        if (!m) return;
        let v = (m[2] || '').trim();
        if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1).replace(/\\n/g, '\n');
        else v = v.replace(/\s+#.*$/, '');
        out[m[1]] = v;
    });
    return out;
}

// ====================================================================== FOLDER COMPARE (#249)
export function compareFolders(files, dirA, dirB) {
    const norm = (d) => d.replace(/\/+$/, '');
    const A = norm(dirA), B = norm(dirB);
    const collect = (dir) => { const m = new Map(); for (const [p, f] of files) if (p.startsWith(dir + '/')) m.set(p.slice(dir.length + 1), f); return m; };
    const a = collect(A), b = collect(B);
    const res = { onlyA: [], onlyB: [], changed: [], same: [] };
    new Set([...a.keys(), ...b.keys()]).forEach(rel => {
        const fa = a.get(rel), fb = b.get(rel);
        if (!fb) res.onlyA.push(rel);
        else if (!fa) res.onlyB.push(rel);
        else if ((fa.content || fa.dataUrl || '') === (fb.content || fb.dataUrl || '')) res.same.push(rel);
        else res.changed.push(rel);
    });
    Object.values(res).forEach(l => l.sort());
    return res;
}

// ====================================================================== HTML ACCESSIBILITY (#169)
export function auditHTML(html, DOMParserImpl = (typeof DOMParser !== 'undefined' ? DOMParser : null)) {
    if (!DOMParserImpl) return [];
    const doc = new DOMParserImpl().parseFromString(html, 'text/html');
    const issues = [];
    const lineOf = (el) => {
        const tag = el.outerHTML.slice(0, 60).split('>')[0];
        const i = html.indexOf(tag);
        return i < 0 ? null : html.slice(0, i).split('\n').length;
    };
    const add = (sev, rule, msg, el) => issues.push({ severity: sev, rule, message: msg, line: el ? lineOf(el) : null });
    const isFullDoc = /<html[\s>]/i.test(html);
    if (isFullDoc && !doc.documentElement.getAttribute('lang')) add('error', 'html-lang', 'عنصر <html> بلا سمة lang (قارئات الشاشة تحتاج لغة الصفحة)', null);
    if (isFullDoc && !doc.querySelector('title')?.textContent.trim()) add('warning', 'title', 'الصفحة بلا <title>', null);
    if (isFullDoc && !doc.querySelector('meta[name="viewport"]')) add('info', 'viewport', 'لا يوجد meta viewport (العرض على الجوال)', null);
    doc.querySelectorAll('img').forEach(el => { if (!el.hasAttribute('alt')) add('error', 'img-alt', 'صورة بلا نص بديل alt', el); });
    const named = (el) => (el.textContent || '').trim() || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.querySelector('img[alt]:not([alt=""])');
    doc.querySelectorAll('button, [role="button"]').forEach(el => { if (!named(el)) add('error', 'button-name', 'زر بلا اسم مقروء (نص أو aria-label)', el); });
    doc.querySelectorAll('a[href]').forEach(el => { if (!named(el)) add('error', 'link-name', 'رابط بلا نص', el); });
    doc.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea').forEach(el => {
        const id = el.getAttribute('id');
        const labelled = (id && doc.querySelector(`label[for="${id.replace(/"/g, '')}"]`)) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
        if (!labelled) add('error', 'label', `حقل ${el.tagName.toLowerCase()} بلا تسمية <label>`, el);
    });
    let last = 0;
    doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(el => { const lvl = +el.tagName[1]; if (last && lvl > last + 1) add('warning', 'heading-order', `قفزة في ترتيب العناوين: h${last} ← h${lvl}`, el); last = lvl; });
    if (isFullDoc && doc.querySelectorAll('h1').length === 0 && doc.body && doc.body.children.length) add('info', 'h1', 'لا يوجد عنوان رئيسي <h1>', null);
    const ids = {};
    doc.querySelectorAll('[id]').forEach(el => { const id = el.id; if (ids[id]) add('error', 'duplicate-id', `المعرّف id="${id}" مكرر`, el); ids[id] = 1; });
    doc.querySelectorAll('[tabindex]').forEach(el => { if (+el.getAttribute('tabindex') > 0) add('warning', 'tabindex', 'tabindex موجب يربك ترتيب التنقل بلوحة المفاتيح', el); });
    doc.querySelectorAll('[onclick]').forEach(el => { if (!/^(a|button|input|select|textarea|summary)$/i.test(el.tagName) && !el.getAttribute('role')) add('warning', 'click-role', `<${el.tagName.toLowerCase()}> قابل للنقر بلا role أو دعم لوحة المفاتيح`, el); });
    doc.querySelectorAll('video[autoplay]:not([muted]), audio[autoplay]').forEach(el => add('warning', 'autoplay', 'تشغيل تلقائي للصوت', el));
    return issues;
}
