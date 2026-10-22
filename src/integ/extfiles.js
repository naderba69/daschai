/* #988 VS Code extension • #989 Chrome extension • #990 CLI — pure generators (no imports).
   The same output is committed under extensions/ and cli/ (tests check they stay in sync). */
export const OX_URL = 'https://daschai.vercel.app/';
export const EXT_VERSION = '1.0.0';

// ====================================================================== shared OpenRouter call (Node 18+ / VS Code / Chrome — global fetch)
const AI_FN = `async function oxChat(apiKey, model, messages, onDelta) {
    if (!apiKey) throw new Error('OpenRouter API key missing (https://openrouter.ai/keys)');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/naderba69/daschai', 'X-Title': 'OX-Alpha' },
        body: JSON.stringify({ model: model || 'openai/gpt-4o-mini', messages, stream: !!onDelta })
    });
    if (!res.ok) { const t = await res.text(); throw new Error('OpenRouter ' + res.status + ': ' + t.slice(0, 300)); }
    if (!onDelta) { const j = await res.json(); return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''; }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', out = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\\n'); buf = lines.pop();
        for (const l of lines) {
            if (!l.startsWith('data: ') || l === 'data: [DONE]') continue;
            try { const d = JSON.parse(l.slice(6)).choices[0].delta.content; if (d) { out += d; onDelta(d); } } catch (e) { /* keep-alive */ }
        }
    }
    return out;
}`;

