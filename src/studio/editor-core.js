/**
 * OX-Alpha Studio — CodeMirror 6 editor core (lazy chunk).
 *
 * Pure editor concerns live here: themes, languages, keymaps, decorations
 * (bracket pairs, error lens, colour swatches, ghost text), macros and a
 * per-file EditorState cache. Everything that needs app knowledge (project
 * files, AI, symbols) comes in through `callbacks`.
 */
import { EditorState, EditorSelection, Compartment, StateField, StateEffect, Prec, RangeSetBuilder, Annotation } from '@codemirror/state';
import {
    EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor,
    rectangularSelection, crosshairCursor, highlightActiveLine, highlightWhitespace, highlightTrailingWhitespace,
    Decoration, WidgetType, ViewPlugin, hoverTooltip, runScopeHandlers, gutter, GutterMarker
} from '@codemirror/view';
import {
    defaultKeymap, history, historyKeymap, indentWithTab, toggleComment, selectLine, deleteLine, copyLineDown, copyLineUp,
    moveLineUp, moveLineDown, indentMore, indentLess, cursorMatchingBracket, selectParentSyntax, insertBlankLine,
    simplifySelection, undo, redo, selectAll, addCursorAbove, addCursorBelow, transposeChars
} from '@codemirror/commands';
import {
    syntaxHighlighting, defaultHighlightStyle, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap,
    foldAll, unfoldAll, foldCode, unfoldCode, syntaxTree, ensureSyntaxTree, LanguageDescription, StreamLanguage, foldService, indentUnit
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completeAnyWord } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches, selectNextOccurrence, selectSelectionMatches, openSearchPanel, gotoLine } from '@codemirror/search';
import { linter, lintGutter, lintKeymap, forEachDiagnostic, forceLinting, openLintPanel, nextDiagnostic } from '@codemirror/lint';
import { languages } from '@codemirror/language-data';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';

// Optional, heavy extensions are separate chunks loaded only when a setting needs them
// (vim ≈120KB, emmet ≈90KB + grammars, minimap, emacs) — keeps the editor's first load small.
const OPTIONAL = {
    vim: () => import('@replit/codemirror-vim'),
    emacs: () => import('@replit/codemirror-emacs'),
    minimap: () => import('@replit/codemirror-minimap'),
    emmet: () => import('@emmetio/codemirror6-plugin')
};
const optLoaded = {};
const optPromises = {};
export function loadOptionalExtension(name) {
    if (!optPromises[name]) optPromises[name] = OPTIONAL[name]().then((m) => (optLoaded[name] = m), (e) => { delete optPromises[name]; throw e; });
    return optPromises[name];
}

// ====================================================================== SETTINGS
export const DEFAULT_SETTINGS = {
    theme: 'ox', fontFamily: 'JetBrains Mono', fontSize: 13, lineHeight: 1.6, ligatures: true, tabSize: 2,
    wrap: false, lineNumbers: 'on', minimap: false, whitespace: false, indentGuides: true, bracketColors: true,
    errorLens: true, keymap: 'default', autocomplete: true, inlineAI: false, inlineDelay: 700, formatOnSave: false,
    trimOnSave: false, eslint: true, direction: 'auto', emmet: true, colorSwatches: true, hoverInfo: true,
    keybindings: {}, toolbar: null, preset: 'custom'
};

