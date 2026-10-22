const fs = require('fs');
const path = require('path');

console.log("⚡ Building OX-Alpha Workbench Pro — Professional Build v2.0");
console.log("─────────────────────────────────────────────────────────");

const startTime = Date.now();

(async () => {
try {
    const cssPath = path.join(__dirname, 'src/styles.css');
    const layoutPath = path.join(__dirname, 'src/layout.html');
    const appJsPath = path.join(__dirname, 'src/app.js');

    [cssPath, layoutPath, appJsPath].forEach(p => {
        if (!fs.existsSync(p)) {
            console.error(`❌ Missing required file: ${p}`);
            process.exit(1);
        }
    });

    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const layoutContent = fs.readFileSync(layoutPath, 'utf8');
    const coreJsContent = fs.readFileSync(appJsPath, 'utf8');

    // Feature modules (src/features/*.js) — loaded in filename order after the core app
    const featuresDir = path.join(__dirname, 'src/features');
    const featureFiles = fs.existsSync(featuresDir)
        ? fs.readdirSync(featuresDir).filter(f => f.endsWith('.js')).sort()
        : [];
    const featureSources = featureFiles.map(f => ({ name: f, src: fs.readFileSync(path.join(featuresDir, f), 'utf8') }));
    const featuresContent = featureSources
        .map(({ name, src }) => `\n/* ---- feature: ${name} ---- */\n` + src)
        .join('\n');
    const useMinify = process.argv.includes('--minify');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

    // Optional JS minification with terser (devDependency). Falls back to the readable bundle if unavailable.
    let rawJs = coreJsContent + '\n' + featuresContent;
    let jsMinified = false;
    if (useMinify && !process.argv.includes('--no-terser')) {
        try {
            const { minify } = require('terser');
            const out = await minify(rawJs, {
                ecma: 2020,
                compress: { passes: 2, drop_debugger: true, pure_getters: false },
                mangle: { toplevel: false },
                keep_classnames: true,
                keep_fnames: false,
                format: { comments: false, ascii_only: false }
            });
            if (out && out.code) { rawJs = out.code; jsMinified = true; }
        } catch (e) {
            console.warn(`⚠️  terser unavailable or failed (${e.message.split('\n')[0]}) — shipping unminified JS`);
        }
    }
    // A literal </script> inside JS (e.g. HTML file templates) would end the inline <script> tag early.
    // Must run AFTER minification (terser may rewrite the escaped form).
    const appJsContent = rawJs.replace(/<\/script/gi, '<\\/script');

    // Studio chunks (Sprint 6): CodeMirror editor + code runner as lazily-imported ES modules.
    // Content-hashed file names → safe to cache forever (vercel.json marks /assets/ immutable).
    let chunks = null;
    const chunkFiles = [];
    const studioEntry = path.join(__dirname, 'src/studio/studio.js');
    if (fs.existsSync(studioEntry)) {
        const esbuild = require('esbuild');
        const outdir = path.join(__dirname, 'assets/studio');
        fs.rmSync(outdir, { recursive: true, force: true });
        const result = await esbuild.build({
            absWorkingDir: __dirname,
            entryPoints: { studio: 'src/studio/studio.js', runner: 'src/studio/runner.js', ui: 'src/ui/ui.js', ai: 'src/ai/ai.js', github: 'src/github/github.js', media: 'src/media/media.js', team: 'src/team/team.js', perf: 'src/perf/perf.js', dev: 'src/dev/dev.js', integ: 'src/integ/integ.js', widgets: 'src/integ/widgets.js' },
            bundle: true, splitting: true, format: 'esm', target: ['es2020'],
            outdir: 'assets/studio', outExtension: { '.js': '.mjs' },
            entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]',
            minify: useMinify, legalComments: 'none', charset: 'utf8', metafile: true, logLevel: 'warning',
            // Lazy-chunk stylesheets (src/ui/ui.css) are imported as minified text and injected on install.
            plugins: [{
                name: 'css-text',
                setup(b) {
                    b.onLoad({ filter: /\.css$/ }, async (args) => {
                        const css = fs.readFileSync(args.path, 'utf8');
                        const out = await esbuild.transform(css, { loader: 'css', minify: useMinify, legalComments: 'none' });
                        return { contents: out.code, loader: 'text' };
                    });
                }
            }]
        });
        const outputs = result.metafile.outputs;
        chunks = { shared: [] };
        const staticDeps = (file, seen = new Set()) => {
            for (const imp of (outputs[file] && outputs[file].imports) || []) {
                if (imp.kind !== 'import-statement' || seen.has(imp.path)) continue;
                seen.add(imp.path);
                staticDeps(imp.path, seen);
            }
            return seen;
        };
        const NAMED = new Set(['studio', 'runner', 'ui', 'ai', 'github', 'media', 'team', 'perf', 'dev', 'integ', 'widgets']);
        for (const [file, meta] of Object.entries(outputs)) {
            // Only the named entry points go into OX_BUILD (dynamic-import chunks such as CodeMirror languages are reached via imports)
            if (meta.entryPoint && NAMED.has(path.basename(meta.entryPoint, '.js')) && /src\/(studio|ui|ai|github|media|team|perf|dev|integ)\//.test(meta.entryPoint)) chunks[path.basename(meta.entryPoint, '.js')] = file;
            const buf = fs.readFileSync(path.join(__dirname, file));
            chunkFiles.push({ name: file, size: meta.bytes, gzip: require('zlib').gzipSync(buf, { level: 9 }).length, br: require('zlib').brotliCompressSync(buf).length });
        }
        chunks.shared = Array.from(staticDeps(chunks.studio)).sort();
        fs.writeFileSync(path.join(outdir, 'manifest.json'), JSON.stringify({ version: pkg.version, chunks, files: chunkFiles }, null, 2) + '\n');
    }

    // Build info for the in-app health panel / changelog (#845, #864)
    const kb = (s) => Buffer.byteLength(s, 'utf8');
    // App icons (PNG) for Android/iOS installs + TWA (#941, #942) — generated once, committed
    try { require('./tools/icons.js').ensureIcons(__dirname); } catch (e) { console.warn('⚠️  icons:', e.message); }
    // Only entry chunks travel in index.html; the full per-file list lives in assets/studio/manifest.json (#821)
    const entryFiles = chunks ? new Set(Object.entries(chunks).filter(([k]) => k !== 'shared').map(([, v]) => v)) : new Set();
    const buildInfo = {
        version: pkg.version,
        builtAt: new Date().toISOString(),
        minified: jsMinified,
        chunks,
        modules: [{ name: 'app.js (core)', size: kb(coreJsContent) }, ...featureSources.map(({ name, src }) => ({ name, size: kb(src) })), { name: 'styles.css', size: kb(cssContent) }, { name: 'layout.html', size: kb(layoutContent) }, ...chunkFiles.filter(f => entryFiles.has(f.name)).map(f => ({ name: f.name, size: f.size, lazy: true }))]
    };

    // Basic minification for CSS (remove comments, extra whitespace) — safe
    const minifyCSS = (css) => css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{};,])\s*/g, '$1')
        .replace(/:\s+/g, ':')
        .trim();

    // esbuild is the real CSS minifier (the regex fallback stripped the space in descendant selectors such as
    // `body.kb-nav :focus-visible`, silently changing their meaning in production).
    let finalCSS = cssContent;
    if (useMinify) {
        try { finalCSS = require('esbuild').transformSync(cssContent, { loader: 'css', minify: true, legalComments: 'none', charset: 'utf8' }).code.trim(); }
        catch (e) { console.warn('⚠️  esbuild CSS minify failed, using the basic minifier:', e.message); finalCSS = minifyCSS(cssContent); }
    }

    // Layout HTML: drop comments + collapse whitespace runs to one space (never inside pre/textarea/script/style,
    // where whitespace is content). Rendering is unchanged — a single space keeps inline gaps intact.
    const minifyHTML = (html) => html.split(/(<(pre|textarea|script|style)\b[\s\S]*?<\/\2>)/i)
        .map((p, i) => i % 3 === 2 ? '' : i % 3 === 1 ? p : p.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/\s+/g, ' ')).join('');
    const finalLayout = useMinify ? minifyHTML(layoutContent) : layoutContent;

    const fullHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>OX-Alpha Workbench Pro | Gemini AI Autonomous Engineering Copilot</title>
    <meta name="description" content="منظومة هندسة البرمجيات بالذكاء الاصطناعي مع جلب وتحديث كود مستودعات GitHub مباشرة، فك وتصدير مشاريع ZIP، ودعم النماذج الحية بواجهة جيميناي الفائقة.">
    <meta name="keywords" content="AI, GitHub, Copilot, Gemini, هندسة برمجيات, ذكاء اصطناعي, OX-Alpha">
    <meta name="author" content="OX-Alpha Workbench Pro">
    <meta name="theme-color" content="#131314">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="OX-Alpha Pro">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://daschai.vercel.app/">

    <!-- Open Graph / Social -->
    <meta property="og:title" content="OX-Alpha Workbench Pro — Gemini AI Copilot">
    <meta property="og:description" content="منظومة هندسة البرمجيات بالذكاء الاصطناعي — جلب GitHub، فك ZIP، تشغيل أكواد حية.">
    <meta property="og:type" content="website">
    <meta property="og:url" content="https://daschai.vercel.app/">
    <meta property="og:image" content="https://daschai.vercel.app/og-image.png">
    <meta property="og:locale" content="ar_SA">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="OX-Alpha Workbench Pro">
    <meta name="twitter:description" content="منظومة هندسة البرمجيات بالذكاء الاصطناعي">

    <!-- Security Headers (also set via vercel.json for production) -->
    <meta http-equiv="X-Content-Type-Options" content="nosniff">
    <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
    <!-- CSP: allow required CDNs only -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com blob: data:; media-src 'self' blob: data:; img-src 'self' data: https: blob:; connect-src 'self' https://api.github.com https://uploads.github.com https://codeload.github.com https://*.actions.githubusercontent.com https://*.blob.core.windows.net https://gitlab.com https://api.bitbucket.org https://raw.githubusercontent.com https://gist.githubusercontent.com https://discord.com https://discordapp.com https://hooks.slack.com https://openrouter.ai https://api.tavily.com https://ar.wikipedia.org https://registry.npmjs.org https://content.dropboxapi.com https://api.dropboxapi.com https://www.googleapis.com https://graph.microsoft.com https://api.onedrive.com https://*.sharepoint.com https://*.amazonaws.com https://api.figma.com https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://*.supabase.co https://firestore.googleapis.com https://*.psdb.cloud https://*.algolia.net https://*.algolianet.com https://api.cloudinary.com https://res.cloudinary.com https://*.auth0.com https://*.clerk.accounts.dev https://*.sentry.io https://*.ingest.sentry.io https://*.posthog.com https://api.linear.app https://api.trello.com https://*.atlassian.net https://hooks.zapier.com https://*.make.com https://hook.integromat.com; worker-src 'self' blob:; frame-src blob: https://www.figma.com https://embed.figma.com;">

    <!-- PWA Manifest -->
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✦</text></svg>">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
    <meta name="mobile-web-app-capable" content="yes">

    <!-- Preconnect for performance -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    <link rel="preconnect" href="https://cdn.jsdelivr.net">

    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">

    <!-- Critical libraries (loaded sync) -->
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js"></script>
    <!-- JSZip and Mermaid are lazy-loaded on first use (src/features/09-platform.js) -->

    <!-- Heavy libraries — lazy loaded on demand (saves ~10MB initial) -->
    <script>
        window._lazyLibs = {
            tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js',
            pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
            pyodide: 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js'
        };
        window.loadLazyLib = function(name){
            return new Promise((res, rej)=>{
                const url = window._lazyLibs[name];
                if(!url) return rej('unknown lib '+name);
                if(document.querySelector('script[data-lazy=\"'+name+'\"]')) return res();
                const s=document.createElement('script');
                s.src=url; s.async=true; s.dataset.lazy=name;
                s.onload=res; s.onerror=rej;
                document.head.appendChild(s);
            });
        };
    </script>

    <style>
