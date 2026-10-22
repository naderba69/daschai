/* #983 Figma → code (HTML/CSS from real node geometry, auto-layout → flexbox, optional AI → React/Tailwind) • #1000 Figma plugin */
import { esc, btn, pbtn, card, empty, field, area, select, pre, lsGet, lsSet } from './util.js';

// ====================================================================== pure converter — self-contained (embedded in the Figma plugin via toString)
export function figmaToHtml(root, opts) {
    opts = opts || {};
    var css = [], used = {}, count = 0;
    var r255 = function (v) { return Math.round((v || 0) * 255); };
    var color = function (c, o) { var a = (c.a == null ? 1 : c.a) * (o == null ? 1 : o); return a < 1 ? 'rgba(' + r255(c.r) + ',' + r255(c.g) + ',' + r255(c.b) + ',' + (+a.toFixed(3)) + ')' : '#' + [c.r, c.g, c.b].map(function (v) { return r255(v).toString(16).padStart(2, '0'); }).join(''); };
    var px = function (v) { return (Math.round(v * 100) / 100) + 'px'; };
    var visible = function (f) { return f && f.visible !== false; };
    var paint = function (fills) {
        var list = (fills || []).filter(visible);
        if (!list.length) return null;
        var f = list[list.length - 1];
        if (f.type === 'SOLID') return { color: color(f.color, f.opacity) };
        if (f.type === 'GRADIENT_LINEAR' && f.gradientStops) {
            var h = f.gradientHandlePositions, deg = h && h.length > 1 ? Math.round(Math.atan2(h[1].y - h[0].y, h[1].x - h[0].x) * 180 / Math.PI + 90) : 180;
            return { image: 'linear-gradient(' + deg + 'deg, ' + f.gradientStops.map(function (s) { return color(s.color, f.opacity) + ' ' + Math.round(s.position * 100) + '%'; }).join(', ') + ')' };
        }
        if (f.type === 'GRADIENT_RADIAL' && f.gradientStops) return { image: 'radial-gradient(circle, ' + f.gradientStops.map(function (s) { return color(s.color, f.opacity) + ' ' + Math.round(s.position * 100) + '%'; }).join(', ') + ')' };
        if (f.type === 'IMAGE') return { image: 'linear-gradient(135deg,#e2e8f0,#cbd5e1)', isImage: true };
        return null;
    };
    var cls = function (name) {
        var base = String(name || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
        if (/^\d/.test(base)) base = 'n-' + base;
        used[base] = (used[base] || 0) + 1;
        return used[base] > 1 ? base + '-' + used[base] : base;
    };
    var escH = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var box = function (n) { return n.absoluteBoundingBox || { x: n.x || 0, y: n.y || 0, width: n.width || 0, height: n.height || 0 }; };
    var arabic = false;
    function walk(n, parent, depth) {
        if (!n || n.visible === false || count > 2000) return '';
        count++;
        var c = cls(n.name), st = [], b = box(n), pb = parent ? box(parent) : null;
        var auto = parent && parent.layoutMode && parent.layoutMode !== 'NONE' && n.layoutPositioning !== 'ABSOLUTE';
        if (!parent) st.push('position: relative', 'width: ' + px(b.width), 'min-height: ' + px(b.height), 'margin: 0 auto');
        else if (!auto) st.push('position: absolute', 'left: ' + px(b.x - pb.x), 'top: ' + px(b.y - pb.y));
        var isText = n.type === 'TEXT';
        if (parent) {
            var horiz = auto && parent.layoutMode === 'HORIZONTAL';
            if (auto && n.layoutGrow === 1) st.push('flex: 1 1 0', horiz ? 'min-width: 0' : 'min-height: 0');
            else if (!isText || !auto) { st.push('width: ' + px(b.width)); if (!isText) st.push((n.layoutMode && n.layoutMode !== 'NONE' ? 'min-height: ' : 'height: ') + px(b.height)); }
            if (auto && n.layoutAlign === 'STRETCH') st.push('align-self: stretch');
        }
        if (n.layoutMode && n.layoutMode !== 'NONE') {
            st.push('display: flex', 'flex-direction: ' + (n.layoutMode === 'HORIZONTAL' ? 'row' : 'column'), 'box-sizing: border-box');
            if (n.layoutWrap === 'WRAP') st.push('flex-wrap: wrap');
            if (n.itemSpacing) st.push('gap: ' + px(n.itemSpacing));
            var pad = [n.paddingTop || 0, n.paddingRight || 0, n.paddingBottom || 0, n.paddingLeft || 0];
            if (pad.some(Boolean)) st.push('padding: ' + pad.map(px).join(' '));
            var J = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between', BASELINE: 'baseline' };
            if (n.primaryAxisAlignItems && n.primaryAxisAlignItems !== 'MIN') st.push('justify-content: ' + J[n.primaryAxisAlignItems]);
            if (n.counterAxisAlignItems && n.counterAxisAlignItems !== 'MIN') st.push('align-items: ' + J[n.counterAxisAlignItems]);
        }
        var p = paint(n.fills);
        if (isText) {
            var s = n.style || {};
            if (p && p.color) st.push('color: ' + p.color);
            if (s.fontFamily) st.push("font-family: '" + s.fontFamily + "', system-ui, sans-serif");
            if (s.fontSize) st.push('font-size: ' + px(s.fontSize));
            if (s.fontWeight && s.fontWeight !== 400) st.push('font-weight: ' + s.fontWeight);
            if (s.italic) st.push('font-style: italic');
            if (s.lineHeightPx) st.push('line-height: ' + px(s.lineHeightPx));
            if (s.letterSpacing) st.push('letter-spacing: ' + px(s.letterSpacing));
            if (s.textAlignHorizontal && s.textAlignHorizontal !== 'LEFT') st.push('text-align: ' + { CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[s.textAlignHorizontal]);
            if (s.textDecoration === 'UNDERLINE') st.push('text-decoration: underline');
            if (s.textCase === 'UPPER') st.push('text-transform: uppercase');
            st.push('margin: 0');
        } else if (p) {
            if (p.color) st.push('background-color: ' + p.color);
            if (p.image) st.push('background-image: ' + p.image, 'background-size: cover');
        }
        var strokes = (n.strokes || []).filter(visible);
        if (strokes.length && n.strokeWeight && !isText) { var sp = paint(strokes); if (sp && sp.color) st.push('border: ' + px(n.strokeWeight) + ' solid ' + sp.color, 'box-sizing: border-box'); }
        if (n.type === 'ELLIPSE') st.push('border-radius: 50%');
        else if (n.rectangleCornerRadii && n.rectangleCornerRadii.some(Boolean)) st.push('border-radius: ' + n.rectangleCornerRadii.map(px).join(' '));
        else if (n.cornerRadius) st.push('border-radius: ' + px(n.cornerRadius));
        var shadows = (n.effects || []).filter(function (e) { return visible(e) && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'); });
        if (shadows.length) st.push('box-shadow: ' + shadows.map(function (e) { return (e.type === 'INNER_SHADOW' ? 'inset ' : '') + px((e.offset || {}).x || 0) + ' ' + px((e.offset || {}).y || 0) + ' ' + px(e.radius || 0) + ' ' + px(e.spread || 0) + ' ' + color(e.color || { r: 0, g: 0, b: 0, a: 0.25 }); }).join(', '));
        var blur = (n.effects || []).find(function (e) { return visible(e) && e.type === 'BACKGROUND_BLUR'; });
        if (blur) st.push('backdrop-filter: blur(' + px(blur.radius || 0) + ')');
        if (n.opacity != null && n.opacity < 1) st.push('opacity: ' + (+n.opacity.toFixed(3)));
        if (n.clipsContent) st.push('overflow: hidden');
        if (n.rotation && Math.abs(n.rotation) > 0.01 && !auto) st.push('transform: rotate(' + (+(-n.rotation).toFixed(2)) + 'deg)');
        css.push('.' + c + ' {\n  ' + st.join(';\n  ') + ';\n}');
        var ind = '  '.repeat(depth + 1);
        if (isText) {
            var t = String(n.characters || '');
            if (/[\u0600-\u06FF]/.test(t)) arabic = true;
            var fs = (n.style || {}).fontSize || 14, tag = fs >= 32 ? 'h1' : fs >= 24 ? 'h2' : fs >= 19 ? 'h3' : 'p';
            return ind + '<' + tag + ' class="' + c + '">' + escH(t).replace(/\n/g, '<br>') + '</' + tag + '>\n';
        }
        var name = String(n.name || '');
        var tagN = /button|btn|زر/i.test(name) ? 'button' : /^(input|field|حقل)/i.test(name) ? 'div' : /nav|header|footer|section|main|aside/i.test(name) && depth < 3 ? (name.toLowerCase().match(/nav|header|footer|section|main|aside/) || ['div'])[0] : p && p.isImage ? 'div' : 'div';
        var kids = (n.children || []).map(function (k) { return walk(k, n, depth + 1); }).join('');
        var attrs = ' class="' + c + '"' + (p && p.isImage ? ' role="img" aria-label="' + escH(name) + '"' : '') + (tagN === 'button' ? ' type="button"' : '');
        return ind + '<' + tagN + attrs + '>' + (kids ? '\n' + kids + ind : '') + '</' + tagN + '>\n';
    }
    var body = walk(root, null, 0);
    var title = escH(root && root.name || 'Figma');
    var cssText = '* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\nbutton { font: inherit; cursor: pointer; }\n' + css.join('\n');
    var html = '<!doctype html>\n<html lang="' + (arabic ? 'ar' : 'en') + '" dir="' + (arabic ? 'rtl' : 'ltr') + '">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + title + '</title>\n  <link rel="stylesheet" href="' + (opts.cssHref || 'styles.css') + '">\n</head>\n<body>\n' + body + '</body>\n</html>\n';
    return { html: html, css: cssText, nodes: count, rtl: arabic };
}

/** Figma plugin source (manifest + code.js + ui.html). The converter above is embedded verbatim. */
export function figmaPluginFiles({ name = 'OX-Alpha Design to Code', id = 'ox-alpha-design-to-code', oxUrl = 'https://daschai.vercel.app/' } = {}) {
    const serializer = `function ser(n) {
    var M = figma.mixed, o = { type: n.type, name: n.name, visible: n.visible };
    var t = n.absoluteTransform;
    o.absoluteBoundingBox = { x: t ? t[0][2] : (n.x || 0), y: t ? t[1][2] : (n.y || 0), width: n.width || 0, height: n.height || 0 };
    ['fills', 'strokes', 'strokeWeight', 'cornerRadius', 'effects', 'opacity', 'layoutMode', 'layoutWrap', 'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'primaryAxisAlignItems', 'counterAxisAlignItems', 'layoutGrow', 'layoutAlign', 'layoutPositioning', 'characters', 'clipsContent', 'rotation'].forEach(function (k) {
        if (k in n && n[k] !== M && n[k] !== undefined) o[k] = JSON.parse(JSON.stringify(n[k]));
    });
    if ('topLeftRadius' in n && n.cornerRadius === M) o.rectangleCornerRadii = [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius];
    if (n.type === 'TEXT') {
        var fn = n.fontName !== M ? n.fontName : null, lh = n.lineHeight !== M ? n.lineHeight : null, ls = n.letterSpacing !== M ? n.letterSpacing : null;
        o.style = { fontSize: n.fontSize !== M ? n.fontSize : 14, fontFamily: fn ? fn.family : 'Inter', fontWeight: n.fontWeight !== M ? n.fontWeight : 400, italic: fn ? /italic/i.test(fn.style) : false,
            textAlignHorizontal: n.textAlignHorizontal, lineHeightPx: lh && lh.unit === 'PIXELS' ? lh.value : undefined, letterSpacing: ls && ls.unit === 'PIXELS' ? ls.value : undefined,
            textDecoration: n.textDecoration !== M ? n.textDecoration : undefined, textCase: n.textCase !== M ? n.textCase : undefined };
    }
    if ('children' in n) o.children = n.children.map(ser);
    return o;
}`;
    return {
        'figma-plugin/manifest.json': JSON.stringify({ name, id, api: '1.0.0', main: 'code.js', ui: 'ui.html', editorType: ['figma', 'dev'], capabilities: ['codegen'], codegenLanguages: [{ label: 'HTML + CSS', value: 'html' }], documentAccess: 'dynamic-page', networkAccess: { allowedDomains: ['none'] } }, null, 2) + '\n',
        'figma-plugin/code.js': `// ${name} — select a frame, get HTML/CSS (same converter as OX-Alpha), send it to OX-Alpha.\nvar figmaToHtml = ${figmaToHtml.toString()};\n${serializer}\n\nfunction run() {\n    var sel = figma.currentPage.selection;\n    if (!sel.length) { figma.ui.postMessage({ type: 'empty' }); return; }\n    var json = ser(sel[0]);\n    var out = figmaToHtml(json);\n    figma.ui.postMessage({ type: 'code', name: sel[0].name, html: out.html, css: out.css, json: JSON.stringify({ oxFigma: 1, node: json }) });\n}\n\nif (figma.mode === 'codegen') {\n    figma.codegen.on('generate', function (e) {\n        var out = figmaToHtml(ser(e.node));\n        return [{ title: 'HTML', language: 'HTML', code: out.html }, { title: 'CSS', language: 'CSS', code: out.css }];\n    });\n} else {\n    figma.showUI(__html__, { width: 520, height: 620, themeColors: true });\n    figma.on('selectionchange', run);\n    figma.ui.onmessage = function (m) { if (m.type === 'notify') figma.notify(m.text); if (m.type === 'close') figma.closePlugin(); };\n    run();\n}\n`,
        'figma-plugin/ui.html': `<!doctype html>\n<html dir="rtl" lang="ar"><head><meta charset="utf-8">\n<style>\n  body { font: 12px system-ui, Tahoma, sans-serif; margin: 0; padding: 12px; color: var(--figma-color-text, #111); background: var(--figma-color-bg, #fff); }\n  h3 { margin: 0 0 8px; } textarea { width: 100%; height: 170px; box-sizing: border-box; font: 11px ui-monospace, monospace; direction: ltr; }\n  .row { display: flex; gap: 6px; margin: 6px 0 12px; flex-wrap: wrap; } button { padding: 6px 10px; border-radius: 6px; border: 1px solid #8883; background: #4f46e5; color: #fff; cursor: pointer; } button.alt { background: transparent; color: inherit; }\n  #empty { opacity: .7; }\n</style></head><body>\n<h3 id="title">OX-Alpha — من التصميم إلى الكود</h3>\n<p id="empty">اختر إطاراً (Frame) في الصفحة…</p>\n<div id="out" hidden>\n  <label>HTML</label><textarea id="html" readonly></textarea>\n  <div class="row"><button data-copy="html">نسخ HTML</button></div>\n  <label>CSS</label><textarea id="css" readonly></textarea>\n  <div class="row"><button data-copy="css">نسخ CSS</button><button id="send">إرسال إلى OX-Alpha</button><button class="alt" id="dl">تنزيل HTML</button></div>\n</div>\n<script>\n  var last = null;\n  function copy(text) { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); parent.postMessage({ pluginMessage: { type: 'notify', text: 'تم النسخ ✓' } }, '*'); }\n  onmessage = function (e) {\n    var m = e.data.pluginMessage; if (!m) return;\n    document.getElementById('empty').hidden = m.type === 'code';\n    document.getElementById('out').hidden = m.type !== 'code';\n    if (m.type !== 'code') return;\n    last = m;\n    document.getElementById('title').textContent = m.name;\n    document.getElementById('html').value = m.html;\n    document.getElementById('css').value = m.css;\n  };\n  document.addEventListener('click', function (e) {\n    var k = e.target.getAttribute('data-copy'); if (k && last) copy(last[k]);\n    if (e.target.id === 'send' && last) { copy(last.json); window.open('${oxUrl}?action=integ&tab=design', '_blank'); }\n    if (e.target.id === 'dl' && last) { var a = document.createElement('a'); a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(last.html.replace('<link rel="stylesheet" href="styles.css">', '<style>' + last.css + '</style>')); a.download = last.name + '.html'; a.click(); }\n  });\n</script>\n</body></html>\n`,
        'figma-plugin/README.md': `# ${name}\n\n1. Figma Desktop ← Plugins ← Development ← **Import plugin from manifest…** واختر \`manifest.json\`.\n2. اختر إطاراً (Frame) ثم شغّل الإضافة: يظهر HTML وCSS فوراً (Auto Layout ← Flexbox).\n3. **إرسال إلى OX-Alpha** ينسخ التصميم ويفتح OX-Alpha ← مركز التكاملات ← التصميم ← «لصق من الإضافة».\n4. في وضع المطوّر (Dev Mode) تظهر الإضافة كمولّد كود (Codegen) في لوحة Inspect.\n`
    };
}

export function installDesign(P) {
    const TOKEN = 'ox_fmx_figma_token';
    const figmaKey = (url) => (/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/.exec(url || '') || [])[1];
    const nodeId = (url) => { const m = /[?&]node-id=([^&]+)/.exec(url || ''); return m ? decodeURIComponent(m[1]).replace(/-/g, ':') : ''; };
    P.ixFigmaFetch = async function (url, token) {
        url = url || (document.getElementById('ix-fg-url') || {}).value || '';
        token = token || (document.getElementById('ix-fg-token') || {}).value || lsGet(TOKEN, '');
        const key = figmaKey(url);
        if (!key) throw new Error('رابط Figma غير صالح');
        if (!token) throw new Error('أدخل Figma personal access token');
        lsSet(TOKEN, token);
        const id = nodeId(url);
        const H = { 'X-Figma-Token': token };
        if (id) { const r = await this.ixHttp(`https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(id)}&geometry=paths`, { headers: H }); const n = r.nodes && r.nodes[id]; if (!n) throw new Error('العقدة غير موجودة'); return n.document; }
        const f = await this.ixHttp(`https://api.figma.com/v1/files/${key}?depth=2`, { headers: H });
        const frames = ((f.document && f.document.children) || []).flatMap(pg => (pg.children || []).filter(n => /FRAME|COMPONENT|SECTION/.test(n.type)));
        if (!frames.length) throw new Error('لا توجد إطارات في الملف');
        const r = await this.ixHttp(`https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(frames[0].id)}`, { headers: H });
        this._ixFigFrames = frames.map(n => ({ id: n.id, name: n.name }));
        return r.nodes[frames[0].id].document;
    };
    P.ixFigmaConvert = async function (node, { framework, dir } = {}) {
        framework = framework || (document.getElementById('ix-fg-fw') || {}).value || 'html';
        const name = String(node.name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
        dir = dir || 'design/' + name;
        const out = figmaToHtml(node);
        let files = { [dir + '/index.html']: out.html, [dir + '/styles.css']: out.css };
        if (framework !== 'html') {
            const j = await this.ixAI(`Convert this generated HTML/CSS (from a Figma frame) into ${framework === 'react' ? 'a clean React function component (JSX) using Tailwind CSS classes; semantic HTML; responsive (replace fixed widths with flex/grid + max-w)' : 'semantic, responsive HTML + modern CSS (flex/grid, CSS variables for colors, no absolute positioning when avoidable)'}. Keep texts exactly.\nHTML:\n${out.html.slice(0, 12000)}\nCSS:\n${out.css.slice(0, 12000)}\nReturn JSON {"files": {"${framework === 'react' ? name + '.jsx' : 'index.html'}": "...", ${framework === 'react' ? '' : '"styles.css": "...", '}"NOTES.md": "short Arabic notes"}}`, { json: true, maxTokens: 8000 });
            if (j && j.files) files = { ...files, ...Object.fromEntries(Object.entries(j.files).map(([p, c]) => [dir + '/' + (framework === 'react' && /\.html$/.test(p) ? p : p), c])) };
        }
        this.ixWriteFiles('Figma → كود', files, { open: false });
        this._ixFigLast = { name, files: Object.keys(files), nodes: out.nodes };
        const f = document.getElementById('ix-fg-frame');
        if (f) f.srcdoc = out.html.replace(/<link rel="stylesheet" href="styles\.css">/, '<style>' + out.css + '</style>');
        this.ixOut('ix-fg-res', empty(`✅ ${out.nodes} عنصر ← ${Object.keys(files).length} ملف في <code>${esc(dir)}/</code>${out.rtl ? ' (اكتُشف نص عربي ← dir="rtl")' : ''}`));
        return { ...out, files };
    };
    P.ixFigmaGo = async function () {
        this.ixBusy('ix-fg-res', 'جلب التصميم من Figma…');
        try { return await this.ixFigmaConvert(await this.ixFigmaFetch()); } catch (e) { return this.ixErr(e, 'ix-fg-res'); }
    };
    P.ixFigmaPaste = async function (text) {
        text = text != null ? text : (document.getElementById('ix-fg-paste') || {}).value || '';
        try {
            const j = JSON.parse(text);
            const node = j.oxFigma ? j.node : (j.document || j);
            if (!node || !node.type) throw new Error('ليس تصميماً من إضافة OX-Alpha');
            return await this.ixFigmaConvert(node);
        } catch (e) { return this.ixErr(e, 'ix-fg-res'); }
    };
    P.ixFigma = async function () {
        return card('من Figma إلى كود', `<p class="hv-dim">يحوّل الإطار إلى HTML وCSS اعتماداً على هندسته الفعلية: Auto Layout يصبح Flexbox، والتعبئة تصبح ألواناً وتدرجات، إضافة إلى الحدود والزوايا والظلال والخطوط. ويمكن بعد ذلك تحسينه بالذكاء إلى React مع Tailwind أو إلى CSS متجاوب. ضع <code>?node-id=</code> في الرابط لتحويل إطار محدد.</p>
            <div class="gh-row">${field('ix-fg-url', 'رابط الملف أو الإطار', '', 'dir="ltr" placeholder="https://www.figma.com/design/KEY/Name?node-id=1-2"')}${field('ix-fg-token', 'Figma token', lsGet(TOKEN, ''), 'dir="ltr" type="password"')}${select('ix-fg-fw', 'الناتج', [['html', 'HTML + CSS (دقيق)'], ['responsive', 'HTML متجاوب (ذكاء)'], ['react', 'React + Tailwind (ذكاء)']], 'html')}</div>
            <div class="gh-row">${pbtn('fa-wand-magic-sparkles', 'تحويل', 'app.ixFigmaGo()')}</div>
            ${area('ix-fg-paste', 'أو الصق JSON من إضافة Figma', '', 2, 'dir="ltr"')}<div class="gh-row">${btn('fa-paste', 'تحويل الملصق', 'app.ixFigmaPaste()')}</div>
            <div id="ix-fg-res"></div><iframe id="ix-fg-frame" class="ix-frame ix-frame-wide" sandbox title="معاينة"></iframe>`, 'fa-pen-ruler');
    };
    P.ixFigmaPluginMake = function (o = {}) {
        const files = figmaPluginFiles({ oxUrl: location.origin + location.pathname, ...o });
        this.ixWriteFiles('إضافة Figma', files, { open: false });
        return files;
    };
    P.ixFigmaPluginZip = async function () {
        const files = figmaPluginFiles({ oxUrl: location.origin + location.pathname });
        if (this.ensureJSZip) await this.ensureJSZip();
        const Z = globalThis.JSZip;
        if (!Z) { this.ixFigmaPluginMake(); return null; }
        const z = new Z();
        Object.entries(files).forEach(([p, c]) => z.file(p.replace(/^figma-plugin\//, ''), c));
        this.downloadBlob(await z.generateAsync({ type: 'blob' }), 'ox-alpha-figma-plugin.zip');
        return Object.keys(files);
    };
    P.ixFigmaPlugin = async function () {
        return card('إضافة Figma', `<p class="hv-dim">إضافة حقيقية لـ Figma تستخدم المحوّل نفسه: اختر إطاراً فيظهر HTML وCSS فوراً. تعمل أيضاً كمولّد كود في Dev Mode، وتُرسل التصميم إلى OX-Alpha بنقرة. تحتاج Figma Desktop فقط: Plugins ← Development ← Import from manifest.</p>
            <div class="gh-row">${pbtn('fa-file-zipper', 'تنزيل الإضافة (zip)', 'app.ixFigmaPluginZip()')}${btn('fa-folder-plus', 'إضافة ملفاتها للمشروع', 'app.ixFigmaPluginMake()')}</div>
            ${pre(Object.keys(figmaPluginFiles()).join('\n'))}`, 'fa-puzzle-piece');
    };
}