// ====================================================================== THEMES
const P = (o) => o;
export const THEMES = {
    ox: P({ label: 'OX (يتبع سمة التطبيق)', vars: true }),
    'one-dark': P({ label: 'One Dark', dark: true, bg: '#282c34', fg: '#abb2bf', gutter: '#636d83', sel: '#3e4451', line: '#2c313c', cursor: '#528bff', comment: '#7f848e', keyword: '#c678dd', string: '#98c379', number: '#d19a66', fn: '#61afef', type: '#e5c07b', prop: '#e06c75', tag: '#e06c75', op: '#56b6c2' }),
    dracula: P({ label: 'Dracula', dark: true, bg: '#282a36', fg: '#f8f8f2', gutter: '#6272a4', sel: '#44475a', line: '#2f3141', cursor: '#f8f8f0', comment: '#6272a4', keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', fn: '#50fa7b', type: '#8be9fd', prop: '#66d9ef', tag: '#ff79c6', op: '#ff79c6' }),
    monokai: P({ label: 'Monokai', dark: true, bg: '#272822', fg: '#f8f8f2', gutter: '#90908a', sel: '#49483e', line: '#3e3d32', cursor: '#f8f8f0', comment: '#75715e', keyword: '#f92672', string: '#e6db74', number: '#ae81ff', fn: '#a6e22e', type: '#66d9ef', prop: '#fd971f', tag: '#f92672', op: '#f92672' }),
    'github-dark': P({ label: 'GitHub Dark', dark: true, bg: '#0d1117', fg: '#c9d1d9', gutter: '#6e7681', sel: '#264f78', line: '#161b22', cursor: '#58a6ff', comment: '#8b949e', keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', fn: '#d2a8ff', type: '#ffa657', prop: '#79c0ff', tag: '#7ee787', op: '#ff7b72' }),
    'github-light': P({ label: 'GitHub Light', dark: false, bg: '#ffffff', fg: '#24292f', gutter: '#8c959f', sel: '#b6e3ff', line: '#f6f8fa', cursor: '#0969da', comment: '#6e7781', keyword: '#cf222e', string: '#0a3069', number: '#0550ae', fn: '#8250df', type: '#953800', prop: '#0550ae', tag: '#116329', op: '#cf222e' }),
    nord: P({ label: 'Nord', dark: true, bg: '#2e3440', fg: '#d8dee9', gutter: '#4c566a', sel: '#434c5e', line: '#3b4252', cursor: '#d8dee9', comment: '#616e88', keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', fn: '#88c0d0', type: '#8fbcbb', prop: '#d8dee9', tag: '#81a1c1', op: '#81a1c1' }),
    'tokyo-night': P({ label: 'Tokyo Night', dark: true, bg: '#1a1b26', fg: '#a9b1d6', gutter: '#3b4261', sel: '#283457', line: '#1e2030', cursor: '#c0caf5', comment: '#565f89', keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', fn: '#7aa2f7', type: '#2ac3de', prop: '#7dcfff', tag: '#f7768e', op: '#89ddff' }),
    'solarized-dark': P({ label: 'Solarized Dark', dark: true, bg: '#002b36', fg: '#93a1a1', gutter: '#586e75', sel: '#073642', line: '#073642', cursor: '#93a1a1', comment: '#586e75', keyword: '#859900', string: '#2aa198', number: '#d33682', fn: '#268bd2', type: '#b58900', prop: '#cb4b16', tag: '#268bd2', op: '#859900' }),
    'solarized-light': P({ label: 'Solarized Light', dark: false, bg: '#fdf6e3', fg: '#586e75', gutter: '#93a1a1', sel: '#eee8d5', line: '#eee8d5', cursor: '#586e75', comment: '#93a1a1', keyword: '#859900', string: '#2aa198', number: '#d33682', fn: '#268bd2', type: '#b58900', prop: '#cb4b16', tag: '#268bd2', op: '#859900' }),
    'ox-light': P({ label: 'فاتح هادئ', dark: false, bg: '#fbfbfd', fg: '#1f2937', gutter: '#9ca3af', sel: '#dbeafe', line: '#f3f4f6', cursor: '#2563eb', comment: '#9ca3af', keyword: '#7c3aed', string: '#047857', number: '#c2410c', fn: '#2563eb', type: '#b45309', prop: '#be185d', tag: '#7c3aed', op: '#475569' })
};

function themeExtension(name) {
    const p = THEMES[name] || THEMES.ox;
    // "ox" reads CSS variables so it follows the app's dark/light switch without reconfiguring
    const c = p.vars ? {
        bg: 'var(--cm-bg)', fg: 'var(--cm-fg)', gutter: 'var(--cm-gutter)', sel: 'var(--cm-sel)', line: 'var(--cm-line)', cursor: 'var(--cm-cursor)',
        comment: 'var(--syn-comment)', keyword: 'var(--syn-keyword)', string: 'var(--syn-string)', number: 'var(--syn-number)', fn: 'var(--syn-fn)',
        type: 'var(--syn-type)', prop: 'var(--syn-prop)', tag: 'var(--syn-tag)', op: 'var(--syn-op)'
    } : p;
    const view = EditorView.theme({
        '&': { color: c.fg, backgroundColor: c.bg, height: '100%' },
        '.cm-content': { caretColor: c.cursor },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.cursor, borderLeftWidth: '2px' },
        '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: c.sel + (p.vars ? '' : '') },
        '.cm-activeLine': { backgroundColor: c.line },
        '.cm-activeLineGutter': { backgroundColor: c.line, color: c.fg },
        '.cm-gutters': { backgroundColor: c.bg, color: c.gutter, border: 'none' },
        '.cm-foldPlaceholder': { backgroundColor: 'transparent', border: '1px solid ' + c.gutter, color: c.gutter },
        '.cm-tooltip': { backgroundColor: p.vars ? 'var(--bg-elevated)' : c.bg, color: c.fg, border: '1px solid ' + (p.vars ? 'var(--border-light)' : c.gutter) },
        '.cm-panels': { backgroundColor: p.vars ? 'var(--bg-elevated)' : c.line, color: c.fg },
        '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.25)', outline: '1px solid rgba(250, 204, 21, 0.5)' },
        '.cm-selectionMatch': { backgroundColor: 'rgba(96, 165, 250, 0.18)' },
        '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'rgba(148, 163, 184, 0.25)', outline: '1px solid rgba(148, 163, 184, 0.5)' }
    }, { dark: p.vars ? true : !!p.dark });
    const hl = HighlightStyle.define([
        { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self], color: c.keyword },
        { tag: [t.bool, t.null, t.atom, t.number, t.integer, t.float, t.constant(t.variableName), t.standard(t.variableName)], color: c.number },
        { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.character, t.docString], color: c.string },
        { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta, t.processingInstruction], color: c.comment, fontStyle: 'italic' },
        { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.macroName], color: c.fn },
        { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.annotation], color: c.type },
        { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName), t.labelName], color: c.prop },
        { tag: [t.tagName, t.angleBracket], color: c.tag },
        { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator, t.updateOperator], color: c.op },
        { tag: [t.variableName, t.definition(t.variableName), t.punctuation, t.bracket, t.separator], color: c.fg },
        { tag: t.heading, color: c.fn, fontWeight: 'bold' },
        { tag: [t.link, t.url], color: c.string, textDecoration: 'underline' },
        { tag: t.emphasis, fontStyle: 'italic' },
        { tag: t.strong, fontWeight: 'bold' },
        { tag: t.strikethrough, textDecoration: 'line-through' },
        { tag: t.invalid, color: '#f87171' }
    ]);
    return [view, syntaxHighlighting(hl), syntaxHighlighting(defaultHighlightStyle, { fallback: true })];
}

// ====================================================================== I18N
const PHRASES = {
    'Find': 'بحث', 'Replace': 'استبدال', 'next': 'التالي', 'previous': 'السابق', 'all': 'الكل', 'match case': 'مطابقة الحالة',
    'by word': 'كلمة كاملة', 'regexp': 'Regex', 'replace': 'استبدال', 'replace all': 'استبدال الكل', 'close': 'إغلاق',
    'current match': 'التطابق الحالي', 'on line': 'في السطر', 'replaced match on line $': 'تم الاستبدال في السطر $',
    'replaced $ matches': 'تم استبدال $ تطابق', 'Go to line': 'انتقل إلى السطر', 'go': 'اذهب', 'Folded lines': 'أسطر مطوية',
    'Unfolded lines': 'أسطر مفتوحة', 'Fold line': 'طي', 'Unfold line': 'فك الطي', 'folded code': 'كود مطوي', 'unfold': 'فك الطي',
    'Diagnostics': 'التشخيصات', 'No diagnostics': 'لا توجد مشاكل', 'Completions': 'الإكمال', 'Selection deleted': 'تم حذف التحديد',
    'Control character': 'محرف تحكم'
};

