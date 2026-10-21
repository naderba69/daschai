/* Sprint 2 tests: router, RAG, token estimate, usage, arena, critic, IndexedDB. */
require('fake-indexeddb/auto');
const { loadApp, mockOpenRouter, ok, wait, section } = require('./helpers');

(async () => {
    const or = mockOpenRouter(async (body) => {
        if (body.model.includes('broken')) return { status: 500, error: 'provider down' };
        return { text: `رد من ${body.model}: hello world `.repeat(3), usage: { prompt_tokens: 120, completion_tokens: 45, cost: 0.00123 } };
    });
    const { w, d, app, errors } = loadApp({ fetchImpl: or.fetchImpl, indexedDB: globalThis.indexedDB });
    await wait(150);
    const localStorage = w.localStorage;

    section('Token estimate');
    const en = app.estimateTokens('hello world this is a test sentence');
    const ar = app.estimateTokens('مرحبا بالعالم هذه جملة اختبار');
    ok(en > 5 && en < 15, `English estimate sane (${en})`);
    ok(ar > en * 0.9, `Arabic gets more tokens per char (${ar} vs ${en})`);
    ok(app.formatTokens(12345) === '12k' && app.formatTokens(1500) === '1.5k', 'formatTokens');
    ok(app.formatUSD(0) === 'مجاني' && app.formatUSD(0.0123) === '$0.012', 'formatUSD');

    section('Smart router v2');
    const route = (content, extra = {}) => app.pickSmartModel({ content, attachments: extra.attachments || [] }, { messages: [{ content }] }, 'google/gemma-3-27b-it:free');
    app.settings.routerMode = 'balanced';
    const code = route('أصلح هذا الخطأ في دالة JavaScript: TypeError undefined');
    ok(code.category === 'coding' && /coder|qwen/.test(code.model), `coding → ${code.model}`);
    const reason = route('حلل تعقيد هذه الخوارزمية وأثبت صحتها رياضياً');
    ok(reason.category === 'reasoning' && /r1/.test(reason.model), `reasoning → ${reason.model}`);
    const img = route('ماذا في الصورة؟', { attachments: [{ isImage: true, base64: 'data:x' }] });
    ok(img.category === 'vision' && /gemma-3|openrouter\/free|gpt-4o|claude|gemini/.test(img.model), `vision → ${img.model}`);
    const chat = route('صباح الخير، كيف حالك؟');
    ok(chat.category === 'chat' && app.isFreeModel(chat.model), `chat (balanced) → free ${chat.model}`);
    app.settings.routerMode = 'economy';
    const econ = ['coding', 'reasoning', 'chat', 'long', 'vision'].map(c => app.routeForCategory(c));
    ok(econ.every(id => id && app.isFreeModel(id)), 'economy never picks paid models');
    app.settings.routerMode = 'quality';
    const q = route('اكتب كود React معقد لنظام مصادقة');
    ok(!app.isFreeModel(q.model), `quality may pick paid → ${q.model}`);
    app.settings.routerMode = 'balanced';
    ok(app.routeForCategory('coding', { exclude: [code.model] }) !== code.model, 'exclude works (critic)');

    section('Local RAG');
    let big = '';
    for (let i = 0; i < 120; i++) {
        big += `--- [الملف: src/module${i}.js] ---\n` + Array.from({ length: 40 }, (_, j) => `export function helper${i}_${j}(a, b) { return a + b * ${j}; } // padding text`).join('\n') + '\n\n';
    }
    big += '--- [الملف: src/upload/fileUploader.js] ---\nexport async function uploadFileChunked(file) {\n  // resumable multipart upload with retry\n  return sendChunks(file);\n}\n\n';
    const att = { name: 'GitHub Codebase: x/y', textContent: big, isGitHubProject: true };
    const msg = { role: 'user', content: 'كيف يعمل uploadFileChunked و resumable upload؟', attachments: [att] };
    const fake = { steps: [] };
    const ctx = app.buildAttachmentContext(msg, { query: msg.content, assistantMsg: fake, isLatest: true, autoContinuePass: 0 });
    ok(big.length > 300000, `attachment is big (${Math.round(big.length / 1000)}k chars)`);
    ok(ctx.length <= 24000 + 200, `RAG context within budget (${ctx.length} chars)`);
    ok(ctx.includes('uploadFileChunked'), 'RAG picked the relevant file');
    ok(ctx.includes('خريطة ملفات المشروع (121)'), 'file map included');
    ok(fake.steps.some(s => s.text.includes('RAG')) && fake.rag && fake.rag.picked > 0, 'RAG step + stats on assistant msg');
    const small = app.buildAttachmentContext({ content: 'x', attachments: [{ name: 'a.js', textContent: 'const a = 1;' }] }, { isLatest: true });
    ok(small.includes('const a = 1;') && !small.includes('RAG'), 'small attachments sent in full');
    app.settings.ragEnabled = false;
    ok(app.buildAttachmentContext(msg, { isLatest: true }).length > 300000, 'RAG off → full content');
    app.settings.ragEnabled = true;
    ok(app.ragTokenize('getUserName snake_case_var المستخدمين').join(' ').includes('user') && app.ragTokenize('المستخدمين').length === 1, 'tokenizer splits camel/snake + Arabic');

    section('Code search modal');
    app.currentAttachments = [att];
    app.openCodeSearch('resumable upload');
    ok(d.getElementById('code-search-modal').classList.contains('active'), 'modal opens');
    const hits = d.querySelectorAll('.code-search-hit');
    ok(hits.length > 0 && hits[0].textContent.includes('fileUploader.js'), `top hit is fileUploader.js (${hits.length} hits)`);
    app.openCodeSearchHit(0);
    ok(app.isCodeStudioOpen && app.activeStudioFile === 'src/upload/fileUploader.js', 'click opens file in studio');
    app.currentAttachments = [];
    app.closeModals();

    section('Token chip');
    const input = d.getElementById('user-input');
    input.value = 'اشرح لي هذا الكود'; input.dispatchEvent(new w.Event('input'));
    await wait(200);
    const chip = d.getElementById('token-estimate-chip');
    ok(/توكن/.test(chip.textContent) && /من السياق/.test(chip.textContent), `chip: "${chip.textContent.trim()}"`);
    input.value = ''; input.dispatchEvent(new w.Event('input')); await wait(200);
    ok(chip.textContent.trim() === '', 'chip hidden on empty input');

    section('Chat streaming → usage + router step');
    app.settings.apiKey = 'sk-test';
    localStorage.removeItem('ox_alpha_usage_v1');
    await app.sendUserMessage('أصلح دالة JavaScript هذه: function a(){ return b }');
    const sess = app.sessions.find(s => s.id === app.activeSessionId);
    const am = sess.messages[sess.messages.length - 1];
    ok(am.status === 'completed' && am.content.includes('hello world'), 'assistant message streamed');
    ok(am.steps.some(s => s.text.includes('الموجّه الذكي')), 'router step shown');
    ok(or.calls[or.calls.length - 1].usage && or.calls[or.calls.length - 1].usage.include === true, 'request asks for usage accounting');
    const usage = app.loadUsage();
    ok(usage.length === 1 && usage[0].pt === 120 && usage[0].ct === 45 && usage[0].c === 0.00123 && !usage[0].e, 'real usage + cost recorded');
    ok(am.usage && am.usage.completion_tokens === 45, 'usage attached to message');

    section('Critic mode');
    const before = or.calls.length;
    app.critiqueLastAnswer();
    await wait(300);
    const criticCall = or.calls[before];
    ok(criticCall && criticCall.model !== am.model, `critic used a different model (${criticCall && criticCall.model} vs ${am.model})`);
    const last = sess.messages[sess.messages.length - 1];
    ok(last.forcedModel === criticCall.model && last.status === 'completed', 'critic answer completed with forced model');

    section('AI hub');
    app.openAIHub();
    const hub = d.getElementById('ai-hub-body');
    ok(hub.querySelectorAll('.hub-stat-card').length === 4, '4 stat cards');
    ok(hub.querySelectorAll('.hub-bar-col').length === 14, '14-day chart');
    ok(hub.querySelectorAll('.hub-table tbody tr').length >= 1 && hub.textContent.includes('$0.00'), 'per-model table with cost');
    ok(hub.querySelectorAll('.hub-mode-btn').length === 4, '4 router modes');
    app.setRouterMode('economy');
    ok(app.settings.routerMode === 'economy' && JSON.parse(localStorage.getItem('ox_alpha_settings_v2')).routerMode === 'economy', 'router mode persisted');
    app.setRouterMode('balanced');
    const csv = app.buildUsageCSV();
    ok(csv.split('\n').length === app.loadUsage().length + 1 && csv.startsWith('timestamp,model'), 'CSV export rows');

    section('Budget alerts');
    const toasts = [];
    const origToast = app.showToast.bind(app);
    app.showToast = (m, t) => { toasts.push([m, t]); origToast(m, t); };
    localStorage.removeItem('ox_alpha_budget_warn');
    app.settings.monthlyBudget = 0.002; // spent so far ≈ 0.0025
    app.checkBudget();
    ok(toasts.some(([m, t]) => t === 'error' && m.includes('تجاوزت')), '100% budget alert');
    const n = toasts.length; app.checkBudget();
    ok(toasts.length === n, 'alert not repeated in same month');
    app.settings.monthlyBudget = 0;
    app.showToast = origToast;

    section('Multi-model arena');
    app.openDualModelArena();
    ok(d.getElementById('arena-modal').classList.contains('active'), 'arena opens');
    app.setArenaCount(4);
    ok(d.querySelectorAll('.arena-column-card').length === 4, '4 columns');
    const sels = d.querySelectorAll('.arena-model-select');
    sels[3].value = sels[0].value; // same model twice → must count as one battle
    // make column 2 fail
    const brokenOpt = d.createElement('option'); brokenOpt.value = 'x/broken-model'; sels[2].appendChild(brokenOpt); sels[2].value = 'x/broken-model';
    d.getElementById('arena-prompt-input').value = 'اكتب دالة fibonacci';
    const results = await app.executeArenaComparison();
    ok(results.filter(r => r.ok).length === 3 && results[2].ok === false, '3 succeed, broken one fails gracefully');
    ok(d.getElementById('arena-output-0').textContent.includes('hello world'), 'column output rendered');
    ok(d.getElementById('arena-gauge-2').classList.contains('fail'), 'failure gauge');
    ok(!d.getElementById('arena-vote-0').disabled && d.getElementById('arena-vote-2').disabled, 'vote enabled only for successful columns');
    app.voteArena(1);
    const board = app.getArenaLeaderboard();
    const winner = results[1].model;
    ok(board.find(r => r.model === winner).wins === 1 && board.every(r => r.battles === 1), 'votes recorded: winner +1, every model 1 battle (duplicate deduped)');
    ok(board.length === 2 && !board.some(r => r.model.includes('broken')), 'broken model not counted');
    ok(app.loadUsage().filter(r => r.src === 'arena').length === 3, 'arena usage recorded');

    section('Palette integration');
    app.openCommandPalette();
    const pi = d.getElementById('cmd-palette-input');
    pi.value = 'الموجّه'; pi.dispatchEvent(new w.Event('input'));
    ok(d.querySelectorAll('.cmd-palette-item').length >= 4, 'router modes in palette');
    app.closeCommandPalette();

    section('IndexedDB durability');
    await app._idbReady;
    app.saveSessions();
    await app.flushSessionsToIDB();
    const rec = await app.idbGet('sessions');
    ok(rec && rec.sessions.length === app.sessions.length && rec.sessions.some(s => s.messages.length >= 4), 'sessions mirrored to IndexedDB');
    // Simulate a quota-trimmed localStorage copy, then a fresh boot: IDB copy (full) must win.
    const bigAttSession = { id: 'sess_big', title: 'big', createdAt: 1, updatedAt: 1, messages: [{ id: 'm1', role: 'user', content: 'x', attachments: [{ name: 'repo', textContent: 'A'.repeat(50000) }] }] };
    app.sessions.unshift(bigAttSession); app.activeSessionId = 'sess_big';
    app.saveSessions(); await app.flushSessionsToIDB();
    const trimmed = JSON.parse(localStorage.getItem('ox_alpha_sessions_v2'));
    trimmed[0].messages[0].attachments[0].textContent = '[trimmed]';
    const seed = { ox_alpha_sessions_v2: JSON.stringify(trimmed), ox_alpha_sessions_saved_at: localStorage.getItem('ox_alpha_sessions_saved_at') };
    const boot2 = loadApp({ indexedDB: globalThis.indexedDB, localStorageSeed: seed });
    await wait(50); await boot2.app._idbReady;
    const restored = boot2.app.sessions.find(s => s.id === 'sess_big');
    ok(boot2.app._idbRestored && restored && restored.messages[0].attachments[0].textContent.length === 50000, 'fresh boot restores full attachment from IndexedDB');
    ok(boot2.app.activeSessionId === 'sess_big', 'active session restored');
    boot2.w.close();

    ok(errors.length === 0, 'no runtime errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
    w.close();
})().catch(e => { console.error('❌ test crashed:', e); process.exitCode = 1; });
