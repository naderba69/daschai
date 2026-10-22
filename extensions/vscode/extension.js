// OX-Alpha for VS Code — zero dependencies (VS Code ≥ 1.82 ships Node 18 with fetch).
const vscode = require('vscode');
const cp = require('child_process');

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

function cfg() {
    const c = vscode.workspace.getConfiguration('oxAlpha');
    return { key: c.get('apiKey') || process.env.OX_ALPHA_KEY || process.env.OPENROUTER_API_KEY || '', model: c.get('model'), lang: c.get('language'), url: c.get('url') || 'https://daschai.vercel.app/' };
}
function context() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return null;
    const sel = ed.selection, doc = ed.document;
    return { ed, code: sel.isEmpty ? doc.getText() : doc.getText(sel), lang: doc.languageId, file: vscode.workspace.asRelativePath(doc.uri), whole: sel.isEmpty };
}
async function stream(title, messages) {
    const c = cfg();
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: '# ' + title + '\n\n' });
    const ed = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, true);
    let pending = '', flushing = false;
    const flush = async () => { if (flushing || !pending) return; flushing = true; const t = pending; pending = ''; await ed.edit(b => b.insert(doc.lineAt(doc.lineCount - 1).range.end, t)); flushing = false; if (pending) flush(); };
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OX-Alpha: ' + title, cancellable: false }, () =>
        oxChat(c.key, c.model, messages, d => { pending += d; flush(); }).catch(e => vscode.window.showErrorMessage(e.message)));
}
const sys = () => ({ role: 'system', content: 'You are OX-Alpha, a senior engineer. ' + (cfg().lang === 'ar' ? 'Answer in Arabic; keep code and identifiers in English.' : 'Answer in English.') });
const block = (x) => 'File: ' + x.file + '\n```' + x.lang + '\n' + x.code.slice(0, 24000) + '\n```';

function activate(ctx) {
    const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
    reg('oxAlpha.ask', async () => {
        const x = context(); if (!x) return;
        const q = await vscode.window.showInputBox({ prompt: 'اسأل OX-Alpha عن الكود المحدد', placeHolder: 'لماذا لا تعمل هذه الدالة؟' });
        if (q) stream(q, [sys(), { role: 'user', content: q + '\n\n' + block(x) }]);
    });
    reg('oxAlpha.explain', () => { const x = context(); if (x) stream('شرح ' + x.file, [sys(), { role: 'user', content: 'Explain this code step by step, then list risks/bugs:\n' + block(x) }]); });
    reg('oxAlpha.tests', () => { const x = context(); if (x) stream('اختبارات ' + x.file, [sys(), { role: 'user', content: 'Write thorough unit tests (edge cases included) for this code using the idiomatic framework for ' + x.lang + '. Return one code block.\n' + block(x) }]); });
    reg('oxAlpha.fix', async () => {
        const x = context(); if (!x) return;
        const c = cfg();
        const out = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'OX-Alpha: إصلاح…' }, () =>
            oxChat(c.key, c.model, [{ role: 'system', content: 'Return ONLY the corrected/improved code, no fences, no explanation. Keep the same language and API.' }, { role: 'user', content: block(x) }]).catch(e => { vscode.window.showErrorMessage(e.message); return null; }));
        if (!out) return;
        const code = out.replace(/^```[\w-]*\n?|\n?```\s*$/g, '');
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
        try { repo = (/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(cp.execSync('git remote get-url origin', { cwd: root }).toString().trim()) || [])[1] || ''; } catch (e) { /* not a repo */ }
        const q = repo ? '?action=open&repo=' + encodeURIComponent(repo) : x ? '?action=ask&q=' + encodeURIComponent(block(x).slice(0, 1800)) : '';
        vscode.env.openExternal(vscode.Uri.parse(c.url + q));
    });
    const sb = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    sb.text = '$(sparkle) OX'; sb.tooltip = 'OX-Alpha: اسأل عن التحديد (Ctrl+Alt+X)'; sb.command = 'oxAlpha.ask'; sb.show();
    ctx.subscriptions.push(sb);
}
function deactivate() {}
module.exports = { activate, deactivate, oxChat };
