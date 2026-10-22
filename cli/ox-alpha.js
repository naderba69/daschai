#!/usr/bin/env node
// OX-Alpha CLI — zero dependencies, Node 18+.
//   npx github:naderba69/daschai <command>     (or: node cli/ox-alpha.js <command>)
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const VERSION = '1.0.0';
const OX_URL = process.env.OX_ALPHA_URL || 'https://daschai.vercel.app/';
const KEY = process.env.OPENROUTER_API_KEY || process.env.OX_ALPHA_KEY || '';
const MODEL = process.env.OX_ALPHA_MODEL || 'openai/gpt-4o-mini';
const C = process.stdout.isTTY ? { b: (s) => '\x1b[1m' + s + '\x1b[0m', d: (s) => '\x1b[2m' + s + '\x1b[0m', g: (s) => '\x1b[32m' + s + '\x1b[0m', r: (s) => '\x1b[31m' + s + '\x1b[0m' } : { b: String, d: String, g: String, r: String };

async function oxChat(apiKey, model, messages, onDelta) {
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
        const lines = buf.split('\n'); buf = lines.pop();
        for (const l of lines) {
            if (!l.startsWith('data: ') || l === 'data: [DONE]') continue;
            try { const d = JSON.parse(l.slice(6)).choices[0].delta.content; if (d) { out += d; onDelta(d); } } catch (e) { /* keep-alive */ }
        }
    }
    return out;
}