export function vscodeFiles({ oxUrl = OX_URL } = {}) {
    const pkg = {
        name: 'ox-alpha', displayName: 'OX-Alpha', description: 'OX-Alpha AI inside VS Code: ask, explain, fix, test and open the project in OX-Alpha Workbench.', version: EXT_VERSION, publisher: 'naderba69', license: 'MIT',
        repository: { type: 'git', url: 'https://github.com/naderba69/daschai' }, engines: { vscode: '^1.82.0' }, categories: ['Programming Languages', 'Machine Learning', 'Other'], main: './extension.js',
        activationEvents: ['onStartupFinished'],
        contributes: {
            commands: [
                { command: 'oxAlpha.ask', title: 'OX-Alpha: Ask about selection' },
                { command: 'oxAlpha.explain', title: 'OX-Alpha: Explain code' },
                { command: 'oxAlpha.fix', title: 'OX-Alpha: Fix / improve selection' },
                { command: 'oxAlpha.tests', title: 'OX-Alpha: Generate tests' },
                { command: 'oxAlpha.commitMessage', title: 'OX-Alpha: Commit message from staged changes' },
                { command: 'oxAlpha.open', title: 'OX-Alpha: Open in OX-Alpha Workbench' }
            ],
            menus: { 'editor/context': [{ submenu: 'oxAlpha.menu', group: 'navigation@9' }], 'oxAlpha.menu': ['ask', 'explain', 'fix', 'tests', 'open'].map(c => ({ command: 'oxAlpha.' + c, when: c === 'open' ? undefined : 'editorHasSelection' })) },
            submenus: [{ id: 'oxAlpha.menu', label: 'OX-Alpha' }],
            keybindings: [{ command: 'oxAlpha.ask', key: 'ctrl+alt+x', mac: 'cmd+alt+x' }],
            configuration: { title: 'OX-Alpha', properties: {
                'oxAlpha.apiKey': { type: 'string', default: '', description: 'OpenRouter API key (stored in your VS Code settings). Prefer the OX_ALPHA_KEY / OPENROUTER_API_KEY env var.' },
                'oxAlpha.model': { type: 'string', default: 'openai/gpt-4o-mini', description: 'OpenRouter model id' },
                'oxAlpha.language': { type: 'string', enum: ['ar', 'en'], default: 'ar', description: 'Answer language' },
                'oxAlpha.url': { type: 'string', default: oxUrl, description: 'OX-Alpha Workbench URL' }
            } }
        }
    };
    return {
        'extensions/vscode/package.json': JSON.stringify(pkg, null, 2) + '\n',
        'extensions/vscode/extension.js': `// OX-Alpha for VS Code — zero dependencies (VS Code ≥ 1.82 ships Node 18 with fetch).
const vscode = require('vscode');
const cp = require('child_process');

${AI_FN}

function cfg() {
    const c = vscode.workspace.getConfiguration('oxAlpha');
    return { key: c.get('apiKey') || process.env.OX_ALPHA_KEY || process.env.OPENROUTER_API_KEY || '', model: c.get('model'), lang: c.get('language'), url: c.get('url') || '${oxUrl}' };
}
function context() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return null;
    const sel = ed.selection, doc = ed.document;
    return { ed, code: sel.isEmpty ? doc.getText() : doc.getText(sel), lang: doc.languageId, file: vscode.workspace.asRelativePath(doc.uri), whole: sel.isEmpty };
}
async function stream(title, messages) {
    const c = cfg();
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# ' + title + '\\n\\n' });
    const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);
    let pending = '', flushing = false;
    const flush = async () => { if (flushing || !pending) return; flushing = true; const t = pending; pending = ''; await ed.edit(b => b.insert(doc.lineAt(doc.lineCount - 1).range.end, t)); flushing = false; if (pending) flush(); };
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OX-Alpha: ' + title, cancellable: false }, () =>
        oxChat(c.key, c.model, messages, d => { pending += d; flush(); }).catch(e => vscode.window.showErrorMessage(e.message)));
}
const sys = () => ({ role: 'system', content: 'You are OX-Alpha, a senior engineer. ' + (cfg().lang === 'ar' ? 'Answer in Arabic; keep code and identifiers in English.' : 'Answer in English.') });
const block = (x) => 'File: ' + x.file + '\\n\`\`\`' + x.lang + '\\n' + x.code.slice(0, 24000) + '\\n\`\`\`';

function activate(ctx) {
    const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
    reg('oxAlpha.ask', async () => {
        const x = context(); if (!x) return;
        const q = await vscode.window.showInputBox({ prompt: 'اسأل OX-Alpha عن الكود المحدد', placeHolder: 'لماذا لا تعمل هذه الدالة؟' });
        if (q) stream(q, [sys(), { role: 'user', content: q + '\\n\\n' + block(x) }]);
    });
    reg('oxAlpha.explain', () => { const x = context(); if (x) stream('شرح ' + x.file, [sys(), { role: 'user', content: 'Explain this code step by step, then list risks/bugs:\\n' + block(x) }]); });
    reg('oxAlpha.tests', () => { const x = context(); if (x) stream('اختبارات ' + x.file, [sys(), { role: 'user', content: 'Write thorough unit tests (edge cases included) for this code using the idiomatic framework for ' + x.lang + '. Return one code block.\\n' + block(x) }]); });
    reg('oxAlpha.fix', async () => {
        const x = context(); if (!x) return;
        const c = cfg();
        const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OX-Alpha: إصلاح…' }, () =>
            oxChat(c.key, c.model, [{ role: 'system', content: 'Return ONLY the corrected/improved code, no fences, no explanation. Keep the same language and API.' }, { role: 'user', content: block(x) }]).catch(e => { vscode.window.showErrorMessage(e.message); return null; }));
        if (!out) return;
        const code = out.replace(/^\`\`\`[\\w-]*\\n?|\\n?\`\`\`\\s*$/g, '');
        const range = x.whole ? new vscode.Range(0, 0, x.ed.document.lineCount, 0) : x.ed.selection;
        const pick = await vscode.window.showInformationMessage('OX-Alpha اقترح تعديلاً', 'تطبيق', 'مقارنة', 'إلغاء');
        if (pick === 'تطبيق') x.ed.edit(b => b.replace(range, code));
        if (pick === 'مقارنة') { const d = await vscode.workspace.openTextDocument({ language: x.lang, content: code }); vscode.commands.executeCommand('vscode.diff', x.ed.document.uri, d.uri, 'OX-Alpha: الأصل ↔ المقترح'); }
    });
    reg('oxAlpha.commitMessage', async () => {
        const root = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath;
        if (!root) return;
        let diff = '';
        try { diff = cp.execSync('git diff --cached', { cwd: root, maxBuffer: 8e6 }).toString(); } catch (e) { return vscode.window.showErrorMessage('git: ' + e.message); }
        if (!diff.trim()) return vscode.window.showWarningMessage('لا توجد تغييرات مُدرجة (git add)');
        const c = cfg();
        const msg = await oxChat(c.key, c.model, [{ role: 'system', content: 'Write a Conventional Commits message (subject ≤ 72 chars, optional body). Output only the message.' }, { role: 'user', content: diff.slice(0, 30000) }]).catch(e => { vscode.window.showErrorMessage(e.message); return ''; });
        const git = vscode.extensions.getExtension('vscode.git');
        const repo = git && git.exports.getAPI(1).repositories[0];
        if (repo && msg) repo.inputBox.value = msg.trim(); else if (msg) vscode.env.clipboard.writeText(msg.trim());
    });
    reg('oxAlpha.open', async () => {
        const c = cfg(), x = context();
        const root = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath;
        let repo = '';
        try { repo = (/github\\.com[:/]([^/]+\\/[^/.]+?)(?:\\.git)?$/.exec(cp.execSync('git remote get-url origin', { cwd: root }).toString().trim()) || [])[1] || ''; } catch (e) { /* not a repo */ }
        const q = repo ? '?action=open&repo=' + encodeURIComponent(repo) : x ? '?action=ask&q=' + encodeURIComponent(block(x).slice(0, 1800)) : '';
        vscode.env.openExternal(vscode.Uri.parse(c.url + q));
    });
    const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    sb.text = '$(sparkle) OX'; sb.tooltip = 'OX-Alpha: اسأل عن التحديد (Ctrl+Alt+X)'; sb.command = 'oxAlpha.ask'; sb.show();
    ctx.subscriptions.push(sb);
}
function deactivate() {}
module.exports = { activate, deactivate, oxChat };
`,
        'extensions/vscode/README.md': `# OX-Alpha for VS Code\n\nأوامر الذكاء الاصطناعي من OX-Alpha داخل VS Code بدون أي اعتماديات خارجية.\n\n| الأمر | الوظيفة |\n|---|---|\n| **OX-Alpha: Ask about selection** (\`Ctrl+Alt+X\`) | سؤال حر عن الكود المحدد، والإجابة تُبث في لوحة جانبية |\n| **Explain code** | شرح خطوة بخطوة مع المخاطر |\n| **Fix / improve selection** | اقتراح إصلاح مع خيارَي «تطبيق» و«مقارنة» (diff) |\n| **Generate tests** | توليد اختبارات بإطار اللغة المعتاد |\n| **Commit message** | رسالة commit بصيغة Conventional Commits من التغييرات المُدرجة |\n| **Open in OX-Alpha** | يفتح المستودع (أو التحديد) في OX-Alpha Workbench |\n\n## التثبيت\n\n\`\`\`bash\n# الطريقة 1: نسخ المجلد (لا يحتاج حزماً)\ncp -r extensions/vscode ~/.vscode/extensions/naderba69.ox-alpha-${EXT_VERSION}\n# الطريقة 2: حزمة VSIX\nnpx @vscode/vsce package && code --install-extension ox-alpha-${EXT_VERSION}.vsix\n\`\`\`\n\nضع مفتاح OpenRouter في متغير البيئة \`OPENROUTER_API_KEY\`، أو في الإعداد \`oxAlpha.apiKey\`.\n`
    };
}

