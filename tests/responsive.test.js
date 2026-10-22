/* v2.15 — Responsive audit regression guard.
 * jsdom has no layout engine and ignores @media, so this test carries a tiny CSS cascade evaluator:
 * it parses the stylesheet (incl. nested @media), evaluates width/height/orientation media queries for a
 * given viewport and returns the winning declaration for an exact selector. That is exactly the class of bug
 * that broke the app on phones (a later unscoped desktop rule silently overriding the mobile one). */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadApp, ok, wait, section, gzipBudgetKB } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------------------------------------------------------------- mini CSS cascade
function parseCSS(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = []; let i = 0, order = 0;
    const walk = (media) => {
        while (i < css.length) {
            const open = css.indexOf('{', i), close = css.indexOf('}', i);
            if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
            if (open === -1) { i = css.length; return; }
            const head = css.slice(i, open).trim(); i = open + 1;
            if (/^@media/i.test(head)) { walk([...media, head.replace(/^@media\s*/i, '')]); continue; }
            if (/^@(supports|layer|container)/i.test(head)) { walk(media); continue; }
            if (/^@/.test(head)) { let depth = 1; while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; } continue; }
            const end = css.indexOf('}', i); const body = css.slice(i, end); i = end + 1;
            const decls = {};
            body.split(';').forEach(d => { const k = d.indexOf(':'); if (k < 1) return; const prop = d.slice(0, k).trim().toLowerCase(); let val = d.slice(k + 1).trim(); const imp = /!important\s*$/.test(val); val = val.replace(/\s*!important\s*$/, ''); decls[prop] = { val, imp }; });
            const sels = []; let depth = 0, cur = '';
            for (const ch of head) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { sels.push(cur); cur = ''; } else cur += ch; }
            sels.push(cur);
            rules.push({ sels: sels.map(s => s.trim().replace(/\s+/g, ' ')), media, decls, order: order++ });
        }
    };
    walk([]);
    return rules;
}
function mediaMatches(q, vp) {
    // comma = OR; "and" = AND; unknown features (pointer, hover, prefers-*) are treated as not matching,
    // except "screen"/"all". "print" never matches.
    return q.split(',').some(part => part.split(/\band\b/).every(t => {
        t = t.trim().replace(/^only\s+/, '');
        if (!t || t === 'screen' || t === 'all') return true;
        if (t === 'print') return false;
        const m = t.match(/^\(\s*(max|min)-(width|height)\s*:\s*([\d.]+)px\s*\)$/);
        if (m) { const v = m[2] === 'width' ? vp.w : vp.h; return m[1] === 'max' ? v <= +m[3] : v >= +m[3]; }
        const o = t.match(/^\(\s*orientation\s*:\s*(landscape|portrait)\s*\)$/);
        if (o) return (vp.w > vp.h ? 'landscape' : 'portrait') === o[1];
        return false;
    }));
}
function computed(rules, selector, prop, vp) {
    let best = null;
    for (const r of rules) {
        if (!r.sels.includes(selector) || !(prop in r.decls)) continue;
        if (!r.media.every(q => mediaMatches(q, vp))) continue;
        const d = r.decls[prop];
        if (!best || (d.imp && !best.imp) || (d.imp === best.imp)) best = { ...d, order: r.order };
    }
    return best ? best.val : undefined;
}

