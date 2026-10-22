/* Start & import: 20 project templates (#604), project from a description (#605), import from GitHub (#606),
   Figma frames + colour tokens (#607), Notion export (#608), export to a new repo (#609), publish as template (#610). */
import { unzipSync } from 'fflate';
import { esc, call, btn, pbtn, card, empty, field, area, select, lsGet, lsSet, uid, baseName, extOf, kindOf, mimeOf, bytesToDataUrl, fromUtf8, blobBytes, val, filesOf } from './shared.js';

const MY_TEMPLATES = 'ox_fmx_templates_v1';
const pkg = (name, extra = {}) => JSON.stringify({ name, version: '0.1.0', private: true, type: 'module', ...extra }, null, 2) + '\n';
const html = (title, body, head = '') => `<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${title}</title>\n${head}</head>\n<body>\n${body}\n</body>\n</html>\n`;
const readme = (t, run) => `# ${t}\n\nأنشئ من قوالب OX-Alpha Workbench.\n\n## التشغيل\n\n\`\`\`bash\n${run}\n\`\`\`\n`;
const CSS = 'body{font-family:system-ui,sans-serif;margin:0;padding:2rem;background:#0f172a;color:#e2e8f0}a{color:#38bdf8}button{padding:.6rem 1rem;border-radius:8px;border:0;background:#2563eb;color:#fff;cursor:pointer}\n';
/** 20 ready templates (#604). Each: [id, icon, label, description, () => files{}] */
export const TEMPLATES = [
    ['static', 'fa-html5', 'موقع HTML/CSS/JS', 'صفحة ثابتة بلا أدوات بناء', () => ({ 'index.html': html('موقعي', '  <main>\n    <h1>مرحباً 👋</h1>\n    <button id="btn">اضغطني</button>\n  </main>\n  <script src="app.js"></script>', '  <link rel="stylesheet" href="style.css">\n'), 'style.css': CSS, 'app.js': "document.getElementById('btn').onclick = () => alert('أهلاً!');\n", 'README.md': readme('موقع ثابت', 'npx serve .') })],
    ['landing', 'fa-rocket', 'صفحة هبوط', 'Hero + مزايا + أسعار + نموذج تواصل', () => ({ 'index.html': html('منتجي', '  <header class="hero"><h1>منتج يغيّر طريقة عملك</h1><p>جرّبه مجاناً اليوم.</p><a class="cta" href="#pricing">ابدأ الآن</a></header>\n  <section class="features"><div>⚡ سريع</div><div>🔒 آمن</div><div>🌍 عالمي</div></section>\n  <section id="pricing" class="pricing"><div><h3>مجاني</h3><b>0$</b></div><div><h3>احترافي</h3><b>9$</b></div></section>\n  <form class="contact"><input placeholder="بريدك" type="email" required><button>اشترك</button></form>', '  <link rel="stylesheet" href="style.css">\n'), 'style.css': CSS + '.hero{text-align:center;padding:5rem 1rem}.cta{background:#2563eb;color:#fff;padding:.8rem 1.4rem;border-radius:10px;text-decoration:none}.features,.pricing{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin:2rem 0}.features div,.pricing div{background:#1e293b;padding:1.5rem;border-radius:12px;text-align:center}.contact{display:flex;gap:.5rem;justify-content:center}\n', 'README.md': readme('صفحة هبوط', 'npx serve .') })],
    ['react', 'fa-react', 'React + Vite', 'تطبيق React حديث', () => ({ 'package.json': pkg('react-app', { scripts: { dev: 'vite', build: 'vite build' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.1' } }), 'vite.config.js': "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n", 'index.html': html('React', '  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>'), 'src/main.jsx': "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);\n", 'src/App.jsx': "import { useState } from 'react';\nexport default function App() {\n  const [n, setN] = useState(0);\n  return <main><h1>React ⚛️</h1><button onClick={() => setN(n + 1)}>العدد: {n}</button></main>;\n}\n", 'README.md': readme('React + Vite', 'npm install\nnpm run dev') })],
    ['vue', 'fa-vuejs', 'Vue + Vite', 'تطبيق Vue 3', () => ({ 'package.json': pkg('vue-app', { scripts: { dev: 'vite', build: 'vite build' }, dependencies: { vue: '^3.4.0' }, devDependencies: { vite: '^5.4.0', '@vitejs/plugin-vue': '^5.1.0' } }), 'vite.config.js': "import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\nexport default defineConfig({ plugins: [vue()] });\n", 'index.html': html('Vue', '  <div id="app"></div>\n  <script type="module" src="/src/main.js"></script>'), 'src/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n", 'src/App.vue': '<script setup>\nimport { ref } from \'vue\';\nconst n = ref(0);\n</script>\n<template>\n  <h1>Vue 💚</h1>\n  <button @click="n++">العدد: {{ n }}</button>\n</template>\n', 'README.md': readme('Vue + Vite', 'npm install\nnpm run dev') })],
    ['svelte', 'fa-s', 'Svelte + Vite', 'تطبيق Svelte', () => ({ 'package.json': pkg('svelte-app', { scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: '^5.4.0', svelte: '^4.2.0', '@sveltejs/vite-plugin-svelte': '^3.1.0' } }), 'vite.config.js': "import { defineConfig } from 'vite';\nimport { svelte } from '@sveltejs/vite-plugin-svelte';\nexport default defineConfig({ plugins: [svelte()] });\n", 'index.html': html('Svelte', '  <div id="app"></div>\n  <script type="module" src="/src/main.js"></script>'), 'src/main.js': "import App from './App.svelte';\nexport default new App({ target: document.getElementById('app') });\n", 'src/App.svelte': '<script>\n  let n = 0;\n</script>\n<h1>Svelte 🧡</h1>\n<button on:click={() => n++}>العدد: {n}</button>\n', 'README.md': readme('Svelte + Vite', 'npm install\nnpm run dev') })],
    ['next', 'fa-n', 'Next.js', 'App Router + صفحة ومسار API', () => ({ 'package.json': pkg('next-app', { scripts: { dev: 'next dev', build: 'next build', start: 'next start' }, dependencies: { next: '^14.2.0', react: '^18.3.1', 'react-dom': '^18.3.1' } }), 'app/layout.js': "export const metadata = { title: 'Next.js' };\nexport default function RootLayout({ children }) {\n  return <html lang=\"ar\" dir=\"rtl\"><body>{children}</body></html>;\n}\n", 'app/page.js': "export default function Page() {\n  return <main><h1>Next.js ▲</h1><a href=\"/api/hello\">API</a></main>;\n}\n", 'app/api/hello/route.js': "export function GET() {\n  return Response.json({ hello: 'world' });\n}\n", 'README.md': readme('Next.js', 'npm install\nnpm run dev') })],
    ['express', 'fa-server', 'Express API', 'REST API مع مسارات وأخطاء', () => ({ 'package.json': pkg('express-api', { scripts: { start: 'node server.js', dev: 'node --watch server.js' }, dependencies: { express: '^4.19.2' } }), 'server.js': "import express from 'express';\nconst app = express();\napp.use(express.json());\nconst todos = [];\napp.get('/api/todos', (req, res) => res.json(todos));\napp.post('/api/todos', (req, res) => {\n  if (!req.body.title) return res.status(400).json({ error: 'title required' });\n  const t = { id: todos.length + 1, title: req.body.title, done: false };\n  todos.push(t);\n  res.status(201).json(t);\n});\napp.use((err, req, res, next) => res.status(500).json({ error: err.message }));\napp.listen(process.env.PORT || 3000, () => console.log('API on :3000'));\n", '.env.example': 'PORT=3000\n', 'README.md': readme('Express API', 'npm install\nnpm run dev') })],
    ['sqlite-api', 'fa-database', 'API + SQLite', 'Express مع قاعدة SQLite', () => ({ 'package.json': pkg('sqlite-api', { scripts: { start: 'node server.js' }, dependencies: { express: '^4.19.2', 'better-sqlite3': '^11.0.0' } }), 'db.js': "import Database from 'better-sqlite3';\nexport const db = new Database('data.db');\ndb.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP)');\n", 'server.js': "import express from 'express';\nimport { db } from './db.js';\nconst app = express();\napp.use(express.json());\napp.get('/notes', (req, res) => res.json(db.prepare('SELECT * FROM notes ORDER BY id DESC').all()));\napp.post('/notes', (req, res) => res.status(201).json(db.prepare('INSERT INTO notes (text) VALUES (?)').run(req.body.text)));\napp.listen(3000);\n", '.gitignore': 'node_modules/\ndata.db\n', 'README.md': readme('API + SQLite', 'npm install\nnpm start') })],
    ['flask', 'fa-python', 'Python Flask', 'تطبيق ويب Flask مع قالب', () => ({ 'app.py': "from flask import Flask, render_template, jsonify\n\napp = Flask(__name__)\n\n@app.route('/')\ndef home():\n    return render_template('index.html', title='Flask')\n\n@app.route('/api/ping')\ndef ping():\n    return jsonify(ok=True)\n\nif __name__ == '__main__':\n    app.run(debug=True)\n", 'templates/index.html': html('{{ title }}', '  <h1>{{ title }} 🐍</h1>'), 'requirements.txt': 'flask>=3.0\n', 'README.md': readme('Flask', 'pip install -r requirements.txt\npython app.py') })],
    ['fastapi', 'fa-bolt', 'Python FastAPI', 'API سريع مع توثيق تلقائي', () => ({ 'main.py': "from fastapi import FastAPI\nfrom pydantic import BaseModel\n\napp = FastAPI()\n\nclass Item(BaseModel):\n    name: str\n    price: float\n\nitems: list[Item] = []\n\n@app.get('/items')\ndef list_items():\n    return items\n\n@app.post('/items')\ndef add_item(item: Item):\n    items.append(item)\n    return item\n", 'requirements.txt': 'fastapi>=0.110\nuvicorn>=0.29\n', 'README.md': readme('FastAPI', 'pip install -r requirements.txt\nuvicorn main:app --reload') })],
    ['cli', 'fa-terminal', 'أداة سطر أوامر Node', 'CLI مع وسائط ومساعدة', () => ({ 'package.json': pkg('my-cli', { bin: { 'my-cli': './cli.js' } }), 'cli.js': "#!/usr/bin/env node\nimport { parseArgs } from 'node:util';\nconst { values, positionals } = parseArgs({ options: { help: { type: 'boolean', short: 'h' }, name: { type: 'string', short: 'n', default: 'world' } }, allowPositionals: true });\nif (values.help) { console.log('Usage: my-cli [--name X] [files...]'); process.exit(0); }\nconsole.log(`Hello, ${values.name}!`, positionals);\n", 'README.md': readme('CLI', 'node cli.js --name Ali') })],
    ['library', 'fa-box', 'مكتبة npm (TypeScript)', 'حزمة TS مع اختبارات', () => ({ 'package.json': pkg('my-lib', { main: 'dist/index.js', types: 'dist/index.d.ts', scripts: { build: 'tsc', test: 'node --test' }, devDependencies: { typescript: '^5.5.0' } }), 'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext', declaration: true, outDir: 'dist', strict: true } }, null, 2) + '\n', 'src/index.ts': 'export function slugify(s: string): string {\n  return s.toLowerCase().trim().replace(/[^\\p{L}\\p{N}]+/gu, \'-\').replace(/^-|-$/g, \'\');\n}\n', 'test/index.test.js': "import test from 'node:test';\nimport assert from 'node:assert';\ntest('placeholder', () => assert.ok(true));\n", 'README.md': readme('مكتبة npm', 'npm install\nnpm run build') })],
    ['extension', 'fa-puzzle-piece', 'إضافة Chrome (MV3)', 'Popup + Content script', () => ({ 'manifest.json': JSON.stringify({ manifest_version: 3, name: 'My Extension', version: '0.1.0', action: { default_popup: 'popup.html' }, permissions: ['storage', 'activeTab'], content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }] }, null, 2) + '\n', 'popup.html': html('Popup', '  <h3>إضافتي</h3>\n  <button id="go">تلوين الصفحة</button>\n  <script src="popup.js"></script>'), 'popup.js': "document.getElementById('go').onclick = async () => {\n  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });\n  chrome.tabs.sendMessage(tab.id, { color: '#fef08a' });\n};\n", 'content.js': 'chrome.runtime.onMessage.addListener((m) => { if (m.color) document.body.style.background = m.color; });\n', 'README.md': readme('إضافة Chrome', 'chrome://extensions → Load unpacked') })],
    ['pwa', 'fa-mobile-screen', 'تطبيق PWA', 'Manifest + Service Worker أوفلاين', () => ({ 'index.html': html('PWA', '  <h1>تطبيق يعمل بلا إنترنت 📱</h1>\n  <script>if (\'serviceWorker\' in navigator) navigator.serviceWorker.register(\'sw.js\');</script>', '  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="stylesheet" href="style.css">\n'), 'manifest.webmanifest': JSON.stringify({ name: 'My PWA', short_name: 'PWA', start_url: '.', display: 'standalone', background_color: '#0f172a', theme_color: '#2563eb', icons: [] }, null, 2) + '\n', 'sw.js': "const C = 'v1';\nself.addEventListener('install', e => e.waitUntil(caches.open(C).then(c => c.addAll(['./', 'index.html', 'style.css']))));\nself.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));\n", 'style.css': CSS, 'README.md': readme('PWA', 'npx serve .') })],
    ['electron', 'fa-desktop', 'تطبيق سطح مكتب Electron', 'نافذة رئيسية + preload', () => ({ 'package.json': pkg('desktop-app', { main: 'main.cjs', type: 'commonjs', scripts: { start: 'electron .' }, devDependencies: { electron: '^31.0.0' } }), 'main.cjs': "const { app, BrowserWindow } = require('electron');\nconst path = require('path');\napp.whenReady().then(() => {\n  const win = new BrowserWindow({ width: 900, height: 640, webPreferences: { preload: path.join(__dirname, 'preload.cjs') } });\n  win.loadFile('index.html');\n});\napp.on('window-all-closed', () => app.quit());\n", 'preload.cjs': "const { contextBridge } = require('electron');\ncontextBridge.exposeInMainWorld('versions', { node: process.versions.node });\n", 'index.html': html('Desktop', '  <h1>تطبيق سطح مكتب 🖥️</h1>'), 'README.md': readme('Electron', 'npm install\nnpm start') })],
    ['discord-bot', 'fa-robot', 'بوت Discord', 'أوامر Slash أساسية', () => ({ 'package.json': pkg('discord-bot', { scripts: { start: 'node bot.js' }, dependencies: { 'discord.js': '^14.15.0' } }), 'bot.js': "import { Client, GatewayIntentBits } from 'discord.js';\nconst client = new Client({ intents: [GatewayIntentBits.Guilds] });\nclient.on('interactionCreate', async (i) => {\n  if (i.isChatInputCommand() && i.commandName === 'ping') await i.reply('🏓 pong');\n});\nclient.login(process.env.DISCORD_TOKEN);\n", '.env.example': 'DISCORD_TOKEN=\n', 'README.md': readme('Discord Bot', 'npm install\nDISCORD_TOKEN=... npm start') })],
    ['game', 'fa-gamepad', 'لعبة Canvas', 'حلقة لعب + تحكم بالأسهم', () => ({ 'index.html': html('لعبة', '  <canvas id="c" width="640" height="400"></canvas>\n  <script src="game.js"></script>', '  <style>body{margin:0;display:grid;place-items:center;height:100vh;background:#111}canvas{background:#0f172a;border-radius:8px}</style>\n'), 'game.js': "const c = document.getElementById('c'), ctx = c.getContext('2d');\nconst p = { x: 300, y: 180, s: 4 }, keys = {};\nonkeydown = e => keys[e.key] = true; onkeyup = e => keys[e.key] = false;\nfunction loop() {\n  if (keys.ArrowLeft) p.x -= p.s; if (keys.ArrowRight) p.x += p.s; if (keys.ArrowUp) p.y -= p.s; if (keys.ArrowDown) p.y += p.s;\n  ctx.clearRect(0, 0, c.width, c.height);\n  ctx.fillStyle = '#38bdf8'; ctx.fillRect(p.x, p.y, 32, 32);\n  requestAnimationFrame(loop);\n}\nloop();\n", 'README.md': readme('لعبة Canvas', 'npx serve .') })],
    ['dashboard', 'fa-chart-line', 'لوحة تحكم', 'بطاقات KPI + رسم بياني SVG', () => ({ 'index.html': html('لوحة التحكم', '  <h1>📊 لوحة التحكم</h1>\n  <section class="kpis"><div>المستخدمون <b>1,240</b></div><div>المبيعات <b>$8.2k</b></div><div>التحويل <b>3.4%</b></div></section>\n  <svg id="chart" viewBox="0 0 600 200"></svg>\n  <script src="app.js"></script>', '  <link rel="stylesheet" href="style.css">\n'), 'style.css': CSS + '.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}.kpis div{background:#1e293b;padding:1rem;border-radius:12px}.kpis b{display:block;font-size:1.6rem}#chart{width:100%;margin-top:1.5rem;background:#1e293b;border-radius:12px}\n', 'app.js': "const data = [12, 19, 8, 25, 31, 22, 40], svg = document.getElementById('chart');\nconst pts = data.map((v, i) => `${i * 100},${200 - v * 4.5}`).join(' ');\nsvg.innerHTML = `<polyline points=\"${pts}\" fill=\"none\" stroke=\"#38bdf8\" stroke-width=\"3\"/>`;\n", 'README.md': readme('لوحة تحكم', 'npx serve .') })],
    ['portfolio', 'fa-id-card', 'معرض أعمال شخصي', 'نبذة + مشاريع + تواصل', () => ({ 'index.html': html('أعمالي', '  <header><h1>اسمي</h1><p>مطوّر واجهات</p></header>\n  <section class="grid"><article><h3>مشروع 1</h3><p>وصف قصير</p></article><article><h3>مشروع 2</h3><p>وصف قصير</p></article></section>\n  <footer><a href="mailto:me@example.com">تواصل معي</a></footer>', '  <link rel="stylesheet" href="style.css">\n'), 'style.css': CSS + 'header{text-align:center;padding:3rem 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}article{background:#1e293b;padding:1.2rem;border-radius:12px}footer{text-align:center;margin-top:2rem}\n', 'README.md': readme('معرض أعمال', 'npx serve .') })],
    ['blog', 'fa-blog', 'مدونة Markdown', 'مولّد مواقع ثابت صغير', () => ({ 'package.json': pkg('md-blog', { scripts: { build: 'node build.mjs' }, dependencies: { marked: '^13.0.0' } }), 'build.mjs': "import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';\nimport { marked } from 'marked';\nmkdirSync('public', { recursive: true });\nconst posts = readdirSync('posts').filter(f => f.endsWith('.md'));\nfor (const f of posts) writeFileSync(`public/${f.replace('.md', '.html')}`, `<meta charset=utf-8>${marked(readFileSync('posts/' + f, 'utf8'))}`);\nwriteFileSync('public/index.html', '<meta charset=utf-8><h1>مدونتي</h1>' + posts.map(f => `<a href=\"${f.replace('.md', '.html')}\">${f}</a>`).join('<br>'));\n", 'posts/2026-01-01-hello.md': '---\ndate: 2026-01-01\n---\n# أول تدوينة\n\nمرحباً بالعالم!\n', 'README.md': readme('مدونة Markdown', 'npm install\nnpm run build') })]
];