export function chromeFiles({ oxUrl = OX_URL } = {}) {
    const origin = oxUrl.replace(/\/+$/, '').replace(/^(https?:\/\/[^/]+).*$/, '$1');
    return {
        'extensions/chrome/manifest.json': JSON.stringify({
            manifest_version: 3, name: 'OX-Alpha', version: EXT_VERSION, description: 'أرسل أي نص أو كود أو صفحة إلى OX-Alpha Workbench، واسأل الذكاء الاصطناعي من أي موقع.',
            action: { default_popup: 'popup.html', default_title: 'OX-Alpha' }, background: { service_worker: 'background.js' },
            permissions: ['contextMenus', 'activeTab', 'scripting', 'storage'], host_permissions: [origin + '/*'],
            commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+X' } } },
            options_page: 'options.html', icons: { 128: 'icon.svg' }
        }, null, 2) + '\n',
        'extensions/chrome/background.js': `// OX-Alpha Chrome extension — context menus + bridge to the OX-Alpha tab (postMessage → local REST API).
const DEFAULT_URL = '${oxUrl}';
const getCfg = () => chrome.storage.sync.get({ url: DEFAULT_URL, token: '' });

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({ id: 'ox-ask', title: 'اسأل OX-Alpha عن «%s»', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ox-file', title: 'احفظ التحديد كملف في مشروع OX-Alpha', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ox-page', title: 'أرسل هذه الصفحة إلى OX-Alpha (Markdown)', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'ox-link', title: 'افتح الرابط في OX-Alpha', contexts: ['link'] });
});

async function oxTab() {
    const { url } = await getCfg();
    const tabs = await chrome.tabs.query({ url: new URL(url).origin + '/*' });
    if (tabs.length) return tabs[0];
    const t = await chrome.tabs.create({ url, active: false });
    await new Promise(r => { const l = (id, info) => { if (id === t.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); setTimeout(r, 1500); } }; chrome.tabs.onUpdated.addListener(l); });
    return t;
}
/** Call OX-Alpha's local API through the page (window.postMessage bridge, token-protected). */
async function oxApi(method, path, body) {
    const { token } = await getCfg();
    const tab = await oxTab();
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', args: [method, path, body, token],
        func: (method, path, body, token) => new Promise((resolve) => {
            const id = Math.random().toString(36).slice(2);
            const t = setTimeout(() => resolve({ status: 504, body: { error: 'OX-Alpha API is disabled (Integrations → API)' } }), 15000);
            addEventListener('message', function h(e) { if (e.data && e.data.oxApiReply === id) { clearTimeout(t); removeEventListener('message', h); resolve(e.data); } });
            postMessage({ oxApi: { id, method, path, body, token } }, location.origin);
        }) });
    return res && res.result;
}
async function openAsk(text) {
    const { url } = await getCfg();
    chrome.tabs.create({ url: url + '?action=ask&q=' + encodeURIComponent(String(text).slice(0, 1800)) });
}
const slug = (s) => String(s || 'clip').toLowerCase().replace(/[^\\w\\u0600-\\u06FF]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'clip';

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'ox-ask') return openAsk(info.selectionText);
    if (info.menuItemId === 'ox-link') return openAsk('حلّل هذا الرابط: ' + info.linkUrl);
    if (info.menuItemId === 'ox-file') {
        const r = await oxApi('PUT', '/api/v1/files/clips/' + slug(tab.title) + '.txt', { content: info.selectionText + '\\n\\n— ' + tab.url + '\\n' });
        return notify(r);
    }
    if (info.menuItemId === 'ox-page') {
        const [page] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, url: location.href, text: (document.querySelector('article, main') || document.body).innerText.slice(0, 200000) }) });
        const p = page.result;
        const r = await oxApi('PUT', '/api/v1/files/clips/' + slug(p.title) + '.md', { content: '# ' + p.title + '\\n\\n> ' + p.url + '\\n\\n' + p.text + '\\n' });
        return notify(r);
    }
});
function notify(r) {
    const ok = r && r.status >= 200 && r.status < 300;
    chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#16a34a' : '#dc2626' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
    return ok;
}
chrome.runtime.onMessage.addListener((m, _s, reply) => {
    if (m && m.type === 'ask') { openAsk(m.text); reply(true); }
    if (m && m.type === 'api') { oxApi(m.method, m.path, m.body).then(reply); return true; }
});
`,
        'extensions/chrome/popup.html': `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><link rel="stylesheet" href="popup.css"></head>
<body><h1>OX-Alpha</h1>
<textarea id="q" rows="4" placeholder="اسأل أي شيء… (أو حدّد نصاً في الصفحة)"></textarea>
<div class="row"><button id="ask">اسأل</button><button id="open" class="alt">فتح OX-Alpha</button></div>
<div class="row"><button id="status" class="alt">حالة المشروع</button><a href="options.html" target="_blank">الإعدادات</a></div>
<pre id="out"></pre>
<script src="popup.js"></script></body></html>
`,
        'extensions/chrome/popup.css': `body { width: 320px; font: 13px system-ui, Tahoma, sans-serif; margin: 0; padding: 12px; background: #0f172a; color: #e2e8f0; }
h1 { font-size: 16px; margin: 0 0 8px; } textarea { width: 100%; box-sizing: border-box; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: inherit; padding: 8px; }
.row { display: flex; gap: 6px; margin-top: 8px; align-items: center; } button { flex: 1; padding: 8px; border: 0; border-radius: 8px; background: #6366f1; color: #fff; cursor: pointer; } button.alt { background: #334155; }
a { color: #a5b4fc; } pre { white-space: pre-wrap; direction: ltr; font-size: 11px; max-height: 200px; overflow: auto; }
`,
        'extensions/chrome/popup.js': `const $ = (id) => document.getElementById(id);
chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
    try { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => String(getSelection()) }); if (r && r.result) $('q').value = r.result; } catch (e) { /* chrome:// pages */ }
});
$('ask').onclick = () => chrome.runtime.sendMessage({ type: 'ask', text: $('q').value }, () => window.close());
$('open').onclick = async () => { const { url } = await chrome.storage.sync.get({ url: '${oxUrl}' }); chrome.tabs.create({ url }); };
$('status').onclick = () => chrome.runtime.sendMessage({ type: 'api', method: 'GET', path: '/api/v1/status' }, (r) => { $('out').textContent = JSON.stringify(r && r.body, null, 2); });
`,
        'extensions/chrome/options.html': `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>OX-Alpha</title><link rel="stylesheet" href="popup.css"><style>body{width:auto;max-width:520px}input{width:100%;padding:8px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:inherit;box-sizing:border-box}label{display:block;margin:10px 0 4px}</style></head>
<body><h1>إعدادات OX-Alpha</h1>
<label>رابط OX-Alpha</label><input id="url" dir="ltr">
<label>رمز API (من OX-Alpha ← مركز التكاملات ← REST API)</label><input id="token" dir="ltr" type="password">
<div class="row"><button id="save">حفظ</button></div><p id="msg"></p>
<script src="options.js"></script></body></html>
`,
        'extensions/chrome/options.js': `chrome.storage.sync.get({ url: '${oxUrl}', token: '' }, (c) => { document.getElementById('url').value = c.url; document.getElementById('token').value = c.token; });
document.getElementById('save').onclick = () => chrome.storage.sync.set({ url: document.getElementById('url').value.trim() || '${oxUrl}', token: document.getElementById('token').value.trim() }, () => { document.getElementById('msg').textContent = '✓ حُفظ'; });
`,
        'extensions/chrome/icon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#4f46e5"/><text x="64" y="84" font-family="Arial Black,Arial" font-size="54" font-weight="900" text-anchor="middle" fill="#fff">OX</text></svg>\n`,
        'extensions/chrome/README.md': `# OX-Alpha for Chrome / Edge\n\n- **قائمة الزر الأيمن**: اسأل عن النص المحدد، أو احفظه كملف في المشروع، أو أرسل الصفحة كاملة بصيغة Markdown إلى \`clips/\`.\n- **النافذة المنبثقة** (\`Alt+Shift+X\`): سؤال سريع، أو فتح OX-Alpha، أو عرض حالة المشروع.\n- الاتصال يتم عبر جسر \`postMessage\` في تبويب OX-Alpha المفتوح، ويُحمى برمز API (فعّله من مركز التكاملات ← REST API).\n\n## التثبيت\n\n1. افتح \`chrome://extensions\` وفعّل **وضع المطوّر**.\n2. اختر **تحميل إضافة غير مضغوطة** ثم مجلد \`extensions/chrome\`.\n3. من الإعدادات: ضع رابط OX-Alpha ورمز API.\n`
    };
}

