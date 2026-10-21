/* Sprint 5 tests: sharing (link/QR/Gist), comments, activity log, tasks, whiteboard, conversation modes,
   presentation, focus timer, platform (launch, offline, data saver, meter, windowed list, lazy libs,
   backups, sync, webhooks, health, mobile) and insights (usage, activity, skills, quality, reports). */
require('fake-indexeddb/auto');
const fs = require('fs');
const path = require('path');
const { loadApp, mockOpenRouter, ok, wait, section } = require('./helpers');

const JSZIP_SRC = fs.readFileSync(path.join(__dirname, '..', 'node_modules/jszip/dist/jszip.min.js'), 'utf8');
const QR_SRC = fs.readFileSync(path.join(__dirname, '..', 'node_modules/qrcode-generator/qrcode.js'), 'utf8');

// ---- Network: OpenRouter mock + in-memory GitHub Gist API + webhook sinks
let aiReply = 'تم';
const or = mockOpenRouter(async () => ({ text: aiReply, usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 } }));
const gists = new Map();
const hookCalls = [];
let gistN = 0;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(JSON.stringify(obj))) } });
async function router(url, opts = {}) {
    url = String(url);
    if (url.includes('openrouter.ai/api/v1/chat')) return or.fetchImpl(url, opts);
    if (url.includes('openrouter.ai/api/v1/models')) { router.modelFetches = (router.modelFetches || 0) + 1; return json({ data: [] }); }
    if (url.startsWith('https://discord.com/api/webhooks/')) { hookCalls.push({ url, opts }); return new Response(null, { status: 204 }); }
    if (url.startsWith('https://hooks.slack.com/')) { hookCalls.push({ url, opts }); return new Response(null, { status: 200 }); }
    const m = /^https:\/\/api\.github\.com\/gists(?:\/([a-f0-9]+))?$/.exec(url);
    if (m) {
        const method = opts.method || 'GET';
        if (!m[1] && method === 'POST') {
            const body = JSON.parse(opts.body);
            const id = 'abcdef' + String(++gistN).padStart(6, '0');
            const files = {};
            Object.entries(body.files).forEach(([n, f]) => { files[n] = { filename: n, content: f.content, truncated: false }; });
            const g = { id, description: body.description, public: body.public, html_url: 'https://gist.github.com/u/' + id, owner: { login: 'nader' }, files };
            gists.set(id, g);
            return json(g, 201);
        }
        const g = gists.get(m[1]);
        if (!g) return json({ message: 'Not Found' }, 404);
        if (method === 'DELETE') { gists.delete(m[1]); return new Response(null, { status: 204 }); }
        if (method === 'PATCH') {
            const body = JSON.parse(opts.body);
            Object.entries(body.files).forEach(([n, f]) => { if (f === null) delete g.files[n]; else g.files[n] = { filename: n, content: f.content, truncated: false }; });
            return json(g);
        }
        return json(g);
    }
    return Promise.reject(new Error('offline: ' + url));
}

function stubs(w) {
    w.setImmediate = (f, ...a) => w.setTimeout(f, 0, ...a);
    w.eval(JSZIP_SRC);
    w.eval(QR_SRC);
    w.CompressionStream = CompressionStream;
    w.DecompressionStream = DecompressionStream;
    w.URL.createObjectURL = () => 'blob:https://daschai.vercel.app/x';
    w.URL.revokeObjectURL = () => {};
    const ctx = new Proxy({ calls: [] }, { get: (t, k) => (k in t ? t[k] : (...a) => { t.calls.push([k, a]); }), set: (t, k, v) => { t[k] = v; return true; } });
    ctx.getImageData = (x, y, ww, hh) => ({ data: new Uint8ClampedArray(ww * hh * 4).fill(120) });
    w.__ctx = ctx;
    w.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
    w.HTMLCanvasElement.prototype.toDataURL = function (type = 'image/png') { return `data:${type};base64,` + 'A'.repeat(type === 'image/jpeg' ? 2000 : 400); };
    w.Notification = class { constructor(t, o) { w.__notes = (w.__notes || []).concat([[t, o && o.body]]); } static requestPermission() { return Promise.resolve('granted'); } };
    w.Notification.permission = 'granted';
    let online = true;
    Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => online });
    w.__setOnline = (v) => { online = v; w.dispatchEvent(new w.Event(v ? 'online' : 'offline')); };
    w.navigator.vibrate = (p) => { w.__vibes = (w.__vibes || 0) + 1; return true; };
    w.open = () => null;
}