/** Notion "Markdown & CSV" export → clean paths (strip 32-hex ids) + fixed links. */
export function cleanNotionExport(entries) {
    const strip = (p) => p.split('/').map(seg => seg.replace(/\s+[0-9a-f]{32}(?=(\.[\w]+)?$)/i, '')).join('/');
    const map = new Map(entries.map(e => [e.path, strip(e.path)]));
    return entries.map(e => {
        let path = map.get(e.path);
        let content = e.text;
        if (content != null && /\.md$/i.test(path)) {
            content = content.replace(/\]\(([^)]+)\)/g, (m, link) => { try { const dec = decodeURIComponent(link); const cleaned = dec.split('/').map(seg => seg.replace(/\s+[0-9a-f]{32}(?=(\.[\w]+)?$)/i, '')).join('/'); return `](${encodeURI(cleaned)})`; } catch (err) { return m; } });
        }
        if (content != null && /\.csv$/i.test(path)) {
            const rows = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(l => l.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
            if (rows.length) { content = `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map(r => `| ${r.join(' | ')} |`).join('\n')}\n`; path = path.replace(/\.csv$/i, '.md'); }
        }
        return { path: 'notion/' + path, text: content, bytes: e.bytes };
    });
}
/** Figma file JSON → frames + colour tokens */
export function figmaFrames(file) { return ((file.document && file.document.children) || []).flatMap(page => (page.children || []).filter(n => ['FRAME', 'COMPONENT', 'SECTION', 'COMPONENT_SET'].includes(n.type)).map(n => ({ id: n.id, name: n.name, page: page.name }))); }
export function figmaColorTokens(nodes) {
    const toHex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('') + (c.a != null && c.a < 1 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '');
    const vars = [];
    Object.values(nodes || {}).forEach(n => { const d = n && n.document; const f = d && d.fills && d.fills.find(x => x.type === 'SOLID'); if (f) vars.push([d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), toHex({ ...f.color, a: f.opacity != null ? f.opacity : f.color.a })]); });
    return `:root {\n${vars.map(([k, v]) => `  --color-${k}: ${v};`).join('\n')}\n}\n`;
}