const git = (args) => cp.execSync('git ' + args, { maxBuffer: 16e6, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const sys = { role: 'system', content: 'You are OX-Alpha, a senior engineer in a terminal. Be concise. Answer in the language of the question.' };
const readFiles = (list) => list.filter(f => fs.existsSync(f) && fs.statSync(f).isFile()).map(f => 'File: ' + f + '\n```\n' + fs.readFileSync(f, 'utf8').slice(0, 20000) + '\n```').join('\n\n');
const print = (d) => process.stdout.write(d);

const TEMPLATES = {
    static: { 'index.html': '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>مشروع جديد</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <main><h1>مرحباً 👋</h1><button id="btn">اضغط</button></main>\n  <script type="module" src="app.js"></script>\n</body>\n</html>\n', 'style.css': 'body { font-family: system-ui, Tahoma, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; }\n', 'app.js': "document.getElementById('btn').addEventListener('click', () => alert('OX-Alpha ✨'));\n" },
    express: { 'package.json': JSON.stringify({ name: 'ox-api', version: '1.0.0', main: 'server.js', scripts: { start: 'node server.js', test: 'node --test' }, dependencies: { express: '^4.21.0' } }, null, 2) + '\n', 'server.js': "const express = require('express');\nconst app = express();\napp.use(express.json());\nconst items = [];\napp.get('/api/items', (req, res) => res.json(items));\napp.post('/api/items', (req, res) => { const it = { id: items.length + 1, ...req.body }; items.push(it); res.status(201).json(it); });\nif (require.main === module) app.listen(3000, () => console.log('http://localhost:3000'));\nmodule.exports = app;\n" },
    react: { 'index.html': '<!doctype html>\n<html lang="ar" dir="rtl">\n<head><meta charset="utf-8"><title>React</title>\n<script type="importmap">{"imports":{"react":"https://esm.sh/react@18","react-dom/client":"https://esm.sh/react-dom@18/client"}}</script></head>\n<body><div id="root"></div><script type="module" src="app.js"></script></body>\n</html>\n', 'app.js': "import React, { useState } from 'react';\nimport { createRoot } from 'react-dom/client';\nconst h = React.createElement;\nfunction App() { const [n, setN] = useState(0); return h('button', { onClick: () => setN(n + 1) }, 'العداد: ' + n); }\ncreateRoot(document.getElementById('root')).render(h(App));\n" }
};

const COMMANDS = {
    async ask(args) {
        const files = args.filter(a => fs.existsSync(a)), q = args.filter(a => !fs.existsSync(a)).join(' ');
        if (!q) throw new Error('usage: ox-alpha ask "سؤالك" [files…]');
        await oxChat(KEY, MODEL, [sys, { role: 'user', content: q + (files.length ? '\n\n' + readFiles(files) : '') }], print);
        print('\n');
    },
    async review() {
        let diff = git('diff --cached'); if (!diff.trim()) diff = git('diff');
        if (!diff.trim()) return console.log(C.d('لا توجد تغييرات'));
        await oxChat(KEY, MODEL, [sys, { role: 'user', content: 'Review this diff: bugs, security, performance, readability. Use a short list with file:line.\n\n' + diff.slice(0, 60000) }], print);
        print('\n');
    },
    async commit(args) {
        const diff = git('diff --cached');
        if (!diff.trim()) throw new Error('لا توجد تغييرات مُدرجة — استخدم git add أولاً');
        const msg = (await oxChat(KEY, MODEL, [{ role: 'system', content: 'Write a Conventional Commits message (subject ≤ 72 chars, optional body). Output only the message.' }, { role: 'user', content: diff.slice(0, 40000) }])).trim();
        console.log(C.b(msg));
        if (args.includes('--yes') || args.includes('-y')) { cp.execFileSync('git', ['commit', '-m', msg], { stdio: 'inherit' }); }
        else console.log(C.d('\nأضف --yes للتنفيذ مباشرة'));
    },
    async explain(args) {
        if (!args.length) throw new Error('usage: ox-alpha explain <file>');
        await oxChat(KEY, MODEL, [sys, { role: 'user', content: 'Explain this code clearly, then list risks.\n\n' + readFiles(args) }], print);
        print('\n');
    },
    async init(args) {
        const tpl = args[0] || 'static', dir = args[1] || 'ox-' + tpl;
        const files = TEMPLATES[tpl];
        if (!files) throw new Error('القوالب المتاحة: ' + Object.keys(TEMPLATES).join(', '));
        if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error('المجلد موجود وغير فارغ: ' + dir);
        Object.entries(files).forEach(([p, c]) => { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); console.log(C.g('+ ') + f); });
        console.log(C.b('\n✓ تم') + C.d('  cd ' + dir + (tpl === 'express' ? ' && npm i && npm start' : ' && npx serve .')));
    },
    async open(args) {
        let repo = args[0] || '';
        if (!repo) { try { repo = (/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(git('remote get-url origin').trim()) || [])[1] || ''; } catch (e) { /* not a repo */ } }
        const url = OX_URL + (repo ? '?action=open&repo=' + encodeURIComponent(repo) : '');
        const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        try { cp.spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref(); } catch (e) { /* headless */ }
        console.log(url);
    },
    async prompts(args) {
        const r = await fetch('https://raw.githubusercontent.com/naderba69/daschai/main/community/prompts.json');
        const list = ((await r.json()).prompts || []).filter(p => !args[0] || JSON.stringify(p).includes(args[0]));
        list.forEach(p => console.log(C.b(p.title) + C.d('  [' + p.cat + '] ★' + (p.stars || 0)) + '\n  ' + p.text.slice(0, 160).replace(/\n/g, ' ') + '\n'));
    },
    version() { console.log('ox-alpha ' + VERSION); },
    help() {
        console.log(C.b('OX-Alpha CLI ' + VERSION) + '\n\n' + [
            ['ask "سؤال" [ملفات…]', 'اسأل الذكاء (مع ملفات كسياق)'], ['review', 'مراجعة git diff'], ['commit [--yes]', 'رسالة commit من التغييرات المُدرجة'],
            ['explain <file>', 'شرح ملف'], ['init <static|react|express> [dir]', 'مشروع جديد من قالب'], ['open [owner/repo]', 'افتح المستودع في OX-Alpha'], ['prompts [بحث]', 'برومبتات المجتمع'], ['version', 'الإصدار']
        ].map(([c, d]) => '  ' + c.padEnd(36) + C.d(d)).join('\n') + '\n\n' + C.d('المفتاح: OPENROUTER_API_KEY • النموذج: OX_ALPHA_MODEL'));
    }
};

if (require.main === module) {
    const [cmd = 'help', ...args] = process.argv.slice(2);
    const fn = COMMANDS[cmd] || COMMANDS[{ '-v': 'version', '--version': 'version', '-h': 'help', '--help': 'help' }[cmd]];
    if (!fn) { console.error(C.r('أمر غير معروف: ' + cmd)); COMMANDS.help(); process.exitCode = 1; }
    else Promise.resolve(fn(args)).catch(e => { console.error(C.r('✗ ' + e.message)); process.exitCode = 1; });
}
module.exports = { COMMANDS, TEMPLATES, oxChat };