export function cliFiles({ oxUrl = OX_URL } = {}) {
    return {
        'cli/ox-alpha.js': `#!/usr/bin/env node
// OX-Alpha CLI — zero dependencies, Node 18+.
//   npx github:naderba69/daschai <command>     (or: node cli/ox-alpha.js <command>)
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const VERSION = '${EXT_VERSION}';
const OX_URL = process.env.OX_ALPHA_URL || '${oxUrl}';
const KEY = process.env.OPENROUTER_API_KEY || process.env.OX_ALPHA_KEY || '';
const MODEL = process.env.OX_ALPHA_MODEL || 'openai/gpt-4o-mini';
const C = process.stdout.isTTY ? { b: (s) => '\\x1b[1m' + s + '\\x1b[0m', d: (s) => '\\x1b[2m' + s + '\\x1b[0m', g: (s) => '\\x1b[32m' + s + '\\x1b[0m', r: (s) => '\\x1b[31m' + s + '\\x1b[0m' } : { b: String, d: String, g: String, r: String };

${AI_FN}

const git = (args) => cp.execSync('git ' + args, { maxBuffer: 16e6, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const sys = { role: 'system', content: 'You are OX-Alpha, a senior engineer in a terminal. Be concise. Answer in the language of the question.' };
const readFiles = (list) => list.filter(f => fs.existsSync(f) && fs.statSync(f).isFile()).map(f => 'File: ' + f + '\\n\`\`\`\\n' + fs.readFileSync(f, 'utf8').slice(0, 20000) + '\\n\`\`\`').join('\\n\\n');
const print = (d) => process.stdout.write(d);

const TEMPLATES = {
    static: { 'index.html': '<!doctype html>\\n<html lang="ar" dir="rtl">\\n<head>\\n  <meta charset="utf-8">\\n  <meta name="viewport" content="width=device-width, initial-scale=1">\\n  <title>مشروع جديد</title>\\n  <link rel="stylesheet" href="style.css">\\n</head>\\n<body>\\n  <main><h1>مرحباً 👋</h1><button id="btn">اضغط</button></main>\\n  <script type="module" src="app.js"></script>\\n</body>\\n</html>\\n', 'style.css': 'body { font-family: system-ui, Tahoma, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; }\\n', 'app.js': "document.getElementById('btn').addEventListener('click', () => alert('OX-Alpha ✨'));\\n" },
    express: { 'package.json': JSON.stringify({ name: 'ox-api', version: '1.0.0', main: 'server.js', scripts: { start: 'node server.js', test: 'node --test' }, dependencies: { express: '^4.21.0' } }, null, 2) + '\\n', 'server.js': "const express = require('express');\\nconst app = express();\\napp.use(express.json());\\nconst items = [];\\napp.get('/api/items', (req, res) => res.json(items));\\napp.post('/api/items', (req, res) => { const it = { id: items.length + 1, ...req.body }; items.push(it); res.status(201).json(it); });\\nif (require.main === module) app.listen(3000, () => console.log('http://localhost:3000'));\\nmodule.exports = app;\\n" },
    react: { 'index.html': '<!doctype html>\\n<html lang="ar" dir="rtl">\\n<head><meta charset="utf-8"><title>React</title>\\n<script type="importmap">{"imports":{"react":"https://esm.sh/react@18","react-dom/client":"https://esm.sh/react-dom@18/client"}}</script></head>\\n<body><div id="root"></div><script type="module" src="app.js"></script></body>\\n</html>\\n', 'app.js': "import React, { useState } from 'react';\\nimport { createRoot } from 'react-dom/client';\\nconst h = React.createElement;\\nfunction App() { const [n, setN] = useState(0); return h('button', { onClick: () => setN(n + 1) }, 'العداد: ' + n); }\\ncreateRoot(document.getElementById('root')).render(h(App));\\n" }
};

const COMMANDS = {
    async ask(args) {
        const files = args.filter(a => fs.existsSync(a)), q = args.filter(a => !fs.existsSync(a)).join(' ');
        if (!q) throw new Error('usage: ox-alpha ask "سؤالك" [files…]');
        await oxChat(KEY, MODEL, [sys, { role: 'user', content: q + (files.length ? '\\n\\n' + readFiles(files) : '') }], print);
        print('\\n');
    },
    async review() {
        let diff = git('diff --cached'); if (!diff.trim()) diff = git('diff');
        if (!diff.trim()) return console.log(C.d('لا توجد تغييرات'));
        await oxChat(KEY, MODEL, [sys, { role: 'user', content: 'Review this diff: bugs, security, performance, readability. Use a short list with file:line.\\n\\n' + diff.slice(0, 60000) }], print);
        print('\\n');
    },
    async commit(args) {
        const diff = git('diff --cached');
        if (!diff.trim()) throw new Error('لا توجد تغييرات مُدرجة — استخدم git add أولاً');
        const msg = (await oxChat(KEY, MODEL, [{ role: 'system', content: 'Write a Conventional Commits message (subject ≤ 72 chars, optional body). Output only the message.' }, { role: 'user', content: diff.slice(0, 40000) }])).trim();
        console.log(C.b(msg));
        if (args.includes('--yes') || args.includes('-y')) { cp.execFileSync('git', ['commit', '-m', msg], { stdio: 'inherit' }); }
        else console.log(C.d('\\nأضف --yes للتنفيذ مباشرة'));
    },
    async explain(args) {
        if (!args.length) throw new Error('usage: ox-alpha explain <file>');
        await oxChat(KEY, MODEL, [sys, { role: 'user', content: 'Explain this code clearly, then list risks.\\n\\n' + readFiles(args) }], print);
        print('\\n');
    },
    async init(args) {
        const tpl = args[0] || 'static', dir = args[1] || 'ox-' + tpl;
        const files = TEMPLATES[tpl];
        if (!files) throw new Error('القوالب المتاحة: ' + Object.keys(TEMPLATES).join(', '));
        if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error('المجلد موجود وغير فارغ: ' + dir);
        Object.entries(files).forEach(([p, c]) => { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); console.log(C.g('+ ') + f); });
        console.log(C.b('\\n✓ تم') + C.d('  cd ' + dir + (tpl === 'express' ? ' && npm i && npm start' : ' && npx serve .')));
    },
    async open(args) {
        let repo = args[0] || '';
        if (!repo) { try { repo = (/github\\.com[:/]([^/]+\\/[^/.]+?)(?:\\.git)?$/.exec(git('remote get-url origin').trim()) || [])[1] || ''; } catch (e) { /* not a repo */ } }
        const url = OX_URL + (repo ? '?action=open&repo=' + encodeURIComponent(repo) : '');
        const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        try { cp.spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* headless */ }
        console.log(url);
    },
    async prompts(args) {
        const r = await fetch('https://raw.githubusercontent.com/naderba69/daschai/main/community/prompts.json');
        const list = ((await r.json()).prompts || []).filter(p => !args[0] || JSON.stringify(p).includes(args[0]));
        list.forEach(p => console.log(C.b(p.title) + C.d('  [' + p.cat + '] ★' + (p.stars || 0)) + '\\n  ' + p.text.slice(0, 160).replace(/\\n/g, ' ') + '\\n'));
    },
    version() { console.log('ox-alpha ' + VERSION); },
    help() {
        console.log(C.b('OX-Alpha CLI ' + VERSION) + '\\n\\n' + [
            ['ask "سؤال" [ملفات…]', 'اسأل الذكاء (مع ملفات كسياق)'], ['review', 'مراجعة git diff'], ['commit [--yes]', 'رسالة commit من التغييرات المُدرجة'],
            ['explain <file>', 'شرح ملف'], ['init <static|react|express> [dir]', 'مشروع جديد من قالب'], ['open [owner/repo]', 'افتح المستودع في OX-Alpha'], ['prompts [بحث]', 'برومبتات المجتمع'], ['version', 'الإصدار']
        ].map(([c, d]) => '  ' + c.padEnd(36) + C.d(d)).join('\\n') + '\\n\\n' + C.d('المفتاح: OPENROUTER_API_KEY • النموذج: OX_ALPHA_MODEL'));
    }
};

if (require.main === module) {
    const [cmd = 'help', ...args] = process.argv.slice(2);
    const fn = COMMANDS[cmd] || COMMANDS[{ '-v': 'version', '--version': 'version', '-h': 'help', '--help': 'help' }[cmd]];
    if (!fn) { console.error(C.r('أمر غير معروف: ' + cmd)); COMMANDS.help(); process.exitCode = 1; }
    else Promise.resolve(fn(args)).catch(e => { console.error(C.r('✗ ' + e.message)); process.exitCode = 1; });
}
module.exports = { COMMANDS, TEMPLATES, oxChat };
`,
        'cli/README.md': `# OX-Alpha CLI\n\n\`\`\`bash\nexport OPENROUTER_API_KEY=sk-or-...\nnpx github:naderba69/daschai ask "ما الخطأ هنا؟" src/app.js\nnpx github:naderba69/daschai review\nnpx github:naderba69/daschai commit --yes\nnpx github:naderba69/daschai init react my-app\nnpx github:naderba69/daschai open\n\`\`\`\n\nبدون أي اعتماديات (Node 18+). يمكن أيضاً تشغيله مباشرة: \`node cli/ox-alpha.js help\`.\n`
    };
}
