/* #985 Jira / Linear / Trello • #986 webhooks on every push • #999 Zapier / Make */
import { esc, call, btn, pbtn, card, empty, field, select, table, toggle, pre, ago, uid } from './util.js';

// ====================================================================== pure helpers
/** TODO/FIXME/BUG comments → issue drafts. */
export function scanTodos(files) {
    const out = [];
    const re = /(?:\/\/|#|<!--|\/\*|--)\s*(TODO|FIXME|BUG|HACK|XXX)\b\s*(?:\(([^)]*)\))?[:\s]*(.+?)(?:-->|\*\/)?\s*$/i;
    files.forEach(([path, text]) => String(text).split('\n').forEach((l, i) => { const m = re.exec(l); if (m && m[3].trim().length > 2) out.push({ path, line: i + 1, tag: m[1].toUpperCase(), who: m[2] || '', title: m[3].trim().slice(0, 200) }); }));
    return out;
}
export const todoBody = (t, repo, branch = 'main') => `**${t.tag}** في \`${t.path}:${t.line}\`${repo ? `\n\nhttps://github.com/${repo}/blob/${branch}/${t.path}#L${t.line}` : ''}\n\n> أنشئت تلقائياً من تعليق في الكود بواسطة OX-Alpha.`;
/** Jira bulk import CSV (Jira → System → External system import → CSV). */
export function jiraCsv(items, { project = 'OX', type = 'Task' } = {}) {
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    return ['Summary,Description,Issue Type,Priority,Labels,Project Key', ...items.map(t => [q(t.title), q(t.body || ''), q(t.type || type), q(t.tag === 'BUG' || t.tag === 'FIXME' ? 'High' : 'Medium'), q((t.tag || 'todo').toLowerCase()), q(project)].join(','))].join('\n') + '\n';
}
export const HOOK_EVENTS = [['push', 'دفع (Push) إلى GitHub'], ['release', 'إصدار جديد'], ['pages', 'نشر GitHub Pages'], ['issue', 'Issue جديدة'], ['pr', 'Pull Request جديد'], ['repo', 'مستودع جديد'], ['test', 'اختبار يدوي']];
/** Classify a successful GitHub API call → event or null. */
export function ghEvent(path, method) {
    const p = String(path || ''), m = String(method || 'GET').toUpperCase();
    if (m === 'GET') return null;
    let r;
    if ((r = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(p)) && (m === 'PUT' || m === 'DELETE')) return { event: 'push', repo: r[1], file: decodeURIComponent(r[2]), op: m === 'DELETE' ? 'delete' : 'write' };
    if ((r = /^\/repos\/([^/]+\/[^/]+)\/git\/refs(?:\/heads\/(.+))?$/.exec(p)) && (m === 'PATCH' || m === 'POST')) return { event: 'push', repo: r[1], branch: r[2] ? decodeURIComponent(r[2]) : '' };
    if ((r = /^\/repos\/([^/]+\/[^/]+)\/releases$/.exec(p)) && m === 'POST') return { event: 'release', repo: r[1] };
    if ((r = /^\/repos\/([^/]+\/[^/]+)\/pages(\/builds)?$/.exec(p)) && m === 'POST') return { event: 'pages', repo: r[1] };
    if ((r = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(p)) && m === 'POST') return { event: 'issue', repo: r[1] };
    if ((r = /^\/repos\/([^/]+\/[^/]+)\/pulls$/.exec(p)) && m === 'POST') return { event: 'pr', repo: r[1] };
    if (/^\/(user|orgs\/[^/]+)\/repos$/.test(p) && m === 'POST') return { event: 'repo', repo: '' };
    return null;
}
/** Merge a burst of push events (one per file) into one payload. */
export function mergePush(events) {
    const by = {};
    events.forEach(e => { const k = e.repo || '?'; const x = by[k] = by[k] || { event: 'push', repo: e.repo, branch: e.branch || '', files: [], at: e.at || Date.now() }; if (e.file && !x.files.includes(e.file)) x.files.push(e.file); if (e.branch) x.branch = e.branch; });
    return Object.values(by);
}
export const hookText = (p) => ({ push: `📤 Push إلى ${p.repo}${p.branch ? '@' + p.branch : ''}${p.files && p.files.length ? ` — ${p.files.length} ملف: ${p.files.slice(0, 5).join('، ')}${p.files.length > 5 ? '…' : ''}` : ''}`, release: `🏷 إصدار جديد في ${p.repo}${p.tag ? ' ' + p.tag : ''}`, pages: `🌍 نشر GitHub Pages لـ ${p.repo}`, issue: `🐞 Issue جديدة في ${p.repo}${p.title ? ': ' + p.title : ''}`, pr: `🔀 PR جديد في ${p.repo}${p.title ? ': ' + p.title : ''}`, repo: `📦 مستودع جديد ${p.repo || ''}`, test: '✅ اختبار Webhook من OX-Alpha' }[p.event] || `📣 ${p.event}`);
/** Webhook URL → kind. */
export function hookKind(url) {
    const u = String(url || '');
    if (/^https:\/\/hooks\.zapier\.com\/hooks\/catch\//.test(u)) return 'zapier';
    if (/^https:\/\/hook\.[\w-]+\.make\.com\//.test(u) || /^https:\/\/hook\.integromat\.com\//.test(u)) return 'make';
    if (/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(u)) return 'discord';
    if (/^https:\/\/hooks\.slack\.com\//.test(u)) return 'slack';
    if (/^https:\/\//.test(u)) return 'json';
    return null;
}

export function installWork(P) {
    // ---------------------------------------------------------------- #985 issue trackers
    P.ixLinear = async function (query, variables) {
        const key = this.ixCfg('issues').linearKey;
        if (!key) throw new Error('أدخل Linear API key');
        const r = await this.ixHttp('https://api.linear.app/graphql', { method: 'POST', headers: { Authorization: key }, body: { query, variables } });
        if (r.errors && r.errors.length) throw new Error(r.errors[0].message);
        return r.data;
    };
    P.ixTrello = function (path, { method = 'GET', params = {} } = {}) {
        const c = this.ixCfg('issues');
        if (!c.trelloKey || !c.trelloToken) throw new Error('أدخل Trello key و token');
        const q = new URLSearchParams({ ...params, key: c.trelloKey, token: c.trelloToken });
        return this.ixHttp(`https://api.trello.com/1${path}?${q}`, { method });
    };
    P.ixJira = function (path, { method = 'GET', body } = {}) {
        const c = this.ixCfg('issues');
        if (!c.jiraSite || !c.jiraEmail || !c.jiraToken) throw new Error('أدخل موقع Jira والبريد و API token');
        const base = (c.jiraProxy ? c.jiraProxy.replace(/\/+$/, '') + '/' : '') + `https://${c.jiraSite.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
        return this.ixHttp(base + '/rest/api/3' + path, { method, body, headers: { Authorization: 'Basic ' + btoa(c.jiraEmail + ':' + c.jiraToken), Accept: 'application/json' } });
    };
    P.ixIssueList = async function (tracker) {
        tracker = tracker || this.ixCfg('issues').tracker || 'linear';
        this.ixBusy('ix-is-list', '');
        try {
            let items = [];
            if (tracker === 'linear') { const d = await this.ixLinear('query { issues(first: 30, orderBy: updatedAt) { nodes { identifier title url state { name } assignee { name } updatedAt } } }'); items = d.issues.nodes.map(n => ({ id: n.identifier, title: n.title, url: n.url, state: n.state && n.state.name, who: n.assignee && n.assignee.name, at: n.updatedAt })); }
            else if (tracker === 'trello') { const c = this.ixCfg('issues'); const cards = await this.ixTrello(`/boards/${encodeURIComponent(c.trelloBoard || '')}/cards`, { params: { fields: 'name,shortUrl,idList,dateLastActivity' } }); items = cards.map(x => ({ id: x.id.slice(-6), title: x.name, url: x.shortUrl, state: '', at: x.dateLastActivity })); }
            else { const c = this.ixCfg('issues'); const r = await this.ixJira(`/search?jql=${encodeURIComponent(`project=${c.jiraProject || 'OX'} ORDER BY updated DESC`)}&maxResults=30&fields=summary,status,assignee,updated`); items = (r.issues || []).map(i => ({ id: i.key, title: i.fields.summary, url: `https://${c.jiraSite}/browse/${i.key}`, state: i.fields.status && i.fields.status.name, who: i.fields.assignee && i.fields.assignee.displayName, at: i.fields.updated })); }
            this._ixIssues = items;
            this.ixOut('ix-is-list', items.length ? table(['#', 'العنوان', 'الحالة', 'المسؤول', 'آخر تحديث'], items.map(i => [`<a href="${esc(i.url)}" target="_blank" rel="noopener" dir="ltr">${esc(i.id)}</a>`, esc(i.title), esc(i.state || ''), esc(i.who || ''), esc(i.at ? ago(new Date(i.at).getTime()) : '')])) : empty('لا توجد مهام'));
            return items;
        } catch (e) { return this.ixErr(/Failed|تعذر/.test(e.message) && tracker === 'jira' ? new Error('Jira Cloud لا يسمح بالطلبات من المتصفح (CORS). استخدم وسيطاً (Proxy) أو صدّر CSV') : e, 'ix-is-list'); }
    };
    P.ixIssueCreate = async function (item, tracker) {
        const c = this.ixCfg('issues');
        tracker = tracker || c.tracker || 'linear';
        if (tracker === 'linear') {
            let team = c.linearTeam;
            if (!team) { const d = await this.ixLinear('query { teams(first: 1) { nodes { id } } }'); team = d.teams.nodes[0] && d.teams.nodes[0].id; }
            const d = await this.ixLinear('mutation($i: IssueCreateInput!) { issueCreate(input: $i) { success issue { identifier url } } }', { i: { teamId: team, title: item.title, description: item.body || '' } });
            return d.issueCreate.issue;
        }
        if (tracker === 'trello') { const r = await this.ixTrello('/cards', { method: 'POST', params: { idList: c.trelloList || '', name: item.title, desc: item.body || '' } }); return { identifier: r.id.slice(-6), url: r.shortUrl }; }
        const r = await this.ixJira('/issue', { method: 'POST', body: { fields: { project: { key: c.jiraProject || 'OX' }, summary: item.title, issuetype: { name: 'Task' }, description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: item.body || item.title }] }] } } } });
        return { identifier: r.key, url: `https://${c.jiraSite}/browse/${r.key}` };
    };
    P.ixTodoScan = function () {
        const list = scanTodos(this.ixFiles(p => !/(^|\/)(node_modules|dist)\//.test(p)));
        this._ixTodos = list;
        this.ixOut('ix-is-todos', list.length ? `${table(['', 'الوسم', 'الموقع', 'النص'], list.map((t, i) => [`<input type="checkbox" class="ix-todo-ck" data-i="${i}" checked>`, esc(t.tag), `<a href="#" dir="ltr" onclick="${call('openFileAt', t.path, t.line, 1)};return false">${esc(t.path)}:${t.line}</a>`, esc(t.title)]))}<div class="gh-row">${pbtn('fa-paper-plane', 'إنشاء المحدد كمهام', 'app.ixTodoPush()')}${btn('fa-file-csv', 'تصدير CSV لـ Jira', 'app.ixTodoCsv()')}</div>` : empty('لا توجد تعليقات TODO/FIXME/BUG في المشروع 🎉'));
        return list;
    };
    P.ixTodoPicked = function () { const ck = [...document.querySelectorAll('.ix-todo-ck')]; return (this._ixTodos || []).filter((t, i) => !ck.length || (ck.find(c => +c.dataset.i === i) || {}).checked); };
    P.ixTodoPush = async function () {
        const items = this.ixTodoPicked(), repo = this.settings.githubOwner && this.settings.githubRepo ? `${this.settings.githubOwner}/${this.settings.githubRepo}` : '';
        const done = [];
        for (const t of items) { try { done.push(await this.ixIssueCreate({ title: `${t.tag}: ${t.title}`, body: todoBody(t, repo, this.settings.githubBranch || 'main') })); } catch (e) { this.ixErr(e, 'ix-is-res'); break; } }
        if (done.length) this.ixOut('ix-is-res', empty(`✅ أُنشئت ${done.length} مهمة: ${done.map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.identifier)}</a>`).join('، ')}`));
        return done;
    };
    P.ixTodoCsv = function () {
        const repo = this.settings.githubOwner && this.settings.githubRepo ? `${this.settings.githubOwner}/${this.settings.githubRepo}` : '';
        const csv = jiraCsv(this.ixTodoPicked().map(t => ({ ...t, title: `${t.tag}: ${t.title}`, body: todoBody(t, repo) })), { project: this.ixCfg('issues').jiraProject || 'OX' });
        this.downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv' }), 'jira-import.csv');
        return csv;
    };
    P.ixIssues = async function () {
        const c = this.ixCfg('issues'), tr = c.tracker || 'linear';
        const F = { linear: [['linearKey', 'API key', 'password'], ['linearTeam', 'Team ID (اختياري)', 'text']], trello: [['trelloKey', 'API key', 'text'], ['trelloToken', 'Token', 'password'], ['trelloBoard', 'Board ID', 'text'], ['trelloList', 'List ID (للإنشاء)', 'text']], jira: [['jiraSite', 'الموقع', 'text'], ['jiraEmail', 'البريد', 'text'], ['jiraToken', 'API token', 'password'], ['jiraProject', 'مفتاح المشروع', 'text'], ['jiraProxy', 'وسيط CORS (اختياري)', 'text']] };
        const map = Object.fromEntries(F[tr].map(([k]) => [k, 'ix-is-' + k]));
        return card('إدارة المهام', `<p class="hv-dim">اعرض مهامك وأنشئ مهام جديدة من تعليقات TODO وFIXME وBUG في الكود مباشرة. يعمل Linear وTrello من المتصفح. أما Jira Cloud فيحجب الطلبات من المتصفح (CORS)، لذا يحتاج وسيطاً (Proxy)، أو صدّر المهام بصيغة CSV واستوردها في Jira.</p>
            <div class="gh-row">${select('ix-is-tr', 'الأداة', [['linear', 'Linear'], ['trello', 'Trello'], ['jira', 'Jira']], tr, `onchange="app.ixSave('issues',{tracker:this.value});app.ixRefresh()"`)}</div>
            <div class="gh-row">${F[tr].map(([k, l, t]) => field('ix-is-' + k, l, c[k] || '', `dir="ltr" type="${t}"`)).join('')}</div>
            <div class="gh-row">${btn('fa-floppy-disk', 'حفظ', `app.ixSaveForm('issues',${esc(JSON.stringify(map))})`)}${pbtn('fa-list', 'عرض المهام', `app.ixSaveForm('issues',${esc(JSON.stringify(map))},{toast:false});app.ixIssueList()`)}</div>
            <div id="ix-is-list"></div>`, 'fa-list-check')
            + card('من الكود إلى المهام', `<div class="gh-row">${pbtn('fa-magnifying-glass', 'افحص TODO / FIXME', 'app.ixTodoScan()')}</div><div id="ix-is-todos"></div><div id="ix-is-res"></div>`, 'fa-code');
    };

    // ---------------------------------------------------------------- #986 / #999 webhooks (event bus over GitHub API calls)
    P.ixHooksList = function () { return this.ixCfg('hooks').list || []; };
    P.ixHookAdd = function (url, events, name) {
        url = String(url || (document.getElementById('ix-hk-url') || {}).value || '').trim();
        const kind = hookKind(url);
        if (!kind) { this.showToast('رابط Webhook غير صالح (يجب أن يبدأ بـ https://)', 'warning'); return null; }
        events = events || [...document.querySelectorAll('.ix-hk-ev:checked')].map(e => e.value);
        if (!events.length) events = ['push'];
        const h = { id: uid('hk'), url, kind, events, name: name || (document.getElementById('ix-hk-name') || {}).value || kind, on: true };
        this.ixSave('hooks', { list: [...this.ixHooksList(), h] });
        this.ixBootSet('hooks', true);
        this.ixHooksInstall();
        if (document.getElementById('ixx-root')) this.ixRefresh();
        return h;
    };
    P.ixHookRemove = function (id) { const list = this.ixHooksList().filter(h => h.id !== id); this.ixSave('hooks', { list }); if (!list.length) this.ixBootSet('hooks', false); this.ixRefresh(); };
    P.ixHookToggle = function (id) { this.ixSave('hooks', { list: this.ixHooksList().map(h => (h.id === id ? { ...h, on: !h.on } : h)) }); this.ixRefresh(); };
    /** Deliver one payload to one hook. Zapier/Make/JSON get structured JSON; Discord/Slack get text. */
    P.ixHookSend = async function (h, payload) {
        const text = hookText(payload);
        const body = { source: 'ox-alpha', text, ...payload, at: new Date(payload.at || Date.now()).toISOString() };
        let ok = true, status = 0;
        try {
            if (h.kind === 'discord' || h.kind === 'slack') { await this.postWebhook({ type: h.kind, url: h.url }, text); status = 200; }
            else {
                // text/plain keeps it a CORS "simple request" (Zapier/Make parse the JSON body anyway)
                const res = await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) }).catch(() => fetch(h.url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(body) }));
                status = res.status; ok = res.type === 'opaque' || res.ok;
            }
        } catch (e) { ok = false; status = e.message; }
        const log = [{ id: h.id, name: h.name, event: payload.event, ok, status, at: Date.now() }, ...(this.ixCfg('hooks').log || [])].slice(0, 50);
        this.ixSave('hooks', { log });
        return ok;
    };
    P.ixEmit = async function (payload) {
        payload = { at: Date.now(), ...payload };
        const hooks = this.ixHooksList().filter(h => h.on !== false && (h.events || []).includes(payload.event));
        const res = await Promise.all(hooks.map(h => this.ixHookSend(h, payload)));
        return res.filter(Boolean).length;
    };
    P.ixHookTest = async function (id) {
        const h = this.ixHooksList().find(x => x.id === id);
        if (!h) return false;
        const ok = await this.ixHookSend(h, { event: 'test', repo: `${this.settings.githubOwner || 'owner'}/${this.settings.githubRepo || 'repo'}`, files: ['index.html'], at: Date.now() });
        this.showToast(ok ? '📨 أُرسل' : '❌ فشل الإرسال — تحقق من الرابط وسياسة CSP', ok ? 'success' : 'error');
        this.ixRefresh();
        return ok;
    };
    /** Wrap app.gh once: successful write calls become events (push bursts merged after 2.5s). */
    P.ixHooksInstall = function () {
        const proto = Object.getPrototypeOf(this);
        if (proto.gh.__ixHooked) return false;
        const orig = proto.gh;
        const wrapped = async function (path, opts = {}) {
            const res = await orig.call(this, path, opts);
            try {
                const ev = ghEvent(path, opts.method);
                if (ev && this.ixHooksList().length) {
                    if (ev.event === 'push') {
                        this._ixPushBuf = [...(this._ixPushBuf || []), { ...ev, at: Date.now() }];
                        clearTimeout(this._ixPushT);
                        this._ixPushT = setTimeout(() => { const buf = this._ixPushBuf || []; this._ixPushBuf = []; mergePush(buf).forEach(p => this.ixEmit(p)); }, 2500);
                    } else this.ixEmit({ ...ev, tag: (opts.body && opts.body.tag_name) || '', title: (opts.body && opts.body.title) || '', repo: ev.repo || (res && res.full_name) || '' });
                }
            } catch (e) { /* never break the API call */ }
            return res;
        };
        wrapped.__ixHooked = true;
        proto.gh = wrapped;
        return true;
    };
    P._ixBootFns.hooks = function () { this.ixHooksInstall(); };
    const hookTable = (app, kinds) => {
        const list = app.ixHooksList().filter(h => !kinds || kinds.includes(h.kind));
        return list.length ? table(['', 'الاسم', 'النوع', 'الأحداث', ''], list.map(h => [`<input type="checkbox" ${h.on !== false ? 'checked' : ''} onchange="${call('ixHookToggle', h.id)}">`, esc(h.name), esc(h.kind), esc((h.events || []).join(', ')), btn('fa-paper-plane', 'اختبار', call('ixHookTest', h.id)) + btn('fa-trash', '', call('ixHookRemove', h.id))])) : empty('لا توجد Webhooks بعد');
    };
    const addForm = (ph) => `<div class="gh-row">${field('ix-hk-name', 'الاسم', '')}${field('ix-hk-url', 'رابط Webhook', '', `dir="ltr" placeholder="${ph}"`)}</div>
        <div class="dvx-flags">${HOOK_EVENTS.filter(e => e[0] !== 'test').map(([v, l]) => `<label class="pfx-toggle"><input type="checkbox" class="ix-hk-ev" value="${v}" ${v === 'push' ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
        <div class="gh-row">${pbtn('fa-plus', 'إضافة', 'app.ixHookAdd()')}</div>`;
    P.ixHooks = async function () {
        const log = this.ixCfg('hooks').log || [];
        return card('Webhooks عند كل Push', `<p class="hv-dim">عند أي عملية كتابة إلى GitHub من OX-Alpha (رفع ملفات، أو commit، أو PR، أو إصدار، أو نشر Pages) يُرسل إشعار تلقائي إلى Discord أو Slack، أو JSON إلى أي رابط. تُدمج ملفات الدفعة الواحدة في إشعار واحد. الروابط من نطاقات غير مسموحة في CSP تُرسل بوضع no-cors.</p>
            ${addForm('https://discord.com/api/webhooks/… أو https://example.com/hook')}${hookTable(this)}`, 'fa-bolt')
            + card('سجل التسليم', log.length ? table(['الحالة', 'الوجهة', 'الحدث', 'متى'], log.slice(0, 15).map(l => [l.ok ? '✅' : '❌ ' + esc(l.status), esc(l.name), esc(l.event), esc(ago(l.at))])) : empty('لم يُرسل شيء بعد'), 'fa-clock-rotate-left');
    };
    P.ixZapier = async function () {
        return card('Zapier و Make', `<p class="hv-dim">أنشئ Zap باستخدام <b>Webhooks by Zapier → Catch Hook</b>، أو سيناريو في Make باستخدام <b>Custom webhook</b>، والصق الرابط هنا. يصل كل حدث بصيغة JSON منظمة تستطيع ربطها بأكثر من 6000 تطبيق (Google Sheets وGmail وNotion وTrello…). مثلاً: كل push يضيف صفاً في جدول.</p>
            ${addForm('https://hooks.zapier.com/hooks/catch/… أو https://hook.eu1.make.com/…')}${hookTable(this, ['zapier', 'make', 'json'])}`, 'fa-diagram-project')
            + card('شكل البيانات المرسلة', pre(JSON.stringify({ source: 'ox-alpha', event: 'push', text: hookText({ event: 'push', repo: 'owner/repo', branch: 'main', files: ['index.html', 'app.js'] }), repo: 'owner/repo', branch: 'main', files: ['index.html', 'app.js'], at: new Date().toISOString() }, null, 2)), 'fa-code');
    };
}
