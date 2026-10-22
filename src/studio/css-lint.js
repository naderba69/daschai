/* ==============================================================================
   Sprint 13 — #142 Stylelint-style CSS/SCSS/Less linting, fully local (no CDN).
   A small tolerant scanner (comments, strings, nested blocks, at-rules) plus the
   rules people actually hit: invalid hex colours, unknown units/properties,
   duplicate properties/selectors, empty blocks, missing semicolons, unbalanced
   braces, !important, zero units, trailing zeros, generic font family,
   redundant shorthand values. Configurable via .stylelintrc(.json) "rules".
   ============================================================================== */

const UNITS = new Set(('px em rem % vh vw vmin vmax vb vi svh lvh dvh svw lvw dvw cqw cqh cqi cqb cqmin cqmax ch ex cap ic lh rlh cm mm q in pt pc ' +
    'deg rad grad turn s ms hz khz dpi dpcm dppx x fr').split(' '));
const PROPS = new Set(('align-content align-items align-self all animation animation-delay animation-direction animation-duration animation-fill-mode animation-iteration-count animation-name ' +
    'animation-play-state animation-timing-function animation-composition animation-timeline appearance aspect-ratio backdrop-filter backface-visibility background background-attachment background-blend-mode ' +
    'background-clip background-color background-image background-origin background-position background-position-x background-position-y background-repeat background-size block-size border ' +
    'border-block border-block-end border-block-start border-bottom border-bottom-color border-bottom-left-radius border-bottom-right-radius border-bottom-style border-bottom-width border-collapse ' +
    'border-color border-end-end-radius border-end-start-radius border-image border-inline border-inline-end border-inline-start border-left border-left-color border-left-style border-left-width ' +
    'border-radius border-right border-right-color border-right-style border-right-width border-spacing border-start-end-radius border-start-start-radius border-style border-top border-top-color ' +
    'border-top-left-radius border-top-right-radius border-top-style border-top-width border-width bottom box-decoration-break box-shadow box-sizing break-after break-before break-inside ' +
    'caption-side caret-color clear clip clip-path color color-scheme column-count column-fill column-gap column-rule column-span column-width columns contain container container-name ' +
    'container-type content content-visibility counter-increment counter-reset counter-set cursor direction display empty-cells fill filter flex flex-basis flex-direction flex-flow flex-grow ' +
    'flex-shrink flex-wrap float font font-display font-family font-feature-settings font-kerning font-optical-sizing font-size font-size-adjust font-stretch font-style font-synthesis font-variant ' +
    'font-variant-numeric font-variation-settings font-weight forced-color-adjust gap grid grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-column-end grid-column-start ' +
    'grid-row grid-row-end grid-row-start grid-template grid-template-areas grid-template-columns grid-template-rows hanging-punctuation height hyphens image-rendering inline-size inset ' +
    'inset-block inset-block-end inset-block-start inset-inline inset-inline-end inset-inline-start isolation justify-content justify-items justify-self left letter-spacing line-break ' +
    'line-clamp line-height list-style list-style-image list-style-position list-style-type margin margin-block margin-block-end margin-block-start margin-bottom margin-inline margin-inline-end ' +
    'margin-inline-start margin-left margin-right margin-top mask mask-image mask-position mask-repeat mask-size max-block-size max-height max-inline-size max-width min-block-size min-height ' +
    'min-inline-size min-width mix-blend-mode object-fit object-position offset opacity order orphans outline outline-color outline-offset outline-style outline-width overflow overflow-anchor ' +
    'overflow-wrap overflow-x overflow-y overscroll-behavior overscroll-behavior-x overscroll-behavior-y padding padding-block padding-block-end padding-block-start padding-bottom padding-inline ' +
    'padding-inline-end padding-inline-start padding-left padding-right padding-top page-break-after page-break-before page-break-inside perspective perspective-origin place-content place-items ' +
    'place-self pointer-events position print-color-adjust quotes resize right rotate row-gap scale scroll-behavior scroll-margin scroll-margin-top scroll-padding scroll-padding-top scroll-snap-align ' +
    'scroll-snap-stop scroll-snap-type scrollbar-color scrollbar-gutter scrollbar-width shape-outside speak stroke stroke-width tab-size table-layout text-align text-align-last text-combine-upright ' +
    'text-decoration text-decoration-color text-decoration-line text-decoration-style text-decoration-thickness text-emphasis text-indent text-justify text-orientation text-overflow text-rendering ' +
    'text-shadow text-transform text-underline-offset text-underline-position text-wrap top touch-action transform transform-box transform-origin transform-style transition transition-behavior ' +
    'transition-delay transition-duration transition-property transition-timing-function translate unicode-bidi user-select vertical-align view-transition-name visibility white-space widows width ' +
    'will-change word-break word-spacing word-wrap writing-mode z-index zoom src unicode-range size marks font-named-instance ascent-override descent-override line-gap-override size-adjust ' +
    'syntax inherits initial-value accent-color math-style anchor-name position-anchor field-sizing interpolate-size').split(' '));