export function installImport(P) {
    const mine = () => lsGet(MY_TEMPLATES, []);
    P.fmxTemplates = function () {
        const all = TEMPLATES.map(([id, icon, label, desc]) => ({ id, icon, label, desc })).concat(mine().map(t => ({ id: t.id, icon: 'fa-star', label: t.name, desc: `قالبك • ${Object.keys(t.files).length} ملف`, mine: true })));
        return `<div class="text-dim">${TEMPLATES.length} قالباً جاهزاً + قوالبك المحفوظة. الإنشاء يضيف الملفات للمشروع (يمكن اختيار الاستبدال).</div>
            <div class="gh-row"><label class="gh-check"><input type="checkbox" id="fmx-tpl-replace"> استبدال ملفات المشروع الحالية</label>${field('fmx-tpl-dir', 'داخل مجلد (اختياري)', '', 'dir="ltr"')}</div>
            <div class="fmx-tpl-grid">${all.map(t => `<button class="fmx-tpl" data-tpl="${esc(t.id)}" onclick="${call('fmxUseTemplate', t.id)}"><i class="fa-${/^fa-(html5|react|vuejs|python)$/.test(t.icon) ? 'brands' : 'solid'} ${t.icon}"></i><b>${esc(t.label)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div>`;
    };
    P.fmxTemplateFiles = function (id) { const t = TEMPLATES.find(x => x[0] === id); if (t) return t[4](); const m = mine().find(x => x.id === id); return m ? m.files : null; };
    P.fmxUseTemplate = async function (id, o = {}) {
        const files = this.fmxTemplateFiles(id);
        if (!files) return null;
        const replace = o.replace != null ? o.replace : val('fmx-tpl-replace'), dir = (o.dir != null ? o.dir : val('fmx-tpl-dir')).replace(/^\/+|\/+$/g, '');
        if (replace && this.virtualProjectFiles.size && !o.force && !(await this.askConfirm('استبدال المشروع؟', 'ستُحذف ملفات المشروع الحالية وتُستبدل بالقالب.'))) return null;
        if (replace) this.deleteProjectPaths(this.projectPaths(), { toast: false });
        const paths = Object.entries(files).map(([p, content]) => { const path = (dir ? dir + '/' : '') + p; this.writeProjectFile(path, content, 'template'); return path; });
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        const first = paths.find(p => /(App|main|index|server|app)\.\w+$/.test(p)) || paths[0];
        this.showToast(`🚀 أُنشئ ${paths.length} ملف`, 'success');
        if (!o.quiet && first) { this.closeModals(); this.openProjectFile(first); }
        return paths;
    };

    // ---- from description (#605)
    P.fmxFromDescription = function () {
        return card('توليد مشروع كامل من وصف', `${area('fmx-desc', 'صف المشروع', '', 5, 'dir="auto" placeholder="تطبيق لإدارة المهام بالعربية: إضافة/حذف/تصنيف، حفظ محلي، وضع داكن، React + Vite"')}
            <div class="gh-row">${select('fmx-desc-stack', 'التقنية', [['auto', 'يختارها الذكاء'], ['html', 'HTML/CSS/JS'], ['react', 'React + Vite'], ['vue', 'Vue'], ['next', 'Next.js'], ['express', 'Node/Express'], ['python', 'Python']], 'auto')}${select('fmx-desc-size', 'الحجم', [['small', 'صغير (3-6 ملفات)'], ['medium', 'متوسط (6-15)'], ['large', 'كبير (15+)']], 'medium')}${pbtn('fa-wand-magic-sparkles', 'توليد', 'app.fmxGenerateProject()')}</div><div id="fmx-gen-out"></div>`, 'fa-wand-magic-sparkles');
    };
    P.fmxGenerateProject = async function (descArg, o = {}) {
        const desc = descArg || val('fmx-desc'), stack = o.stack || val('fmx-desc-stack') || 'auto', size = o.size || val('fmx-desc-size') || 'medium';
        if (!desc.trim()) { this.showToast('اكتب وصفاً', 'warning'); return null; }
        const el = document.getElementById('fmx-gen-out');
        if (el) el.innerHTML = '<div class="gh-empty"><span class="live-step-spinner"></span> يولّد الذكاء الاصطناعي المشروع…</div>';
        const prompt = `Create a complete, working project from this description:\n"""${desc}"""\nStack: ${stack === 'auto' ? 'choose the best fit' : stack}. Size: ${size}.\nInclude README.md (Arabic) with run instructions, package/dependency manifest if needed, and all source files. Every file must be complete (no placeholders).\nOutput each file as a fenced block: \`\`\`lang [path/to/file]`;
        const text = await this.aiRun(prompt, { kind: 'coding', maxTokens: size === 'large' ? 16000 : 9000, source: 'fmx-project', onDelta: (c) => { if (el) el.innerHTML = `<div class="text-dim">${(c.match(/```[^\n]*\[/g) || []).length} ملف…</div>`; } });
        if (text == null) { if (el) el.innerHTML = empty('يلزم مفتاح OpenRouter'); return null; }
        const files = (this.parseFileBlocks ? this.parseFileBlocks(text) : []).filter(f => f.path);
        if (el) el.innerHTML = files.length ? `<div class="text-dim">${files.length} ملف مولّد</div>` : empty('لم يُعثر على ملفات في الرد');
        return files.length && this.aiApplyFiles ? this.aiApplyFiles(files, { title: '🚀 مشروع جديد من الوصف', auto: !!o.auto }) : files;
    };

    // ---- import (#606 #607 #608)
    P.fmxImport = function () {
        return card('استيراد من GitHub', `<div class="gh-row">${field('fmx-imp-gh', 'رابط المستودع', '', 'dir="ltr" placeholder="https://github.com/owner/repo"')}<label class="gh-check"><input type="checkbox" id="fmx-imp-replace"> استبدال المشروع</label>${pbtn('fa-brands fa-github', 'استيراد', 'app.fmxImportGitHub()')}</div>`, 'fa-brands fa-github')
            + card('استيراد من Figma', `<div class="text-dim">يصدّر إطارات الملف كصور PNG إلى <code>design/figma/</code> ويستخرج ألوان الأنماط إلى <code>design/tokens.css</code>. يلزم Personal Access Token من إعدادات Figma (يُحفظ محلياً).</div>
                <div class="fmx-grid2">${field('fmx-fig-url', 'رابط الملف', '', 'dir="ltr" placeholder="https://www.figma.com/design/KEY/Name"')}${field('fmx-fig-token', 'Figma Token', lsGet('ox_fmx_figma_token', ''), 'dir="ltr" type="password"')}</div><div class="gh-row">${pbtn('fa-brands fa-figma', 'جلب الإطارات', 'app.fmxFigmaList()')}</div><div id="fmx-fig-out"></div>`, 'fa-pen-ruler')
            + card('استيراد من Notion', `<div class="text-dim">واجهة Notion API لا تسمح بالطلبات من المتصفح (CORS)، لذلك: في Notion ← ⋯ ← Export ← <b>Markdown &amp; CSV</b> ثم ارفع ملف ZIP هنا. تُحذف معرّفات Notion من الأسماء وتُصلح الروابط وتتحول قواعد البيانات CSV إلى جداول Markdown.</div>
                <div class="gh-row"><input id="fmx-notion-zip" type="file" class="form-input-box" accept=".zip">${pbtn('fa-file-import', 'استيراد', 'app.fmxImportNotion()')}</div>`, 'fa-book');
    };
    P.fmxImportGitHub = function (url, o = {}) { return this.ghxCloneByUrl(url || val('fmx-imp-gh'), { replace: o.replace != null ? o.replace : val('fmx-imp-replace'), active: false }); };
    const figmaKey = (url) => (/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/.exec(url || '') || [])[1];
    const figma = async (app, path, token) => { const res = await fetch('https://api.figma.com/v1' + path, { headers: { 'X-Figma-Token': token } }); const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error('Figma: ' + (j.err || j.message || res.status)); return j; };
    P.fmxFigmaList = async function (urlArg, tokenArg) {
        const key = figmaKey(urlArg || val('fmx-fig-url')), token = tokenArg || val('fmx-fig-token');
        const el = document.getElementById('fmx-fig-out');
        if (!key || !token) { this.showToast('أدخل رابط الملف والرمز', 'warning'); return null; }
        lsSet('ox_fmx_figma_token', token);
        try {
            const file = await figma(this, `/files/${key}?depth=2`, token);
            const frames = figmaFrames(file);
            this._fmxFigma = { key, token, frames, styles: file.styles || {}, name: file.name };
            if (el) el.innerHTML = `<div class="text-dim">${esc(file.name)} • ${frames.length} إطار • ${Object.keys(file.styles || {}).length} نمط</div>${frames.map((f, i) => `<label class="gh-check fmx-fig-frame"><input type="checkbox" class="fmx-fig-pick" data-i="${i}" ${i < 12 ? 'checked' : ''}> ${esc(f.page)} / <b>${esc(f.name)}</b></label>`).join('')}<div class="gh-row">${pbtn('fa-file-import', 'استيراد المحدد + الألوان', 'app.fmxFigmaImport()')}</div>`;
            return frames;
        } catch (e) { if (el) el.innerHTML = empty('❌ ' + esc(e.message), true); return null; }
    };
    P.fmxFigmaImport = async function (idsArg) {
        const F = this._fmxFigma;
        if (!F) return null;
        const boxes = Array.from(document.querySelectorAll('.fmx-fig-pick'));
        const frames = idsArg ? F.frames.filter(f => idsArg.includes(f.id)) : boxes.length ? F.frames.filter((_, i) => boxes[i] && boxes[i].checked) : F.frames.slice(0, 12);
        const written = [];
        if (frames.length) {
            const imgs = await figma(this, `/images/${F.key}?ids=${encodeURIComponent(frames.map(f => f.id).join(','))}&format=png&scale=2`, F.token);
            for (const f of frames) {
                const url = imgs.images && imgs.images[f.id];
                if (!url) continue;
                const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
                const path = `design/figma/${f.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || f.id.replace(':', '-')}.png`;
                this.virtualProjectFiles.set(path, { content: '', dataUrl: bytesToDataUrl(bytes, 'image/png'), binary: true, size: bytes.length, timestamp: Date.now() });
                written.push(path);
            }
        }
        const fillIds = Object.entries(F.styles).filter(([, s]) => s.styleType === 'FILL').map(([id]) => id);
        if (fillIds.length) {
            const nodes = await figma(this, `/files/${F.key}/nodes?ids=${encodeURIComponent(fillIds.slice(0, 200).join(','))}`, F.token);
            this.writeProjectFile('design/tokens.css', `/* ${F.name} — Figma colour styles */\n` + figmaColorTokens(nodes.nodes), 'figma');
            written.push('design/tokens.css');
        }
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`🎨 استُورد ${written.length} ملف من Figma`, 'success');
        return written;
    };
    P.fmxImportNotion = async function (fileArg) {
        const f = fileArg || filesOf('fmx-notion-zip')[0];
        if (!f) { this.showToast('اختر ملف ZIP', 'warning'); return null; }
        let raw = unzipSync(await blobBytes(f));
        const inner = Object.keys(raw).filter(k => /\.zip$/i.test(k));
        if (inner.length) inner.forEach(k => { Object.assign(raw, unzipSync(raw[k])); delete raw[k]; });
        const entries = Object.entries(raw).filter(([p]) => !p.endsWith('/')).map(([path, bytes]) => ({ path, bytes, text: /\.(md|csv|txt|html)$/i.test(path) ? fromUtf8(bytes) : null }));
        const clean = cleanNotionExport(entries);
        for (const e of clean) {
            if (e.text != null) this.writeProjectFile(e.path, e.text, 'notion');
            else if (e.bytes.length <= 3 * 1048576) this.virtualProjectFiles.set(e.path, { content: '', dataUrl: bytesToDataUrl(e.bytes, mimeOf(e.path)), binary: true, size: e.bytes.length, timestamp: Date.now() });
        }
        if (this.renderStudioExplorer) this.renderStudioExplorer();
        this.showToast(`📓 استُورد ${clean.length} ملف من Notion`, 'success');
        return clean.map(e => e.path);
    };

    // ---- publish (#609 #610)
    P.fmxPublish = function () {
        const r = this.ghRepo();
        return card('تصدير لمستودع GitHub جديد', `<div class="fmx-grid2">${field('fmx-pub-name', 'اسم المستودع', (this.virtualProjectFiles.get('package.json') && (/"name"\s*:\s*"([^"]+)"/.exec(this.virtualProjectFiles.get('package.json').content || '') || [])[1]) || 'my-project', 'dir="ltr"')}${field('fmx-pub-desc', 'الوصف', '', 'dir="auto"')}</div>
                <div class="gh-row"><label class="gh-check"><input type="checkbox" id="fmx-pub-private" checked> خاص</label><label class="gh-check"><input type="checkbox" id="fmx-pub-template"> اجعله Template repository</label>${pbtn('fa-file-export', `تصدير ${this.virtualProjectFiles.size} ملف`, 'app.fmxPublishRepo()')}</div>`, 'fa-file-export')
            + card('نشر كقالب', `<div class="gh-row">${btn('fa-brands fa-github', `جعل ${esc(r.owner)}/${esc(r.repo)} قالب GitHub`, 'app.fmxMarkTemplateRepo()')}${btn('fa-note-sticky', 'نشر كقالب Gist', 'app.publishProjectTemplateUI()')}</div>
                <div class="gh-row">${field('fmx-my-tpl', 'حفظ المشروع كقالب محلي', 'قالبي', 'dir="auto"')}${pbtn('fa-star', 'حفظ', 'app.fmxSaveMyTemplate()')}</div>
                ${mine().map(t => `<div class="gh-item static" data-mytpl="${esc(t.id)}"><i class="fa-solid fa-star text-blue"></i><div class="gh-item-main"><b>${esc(t.name)}</b><small>${Object.keys(t.files).length} ملف • ${new Date(t.created).toLocaleDateString('ar')}</small></div>${btn('fa-trash', '', call('fmxDeleteMyTemplate', t.id), 'gh-chip')}</div>`).join('')}`, 'fa-star');
    };
    P.fmxPublishRepo = async function (o) {
        const opts = o || { name: val('fmx-pub-name'), description: val('fmx-pub-desc'), private: val('fmx-pub-private'), template: val('fmx-pub-template') };
        const r = await this.ghxExportToNewRepo({ name: opts.name, description: opts.description, private: opts.private, use: true });
        if (r && opts.template) { const [owner, repo] = r.repo.split('/'); await this.fmxMarkTemplateRepo(owner, repo); }
        return r;
    };
    P.fmxMarkTemplateRepo = async function (ownerArg, repoArg) {
        if (this.ghRequireToken && !this.ghRequireToken()) return null;
        const r = this.ghRepo(), owner = ownerArg || r.owner, repo = repoArg || r.repo;
        try { const res = await this.gh(`/repos/${owner}/${repo}`, { method: 'PATCH', body: { is_template: true } }); this.showToast(`⭐ ${owner}/${repo} أصبح Template — يظهر زر «Use this template»`, 'success'); return res; }
        catch (e) { this.showToast('❌ ' + e.message, 'error'); return null; }
    };
    P.fmxSaveMyTemplate = function (nameArg) {
        const name = nameArg || val('fmx-my-tpl') || 'قالبي';
        const files = Object.fromEntries(Array.from(this.virtualProjectFiles.entries()).filter(([, e]) => typeof e.content === 'string' && !e.dataUrl).map(([p, e]) => [p, e.content]));
        const size = JSON.stringify(files).length;
        if (size > 2 * 1048576) { this.showToast('المشروع أكبر من 2MB — انشره كمستودع Template', 'warning'); return null; }
        const t = { id: uid('tpl'), name, files, created: Date.now() };
        lsSet(MY_TEMPLATES, [t, ...mine()].slice(0, 30));
        this.showToast('⭐ حُفظ القالب — يظهر في «قوالب المشاريع»', 'success');
        if (this._fmx && this._fmx.sec === 'publish') this.fmxRefresh();
        return t;
    };
    P.fmxDeleteMyTemplate = function (id) { lsSet(MY_TEMPLATES, mine().filter(t => t.id !== id)); return this.fmxRefresh(); };
}
