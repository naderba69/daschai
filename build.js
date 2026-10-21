const fs = require('fs');
const path = require('path');

console.log("⚡ Building OX-Alpha Workbench Pro — Professional Build v2.0");
console.log("─────────────────────────────────────────────────────────");

const startTime = Date.now();

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
    const featuresContent = featureFiles
        .map(f => `\n/* ---- feature: ${f} ---- */\n` + fs.readFileSync(path.join(featuresDir, f), 'utf8'))
        .join('\n');
    const appJsContent = coreJsContent + '\n' + featuresContent;

    // Basic minification for CSS (remove comments, extra whitespace) — safe
    const minifyCSS = (css) => css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}:;,])\s*/g, '$1')
        .trim();

    const useMinify = process.argv.includes('--minify');
    const finalCSS = useMinify ? minifyCSS(cssContent) : cssContent;

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
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://openrouter.ai https://api.tavily.com https://ar.wikipedia.org; worker-src blob:; frame-src blob:;">

    <!-- PWA Manifest -->
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✦</text></svg>">
    <link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✦</text></svg>">

    <!-- Preconnect for performance -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    <link rel="preconnect" href="https://cdn.jsdelivr.net">

    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" crossorigin="anonymous" referrerpolicy="no-referrer">

    <!-- Critical libraries (loaded sync) -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" defer></script>

    <!-- Heavy libraries — lazy loaded on demand (saves ~10MB initial) -->
    <script>
        window._lazyLibs = {
            tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js',
            pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
            pyodide: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js'
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
${layoutContent}

    <!-- Main Application Logic -->
    <script id="app-script">
${appJsContent}
    </script>

    <!-- Service Worker registration (if present) -->
    <script>
        if('serviceWorker' in navigator){
            window.addEventListener('load', ()=> {
                navigator.serviceWorker.register('/sw.js').catch(()=>{});
            });
        }
    </script>
</body>
</html>
`;

    fs.writeFileSync(path.join(__dirname, 'index.html'), fullHtml, 'utf8');

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const sizeKB = (fullHtml.length / 1024).toFixed(1);
    const lines = fullHtml.split('\n').length;

    console.log(`✅ Build complete in ${duration}s`);
    console.log(`   📦 index.html → ${sizeKB} KB / ${lines} lines`);
    console.log(`   🎨 CSS: ${(finalCSS.length/1024).toFixed(1)} KB ${useMinify ? '(minified)' : ''}`);
    console.log(`   📜 JS: ${(appJsContent.length/1024).toFixed(1)} KB (core + ${featureFiles.length} feature module${featureFiles.length === 1 ? '' : 's'})`);
    console.log(`   🧩 Layout: ${(layoutContent.length/1024).toFixed(1)} KB`);

    if (parseFloat(sizeKB) > 500) {
        console.warn(`⚠️  Warning: bundle >500KB (${sizeKB}KB) — consider code splitting`);
    }

} catch (err) {
    console.error('❌ Build failed:', err.message);
    console.error(err.stack);
    process.exit(1);
}