const GENERIC = /\b(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit|initial|unset|revert|var\()/i;
const SHORTHANDS = new Set(['margin', 'padding', 'border-width', 'border-color', 'border-style', 'border-radius', 'inset', 'scroll-margin', 'scroll-padding']);

export const CSS_RULES = {
    'color-no-invalid-hex': 'error', 'unit-no-unknown': 'error', 'property-no-unknown': 'warning', 'declaration-block-no-duplicate-properties': 'warning',
    'no-duplicate-selectors': 'warning', 'block-no-empty': 'warning', 'declaration-block-missing-semicolon': 'error', 'no-unbalanced-braces': 'error',
    'declaration-no-important': 'info', 'length-zero-no-unit': 'info', 'number-no-trailing-zeros': 'info', 'font-family-no-missing-generic-family-keyword': 'warning',
    'shorthand-property-no-redundant-values': 'info', 'selector-max-id': 'info', 'comment-no-empty': 'info', 'declaration-empty-value': 'error'
};
const FIXABLE = new Set(['length-zero-no-unit', 'number-no-trailing-zeros', 'shorthand-property-no-redundant-values', 'declaration-block-no-duplicate-properties']);

/** Replace comments + strings with spaces (same length) so offsets stay valid. */
function blank(src, lang) {
    let out = '', i = 0;
    const comments = [];
    while (i < src.length) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const j = e < 0 ? src.length : e + 2; comments.push({ from: i, to: j, body: src.slice(i + 2, e < 0 ? j : e) }); out += src.slice(i, j).replace(/[^\n]/g, ' '); i = j; continue; }
        if (c === '/' && src[i + 1] === '/' && lang !== 'css') { const e = src.indexOf('\n', i); const j = e < 0 ? src.length : e; out += ' '.repeat(j - i); i = j; continue; }
        if (c === '"' || c === "'") { let j = i + 1; while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } out += c + 'x'.repeat(Math.max(0, Math.min(j, src.length) - i - 1)).replace(/x/g, '_') + (src[j] === c ? c : ''); i = src[j] === c ? j + 1 : j; continue; }
        if (c === 'u' && /^url\(/i.test(src.slice(i, i + 4)) && !/^url\(\s*['"]/i.test(src.slice(i, i + 10))) { const e = src.indexOf(')', i); const j = e < 0 ? src.length : e + 1; out += 'url(' + '_'.repeat(Math.max(0, j - i - 5)) + ')'; i = j; continue; }
        out += c; i++;
    }
    return { text: out.slice(0, src.length), comments };
}

/** Lint CSS/SCSS/Less source. Returns [{ from, to, line, column, severity, message, rule, fix? }]. */
export function lintCss(src, opts = {}) {
    const lang = opts.lang || 'css';
    const rules = { ...CSS_RULES, ...normaliseRules(opts.rules) };
    const out = [];
    const { text, comments } = blank(String(src || ''), lang);
    const lineStarts = [0];
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
    const lc = (pos) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; } return { line: lo + 1, column: pos - lineStarts[lo] + 1 }; };
    const report = (rule, from, to, message, fix) => {
        const sev = rules[rule];
        if (!sev || sev === 'off') return;
        out.push({ from, to: Math.max(to, from + 1), ...lc(from), severity: sev, message: `${message} (${rule})`, rule, fix: fix || null });
    };
    comments.forEach(c => { if (!c.body.trim()) report('comment-no-empty', c.from, c.to, 'تعليق فارغ'); });

    // Walk blocks: stack of { selector, start, props:Map, decls:[] }
    const stack = [{ selector: '', start: 0, props: new Map(), seenSel: new Map(), atRule: '' }];
    let segStart = 0;
    const flushDecl = (from, to, terminated) => {
        const raw = text.slice(from, to);
        if (!raw.trim()) return;
        const top = stack[stack.length - 1];
        const lead = raw.length - raw.trimStart().length;
        const start = from + lead;
        const body = raw.trim();
        if (/^@/.test(body)) return;                                   // @import/@use/@include … ;
        const colon = body.indexOf(':');
        if (colon < 0 || /^[&.#:[>~+*]/.test(body) && !/^--/.test(body)) return;
        const prop = body.slice(0, colon).trim().toLowerCase();
        let value = body.slice(colon + 1).trim();
        if (!/^(--)?[a-z-][\w-]*$|^\$[\w-]+$|^@[\w-]+$/.test(prop)) return;
        if (lang !== 'css' && (prop[0] === '$' || prop[0] === '@')) return;
        // a value spanning a newline that contains `name:` → missing semicolon
        const nl = /\n\s*([a-z-]+)\s*:[^:]/.exec(value);
        if (nl && !/^--/.test(prop) && top.selector) {
            const at = start + body.indexOf(value) + nl.index;
            report('declaration-block-missing-semicolon', at, at + 1, `فاصلة منقوطة مفقودة بعد «${prop}»`);
            value = value.slice(0, nl.index).trim();
        }
        const vStart = start + body.indexOf(value, colon);
        if (!value) { report('declaration-empty-value', start, start + prop.length, `الخاصية «${prop}» بلا قيمة`); return; }
        if (!/^--/.test(prop) && !/^-(webkit|moz|ms|o)-/.test(prop) && !PROPS.has(prop) && !(lang !== 'css' && /#\{/.test(prop))) report('property-no-unknown', start, start + prop.length, `خاصية غير معروفة «${prop}»`);
        if (top.props.has(prop) && !/^--/.test(prop)) {
            const prev = top.props.get(prop);
            if (prev.value !== value || true) report('declaration-block-no-duplicate-properties', start, start + prop.length, `الخاصية «${prop}» مكررة في نفس الكتلة`, { from: prev.from, to: prev.end, insert: '' });
        }
        let end = to;
        if (terminated) { end = to + 1; while (end < src.length && /[ \t]/.test(src[end])) end++; if (src[end] === '\n') end++; }
        const lineFrom = lineStarts[lc(start).line - 1];
        top.props.set(prop, { from: /^\s*$/.test(src.slice(lineFrom, start)) ? lineFrom : start, end, value });
        if (/^--/.test(prop)) return;
        if (/!\s*important/i.test(value)) report('declaration-no-important', vStart + value.search(/!\s*important/i), vStart + value.length, 'تجنب !important');
        let m;
        const hexRe = /#([\w]+)\b/g;
        while ((m = hexRe.exec(value))) {
            if (/^#\{/.test(value.slice(m.index))) continue;
            if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(m[1])) report('color-no-invalid-hex', vStart + m.index, vStart + m.index + m[0].length, `لون سداسي غير صالح «${m[0]}»`);
        }
        const numRe = /(^|[\s,(/*+-])(-?(?:\d*\.\d+|\d+\.?\d*))([a-z%]+)?(?![\w-]*\()/gi;
        while ((m = numRe.exec(value))) {
            const at = vStart + m.index + m[1].length, num = m[2], unit = (m[3] || '').toLowerCase();
            if (unit && !UNITS.has(unit) && !/^e\d/.test(unit)) report('unit-no-unknown', at + num.length, at + num.length + unit.length, `وحدة غير معروفة «${unit}»`);
            if (/^-?0*\.?0+$/.test(num) && unit && UNITS.has(unit) && !/^(s|ms|deg|rad|grad|turn|hz|khz|dpi|dpcm|dppx|x|fr|%)$/.test(unit) && !/^(flex|flex-basis)$/.test(prop))
                report('length-zero-no-unit', at, at + num.length + unit.length, `استخدم 0 بدل «${num}${unit}»`, { from: at, to: at + num.length + unit.length, insert: '0' });
            if (/\.\d*?0+$/.test(num) && !/^0?\.0*$/.test(num)) {
                const fixed = num.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
                report('number-no-trailing-zeros', at, at + num.length, `أصفار زائدة في «${num}»`, { from: at, to: at + num.length, insert: fixed });
            }
        }
        if ((prop === 'font-family' || prop === 'font') && !GENERIC.test(value) && !/^(inherit|initial|unset|revert)$/i.test(value) && (prop === 'font-family' || /,|\s['"_]/.test(value)))
            report('font-family-no-missing-generic-family-keyword', vStart, vStart + value.length, 'أضف عائلة خط عامة (sans-serif / serif / monospace…)');
        if (SHORTHANDS.has(prop) && !/[/(]/.test(value)) {
            const parts = value.replace(/\s*!important$/i, '').split(/\s+/);
            let red = null;
            if (parts.length === 4 && parts[1] === parts[3]) red = parts.slice(0, 3);
            if ((red || parts).length === 3 && (red || parts)[0] === (red || parts)[2]) red = (red || parts).slice(0, 2);
            if ((red || parts).length === 2 && (red || parts)[0] === (red || parts)[1]) red = [(red || parts)[0]];
            if (red && red.join(' ') !== parts.join(' ')) {
                const core = parts.join(' ');
                const idx = value.indexOf(core);
                report('shorthand-property-no-redundant-values', vStart + idx, vStart + idx + core.length, `اختصر «${core}» إلى «${red.join(' ')}»`, { from: vStart + idx, to: vStart + idx + core.length, insert: red.join(' ') });
            }
        }
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '{' && text[i - 1] === '#' && lang !== 'css') { const e = text.indexOf('}', i); if (e > 0) { i = e; continue; } }
        if (c === ';') { flushDecl(segStart, i, true); segStart = i + 1; continue; }
        if (c === '{') {
            const head = text.slice(segStart, i);
            const lead = head.length - head.trimStart().length;
            const selector = head.trim();
            const top = stack[stack.length - 1];
            const selFrom = segStart + lead;
            if (selector && !/^@/.test(selector) && !/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+%))*$/i.test(selector)) {
                const key = top.atRule + '|' + selector.replace(/\s+/g, ' ');
                if (top.seenSel.has(key)) report('no-duplicate-selectors', selFrom, selFrom + selector.length, `المحدد «${selector.slice(0, 60)}» مكرر (السطر ${lc(top.seenSel.get(key)).line})`);
                else top.seenSel.set(key, selFrom);
                const ids = (selector.replace(/\[[^\]]*\]/g, '').match(/#[\w-]+/g) || []).length;
                if (ids > 1) report('selector-max-id', selFrom, selFrom + selector.length, `المحدد يحوي ${ids} معرفات (#id) — الحد 1`);
            }
            stack.push({ selector: selector || '{}', start: i, selFrom, props: new Map(), seenSel: new Map(), atRule: /^@/.test(selector) ? selector : top.atRule, hasContent: false });
            segStart = i + 1;
            continue;
        }
        if (c === '}') {
            flushDecl(segStart, i, false);
            if (stack.length === 1) { report('no-unbalanced-braces', i, i + 1, 'قوس إغلاق «}» زائد'); segStart = i + 1; continue; }
            const blk = stack.pop();
            const inner = text.slice(blk.start + 1, i);
            if (!inner.trim()) report('block-no-empty', blk.selFrom, blk.start + 1, `كتلة فارغة «${blk.selector.slice(0, 40)}»`);
            segStart = i + 1;
            continue;
        }
    }
    if (stack.length > 1) { const b = stack[stack.length - 1]; report('no-unbalanced-braces', b.start, b.start + 1, `قوس «{» غير مغلق (${b.selector.slice(0, 40)})`); }
    else if (text.slice(segStart).trim() && /:/.test(text.slice(segStart))) flushDecl(segStart, text.length, false);
    return out.sort((a, b) => a.from - b.from);
}

function normaliseRules(r) {
    const o = {};
    Object.entries(r || {}).forEach(([k, v]) => {
        const val = Array.isArray(v) ? (v[1] && v[1].severity) || (v[0] === false || v[0] === null ? 'off' : 'error') : v;
        o[k] = val === false || val === null || val === 'off' || val === 0 ? 'off' : val === true || val === 2 ? 'error' : val === 1 ? 'warning' : val;
    });
    return o;
}

/** Apply every fixable rule (zero units, trailing zeros, redundant shorthands, duplicate props). Returns { code, fixed }. */
export function fixCss(src, opts = {}) {
    let code = String(src || ''), fixed = 0;
    for (let pass = 0; pass < 5; pass++) {
        const fixes = lintCss(code, opts).filter(d => d.fix && FIXABLE.has(d.rule)).sort((a, b) => b.fix.from - a.fix.from);
        if (!fixes.length) break;
        let lastFrom = Infinity;
        for (const d of fixes) {
            if (d.fix.to > lastFrom) continue;          // overlapping — next pass
            code = code.slice(0, d.fix.from) + d.fix.insert + code.slice(d.fix.to);
            lastFrom = d.fix.from;
            fixed++;
        }
    }
    return { code, fixed };
}