// ====================================================================== LANGUAGES
const ALIASES = { jsonc: 'json', json5: 'json', svelte: 'html', astro: 'html', env: 'properties', mdx: 'markdown', h: 'c', hpp: 'cpp', cc: 'cpp', bash: 'sh', zsh: 'sh', ps1: 'powershell', kt: 'kotlin', kts: 'kotlin', rs: 'rust', rb: 'ruby', yml: 'yaml', htm: 'html', mjs: 'js', cjs: 'js' };
export function findLanguage(path) {
    const name = String(path || '').split('/').pop();
    let d = LanguageDescription.matchFilename(languages, name);
    if (!d) {
        const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
        const alias = ALIASES[ext];
        if (alias) d = LanguageDescription.matchFilename(languages, 'x.' + alias) || LanguageDescription.matchLanguageName(languages, alias, true);
        if (!d && name.toLowerCase() === '.gitignore') d = LanguageDescription.matchLanguageName(languages, 'shell', true);
    }
    return d || null;
}
export const languageCount = () => languages.length;
export const languageNames = () => languages.map(l => l.name);

// Indentation folding for legacy (stream) languages that carry no syntax-tree fold info
const indentFold = foldService.of((state, from) => {
    const line = state.doc.lineAt(from);
    if (!line.text.trim()) return null;
    const ind = /^\s*/.exec(line.text)[0].length;
    let end = line.number, n = line.number + 1;
    while (n <= state.doc.lines) {
        const l = state.doc.line(n);
        if (l.text.trim()) { if (/^\s*/.exec(l.text)[0].length <= ind) break; end = n; }
        n++;
    }
    return end > line.number ? { from: line.to, to: state.doc.line(end).to } : null;
});

// ====================================================================== DECORATIONS
// --- Bracket pair colourisation (#266)
const BRACKETS = { '(': 1, '[': 1, '{': 1, ')': -1, ']': -1, '}': -1 };
const bpMarks = [0, 1, 2].map(i => Decoration.mark({ class: 'cm-bp-' + i }));
function bracketDecorations(view) {
    const b = new RangeSetBuilder();
    const { from: vf, to: vt } = view.viewport;
    const tree = syntaxTree(view.state);
    const found = [];
    let sawNodes = false;
    tree.iterate({
        to: vt, enter: (n) => {
            const name = n.name;
            if (BRACKETS[name] && n.to - n.from === 1) { sawNodes = true; found.push([n.from, BRACKETS[name]]); }
        }
    });
    if (!sawNodes && !(view.state.facet(EditorState.languageData) || []).length) return Decoration.none;
    if (!sawNodes) {
        // Stream languages: plain scan (no string awareness) limited to the viewport prefix
        const text = view.state.doc.sliceString(Math.max(0, vt - 200000), vt);
        const base = Math.max(0, vt - 200000);
        for (let i = 0; i < text.length; i++) if (BRACKETS[text[i]]) found.push([base + i, BRACKETS[text[i]]]);
    }
    let depth = 0;
    for (const [pos, dir] of found) {
        if (dir < 0) depth = Math.max(0, depth - 1);
        if (pos >= vf) b.add(pos, pos + 1, bpMarks[depth % 3]);
        if (dir > 0) depth++;
    }
    return b.finish();
}
const bracketColors = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = bracketDecorations(view); }
    update(u) { if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = bracketDecorations(u.view); }
}, { decorations: v => v.decorations });

// --- Error lens (#268): show the most severe diagnostic message at the end of its line
class LensWidget extends WidgetType {
    constructor(msg, sev) { super(); this.msg = msg; this.sev = sev; }
    eq(o) { return o.msg === this.msg && o.sev === this.sev; }
    toDOM() { const s = document.createElement('span'); s.className = 'cm-lens cm-lens-' + this.sev; s.textContent = this.msg; return s; }
    ignoreEvent() { return true; }
}
const SEV = { error: 3, warning: 2, info: 1, hint: 0 };
function lensDecorations(state) {
    const perLine = new Map();
    forEachDiagnostic(state, (d, from) => {
        const line = state.doc.lineAt(Math.min(from, state.doc.length));
        const cur = perLine.get(line.number);
        if (!cur || SEV[d.severity] > SEV[cur.severity]) perLine.set(line.number, { severity: d.severity, message: d.message, to: line.to });
    });
    const items = Array.from(perLine.values()).sort((a, b) => a.to - b.to);
    const b = new RangeSetBuilder();
    items.forEach(x => b.add(x.to, x.to, Decoration.widget({ widget: new LensWidget(x.message.split('\n')[0].slice(0, 160), x.severity), side: 1 })));
    return b.finish();
}
const errorLens = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = lensDecorations(view.state); }
    update(u) { if (u.docChanged || u.transactions.some(tr => tr.effects.length)) this.decorations = lensDecorations(u.state); }
}, { decorations: v => v.decorations });

