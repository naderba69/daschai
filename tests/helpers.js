/* Shared jsdom harness for the built index.html — no browser or network needed. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { TextDecoder, TextEncoder } = require('util');

function loadApp({ fetchImpl, indexedDB, localStorageSeed, beforeParse } = {}) {
    let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    html = html.replace(/<script src=[^>]*><\/script>/g, ''); // CDN scripts are stubbed below
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
    vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
    const dom = new JSDOM(html, {
        runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://daschai.vercel.app/', virtualConsole: vc,
        beforeParse(w) {
            w.marked = { parse: s => s, setOptions() {}, use() {} };
            w.hljs = { highlightElement() {}, highlightAuto: s => ({ value: s }), getLanguage() { return null; } };
            w.DOMPurify = { sanitize: s => s };
            w.fetch = fetchImpl || (() => Promise.reject(new Error('offline')));
            w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
            w.HTMLElement.prototype.scrollIntoView = function () {};
            w.speechSynthesis = { getVoices: () => [], cancel() {}, speak() {} };
            w.document.execCommand = () => false;
            w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
            w.confirm = () => true;
            if (indexedDB) { w.indexedDB = indexedDB; }
            if (localStorageSeed) Object.entries(localStorageSeed).forEach(([k, v]) => w.localStorage.setItem(k, v));
            if (beforeParse) beforeParse(w);
        }
    });
    return { dom, w: dom.window, d: dom.window.document, app: dom.window.app, errors };
}

/** Build a fetch() that answers OpenRouter chat requests with a streamed SSE body. */
function mockOpenRouter(responder) {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
        if (!String(url).includes('/chat/completions')) return new Response('{}', { status: 404 });
        const body = JSON.parse(opts.body);
        calls.push(body);
        const { status = 200, text = 'ok', usage = null, delayMs = 0, error } = await responder(body, calls.length);
        if (status !== 200) return new Response(JSON.stringify({ error: { message: error || 'fail' } }), { status });
        const enc = new TextEncoder();
        const parts = text.match(/.{1,12}/gs) || [''];
        const stream = new ReadableStream({
            async start(ctrl) {
                for (const p of parts) {
                    if (opts.signal && opts.signal.aborted) { ctrl.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); return; }
                    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
                    ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
                }
                ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`));
                if (usage) ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [], usage })}\n\n`));
                ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
                ctrl.close();
            }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    return { fetchImpl, calls };
}

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) { failures++; process.exitCode = 1; } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const section = (t) => console.log('\n— ' + t);

/** Main-page gzip budget — single source of truth in package.json → config.gzipBudgetKB */
const gzipBudgetKB = require('../package.json').config.gzipBudgetKB;

module.exports = { gzipBudgetKB, loadApp, mockOpenRouter, ok, wait, section, getFailures: () => failures };