${finalCSS}
    </style>
</head>
<body>
${finalLayout}

    <script>window.OX_BUILD = ${JSON.stringify(buildInfo)};</script>
    <!-- Main Application Logic -->
    <script id="app-script">
${appJsContent}
    </script>

    <!-- Service Worker registration + update prompts live in src/features/09-platform.js -->
</body>
</html>
`;

    fs.writeFileSync(path.join(__dirname, 'index.html'), fullHtml, 'utf8');

    // version.json — read by the service worker for delta updates (#866), rollback (#865) and update channels (#869)
    const zlib = require('zlib');
    const hash8 = (buf) => ({ h: require('crypto').createHash('sha256').update(buf).digest('hex').slice(0, 12), gz: zlib.gzipSync(buf, { level: 6 }).length });
    const channel = process.env.OX_CHANNEL || pkg.oxChannel || (/-(alpha|beta|rc)/i.test(pkg.version) ? 'beta' : 'stable');
    const vfiles = {};
    for (const f of ['index.html', 'sw.js', 'manifest.json']) if (fs.existsSync(path.join(__dirname, f))) vfiles['/' + f] = hash8(fs.readFileSync(path.join(__dirname, f)));
    for (const f of chunkFiles) vfiles['/' + f.name] = hash8(fs.readFileSync(path.join(__dirname, f.name)));
    for (const dir of ['workers', 'icons', 'widgets']) {
        const d = path.join(__dirname, dir);
        if (fs.existsSync(d)) for (const f of fs.readdirSync(d).sort()) vfiles[`/${dir}/${f}`] = hash8(fs.readFileSync(path.join(d, f)));
    }
    const versionJson = { version: pkg.version, channel, builtAt: buildInfo.builtAt, entries: chunks ? Object.fromEntries(Object.entries(chunks).filter(([k]) => k !== 'shared').map(([k, v]) => ['/' + v, k])) : {}, files: vfiles };
    fs.writeFileSync(path.join(__dirname, 'version.json'), JSON.stringify(versionJson, null, 1) + '\n');

    // Precompressed copies for static hosts (Termux / nginx gzip_static / brotli_static) — #824. Not committed (.gitignore).
    if (process.argv.includes('--precompress')) {
        const targets = ['index.html', 'sw.js', 'manifest.json', 'version.json', ...chunkFiles.map(f => f.name)];
        for (const f of targets) {
            const abs = path.join(__dirname, f), buf = fs.readFileSync(abs);
            fs.writeFileSync(abs + '.gz', zlib.gzipSync(buf, { level: 9 }));
            fs.writeFileSync(abs + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
        }
        console.log(`   🗜️  precompressed ${targets.length} files (.gz + .br)`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const sizeKB = (Buffer.byteLength(fullHtml, 'utf8') / 1024).toFixed(1);
    const lines = fullHtml.split('\n').length;

    console.log(`✅ Build complete in ${duration}s`);
    console.log(`   📦 index.html → ${sizeKB} KB / ${lines} lines`);
    console.log(`   🎨 CSS: ${(finalCSS.length/1024).toFixed(1)} KB ${useMinify ? '(minified)' : ''}`);
    console.log(`   📜 JS: ${(kb(appJsContent)/1024).toFixed(1)} KB ${jsMinified ? '(terser) ' : ''}(core + ${featureFiles.length} feature module${featureFiles.length === 1 ? '' : 's'})`);
    console.log(`   🧩 Layout: ${(layoutContent.length/1024).toFixed(1)} KB`);
    if (chunks) {
        const sum = (arr, k) => arr.reduce((n, f) => n + f[k], 0);
        const studioSet = [chunks.studio, ...chunks.shared];
        const studioFiles = chunkFiles.filter(f => studioSet.includes(f.name));
        console.log(`   🧠 Studio chunks: ${chunkFiles.length} files, editor first load ${(sum(studioFiles, 'size') / 1024).toFixed(1)} KB (${(sum(studioFiles, 'gzip') / 1024).toFixed(1)} KB gzip) — lazy, not in index.html`);
    }

    // What actually travels over the network: Vercel serves index.html compressed (gzip/brotli)
    const gzipKB = (require('zlib').gzipSync(fullHtml, { level: 9 }).length / 1024).toFixed(1);
    const brKB = (require('zlib').brotliCompressSync(fullHtml, { params: { [require('zlib').constants.BROTLI_PARAM_QUALITY]: 11 } }).length / 1024).toFixed(1);
    const budgetKB = (JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).config || {}).gzipBudgetKB || 270; // single source: package.json config.gzipBudgetKB
    console.log(`   🗜️  gzip: ${gzipKB} KB transferred (budget ${budgetKB} KB) • brotli: ${brKB} KB`);
    if (parseFloat(gzipKB) > budgetKB) {
        console.warn(`⚠️  Warning: compressed bundle >${budgetKB}KB (${gzipKB}KB) — consider code splitting`);
    }

} catch (err) {
    console.error('❌ Build failed:', err.message);
    console.error(err.stack);
    process.exit(1);
}
})();