// --- Colour swatches + picker (#191)
const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*\d+[\s,]+\d+[\s,]+\d+(?:[\s,/]+[\d.]+%?)?\s*\)|hsla?\([^)]{5,40}\)/g;
export function toHex(css) {
    const m = /^#([0-9a-f]{3,8})$/i.exec(css);
    if (m) { let h = m[1]; if (h.length <= 4) h = h.split('').map(x => x + x).join(''); return '#' + h.slice(0, 6).toLowerCase(); }
    const r = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(css);
    if (r) return '#' + [r[1], r[2], r[3]].map(n => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, '0')).join('');
    return null;
}
class SwatchWidget extends WidgetType {
    constructor(color, from, to) { super(); this.color = color; this.from = from; this.to = to; }
    eq(o) { return o.color === this.color && o.from === this.from; }
    toDOM(view) {
        const s = document.createElement('span');
        s.className = 'cm-color-swatch';
        s.style.background = this.color;
        s.title = 'انقر لاختيار لون';
        s.onmousedown = (e) => {
            e.preventDefault();
            const input = document.createElement('input');
            input.type = 'color';
            input.value = toHex(this.color) || '#000000';
            input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;left:0;top:0';
            document.body.appendChild(input);
            const from = this.from, len = this.to - this.from;
            input.addEventListener('input', () => {
                const cur = view.state.sliceDoc(from, from + len);
                view.dispatch({ changes: { from, to: from + cur.length, insert: input.value }, userEvent: 'input.color' });
            });
            input.addEventListener('change', () => input.remove());
            input.click();
        };
        return s;
    }
    ignoreEvent() { return false; }
}
function swatchDecorations(view) {
    const b = new RangeSetBuilder();
    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        let m; COLOR_RE.lastIndex = 0;
        while ((m = COLOR_RE.exec(text))) {
            const start = from + m.index;
            b.add(start, start, Decoration.widget({ widget: new SwatchWidget(m[0], start, start + m[0].length), side: -1 }));
        }
    }
    return b.finish();
}
const colorSwatches = ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = swatchDecorations(view); }
    update(u) { if (u.docChanged || u.viewportChanged) this.decorations = swatchDecorations(u.view); }
}, { decorations: v => v.decorations });

// --- Relative line numbers (#199)
class NumMarker extends GutterMarker { constructor(n) { super(); this.n = n; } eq(o) { return o.n === this.n; } toDOM() { return document.createTextNode(this.n); } }
const relativeNumbers = gutter({
    class: 'cm-lineNumbers cm-relativeNumbers',
    lineMarker(view, line) {
        const n = view.state.doc.lineAt(line.from).number;
        const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
        return new NumMarker(n === cur ? String(n) : String(Math.abs(cur - n)));
    },
    lineMarkerChange: (u) => u.selectionSet || u.docChanged,
    initialSpacer: (view) => new NumMarker(String(view.state.doc.lines))
});

// --- AI ghost text (#211)
const setGhost = StateEffect.define();
const ghostField = StateField.define({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setGhost)) return e.value;
        if (value && (tr.docChanged || tr.selection)) return null;
        return value;
    },
    provide: f => EditorView.decorations.from(f, (g) => g && g.text
        ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)])
        : Decoration.none)
});
class GhostWidget extends WidgetType {
    constructor(text) { super(); this.text = text; }
    eq(o) { return o.text === this.text; }
    toDOM() { const s = document.createElement('span'); s.className = 'cm-ghost'; s.textContent = this.text; s.title = 'Tab للقبول • Esc للإلغاء'; return s; }
}
function acceptGhost(view) {
    const g = view.state.field(ghostField, false);
    if (!g || !g.text) return false;
    view.dispatch({ changes: { from: g.pos, insert: g.text }, selection: EditorSelection.cursor(g.pos + g.text.length), effects: setGhost.of(null), userEvent: 'input.complete' });
    return true;
}
function dismissGhost(view) {
    if (!view.state.field(ghostField, false)) return false;
    view.dispatch({ effects: setGhost.of(null) });
    return true;
}

// ====================================================================== SYNTAX DIAGNOSTICS (#141 baseline, all Lezer languages)
export function syntaxDiagnostics(state, max = 25) {
    const out = [];
    const tree = ensureSyntaxTree(state, state.doc.length, 300) || syntaxTree(state);
    tree.iterate({
        enter: (n) => {
            if (out.length >= max) return false;
            if (n.type.isError) {
                const from = n.from, line = state.doc.lineAt(from);
                const to = Math.max(n.to, Math.min(line.to, from + 1));
                if (!out.length || out[out.length - 1].from !== from) out.push({ from, to, severity: 'error', message: 'خطأ نحوي: ' + (n.to > n.from ? `«${state.sliceDoc(n.from, Math.min(n.to, n.from + 30))}» غير متوقع هنا` : 'رمز ناقص أو غير مكتمل'), source: 'syntax' });
            }
        }
    });
    return out;
}

// ====================================================================== COMMANDS (named — for palette, keybindings and macros)
export const COMMANDS = {
    undo: ['تراجع', undo], redo: ['إعادة', redo], selectAll: ['تحديد الكل', selectAll],
    toggleComment: ['تبديل التعليق', toggleComment], selectLine: ['تحديد السطر', selectLine], deleteLine: ['حذف السطر', deleteLine],
    copyLineDown: ['تكرار السطر للأسفل', copyLineDown], copyLineUp: ['تكرار السطر للأعلى', copyLineUp],
    moveLineUp: ['نقل السطر للأعلى', moveLineUp], moveLineDown: ['نقل السطر للأسفل', moveLineDown],
    indentMore: ['زيادة المسافة', indentMore], indentLess: ['إنقاص المسافة', indentLess],
    cursorMatchingBracket: ['القوس المقابل', cursorMatchingBracket], selectParentSyntax: ['توسيع التحديد', selectParentSyntax],
    insertBlankLine: ['سطر جديد أسفل', insertBlankLine], simplifySelection: ['مؤشر واحد', simplifySelection],
    addCursorAbove: ['مؤشر إضافي للأعلى', addCursorAbove], addCursorBelow: ['مؤشر إضافي للأسفل', addCursorBelow],
    selectNextOccurrence: ['تحديد التطابق التالي', selectNextOccurrence], selectAllOccurrences: ['تحديد كل التطابقات', selectSelectionMatches],
    transposeChars: ['تبديل حرفين', transposeChars], foldAll: ['طي الكل', foldAll], unfoldAll: ['فك طي الكل', unfoldAll],
    foldCode: ['طي الكتلة', foldCode], unfoldCode: ['فك طي الكتلة', unfoldCode],
    openSearch: ['بحث واستبدال', openSearchPanel], gotoLine: ['انتقال إلى سطر', gotoLine],
    openLintPanel: ['قائمة المشاكل', openLintPanel], nextDiagnostic: ['المشكلة التالية', nextDiagnostic]
};