(async () => {
    const css = read('src/styles.css');
    const rules = parseCSS(css);
    const PHONE = { w: 390, h: 844 }, SMALL = { w: 320, h: 568 }, TABLET = { w: 768, h: 1024 }, DESK = { w: 1280, h: 800 }, LAND = { w: 844, h: 390 };

    section('Shell cascade at every breakpoint (the root cause of the broken phone layout)');
    for (const vp of [SMALL, PHONE, TABLET, LAND]) {
        ok(computed(rules, '.sidebar', 'position', vp) === 'fixed', `${vp.w}x${vp.h}: the sidebar is an off-canvas fixed drawer (not a flex column eating the screen)`);
        ok(computed(rules, '.code-studio-pane', 'width', vp) === '100%', `${vp.w}x${vp.h}: the code studio pane is full-width (desktop --studio-width no longer wins)`);
    }
    ok(computed(rules, '.sidebar', 'position', DESK) === 'relative', 'desktop: the sidebar is back in the flex row');
    ok(/var\(--studio-width/.test(computed(rules, '.code-studio-pane', 'width', DESK) || ''), 'desktop: the studio keeps its resizable width');
    ok(computed(rules, '.main-viewport', 'min-width', PHONE) === '0', '.main-viewport can shrink (min-width: 0)');
    ok(computed(rules, '.chat-pane', 'min-width', PHONE) === '0', '.chat-pane can shrink (min-width: 0)');
    ok(computed(rules, '.content-workspace', 'flex', PHONE) === '1 1 0' && computed(rules, '.content-workspace', 'min-height', PHONE) === '0', 'the workspace flexes into the space left by banners instead of a fixed calc() height');
    ok(/fixed/.test(computed(rules, '.code-studio-pane.active', 'position', SMALL) || '') && /fixed/.test(computed(rules, '.code-studio-pane.active', 'position', LAND) || ''), 'phones + short landscape: the studio takes the whole screen under the navbar');
    ok(computed(rules, '.code-studio-pane.active', 'height', SMALL) === 'auto', 'the fixed studio is not pushed past the bottom edge by the base height:100%');
    ok(computed(rules, '.code-studio-pane.active', 'position', TABLET) === undefined, 'tablet: the studio stays inside the workspace');
    ok(computed(rules, '#sidebar-close-btn', 'display', PHONE) === 'flex' && computed(rules, '#sidebar-close-btn', 'display', DESK) === 'none', 'the drawer close button exists on phones only');
    ok(computed(rules, '.sidebar', 'visibility', PHONE) === undefined && rules.some(r => r.sels.includes('.sidebar:not(.active)') && r.decls.visibility), 'a closed drawer is visibility:hidden (no invisible tab stops)');

    section('Components that used to overflow or be unreachable');
    ok(rules.some(r => r.sels.includes('.sidebar-btn-util') && r.media.length === 0 && r.decls.display), '.sidebar-btn-util (206 buttons) is finally defined');
    ok(/100dvh/.test(css.match(/\.fx-menu \{[^}]*max-height[^}]*\}/)?.[0] || '') && /overflow-y: auto/.test(css.match(/\.fx-menu \{[^}]*max-height[^}]*\}/)?.[0] || ''), 'context/mode menus scroll instead of running off-screen');
    ok(computed(rules, '.sidebar-footer-nav', 'overflow-y', SMALL) === 'auto' && computed(rules, '.sidebar-footer-nav', 'min-height', SMALL) === '0', 'the sidebar tools grid scrolls on short screens');
    ok(computed(rules, '.sidebar', 'overflow-y', LAND) === 'auto' && computed(rules, '.sidebar-footer-nav', 'max-height', LAND) === 'none', 'short landscape: the whole drawer scrolls so the tools stay reachable');
    ok(computed(rules, '.arena-grid', 'overflow-y', PHONE) === 'auto', 'stacked arena columns scroll (2nd column + vote button reachable)');
    ok(computed(rules, '.form-grid-2', 'grid-template-columns', PHONE) === '1fr' && /repeat\(2,/.test(computed(rules, '.form-grid-2', 'grid-template-columns', DESK) || ''), 'settings 2-column grids collapse to one column on phones');
    ok(['.nav-hide-sm'].every(s => computed(rules, s, 'display', PHONE) === 'none' && computed(rules, s, 'display', DESK) === undefined), 'secondary navbar actions hide on phones only');
    ok(rules.some(r => r.sels.includes(':where(button, input, select, textarea)') && r.decls['font-family']?.val === 'inherit'), 'form controls inherit the Arabic page font');

    section('Every auto-fill / auto-fit grid is clamped with min(…, 100%) — all CSS incl. lazy chunks');
    const cssFiles = ['src/styles.css', ...fs.readdirSync(path.join(ROOT, 'src')).filter(d => fs.statSync(path.join(ROOT, 'src', d)).isDirectory())
        .flatMap(d => fs.readdirSync(path.join(ROOT, 'src', d)).filter(f => f.endsWith('.css')).map(f => `src/${d}/${f}`))];
    const unclamped = cssFiles.flatMap(f => (read(f).match(/repeat\(\s*auto-(?:fill|fit)\s*,\s*minmax\(\s*\d+px/g) || []).map(m => `${f}: ${m}`));
    ok(cssFiles.length >= 10, `scanned ${cssFiles.length} stylesheets`);
    ok(unclamped.length === 0, `no fixed px track minimum can overflow a narrow container${unclamped.length ? ' → ' + unclamped.slice(0, 3).join(' | ') : ''}`);

    section('Layout markup');
    const layout = read('src/layout.html');
    const closeBtn = layout.match(/<button[^>]*id="sidebar-close-btn"[^>]*>/)?.[0] || '';
    ok(closeBtn && !/display:\s*none/.test(closeBtn), 'the sidebar close button is not hard-hidden inline');
    ok((layout.match(/nav-hide-sm/g) || []).length >= 2 && /nav-hide-xs/.test(layout), 'navbar actions carry their breakpoint classes');
    ok(/class="input-kbd-hint"/.test(layout) && /kbd-only/.test(layout), 'keyboard-only hints are classed (hidden on touch)');
    ok((layout.match(/form-grid-2/g) || []).length >= 2 && (layout.match(/wb-viewer-pre/g) || []).length >= 2, 'settings + workbench grids use responsive classes instead of inline grids');
    ok(!/style="[^"]*grid-template-columns:\s*1fr 1fr/.test(layout), 'no inline fixed 2-column grids remain in the layout');

    section('Build: CSS + HTML minification is meaning-preserving');
    const html = read('index.html');
    ok(/body\.kb-nav :focus-visible/.test(html), 'descendant selectors keep their space after minification (`body.kb-nav :focus-visible`)');
    ok(!/<!-- Sidebar/.test(html) && /<pre/.test(html) === /<pre/.test(layout), 'layout comments are stripped, <pre> blocks kept');
    const zlib = require('zlib');
    const gz = zlib.gzipSync(html, { level: 9 }).length / 1024;
    ok(gz < gzipBudgetKB, `main page stays under the ${gzipBudgetKB} KB gzip budget (${gz.toFixed(1)} KB)`);

    section('v2.16 design system: tokens, clean chrome, compact phone banners');
    const rootTok = (css.match(/:root \{([\s\S]*?)\n\}/) || [])[1] || '';
    ok(/--primary: #5b9bff/.test(rootTok) && /--accent: #2f74f0/.test(rootTok) && /--radius-pill: 8px/.test(rootTok), 'one blue accent + crisp radii are the root tokens');
    ok(!/#c084fc|155, 114, 207/.test(css), 'no leftover purple accent / glow colours in the main stylesheet');
    ok(computed(rules, '.sidebar-footer-nav:not(.open) .sidebar-tools-grid', 'display', DESK) === 'none', 'the tools section is collapsible (hidden until opened)');
    ok(computed(rules, '.input-kbd-hint', 'display', DESK) === 'none' && computed(rules, 'body.has-msgs .quick-suggestions-carousel', 'display', PHONE) === 'none', 'hints are hidden; suggestion chips disappear once the chat has messages');
    ok(computed(rules, '.ox-banner', 'flex-wrap', PHONE) === 'nowrap' && computed(rules, '.top-tabs-bar.visible', 'display', PHONE) === 'none' && computed(rules, '.top-tabs-bar.visible', 'display', DESK) !== 'none', 'phones: banners stay one compact row; the tabs bar gives way to the drawer');
    ok(computed(rules, '.top-tabs-bar', 'order', DESK) === '-1' && computed(rules, '.top-navbar', 'order', DESK) === '-2', 'the tabs bar always sits right under the navbar (above banners)');
    const lay = read('src/layout.html');
    ok(/id="tools-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="sidebar-tools-grid"/.test(lay) && /id="sidebar-tools-grid"/.test(lay), 'the tools toggle is an accessible disclosure button');
    ok(!/[✦↗]/.test(lay), 'no font-dependent symbol glyphs in the layout (icons instead)');
    ok(!/['"](📌|⭐|🗄️)['"]/.test(read('src/features/13-conversations.js')), 'session filter chips use icons, not emoji');
    ok(/IBM\+Plex\+Sans\+Arabic/.test(read('build.js')), 'IBM Plex Sans Arabic is the UI font');
    const allCSS = [css, ...['ai', 'dev', 'integ', 'media', 'perf', 'studio', 'team', 'ui'].map(d => read(`src/${d}/${d}.css`)), read('src/integ/widgets.css')].join('\n');
    ok(!/(?<![-\w])color:\s*(#34d399|#4ade80|#fbbf24|#f87171|#ef4444|#8ab4f8|#38bdf8|#93c5fd|#94a3b8|#cbd5e1|#e2e8f0|#64748b)\b/i.test(allCSS), 'status/text colours go through theme tokens (readable in light and dark), no fixed light-on-dark hex text');
    const lightTok = (css.match(/\[data-theme="light"\] \{([\s\S]*?)\n\}/) || [])[1] || '';
    ok(/--success: #047857/.test(lightTok) && /--warning: #b45309/.test(lightTok) && /--danger: #dc2626/.test(lightTok), 'light theme darkens the semantic colours for contrast on white');
    ok(/\[data-theme="light"\] :is\(\.hljs-keyword/.test(css) && /\[data-theme="light"\] \.hljs \{/.test(css), 'highlight.js gets a light palette in the light theme');
    ok(!/background: #121314/.test(lay) && !/style="[^"]*color: #fff;[^"]*min-width: 0;/.test(read('src/app.js')), 'no hard-coded dark panels / white text in app templates');
    ok(!/(^|[\s,}])\.cm-line\b/.test(css) && /id="cmt-list"/.test(read('src/features/08-collab.js')) && !/getElementById\('cm-list'\)/.test(read('src/features/08-collab.js')), 'code comments no longer reuse CodeMirror\'s .cm-line (which restyled every editor line) nor the conversation manager\'s #cm-list');
    ok(/\.code-studio-pane \{[^}]*container-type:\s*inline-size/.test(css) && /@container \(max-width: 720px\) \{ \.studio-action-btn > span:not\(\[class\]\) \{ display: none/.test(css) && /@container \(max-width: 480px\)[^\n]*\.studio-tabs-row \{ order: 1; flex-basis: 100%/.test(css) && computed(rules, '.studio-tabs-row', 'min-width', DESK) === '96px', 'studio header: open-file tabs keep room (icon-only actions on a narrow pane, two rows on very narrow)');
    { const b = read('build.js'); const unpinned = (b.match(/cdn\.jsdelivr\.net\/npm\/(@[\w.-]+\/)?[\w.-]+\//g) || []).filter(u => !/@[\d]/.test(u.replace(/npm\/@[\w.-]+\//, 'npm/'))); ok(unpinned.length === 0 && /npm\/marked@15\.0\.12\/marked\.min\.js/.test(b), 'every jsDelivr npm script is version-pinned (unpinned marked 404s since v16 dropped marked.min.js → raw markdown) ' + unpinned.join(' ')); }
    ok(/\.code-block-box \{\s*container-type:\s*inline-size/.test(css) && /@container \(max-width: 520px\) \{ \.code-tool-btn > span \{ display: none/.test(css) && /class="code-tool-btn test-btn" title="/.test(read('src/app.js')), 'narrow code blocks show icon-only tools, with names kept in title');
    ok(/:where\(button\)\s*\{\s*color:\s*inherit/.test(css) && /:where\(a:not\(\[class\]\)\)\s*\{\s*color:\s*var\(--primary\)/.test(css), 'unstyled buttons/links follow the theme (no UA black text on dark cards, no #0000ee links)');
    { const perf = read('src/perf/perf.css'), integ = read('src/integ/integ.css'); ok(!/(^|[^-])color:\s*#(0cce6b|ffa400|ff4e42)/.test(perf) && !/ix-lang-list[^{]*small\s*\{\s*opacity/.test(integ), 'perf ratings use semantic tokens and language codes use --text-muted (readable in the light theme)'); }
    ok(computed(rules, '.cmd-palette-input', 'min-width', SMALL) === '0' && computed(rules, '.cmd-palette-footer', 'flex-wrap', SMALL) === 'wrap', '320px: the palette search field shrinks (Esc hint no longer clipped) and its footer wraps');
    ok(/\.modal-header-bar > :not\(\.modal-title-heading\):not\(button\)/.test(css), 'header-group alignment no longer pushes icon buttons (close ×) off-centre');

    section('Runtime: menus flip above their anchor; the terminal fits its host');
    const { w, d, app, errors } = loadApp();
    await wait(80);
    Object.defineProperty(w, 'innerHeight', { value: 568, configurable: true });
    Object.defineProperty(w, 'innerWidth', { value: 320, configurable: true });
    Object.defineProperty(w.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList && this.classList.contains('fx-menu') ? 300 : 0; } });
    Object.defineProperty(w.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList && this.classList.contains('fx-menu') ? 220 : 0; } });
    const anchor = { getBoundingClientRect: () => ({ left: 40, top: 500, bottom: 536, right: 80, width: 40, height: 36 }) };
    app.showMenu([{ label: 'أ', run() {} }, { label: 'ب', run() {} }], anchor);
    let m = d.querySelector('.fx-menu');
    ok(m && parseInt(m.style.top, 10) === 500 - 4 - 300, `an anchor near the bottom opens the menu upwards (top=${m && m.style.top})`);
    app.hideMenu();
    app.showMenu([{ label: 'أ', run() {} }], { getBoundingClientRect: () => ({ left: 40, top: 60, bottom: 96, right: 80, width: 40, height: 36 }) });
    m = d.querySelector('.fx-menu');
    ok(m && parseInt(m.style.top, 10) === 100, 'an anchor near the top still opens downwards');
    app.hideMenu();
    const termSrc = read('src/dev/term.js');
    const colsFn = termSrc.match(/P\.dvTermCols = function \(width, cellW\) \{([^\n]*)\};/);
    ok(!!colsFn, 'the dev chunk sizes xterm columns from its host');
    const cols = colsFn ? new Function('width', 'cellW', colsFn[1]) : () => 0;
    ok(cols(340, 7.8) === 41 && cols(1000, 7.8) === 126 && cols(60, 7.8) === 20, 'columns follow the host width (41 on a phone instead of a fixed, cut-off 80)');
    ok(/new ResizeObserver\(\(\) => fit\(\)\)/.test(termSrc), 'the terminal refits on resize/rotation');
    ok(/Promise\.race\(\[SR\.available/.test(read('src/perf/audio.js')), 'the voice section never waits forever on SpeechRecognition.available()');
    const tg = d.getElementById('tools-toggle'), fnav = d.querySelector('.sidebar-footer-nav');
    ok(tg && fnav && !fnav.classList.contains('open') && tg.getAttribute('aria-expanded') === 'false', 'tools start collapsed');
    app.toggleSidebarTools();
    ok(fnav.classList.contains('open') && tg.getAttribute('aria-expanded') === 'true' && w.localStorage.getItem('ox_tools_open') === '1', 'toggling opens the tools and remembers the choice');
    app.toggleSidebarTools(false);
    const ses = app.sessions.find(x => x.id === app.activeSessionId);
    if (ses) { ses.messages = [{ role: 'user', content: 'hi', timestamp: Date.now() }]; app.renderMessages(); }
    ok(d.body.classList.contains('has-msgs'), 'body.has-msgs reflects a non-empty conversation');
    if (ses) { ses.messages = []; app.renderMessages(); }
    ok(!d.body.classList.contains('has-msgs'), '…and clears on an empty one');
    const chipsHTML = (d.getElementById('sess-filter-bar') || {}).innerHTML || '';
    ok(!chipsHTML || /fa-thumbtack/.test(chipsHTML), 'rendered filter chips carry icons');
    ok(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`);

    console.log(process.exitCode ? '\n❌ responsive test failed' : '\n✅ responsive test passed');
    process.exit(process.exitCode || 0);
})().catch(e => { console.error(e); process.exit(1); });
