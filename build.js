const fs = require('fs');
const path = require('path');

console.log("Building OX-Alpha Workbench Pro index.html...");

const cssContent = fs.readFileSync(path.join(__dirname, 'src/styles.css'), 'utf8');
const layoutContent = fs.readFileSync(path.join(__dirname, 'src/layout.html'), 'utf8');
const appJsContent = fs.readFileSync(path.join(__dirname, 'src/app.js'), 'utf8');

const fullHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>OX-Alpha Workbench Pro | Gemini AI Autonomous Engineering Copilot</title>
    
    <!-- Meta tags for PWA & Mobile Polish -->
    <meta name="theme-color" content="#131314">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="description" content="منظومة هندسة البرمجيات بالذكاء الاصطناعي مع جلب وتحديث كود مستودعات GitHub مباشرة، فك وتصدير مشاريع ZIP، ودعم النماذج الحية بواجهة جيميناي الفائقة.">

    <!-- Fonts: Google Sans / Inter / Cairo / JetBrains Mono -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
    
    <!-- FontAwesome Pro/Solid/Brands CDN -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    
    <!-- Highlight.js Theme (Atom One Dark / Obsidian) -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
    
    <!-- Client Libraries -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.9/purify.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script src="https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>

    <style>
${cssContent}
    </style>
</head>
<body>
${layoutContent}

    <!-- Main JavaScript Application Logic -->
    <script id="app-script">
${appJsContent}
    </script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), fullHtml, 'utf8');
console.log(`✅ Successfully generated index.html (${fullHtml.length} bytes / ${fullHtml.split('\n').length} lines)`);