// Sublime-style extras on top of the default keymap (#138)
const sublimeKeymap = [
    { key: 'Mod-Shift-k', run: deleteLine }, { key: 'Mod-l', run: selectLine }, { key: 'Mod-Shift-d', run: copyLineDown },
    { key: 'Mod-Shift-ArrowUp', run: moveLineUp }, { key: 'Mod-Shift-ArrowDown', run: moveLineDown },
    { key: 'Mod-Alt-Enter', run: insertBlankLine }, { key: 'Mod-m', run: cursorMatchingBracket }, { key: 'Mod-Shift-Space', run: selectParentSyntax }
];

const EMMET_SYNTAX = { html: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', sass: 'sass', less: 'less', jsx: 'jsx', tsx: 'jsx' };
const silent = Annotation.define();

// ====================================================================== EDITOR FACTORY
export function createEditor({ parent, doc = '', path = 'untitled.txt', settings = {}, callbacks = {} }) {
    let cfg = { ...DEFAULT_SETTINGS, ...settings };
    let currentPath = path;
    let langName = '';
    let isStream = false;
    const states = new Map();
    let alive = true;
    const pendingOpt = new Set();
    /** Returns the optional module if loaded; otherwise starts loading it and reconfigures when ready. */
    const opt = (name) => {
        if (optLoaded[name]) return optLoaded[name];
        if (!pendingOpt.has(name)) {
            pendingOpt.add(name);
            loadOptionalExtension(name).then(() => { if (alive && editorView) reconfigureAll(); }, (e) => { pendingOpt.delete(name); console.warn('[editor] optional extension failed:', name, e); });
        }
        return null;
    };
    const C = {}; ['lang', 'theme', 'font', 'wrap', 'minimap', 'keymap', 'numbers', 'whitespace', 'indent', 'brackets', 'lens', 'user', 'emmet', 'dir', 'tab', 'complete', 'colors', 'fold'].forEach(k => { C[k] = new Compartment(); });
    let recording = null, replaying = false;

    const ext = (k) => {
        switch (k) {
            case 'theme': return themeExtension(cfg.theme);
            case 'font': return EditorView.theme({
                '&': { fontSize: (+cfg.fontSize || 13) + 'px' },
                '.cm-scroller': { fontFamily: `'${cfg.fontFamily}', 'JetBrains Mono', ui-monospace, monospace`, lineHeight: String(cfg.lineHeight || 1.6), fontVariantLigatures: cfg.ligatures ? 'contextual' : 'none', fontFeatureSettings: cfg.ligatures ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0' }
            });
            case 'wrap': return cfg.wrap ? EditorView.lineWrapping : [];
            case 'minimap': return cfg.minimap && opt('minimap') ? opt('minimap').showMinimap.compute(['doc'], () => ({ create: () => ({ dom: document.createElement('div') }), displayText: 'blocks', showOverlay: 'always' })) : [];
            case 'keymap': return cfg.keymap === 'vim' ? (opt('vim') ? opt('vim').vim() : []) : cfg.keymap === 'emacs' ? (opt('emacs') ? opt('emacs').emacs() : []) : cfg.keymap === 'sublime' ? Prec.high(keymap.of(sublimeKeymap)) : [];
            case 'numbers': return cfg.lineNumbers === 'off' ? [] : cfg.lineNumbers === 'relative' ? [relativeNumbers, highlightActiveLineGutter()] : [lineNumbers(), highlightActiveLineGutter()];
            case 'whitespace': return cfg.whitespace ? [highlightWhitespace(), highlightTrailingWhitespace()] : [];
            case 'indent': return cfg.indentGuides ? indentationMarkers({ thickness: 1, colors: { light: '#cbd5e1', dark: '#334155', activeLight: '#94a3b8', activeDark: '#64748b' } }) : [];
            case 'brackets': return cfg.bracketColors ? bracketColors : [];
            case 'lens': return cfg.errorLens ? errorLens : [];
            case 'user': return Prec.high(keymap.of(Object.entries(cfg.keybindings || {}).filter(([, c]) => c).map(([key, cmd]) => ({ key, run: (v) => runNamed(cmd, v), preventDefault: true }))));
            case 'emmet': {
                const syn = EMMET_SYNTAX[(currentPath.split('.').pop() || '').toLowerCase()];
                const em = cfg.emmet && syn ? opt('emmet') : null;
                return em ? [em.emmetConfig.of({ syntax: syn }), em.abbreviationTracker()] : [];
            }
            case 'dir': return cfg.direction === 'rtl' ? EditorView.contentAttributes.of({ dir: 'rtl' })
                : cfg.direction === 'ltr' ? EditorView.contentAttributes.of({ dir: 'ltr' }) : EditorView.perLineTextDirection.of(true);
            case 'tab': return [EditorState.tabSize.of(+cfg.tabSize || 2), indentUnit.of(' '.repeat(+cfg.tabSize || 2))];
            case 'complete': return cfg.autocomplete ? autocompletion({ activateOnTyping: true, override: null }) : [];
            case 'colors': return cfg.colorSwatches ? colorSwatches : [];
            case 'fold': return isStream ? indentFold : [];
            default: return [];
        }
    };

    function runNamed(name, view = editorView) {
        const c = COMMANDS[name];
        if (c) return c[1](view) !== false;
        if (callbacks.command) { callbacks.command(name); return true; }
        return false;
    }

    // Top-precedence keys: ghost text, emmet, macro recording
    const topKeys = Prec.highest(keymap.of([
        { key: 'Tab', run: (v) => acceptGhost(v) || (cfg.emmet && EMMET_SYNTAX[(currentPath.split('.').pop() || '').toLowerCase()] && optLoaded.emmet ? optLoaded.emmet.expandAbbreviation(v) : false) },
        { key: 'Escape', run: dismissGhost }
    ]));
    const appKeys = Prec.high(keymap.of([
        ['Mod-s', 'save'], ['Shift-Alt-f', 'format'], ['Alt-w', 'toggleWrap'], ['F12', 'gotoDefinition'],
        ['Shift-F12', 'findReferences'], ['F2', 'renameSymbol'], ['Mod-i', 'aiEdit'], ['Mod-Enter', 'runFile'], ['Shift-Enter', 'runSelection'],
        ['Mod-Alt-z', 'zen'], ['Mod-Alt-r', 'macroToggle'], ['Mod-Alt-p', 'macroPlay'], ['Mod-Alt-e', 'aiExplain'], ['Mod-Alt-v', 'togglePreview'],
        ['Mod-\\', 'splitEditor'], ['Mod-Alt-l', 'toggleMinimap']
    ].map(([key, cmd]) => ({ key, run: () => { if (callbacks.command) callbacks.command(cmd); return true; }, preventDefault: true }))));

    const recorder = [
        Prec.highest(EditorView.domEventHandlers({
            keydown(e) {
                if (!recording || replaying) return false;
                if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return false;
                const isCmd = e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey;
                if (isCmd && !(e.ctrlKey && e.altKey && e.key.toLowerCase() === 'r')) recording.push({ k: e.key, c: e.ctrlKey, s: e.shiftKey, a: e.altKey, m: e.metaKey });
                return false;
            }
        })),
        EditorView.inputHandler.of((view, from, to, text) => { if (recording && !replaying) recording.push({ t: text }); return false; })
    ];

    const lint = cfg.lintEnabled === false ? [] : [
        linter(async (view) => {
            const doc = view.state.doc.toString();
            const own = (!isStream && langName && !/markdown|plain/i.test(langName)) ? syntaxDiagnostics(view.state) : [];
            let extra = [];
            try { extra = (callbacks.lint && (await callbacks.lint(doc, currentPath))) || []; } catch (e) { extra = []; }
            if (view.state.doc.toString() !== doc) return [];
            const len = view.state.doc.length;
            return own.concat(extra).filter(d => d && d.from >= 0 && d.from <= len).map(d => ({ ...d, to: Math.min(Math.max(d.to ?? d.from, d.from), len) }));
        }, { delay: 600 }),
        lintGutter()
    ];

    // Project-wide symbols (IntelliSense #133): names defined in other files of the project
    const projectSource = (context) => {
        if (!callbacks.completions) return null;
        const word = context.matchBefore(/[\w$]+/);
        if (!word || (word.from === word.to && !context.explicit) || word.to - word.from < 2 && !context.explicit) return null;
        let items = [];
        try { items = callbacks.completions(word.text, currentPath) || []; } catch (e) { items = []; }
        if (!items.length) return null;
        return { from: word.from, options: items.map(it => ({ label: it.label, type: it.type, detail: it.detail, info: it.info, boost: it.boost || 0 })), validFor: /^[\w$]*$/ };
    };

    const hover = hoverTooltip(async (view, pos) => {
        if (!cfg.hoverInfo || !callbacks.hover) return null;
        const line = view.state.doc.lineAt(pos);
        const tok = tokenAt(line.text, pos - line.from);
        if (!tok) return null;
        let res = null;
        try { res = await callbacks.hover({ word: tok.word, token: tok.token, lineText: line.text, line: line.number, path: currentPath }); } catch (e) { res = null; }
        if (!res) return null;
        return {
            pos: line.from + tok.from, end: line.from + tok.to, above: true,
            create() { const dom = document.createElement('div'); dom.className = 'cm-ox-hover'; if (res.node) dom.appendChild(res.node); else dom.innerHTML = res.html || ''; return { dom }; }
        };
    }, { hoverTime: 350 });

    const ctrlClick = EditorView.domEventHandlers({
        mousedown(e, view) {
            if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || !callbacks.command) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const line = view.state.doc.lineAt(pos);
            const tok = tokenAt(line.text, pos - line.from);
            if (!tok || !tok.word) return false;
            e.preventDefault();
            callbacks.command('gotoDefinition', { word: tok.word });
            return true;
        }
    });

    // Inline AI trigger (debounced after typing)
    let ghostTimer = null, ghostSeq = 0;
    const ghostTrigger = ViewPlugin.fromClass(class {
        update(u) {
            if (!cfg.inlineAI || !callbacks.inlineSuggest) return;
            if (!u.docChanged || !u.transactions.some(tr => tr.isUserEvent('input.type') || tr.isUserEvent('delete'))) return;
            clearTimeout(ghostTimer);
            const seq = ++ghostSeq;
            ghostTimer = setTimeout(() => requestGhost(u.view, seq), +cfg.inlineDelay || 700);
        }
        destroy() { clearTimeout(ghostTimer); }
    });
    async function requestGhost(view, seq) {
        const st = view.state, sel = st.selection.main;
        if (!sel.empty) return;
        const pos = sel.head, line = st.doc.lineAt(pos);
        const after = line.text.slice(pos - line.from);
        if (after.trim() && !/^[\s)\]}'"`;,]*$/.test(after)) return;
        const doc = st.doc;
        let text = null;
        try { text = await callbacks.inlineSuggest({ prefix: doc.sliceString(Math.max(0, pos - 4000), pos), suffix: doc.sliceString(pos, Math.min(doc.length, pos + 1500)), path: currentPath, language: langName }); } catch (e) { text = null; }
        if (!text || seq !== ghostSeq || view.state.doc !== doc || view.state.selection.main.head !== pos) return;
        view.dispatch({ effects: setGhost.of({ pos, text }) });
    }

    const updates = EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some(tr => tr.annotation(silent)) && callbacks.onChange) callbacks.onChange(u.state.doc.toString(), currentPath);
        if ((u.selectionSet || u.docChanged) && callbacks.onCursor) callbacks.onCursor();
        if (u.focusChanged && callbacks.onFocus) callbacks.onFocus(u.view.hasFocus);
    });

    function extensions() {
        return [
            C.keymap.of(ext('keymap')), // vim/emacs must come first
            topKeys, recorder, C.user.of(ext('user')), appKeys,
            C.numbers.of(ext('numbers')), foldGutter({ openText: '▾', closedText: '▸' }), C.fold.of(ext('fold')),
            highlightSpecialChars(), history(), drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
            EditorView.clickAddsSelectionRange.of(e => e.altKey && !e.shiftKey),
            indentOnInput(), bracketMatching(), closeBrackets(), C.complete.of(ext('complete')),
            EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }, { autocomplete: projectSource }]),
            rectangularSelection({ eventFilter: e => e.altKey && e.shiftKey }), crosshairCursor({ key: 'Alt' }),
            highlightActiveLine(), highlightSelectionMatches(),
            keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
            C.lang.of([]), C.theme.of(ext('theme')), C.font.of(ext('font')), C.wrap.of(ext('wrap')), C.minimap.of(ext('minimap')),
            C.whitespace.of(ext('whitespace')), C.indent.of(ext('indent')), C.brackets.of(ext('brackets')), C.lens.of(ext('lens')),
            C.emmet.of(ext('emmet')), C.dir.of(ext('dir')), C.tab.of(ext('tab')), C.colors.of(ext('colors')),
            EditorView.editorAttributes.of({ dir: 'ltr', class: 'ox-cm' }), EditorState.phrases.of(PHRASES),
            ghostField, ghostTrigger, hover, ctrlClick, ...lint, updates
        ];
    }

    const editorView = new EditorView({ parent, state: EditorState.create({ doc, extensions: extensions() }) });

    function reconfigureAll() {
        editorView.dispatch({ effects: Object.keys(C).filter(k => k !== 'lang').map(k => C[k].reconfigure(ext(k))) });
    }

    let langSeq = 0;
    async function loadLanguage(p) {
        const seq = ++langSeq;
        const d = findLanguage(p);
        langName = d ? d.name : 'Plain Text';
        let support = [];
        isStream = false;
        if (d) {
            try {
                support = await d.load();
                isStream = !!(support && support.language instanceof StreamLanguage);
            } catch (e) { support = []; }
        }
        if (seq !== langSeq) return langName;
        editorView.dispatch({ effects: [C.lang.reconfigure(support), C.fold.reconfigure(ext('fold')), C.emmet.reconfigure(ext('emmet'))] });
        if (callbacks.onLanguage) callbacks.onLanguage(langName);
        return langName;
    }

    function setValue(text, { keepSelection = true, notify = false } = {}) {
        text = text == null ? '' : String(text);
        const cur = editorView.state.doc.toString();
        if (cur === text) return;
        // Minimal diff (common prefix/suffix) keeps the cursor and undo history meaningful
        let a = 0; const max = Math.min(cur.length, text.length);
        while (a < max && cur.charCodeAt(a) === text.charCodeAt(a)) a++;
        let b = 0;
        while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
        editorView.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) }, annotations: notify ? [] : silent.of(true), userEvent: notify ? 'input.replace' : 'external', selection: keepSelection ? undefined : EditorSelection.cursor(0) });
    }

    const api = {
        view: editorView,
        get dom() { return editorView.dom; },
        getValue: () => editorView.state.doc.toString(),
        setValue,
        getPath: () => currentPath,
        languageName: () => langName,
        isStreamLanguage: () => isStream,
        async openFile(p, text) {
            if (p === currentPath) { setValue(text); return langName; }
            states.set(currentPath, editorView.state);
            if (states.size > 40) states.delete(states.keys().next().value);
            const cached = states.get(p);
            currentPath = p;
            if (cached) {
                editorView.setState(cached);
                reconfigureAll();
                if (cached.doc.toString() !== text) setValue(text);
            } else {
                editorView.setState(EditorState.create({ doc: text == null ? '' : String(text), extensions: extensions() }));
            }
            return loadLanguage(p);
        },
        loadLanguage: () => loadLanguage(currentPath),
        renamePath(oldP, newP) { if (states.has(oldP)) { states.set(newP, states.get(oldP)); states.delete(oldP); } if (currentPath === oldP) { currentPath = newP; loadLanguage(newP); } },
        dropPath(p) { states.delete(p); },
        getSelection() { const s = editorView.state.selection; return { from: s.main.from, to: s.main.to, head: s.main.head, anchor: s.main.anchor, ranges: s.ranges.map(r => ({ from: r.from, to: r.to })) }; },
        setSelection(from, to = from, { scroll = true, center = true } = {}) {
            const len = editorView.state.doc.length;
            from = Math.max(0, Math.min(from, len)); to = Math.max(0, Math.min(to, len));
            editorView.dispatch({ selection: EditorSelection.range(from, to), effects: scroll ? EditorView.scrollIntoView(from, { y: center ? 'center' : 'nearest' }) : [] });
        },
        replaceRange(from, to, text, selFrom, selTo) {
            const spec = { changes: { from, to, insert: text }, userEvent: 'input.replace' };
            if (selFrom !== undefined) {
                const len = editorView.state.doc.length - (to - from) + text.length;
                spec.selection = EditorSelection.range(Math.min(selFrom, len), Math.min(selTo !== undefined ? selTo : selFrom, len));
            }
            editorView.dispatch(spec);
        },
        insertAtCursor(text) { editorView.dispatch(editorView.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true }); },
        /** Apply fn(text, range) to every selection range (multi-cursor aware). */
        transformSelections(fn) {
            const st = editorView.state;
            const tr = st.changeByRange(r => {
                const text = st.sliceDoc(r.from, r.to);
                const out = fn(text, r);
                if (out == null || out === text) return { range: r };
                return { changes: { from: r.from, to: r.to, insert: out }, range: EditorSelection.range(r.from, r.from + out.length) };
            });
            editorView.dispatch(st.update(tr, { userEvent: 'input.transform' }));
        },
        /** Expand each selection to whole lines; returns [{from,to,text}] */
        selectedLineBlocks() {
            const st = editorView.state;
            return st.selection.ranges.map(r => {
                const a = st.doc.lineAt(r.from), bLine = st.doc.lineAt(r.to > r.from && st.doc.lineAt(r.to).from === r.to ? r.to - 1 : r.to);
                return { from: a.from, to: bLine.to, text: st.sliceDoc(a.from, bLine.to) };
            });
        },
        focus: () => editorView.focus(),
        hasFocus: () => editorView.hasFocus,
        get scrollTop() { return editorView.scrollDOM.scrollTop; },
        set scrollTop(v) { editorView.scrollDOM.scrollTop = v; },
        scrollToLine(n, { select = false } = {}) {
            const doc = editorView.state.doc;
            const line = doc.line(Math.max(1, Math.min(n, doc.lines)));
            editorView.dispatch({ selection: select ? EditorSelection.range(line.from, line.to) : EditorSelection.cursor(line.from), effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
            editorView.focus();
        },
        lineAt(pos) { const l = editorView.state.doc.lineAt(pos == null ? editorView.state.selection.main.head : pos); return { number: l.number, from: l.from, to: l.to, text: l.text }; },
        lineCount: () => editorView.state.doc.lines,
        wordAt(pos) {
            const st = editorView.state, p = pos == null ? st.selection.main.head : pos;
            const line = st.doc.lineAt(p);
            const tok = tokenAt(line.text, p - line.from) || tokenAt(line.text, p - line.from - 1);
            return tok && tok.word ? { word: tok.word, from: line.from + tok.from, to: line.from + tok.to } : null;
        },
        configure(next) { cfg = { ...cfg, ...next }; reconfigureAll(); },
        getSettings: () => ({ ...cfg }),
        runCommand: (name) => runNamed(name),
        commands: () => Object.entries(COMMANDS).map(([id, [label]]) => ({ id, label })),
        forceLint() { try { forceLinting(editorView); } catch (e) { /* lint not configured */ } },
        diagnostics() { const out = []; forEachDiagnostic(editorView.state, (d, from, to) => out.push({ ...d, from, to, line: editorView.state.doc.lineAt(from).number })); return out; },
        // ---- macros (#252-#256)
        startRecording() { recording = []; },
        stopRecording() { const r = recording || []; recording = null; return r; },
        isRecording: () => !!recording,
        typeText(text) {
            const st = editorView.state, { from, to } = st.selection.main;
            const insert = () => editorView.state.update(editorView.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
            const handled = st.facet(EditorView.inputHandler).some(h => h(editorView, from, to, text, insert));
            if (!handled) editorView.dispatch(insert());
        },
        pressKey(step) {
            const ev = new KeyboardEvent('keydown', { key: step.k, ctrlKey: !!step.c, shiftKey: !!step.s, altKey: !!step.a, metaKey: !!step.m, bubbles: true, cancelable: true });
            if (recording && !replaying) recording.push({ k: step.k, c: !!step.c, s: !!step.s, a: !!step.a, m: !!step.m });
            return runScopeHandlers(editorView, ev, 'editor');
        },
        playMacro(steps, times = 1) {
            replaying = true;
            try {
                for (let i = 0; i < Math.max(1, Math.min(500, times)); i++) {
                    for (const s of steps || []) {
                        if (s.t != null) api.typeText(s.t);
                        else if (s.cmd) runNamed(s.cmd);
                        else if (s.k) runScopeHandlers(editorView, new KeyboardEvent('keydown', { key: s.k, ctrlKey: !!s.c, shiftKey: !!s.s, altKey: !!s.a, metaKey: !!s.m, bubbles: true, cancelable: true }), 'editor');
                    }
                }
            } finally { replaying = false; }
        },
        // ---- ghost text
        showGhost(text, pos) { const p = pos == null ? editorView.state.selection.main.head : pos; editorView.dispatch({ effects: setGhost.of(text ? { pos: p, text } : null) }); },
        ghost: () => editorView.state.field(ghostField, false),
        acceptGhost: () => acceptGhost(editorView),
        dismissGhost: () => dismissGhost(editorView),
        requestGhostNow: () => requestGhost(editorView, ++ghostSeq),
        destroy() { alive = false; clearTimeout(ghostTimer); editorView.destroy(); }
    };
    loadLanguage(currentPath);
    return api;
}

/** Identifier / token under a column. `token` is the wider non-space run (for colours, URLs, class names). */
export function tokenAt(text, col) {
    if (col < 0 || col > text.length) return null;
    const isW = (ch) => /[\w$\u0600-\u06FF]/.test(ch);
    let a = col, b = col;
    while (a > 0 && isW(text[a - 1])) a--;
    while (b < text.length && isW(text[b])) b++;
    let ta = col, tb = col;
    const isT = (ch) => ch && !/[\s'"`<>()[\]{},;]/.test(ch);
    while (ta > 0 && isT(text[ta - 1])) ta--;
    while (tb < text.length && isT(text[tb])) tb++;
    if (a === b && ta === tb) return null;
    return { word: text.slice(a, b), from: a === b ? ta : a, to: a === b ? tb : b, token: text.slice(ta, tb), tokenFrom: ta, tokenTo: tb };
}