let W = null;
(async () => {
    const { w, d, app, errors } = loadApp({ indexedDB: globalThis.indexedDB, fetchImpl: router, beforeParse: stubs });
    const $ = (id) => d.getElementById(id);
    W = w;
    await wait(120);
    const downloads = [];
    app.downloadBlob = (blob, name) => downloads.push({ blob, name });
    app.loadImageElement = async () => ({ naturalWidth: 4000, naturalHeight: 3000 });
    app.settings.apiKey = 'sk-test';
    app.settings.githubToken = 'ghp_test';
    const session = () => app.sessions.find(s => s.id === app.activeSessionId);

    // ------------------------------------------------------------------
    section('Sharing — compressed links, QR, Gist (#731, #786-#788, #790, #737)');
    const packed = await app.packData({ hello: 'مرحبا بالعالم '.repeat(40), n: [1, 2, 3] });
    ok(packed[0] === 'z' && !/[+/=]/.test(packed), 'packData deflates + base64url (prefix z, URL-safe)');
    const back = await app.unpackData(packed);
    ok(back.hello.startsWith('مرحبا') && back.n[2] === 3, 'unpackData round-trips Arabic text');
    ok((await app.unpackData(app.b64urlEncode(new TextEncoder().encode('j')) && 'j' + app.b64urlEncode(new TextEncoder().encode('{"a":1}')))).a === 1, 'plain (j) payloads decode too');

    app.createNewSession(true);
    const s1 = session();
    s1.title = 'محادثة للمشاركة';
    s1.messages.push({ id: 'm1', role: 'user', content: 'كيف أكتب دالة؟', timestamp: Date.now() }, { id: 'm2', role: 'assistant', content: '<think>secret</think>هكذا:\n```js\nfunction f(){}\n```', model: 'x/y', timestamp: Date.now() });
    const link = await app.buildShareLink(s1);
    ok(link.startsWith('https://daschai.vercel.app/#share=z'), 'share link points at the app with #share=');
    const payload = app.buildSharePayload(s1);
    ok(payload.m.length === 2 && !payload.m[1].c.includes('secret'), 'share payload strips <think> reasoning');

    const sessionsBefore = app.sessions.length;
    await app.handleShareHash('#share=' + link.split('#share=')[1]);
    ok(d.querySelectorAll('.shared-msg').length === 2, 'opening a share link shows a read-only viewer');
    app.importSharedChat();
    ok(app.sessions.length === sessionsBefore + 1 && session().title.includes('محادثة للمشاركة') && session().messages.length === 2, 'shared chat can be imported as a new session');

    app.activeSessionId = s1.id;
    const qrSvg = await app.renderQR(link.slice(0, 300), (() => { const el = d.createElement('div'); el.id = 'qr-test'; d.body.appendChild(el); return 'qr-test'; })());
    ok(qrSvg && qrSvg.includes('<svg'), 'QR code rendered as SVG (qrcode-generator, UTF-8)');
    ok((await app.renderQR('x'.repeat(3000), 'qr-test')) === null && $('qr-test').textContent.includes('Gist'), 'too-long links suggest a Gist instead of a QR');

    const rec = await app.shareSessionViaGist(s1.id, false);
    ok(rec && rec.url.endsWith('#gist=' + rec.id) && gists.get(rec.id).public === false, 'share via secret Gist → short link');
    ok(gists.get(rec.id).files['ox-alpha-chat.json'] && gists.get(rec.id).files['chat.md'], 'Gist contains JSON payload + readable Markdown');
    ok(app.loadShareRecords().length === 1, 'share recorded in "my shares"');
    await app.handleShareHash('#gist=' + rec.id);
    ok(d.querySelectorAll('.shared-msg').length === 2 && d.body.innerHTML.includes('nader'), 'gist link opens the viewer with the owner');
    await app.revokeShare(rec.id);
    ok(!gists.has(rec.id) && app.loadShareRecords().length === 0, 'revoke deletes the Gist and the record (#786)');

    app.virtualProjectFiles.clear();
    app.virtualProjectFiles.set('src/a.js', { content: 'export const a = 1;\n' });
    app.virtualProjectFiles.set('README.md', { content: '# Hi\n' });
    const tpl = await app.publishProjectTemplate({ name: 'starter', isPublic: true });
    ok(tpl.url.includes('#gist=') && gists.get(tpl.gist.id).files['ox-alpha-project.json'], 'project published as a Gist template (#737)');
    app.virtualProjectFiles.clear();
    await app.handleShareHash('#gist=' + tpl.gist.id);
    ok(d.querySelectorAll('.sr-file').length === 2, 'template viewer lists files');
    ok(app.importSharedProject(false) === 2 && app.virtualProjectFiles.get('src/a.js').content.includes('a = 1'), 'template imported into the project');
    app.activeStudioFile = 'src/a.js';
    const fg = await app.shareFileAsGist('src/a.js');
    ok(fg && gists.get(fg.id).files['a.js'], 'current file shared as Gist (#790)');
    ok(app.parseGistId('https://gist.github.com/nader/' + fg.id + 'aaaaaaaaaaaaaaaa') === fg.id + 'aaaaaaaaaaaaaaaa' && app.parseGistId('nope') === null, 'Gist URL/id parsing');
    app.askText = async () => 'https://gist.github.com/u/' + tpl.gist.id;
    await app.importGistUI();
    ok(d.querySelectorAll('.sr-file').length === 2, 'import from Gist by URL (#480)');
    delete app.askText;
    app.closeModals();
    app.settings.githubToken = '';
    let gistErr = '';
    try { await app.createGist({ description: 'x', files: { a: { content: 'b' } } }); } catch (e) { gistErr = e.message; }
    ok(/gist/.test(gistErr), 'Gist creation without a token explains the needed scope');
    app.settings.githubToken = 'ghp_test';
    await app.openSharePanel();
    ok($('share-link').value.includes('#share=') && $('share-qr').innerHTML.includes('svg'), 'share panel: link + QR');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Activity log + code comments (#744, #733, #749, #750)');
    app.activityLog = [];
    app.virtualProjectFiles.set('src/app.js', { content: 'line1\nconst target = 42;\nline3\n' });
    ok(app.activityLog.some(e => e.path === 'src/app.js' && e.op === 'create'), 'file creation logged');
    app._typingInStudio = true;
    app.virtualProjectFiles.set('src/app.js', { content: 'line1\nconst target = 42;\nline3\n// a\n' });
    app.virtualProjectFiles.set('src/app.js', { content: 'line1\nconst target = 42;\nline3\n// ab\n' });
    app._typingInStudio = false;
    const edits = app.activityLog.filter(e => e.path === 'src/app.js' && e.op === 'edit');
    ok(edits.length === 1 && edits[0].n === 2, 'rapid typing edits coalesce into one entry (×2)');

    const c = app.addCodeComment('src/app.js', 2, 'هل 42 رقم سحري؟');
    ok(c && c.anchor === 'const target = 42;', 'comment anchored to the line text');
    app.virtualProjectFiles.set('src/app.js', { content: 'new0\nnew1\nline1\nconst target = 42;\nline3\n' });
    ok(app.locateComment(c) === 4, 'comment follows its line after lines are inserted above');
    app.renameProjectFile('src/app.js', 'src/main.js');
    ok(c.path === 'src/main.js', 'comment follows file rename');
    ok(app.activityLog.some(e => e.op === 'rename' && e.from === 'src/app.js' && e.path === 'src/main.js'), 'rename logged with from → to');
    app.virtualProjectFiles.set('src/lib/u.js', { content: 'x' });
    app.addCodeComment('src/lib/u.js', 1, 'folder test');
    app.renameProjectFolder('src/lib', 'src/utils');
    ok(app.codeComments.some(k => k.path === 'src/utils/u.js'), 'comments follow folder renames');
    ok(app.activityLog.filter(e => e.op === 'rename' && e.from === 'src/lib').length === 1, 'folder rename logged once (not per file)');
    app.setCommentResolved(c.id, true);
    ok(c.resolved && c.resolvedAt, 'comment resolved (#749)');
    app.setCommentResolved(c.id, false);
    ok(!c.resolved, 'comment reopened (#750)');
    app.openComments('open');
    ok(d.querySelectorAll('.cm-item').length === 2, 'comments panel lists open comments');
    ok(($('btn-studio-comments').querySelector('.cm-badge') || {}).textContent === '2', 'studio button shows open-comment badge');
    const aiPrompt = app.askAIAboutComment(c.id);
    ok(aiPrompt.includes('4 >>') && $('user-input').value.includes('هل 42 رقم سحري'), 'send comment + context to AI');
    $('user-input').value = '';
    app.openActivityLog();
    ok(d.querySelectorAll('.act-row').length >= 4, 'activity panel renders entries');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Tasks — Kanban, timers, deadlines, reminders, AI (#759-#768, #793, #797)');
    const now = new Date(2026, 9, 21, 10, 0);
    const q = app.parseQuickTask('إصلاح تسجيل الدخول !high ~45m @غدا', now);
    ok(q.title === 'إصلاح تسجيل الدخول' && q.priority === 'high' && q.estimate === 45, 'quick-add parses priority + estimate');
    ok(new Date(q.deadline).getDate() === 22 && new Date(q.deadline).getHours() === 18, '@غدا → tomorrow 18:00');
    const q2 = app.parseQuickTask('نشر ~2h @2026-11-01 !l', now);
    ok(q2.estimate === 120 && q2.priority === 'low' && new Date(q2.deadline).getMonth() === 10, '~2h, explicit date, !l');
    app.tasks = [];
    const t1 = app.addTask('مهمة أولى !h');
    const t2 = app.addTask('مهمة ثانية');
    app.startTaskTimer(t1.id);
    ok(t1.timerStart && t1.status === 'doing', 'starting a timer moves the task to "doing"');
    app.startTaskTimer(t2.id);
    ok(!t1.timerStart && t2.timerStart, 'only one timer runs at a time');
    t2.timerStart -= 90000;
    app.updateTask(t2.id, { status: 'done' });
    ok(!t2.timerStart && t2.spent >= 90000 && t2.done, 'completing a task stops its timer and stamps done');
    const soon = app.addTask({ title: 'قريبة', deadline: Date.now() + 10 * 60000 });
    const late = app.addTask({ title: 'متأخرة', deadline: Date.now() - 60000 });
    w.document.hidden !== false || Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => true });
    const fired = app.checkTaskReminders();
    ok(fired.length === 2 && fired.some(([k]) => k === 'soon') && fired.some(([k]) => k === 'overdue'), 'reminders: 30-min warning + overdue alert');
    ok(app.checkTaskReminders().length === 0, 'each reminder fires only once');
    ok(app.isOverdue(late) && !app.isOverdue(soon), 'overdue detection');
    app.openTasks('board');
    ok(d.querySelectorAll('.kanban-col').length === 3 && d.querySelectorAll('.task-card').length === 4, 'Kanban board renders 3 columns and all cards');
    ok(d.querySelector('.task-card.overdue'), 'overdue card highlighted');
    app.updateTask(t1.id, { status: 'done' });
    ok(d.querySelector('.kanban-col[data-status="done"]').querySelectorAll('.task-card').length === 2, 'moving a task re-renders the board');
    app.openTasks('list');
    ok(d.querySelectorAll('.todo-row').length === 4, 'todo-list view');
    app.openTasks('report');
    const rep = app.computeTaskReport();
    ok(rep.completion === 50 && rep.overdue.length === 1 && rep.totalMs >= 90000, 'completion report: %, overdue, time');
    ok(app.buildTaskReportText().includes('✅ مهمة أولى'), 'report text lists tasks');
    ok(app.extractJsonArray('Sure!\n```json\n[{"title":"a"}]\n```').length === 1 && app.extractJsonArray('no json') === null, 'JSON array extraction from model replies');
    aiReply = '[{"title":"كتابة اختبارات","priority":"high","estimate":60},{"title":"تحديث README","priority":"low","estimate":15}]';
    app.openTasks('board');
    const sug = await app.suggestTasksAI();
    ok(sug && sug.length === 2 && d.querySelectorAll('[data-sug]').length === 2, 'AI suggests tasks (#793)');
    ok(app.acceptSuggestedTasks() === 2 && app.tasks.some(t => t.title === 'كتابة اختبارات' && t.source === 'ai'), 'accepting suggestions adds tasks');
    aiReply = '## التقدم\nجيد';
    app.openTasks('report');
    const prog = await app.taskProgressAI();
    ok(prog && prog.includes('التقدم') && or.calls[or.calls.length - 1].messages[0].content.includes('تقرير المهام'), 'AI progress report (#797)');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Whiteboard (#755, #672, #1004)');
    app._wb = null;
    await app.openWhiteboard();
    ok($('wb-canvas') && d.querySelectorAll('.wb-tool[data-tool]').length === 8, 'whiteboard with 8 tools');
    app.wbAddItem({ tool: 'pen', color: '#fff', size: 4, points: [[1, 1], [50, 50]] });
    app.wbAddItem({ tool: 'arrow', color: '#f00', size: 3, x1: 0, y1: 0, x2: 100, y2: 0 });
    app.wbAddItem({ tool: 'eraser', color: '#000', size: 4, points: [[10, 10]] });
    ok(app._wb.items.length === 3, 'strokes/shapes added');
    app.wbUndo();
    ok(app._wb.items.length === 2 && app._wb.redo.length === 1, 'undo');
    app.wbRedo();
    ok(app._wb.items.length === 3, 'redo');
    ok(w.__ctx.calls.some(([k, a]) => k === 'drawImage'), 'items drawn on a separate layer (eraser keeps background)');
    w.__ctx.globalCompositeOperation = 'source-over';
    app.currentAttachments = [];
    await app.wbExport('code');
    ok(app.currentAttachments.length === 1 && app.currentAttachments[0].isImage && /HTML/.test($('user-input').value), 'drawing → code: attaches PNG + prompt (#1004)');
    app.currentAttachments = []; $('user-input').value = '';
    await app.openWhiteboard();
    await app.wbExport('download');
    ok(downloads.some(x => /^whiteboard-.*\.png$/.test(x.name)), 'export PNG');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Conversation modes (#802-#805, #1005-#1007, #1009)');
    app.activeSessionId = s1.id;
    ok(Object.keys(app.CHAT_MODES).length === 12, '8 conversation modes + 4 from Sprint 7 (learn/quiz/game/story)');
    app.setChatMode('review');
    ok(session().mode === 'review' && $('session-mode-badge').style.display !== 'none' && $('session-mode-badge').textContent.includes('مراجعة'), 'mode stored per session + badge');
    ok($('btn-chat-mode').classList.contains('active'), 'mode button highlighted');
    $('user-input').value = '';
    aiReply = 'مراجعة';
    await app.sendUserMessage('راجع: var x = 1');
    await wait(60);
    const sys = or.calls[or.calls.length - 1].messages[0].content;
    ok(sys.includes('REVIEW MODE'), 'mode instructions injected into the system prompt');
    app.setChatMode(null);
    ok(!session().mode && $('session-mode-badge').style.display === 'none', 'back to normal mode');
    ok(app.decorateSystemPrompt('base', { mode: 'legacy' }).includes('COBOL'), 'legacy translation mode prompt');
    app.openModeMenu($('btn-chat-mode'));
    ok(d.querySelectorAll('.fx-menu [data-mi]').length === 15, 'mode menu: normal + 12 modes + presentation + focus');
    app.hideMenu();

    // ------------------------------------------------------------------
    section('Presentation mode (#801)');
    const slides = app.buildSlides({ messages: [{ role: 'user', content: 'سؤال' }, { role: 'assistant', content: '# A\nنص\n```md\n# not a heading\n```\n---\n## B\nنص2' }] });
    ok(slides.length === 3 && slides[0].kind === 'question' && slides[1].md.includes('# not a heading') && slides[2].md.startsWith('## B'), 'slides split on headings/--- but not inside code fences');
    app.openPresentation();
    ok($('ox-present').classList.contains('active') && $('ox-present').textContent.includes('1 /'), 'presentation overlay opens');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    ok(app._present.i === 1, 'arrow key → next slide');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    ok(!app._present && !$('ox-present').classList.contains('active'), 'Esc closes the presentation');

    // ------------------------------------------------------------------
    section('Focus timer + breaks (#810, #809)');
    app.startFocus(25, 5, t2.id);
    ok(d.body.classList.contains('zen-mode') && app.isDnd() && $('focus-pill'), 'focus session: zen mode + DND + timer pill');
    ok(!app.settings.dnd, 'focus DND does not overwrite the saved DND setting');
    app._focus.end = Date.now() - 1;
    app.tickFocus();
    ok(app._focus.phase === 'break' && $('focus-remaining') && !app.isDnd(), 'end of focus → break overlay, DND released');
    app.stopFocus();
    ok(!app._focus && !$('focus-pill') && !d.body.classList.contains('zen-mode'), 'stop focus restores the UI');

    // ------------------------------------------------------------------
    section('Install & launch (#816, #965, #947, #948)');
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    ok(manifest.shortcuts.length >= 4 && manifest.share_target.params.text === 'text' && manifest.file_handlers[0].accept['text/javascript'].includes('.js'), 'manifest: shortcuts, share_target, file_handlers');
    $('user-input').value = '';
    const sh = app.handleLaunchParams('?title=مقال&text=نص مشترك&url=https://x.y');
    ok(sh.kind === 'share' && $('user-input').value.includes('نص مشترك') && $('user-input').value.includes('https://x.y'), 'share target prefills the input');
    $('user-input').value = '';
    ok(app.handleLaunchParams('?action=tasks').action === 'tasks', 'shortcut ?action= handled');
    ok(app.handleLaunchParams('') === null, 'no params → nothing');
    let consumer = null;
    w.launchQueue = { setConsumer: (fn) => { consumer = fn; } };
    app.initLaunchQueue();
    app.currentAttachments = [];
    await consumer({ files: [{ getFile: async () => new w.File(['print(1)'], 'run.py', { type: 'text/x-python' }) }] });
    ok(app.currentAttachments.some(a => a.name === 'run.py'), 'files opened with the app are attached (launchQueue)');
    app.currentAttachments = [];
    let prompted = false;
    app._installEvent = { prompt() { prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
    ok((await app.promptInstall()) === true && prompted && !app._installEvent, 'install prompt (beforeinstallprompt)');
    await app.promptInstall();

    // ------------------------------------------------------------------
    section('Updates & changelog (#861, #863, #864, #815)');
    ok(w.OX_BUILD && w.OX_BUILD.version === require('../package.json').version && w.OX_BUILD.modules.length >= 12, 'OX_BUILD injected (version + module sizes)');
    const md = '# Changelog\n\n## [2.5.0] - x\n- a\n- b\n\n## [2.4.0]\n- old';
    ok(app.extractChangelogSection(md, '2.5.0') === '## [2.5.0] - x\n- a\n- b', 'changelog section extraction');
    w.localStorage.setItem('ox_alpha_version', '0.0.1');
    const vc = app.checkVersionChange();
    ok(vc && vc.from === '0.0.1' && w.localStorage.getItem('ox_alpha_version') === w.OX_BUILD.version, 'version change detected → "what\'s new" toast');
    ok(app.checkVersionChange() === null, 'no toast on the same version');
    let posted = null;
    app._waitingWorker = { postMessage: (m) => { posted = m; } };
    app.applyUpdate();
    ok(posted && posted.type === 'SKIP_WAITING' && app._updateRequested, 'update → SKIP_WAITING to the waiting worker');
    const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    ok(/SKIP_WAITING/.test(swSrc) && /networkFirst/.test(swSrc) && /staleWhileRevalidate/.test(swSrc) && !/self\.skipWaiting\(\)\);\s*\}\);\s*self\.addEventListener\('activate'/.test(swSrc), 'service worker: network-first shell, SWR CDN, waits for the user');
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ok(!/jszip\.min\.js"><\/script>/.test(html) && !/mermaid\.min\.js" defer/.test(html), 'JSZip + Mermaid no longer block startup (#822)');
    ok(/hooks\.slack\.com/.test(html) && /discord\.com/.test(html), 'CSP allows the webhook hosts');

    // ------------------------------------------------------------------
    section('Offline banner + outbox (#853, #854)');
    w.__setOnline(false);
    ok($('offline-banner') && $('offline-banner').classList.contains('active'), 'offline banner shown');
    const callsBefore = or.calls.length;
    $('user-input').value = 'رسالة دون اتصال';
    ok((await app.sendUserMessage()) === 'queued' && app.outbox.length === 1 && $('user-input').value === '', 'message queued while offline');
    ok(or.calls.length === callsBefore && JSON.parse(w.localStorage.getItem('ox_alpha_outbox_v1')).length === 1, 'nothing sent; outbox persisted');
    aiReply = 'وصلت';
    w.__setOnline(true);
    await wait(150);
    ok(app.outbox.length === 0 && or.calls.length === callsBefore + 1 && !$('offline-banner').classList.contains('active'), 'back online → queued message sent automatically');

    // ------------------------------------------------------------------
    section('Data saver, data meter, battery saver (#851, #855-#860, #852)');
    app.settings.dataSaver = 'off';
    ok(!app.isDataSaver(), 'data saver off');
    w.navigator.connection = { effectiveType: '3g', saveData: false };
    app.settings.dataSaver = 'auto';
    ok(app.isDataSaver(), 'auto: 3G connection → data saver on (#857)');
    delete w.navigator.connection;
    app.settings.dataSaver = 'on';
    app.availableModels = app.availableModels && app.availableModels.length ? app.availableModels : [{ id: 'a/b', pricing: { prompt: 0, completion: 0 } }];
    router.modelFetches = 0;
    await app.fetchOpenRouterModels();
    ok(router.modelFetches === 0, 'data saver skips the automatic model list refresh (#856)');
    const big = 'data:image/png;base64,' + 'B'.repeat(400000);
    const small = await app.compressImageDataUrl(big);
    ok(small.startsWith('data:image/jpeg') && small.length < big.length, 'large images re-encoded as 1280px JPEG (#855)');
    app.settings.dataSaver = 'off';
    w.localStorage.removeItem('ox_alpha_datausage_v1'); app._dataUsage = {};
    await w.fetch('https://api.github.com/gists/ffffffff');
    await wait(1700);
    const du = app.dataUsageSummary(1);
    ok(du.byHost.some(([h, b]) => h === 'api.github.com' && b > 0), 'fetch meter counts bytes per host (#858, #859)');
    app.settings.dataWarnMB = 0.000001;
    w.localStorage.removeItem('ox_alpha_datawarn_day');
    ok(app.checkDataWarning() === true && app.checkDataWarning() === false, 'daily data warning fires once (#860)');
    app.settings.dataWarnMB = 0;
    app.settings.powerSave = 'on';
    ok(app.applyPowerSave() && d.body.classList.contains('power-save'), 'battery saver adds body.power-save');
    app.settings.powerSave = 'auto'; app._batteryLow = true;
    ok(app.isPowerSave(), 'auto power save when battery is low');
    app._batteryLow = false; app.applyPowerSave();
    ok(!d.body.classList.contains('power-save'), 'power save off');

    // ------------------------------------------------------------------
    section('Windowed message list + lazy libraries (#813, #822, #827)');
    app.createNewSession(true);
    const longS = session();
    for (let i = 0; i < 120; i++) longS.messages.push({ id: 'lm' + i, role: i % 2 ? 'assistant' : 'user', content: 'رسالة ' + i, timestamp: Date.now() });
    app.renderMessages();
    const cards = () => d.querySelectorAll('#chat-messages-container .msg-card, #chat-messages-container .user-msg-wrapper, #chat-messages-container [class*="msg-row"]').length;
    ok(d.querySelector('.load-older-btn') && !$('chat-messages-container').textContent.includes('رسالة 69') && $('chat-messages-container').textContent.includes('رسالة 70'), 'only the last 50 messages are rendered + "load older"');
    ok(longS.messages.length === 120, 'the session data is untouched');
    app.loadOlderMessages();
    ok($('chat-messages-container').textContent.includes('رسالة 20') && !$('chat-messages-container').textContent.includes('رسالة 19 '), 'load older → 100 messages');
    app.loadOlderMessages();
    ok(!d.querySelector('.load-older-btn') && $('chat-messages-container').textContent.includes('رسالة 0'), 'all messages once fully expanded');
    ok((await app.ensureJSZip()) === w.JSZip, 'ensureJSZip resolves immediately when JSZip is present');
    let mermaidReq = 0;
    const origLoad = app.loadScriptOnce;
    app.loadScriptOnce = (url, g) => { if (g === 'mermaid') { mermaidReq++; return Promise.reject(new Error('offline')); } return origLoad.call(app, url, g); };
    longS.messages.push({ id: 'mm', role: 'assistant', content: '```mermaid\ngraph TD; A-->B\n```', timestamp: Date.now() });
    const container = $('chat-messages-container');
    container.insertAdjacentHTML('beforeend', '<pre><code class="language-mermaid">graph TD; A-->B</code></pre>');
    app.enhanceRenderedCodeBlocks();
    await wait(10);
    ok(mermaidReq === 1, 'mermaid is fetched only when a diagram appears');
    app.loadScriptOnce = origLoad;
    app._mermaidLoading = null;

    // ------------------------------------------------------------------
    section('Backups, export/import, Gist sync (#818, #812, #817)');
    app.settings.webhooks = [{ id: 'w1', type: 'discord', name: 'd', url: 'https://discord.com/api/webhooks/1/abc' }];
    app.persistSettings();
    const clean = app.stripSecrets(app.settings);
    ok(!clean.apiKey && !clean.githubToken && !clean.webhooks, 'secrets excluded from backups (apiKey, githubToken, webhooks)');
    const b1 = await app.createBackup({ reason: 'manual' });
    const list = await app.listBackups();
    ok(list.length >= 1 && list[0].id === b1.id && b1.size > 0, 'backup stored in IndexedDB');
    const raw = new Uint8Array(list[0].data);
    ok(raw[0] === 0x1f && raw[1] === 0x8b, 'backups are gzip-compressed');
    const restored = JSON.parse(await app.gunzipToString(raw));
    ok(restored.app === 'ox-alpha' && restored.idb.sessions.sessions.length >= 2 && !JSON.parse(restored.ls.ox_alpha_settings_v2).apiKey, 'backup contains sessions; settings without secrets');
    ok(restored.idb.tasks_v1 && restored.idb.tasks_v1.length >= 4, 'backup includes tasks');
    ok((await app.autoBackupTick()) === null, 'auto backup skipped when nothing changed');
    app.tasks.push({ id: 'tx', title: 'new', status: 'todo' });
    ok((await app.autoBackupTick()) !== null, 'auto backup runs after changes');
    for (let i = 0; i < 6; i++) { app.tasks.push({ id: 'ty' + i, title: 'n', status: 'todo' }); await app.createBackup(); }
    ok((await app.listBackups()).length === 5, 'only the last 5 backups are kept');
    await app.exportAllData();
    const exp = downloads[downloads.length - 1];
    ok(/^ox-alpha-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(exp.name), 'export everything → .json.gz');
    const keepKey = app.settings.apiKey;
    await app.applyBackupData(restored);
    ok(JSON.parse(w.localStorage.getItem('ox_alpha_settings_v2')).apiKey === keepKey, 'restoring keeps the current secrets');
    let bad = '';
    try { await app.applyBackupData({ foo: 1 }); } catch (e) { bad = e.message; }
    ok(/غير صالح/.test(bad), 'invalid backup rejected');
    app.settings.syncGistId = '';
    const pushed = await app.syncPush();
    const sg = gists.get(pushed.id);
    ok(sg && sg.public === false && sg.files['ox-alpha-sync.json'] && sg.files['part-000.b64'], 'cloud sync → secret Gist with chunked parts');
    ok(!JSON.stringify(sg.files).includes('ghp_test') && !JSON.stringify(sg.files).includes('sk-test'), 'no secrets uploaded');
    ok(app.settings.syncGistId === pushed.id, 'sync gist id remembered');
    sg.files['part-099.b64'] = { content: 'stale' };
    await app.syncPush();
    ok(!sg.files['part-099.b64'] && gists.size >= 1, 'second push updates the same Gist and removes stale parts');
    const pulled = await app.syncPull();
    ok(pulled.data.app === 'ox-alpha' && pulled.data.idb.sessions.sessions.length >= 2, 'pull reconstructs the data');

    // ------------------------------------------------------------------
    section('Webhooks + DND + haptics (#984, #977, #946)');
    ok(app.detectWebhookType('https://discord.com/api/webhooks/123/abc-DEF') === 'discord' && app.detectWebhookType('https://hooks.slack.com/services/T/B/x') === 'slack' && !app.detectWebhookType('https://evil.com/x'), 'webhook URL detection');
    let werr = '';
    try { app.addWebhook('x', 'https://evil.com/hook'); } catch (e) { werr = e.message; }
    ok(/Discord أو Slack/.test(werr), 'unsupported webhook URLs rejected');
    app.settings.webhooks = [];
    const dh = app.addWebhook('الفريق', 'https://discord.com/api/webhooks/123/abc');
    const shk = app.addWebhook('slack', 'https://hooks.slack.com/services/T1/B1/xyz');
    ok(dh.id !== shk.id, 'webhooks added in the same millisecond get distinct ids');
    ok(await app.sendToWebhook('مرحبا '.repeat(500), dh.id), 'send to Discord');
    const dcalls = hookCalls.filter(h => h.url.includes('discord'));
    ok(dcalls.length === 2 && JSON.parse(dcalls[0].opts.body).content.length <= 1900, 'long Discord messages split into ≤1900-char chunks');
    await app.sendToWebhook('hi', shk.id);
    const sc = hookCalls.find(h => h.url.includes('slack'));
    ok(sc && sc.opts.mode === 'no-cors' && sc.opts.body.startsWith('payload=') && decodeURIComponent(sc.opts.body.slice(8)).includes('"text":"hi"'), 'Slack via no-cors form payload');
    w.__vibes = 0;
    app.settings.haptics = true;
    app.haptic(10);
    ok(w.__vibes === 1, 'haptic feedback vibrates');
    app.setDnd(true);
    app.haptic(10);
    w.__notes = [];
    ok(w.__vibes === 1 && d.body.classList.contains('dnd-on') && app.notify('t', 'b') === false, 'DND mutes vibration + notifications');
    app.setDnd(false);
    ok(app.notify('t', 'b') === true, 'notifications back after DND');

    // ------------------------------------------------------------------
    section('Health panel, errors, mobile helpers (#841, #842, #845-#847, #943-#945, #951, #952)');
    w.dispatchEvent(new w.ErrorEvent('error', { message: 'Boom test error', error: new Error('Boom test error') }));
    ok(app.getErrorLog().some(e => e.message === 'Boom test error'), 'runtime errors captured in a ring buffer');
    const recs = app.buildRecommendations({ longTasks: 30, domNodes: 20000, heapUsed: 0, heapLimit: 0 }, { quota: 100, usage: 90, persisted: false });
    ok(recs.length >= 4, 'recommendations from perf + storage signals (#847)');
    app.openPlatform('health');
    await wait(30);
    ok($('health-root').textContent.includes('Boom test error') && d.querySelectorAll('#health-root .hub-model-row').length >= 12, 'health panel: errors + module sizes');
    ok(app.reportErrorsToGitHub().startsWith('https://github.com/naderba69/daschai/issues/new?title='), 'file an issue from the error log');
    app.explainErrorsAI();
    ok($('user-input').value.includes('Boom test error'), 'explain errors with AI');
    $('user-input').value = '';
    app.clearErrorLog();
    for (const tab of ['data', 'network', 'device', 'integrations']) { app.openPlatform(tab); await wait(30); }
    ok($('plat-root').textContent.includes('Notion'), 'integrations tab discloses Notion limitation');
    app.closeModals();
    const ta = d.createElement('textarea'); ta.id = 'user-input-test'; d.body.appendChild(ta);
    ta.value = 'ab'; ta.selectionStart = ta.selectionEnd = 1;
    app._symTarget = ta;
    app.insertSymbol('{');
    ok(ta.value === 'a{b' && ta.selectionStart === 2, 'symbols bar inserts at the caret (#944)');
    app.insertSymbol('Tab');
    ok(ta.value === 'a{    b', 'Tab key inserts 4 spaces');
    const px = new Uint8ClampedArray([10, 20, 30, 255, 200, 210, 220, 255]);
    app.enhanceDocumentPixels(px);
    ok(px[0] === px[1] && px[0] < 30 && px[4] > 230, 'document scan: grayscale + contrast stretch (#952)');
    app.showScanResult({ rawValue: 'https://example.com', format: 'qr_code' });
    w.BarcodeDetector = undefined;
    await app.openScanner('code');
    await wait(10);
    ok($('scan-result').textContent.includes('BarcodeDetector'), 'scanner explains missing BarcodeDetector');
    ok($('scan-result').textContent.includes('الكاميرا غير مدعومة'), 'missing camera API reported clearly');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Insights — usage analytics (#892, #895-#897, #899)');
    const T = Date.now();
    const usage = [
        { t: T - 1000, m: 'openai/gpt-4o', pt: 10000, ct: 2000, c: 0.05, s: s1.id },
        { t: T - 2 * 864e5, m: 'openai/gpt-4o', pt: 8000, ct: 1000, c: 0.03, s: s1.id },
        { t: T - 9 * 864e5, m: 'meta/llama:free', pt: 5000, ct: 500, c: 0, s: 'gone' },
        { t: T - 40 * 864e5, m: 'openai/gpt-4o', pt: 1000, ct: 100, c: 0.01, s: '' }
    ];
    w.localStorage.setItem('ox_alpha_usage_v1', JSON.stringify(usage));
    const wk = app.usageBuckets(usage, 'week', 12, T);
    ok(wk.length === 12 && Math.abs(wk.reduce((n, b) => n + b.cost, 0) - 0.09) < 1e-9 && wk[11].cost >= 0.05, 'weekly buckets (12 weeks, all records inside)');
    const mo = app.usageBuckets(usage, 'month', 12, T);
    ok(Math.abs(mo.reduce((n, b) => n + b.cost, 0) - 0.09) < 1e-9, 'monthly buckets cover all records');
    const cpc = app.costPerChat(usage);
    ok(cpc[0].sessionId === s1.id && cpc[0].title === 'محادثة للمشاركة' && Math.abs(cpc[0].cost - 0.08) < 1e-9 && cpc.some(x => x.title === '(محادثة محذوفة)'), 'cost per chat with titles (#896)');
    const fc = app.forecastCost(usage, T);
    ok(fc.mtd >= 0.05 && fc.projected >= fc.mtd, 'month-end forecast (#899)');
    app.availableModels = [
        { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000, is_vision: true, pricing: { prompt: 0.0000025, completion: 0.00001 } },
        { id: 'google/flash', name: 'Flash', context_length: 1000000, is_vision: true, pricing: { prompt: 0.0000001, completion: 0.0000004 } },
        { id: 'meta/llama:free', name: 'Llama free', context_length: 128000, is_vision: true, is_free: true, pricing: { prompt: 0, completion: 0 } }
    ];
    const cheap = app.suggestCheaperModels(usage);
    ok(cheap.length === 1 && cheap[0].alternatives.some(a => a.id === 'google/flash' && a.saving > 0) && cheap[0].alternatives.some(a => a.free), 'cheaper model suggestions with savings (#895)');
    const ym = new Date(T).toISOString().slice(0, 7);
    const inv = app.buildInvoice(ym, usage);
    ok(inv.lines.length >= 1 && inv.total > 0, 'monthly invoice');
    ok(app.invoiceCSV(inv).split('\n')[0] === 'model,requests,prompt_tokens,completion_tokens,cost_usd' && /TOTAL/.test(app.invoiceCSV(inv)), 'invoice CSV');
    ok(app.invoiceHTML(inv).includes('فاتورة') && app.printInvoice(ym) === false && downloads.some(x => x.name === `invoice-${ym}.html`), 'printable invoice (falls back to download if popups blocked) (#897)');

    section('Insights — activity, skills, quality, reports (#901-#926)');
    app._lastInteraction = Date.now();
    Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => false });
    ok(app.heartbeat() === true && app.loadActivity()[Object.keys(app.loadActivity()).pop()] >= 30, 'active-time heartbeat (#911)');
    app._lastInteraction = Date.now() - 10 * 60000;
    ok(app.heartbeat() === false, 'idle time is not counted');
    const ds = app.dailyStats(7);
    ok(ds.length === 7 && ds[6].sent >= 1 && ds[6].score > 0, 'daily productivity stats (#912)');
    ok(app.streak() >= 1, 'activity streak');
    const abh = app.activityByHour();
    ok(abh.hours.length === 24 && abh.hours.reduce((a, b) => a + b, 0) >= 1 && abh.peakHour === new Date().getHours(), 'most active hours (#465)');
    const sk = app.skillMap();
    ok(sk.some(x => x.name === 'JavaScript' && x.blocks >= 1), 'skill map from code blocks + files (#925, #926)');
    s1.messages.push({ id: 'tp', role: 'user', content: 'كيف أستخدم react مع docker و react hooks؟', timestamp: Date.now() });
    const tp = app.topicStats();
    ok(tp.tech[0][0] === 'react' && tp.tech[0][1] === 2 && tp.tech.some(([t]) => t === 'docker'), 'tech topics detected (#922)');
    const ach = app.computeAchievements();
    ok(ach.list.length === 16 && !!ach.list.find(a => a.id === 'first-chat').earned && !!ach.list.find(a => a.id === 'artist').earned && !ach.list.find(a => a.id === 'msgs-1000').earned, 'achievements computed (#915)');
    ok(app.computeAchievements().fresh.length === 0, 'achievements announced only once');

    const complexSrc = ['function big(a, b) {'].concat(Array.from({ length: 70 }, (_, i) => `  if (a > ${i} && b) { a++; } else if (a || b) { b--; }`)).concat(['}', 'const small = (x) => x + 1;', '// TODO: tidy']).join('\n');
    const af = app.analyzeFile('src/big.js', complexSrc);
    ok(af.functions === 2 && af.longFunctions.length === 1 && af.complexFunctions[0].name === 'big' && af.todos === 1, 'file metrics: functions, long/complex functions, TODOs (#902)');
    const py = app.analyzeFile('a.py', 'def f(x):\n    if x:\n        for i in x:\n            if i:\n                pass\n    return 1\n\ndef g():\n    return 2\n');
    ok(py.functions === 2 && py.maxDepth === 4 && py.fns[0].length === 6, 'Python functions + indentation depth');
    const dupBlock = Array.from({ length: 7 }, (_, i) => `const value${i} = computeSomethingLong(input${i}, options${i});`).join('\n');
    const dupes = app.findDuplicates([['a.js', dupBlock + '\nfoo();'], ['b.js', 'bar();\n' + dupBlock]]);
    ok(dupes.length >= 1 && dupes[0].locations.length === 2, 'duplicate code detection across files (#904)');
    app.virtualProjectFiles.clear();
    app.virtualProjectFiles.set('src/big.js', { content: complexSrc });
    app.virtualProjectFiles.set('src/a.js', { content: dupBlock });
    app.virtualProjectFiles.set('src/b.js', { content: dupBlock });
    const qr = app.projectQualityReport();
    ok(qr.score < 80 && qr.testRatio === 0 && qr.recommendations.some(([, t]) => /اختبارات/.test(t)) && qr.recommendations.some(([, t]) => /مكرر/.test(t)), 'quality score + recommendations (#901, #910)');
    app.virtualProjectFiles.set('tests/big.test.js', { content: Array.from({ length: 40 }, (_, i) => `test('t${i}', () => expect(1).toBe(1));`).join('\n') });
    ok(app.projectQualityReport().testRatio > 0 && app.projectQualityReport().score > qr.score, 'adding tests raises the score (#908)');
    const rf = app.refactorFileAI('src/big.js');
    ok(rf.includes('big') && $('user-input').value.includes('أعد هيكلة'), 'refactor via AI (#903)');
    $('user-input').value = '';
    const dr = app.buildActivityReport('day');
    const wr = app.buildActivityReport('week');
    ok(dr.includes('التقرير اليومي') && wr.includes('التقرير الأسبوعي') && /طلبات AI/.test(wr), 'daily + weekly reports (#919, #920)');
    for (const tab of ['usage', 'activity', 'skills', 'quality', 'reports']) { app.openInsights(tab); await wait(10); }
    ok($('ins-root').textContent.includes('التقرير اليومي'), 'insights panels render (reports tab last)');
    app.openInsights('usage');
    ok($('ins-root').textContent.includes('Flash') && $('ins-root').textContent.includes('محادثة للمشاركة'), 'usage tab: cheaper models + cost per chat');
    app.openInsights('quality');
    ok(d.querySelectorAll('.q-row').length >= 3, 'quality tab lists files');
    app.closeModals();

    // ------------------------------------------------------------------
    section('Palette + layout');
    const cmds = app.buildPaletteCommands().map(x => x.label);
    ok(['مشاركة المحادثة برابط', 'المهام (Kanban)', 'السبورة البيضاء', 'صحة التطبيق والأداء', 'تقرير جودة المشروع', 'وضع: تدريس'].every(l => cmds.includes(l)), 'palette commands for sprint 5 features');
    ok(d.querySelectorAll('.tool-grid-btn').length >= 14 && $('btn-chat-mode') && $('session-mode-badge') && $('btn-studio-comments'), 'sidebar tools, mode button, mode badge, comments button');
    await wait(50);
    const persisted = await app.idbGet('tasks_v1');
    ok(Array.isArray(persisted) && persisted.length >= 4, 'tasks persisted to IndexedDB');

    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
    w.close();
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; if (W) W.close(); });
