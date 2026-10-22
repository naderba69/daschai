/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 5c: Insights (usage, activity, skills, code quality)
   Ideas implemented (THOUSAND_IDEAS.md):
     #892 weekly/monthly usage charts   #895 cheaper-model suggestions   #896 cost per chat
     #897 monthly invoice (print + CSV)   #899 cost forecast   #911 time tracking   #912 productivity
     #915 achievements   #916 progress chart   #919 daily report   #920 weekly report   #922 topics
     #925 skill map   #926 languages used   #901 project quality report   #902 complexity
     #903 refactor suggestions   #904 duplicate code   #908 test ratio   #910 quality score
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;
    const DAY = 864e5;
    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const sod = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const dkey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const usd = (n) => (P.formatUSD ? P.formatUSD(n) : '$' + (n || 0).toFixed(4));
    const mins = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}س ${m % 60}د` : `${m}د`; };

    // ------------------------------------------------------------------ USAGE ANALYTICS (#892, #895, #896, #897, #899)
    /** Bucket usage records by ISO week (Mon) or month. */
    P.usageBuckets = function (records = this.loadUsage(), unit = 'week', count = 12, now = Date.now()) {
        const out = [];
        const d = new Date(now);
        for (let i = count - 1; i >= 0; i--) {
            let from, to, label;
            if (unit === 'month') {
                from = new Date(d.getFullYear(), d.getMonth() - i, 1).getTime();
                to = new Date(d.getFullYear(), d.getMonth() - i + 1, 1).getTime();
                label = new Date(from).toLocaleDateString('ar', { month: 'short' });
            } else {
                const today = sod(now);
                const dow = (new Date(today).getDay() + 6) % 7; // Monday = 0
                from = today - dow * DAY - i * 7 * DAY;
                to = from + 7 * DAY;
                label = new Date(from).toLocaleDateString('ar', { day: 'numeric', month: 'numeric' });
            }
            const rs = records.filter(r => r.t >= from && r.t < to);
            out.push({ from, to, label, requests: rs.length, tokens: rs.reduce((n, r) => n + (r.pt || 0) + (r.ct || 0), 0), cost: rs.reduce((n, r) => n + (r.c || 0), 0) });
        }
        return out;
    };
    P.costPerChat = function (records = this.loadUsage()) {
        const map = new Map();
        records.forEach(r => {
            const k = r.s || '(بدون محادثة)';
            const e = map.get(k) || { sessionId: r.s || null, requests: 0, tokens: 0, cost: 0, last: 0, models: new Set() };
            e.requests++; e.tokens += (r.pt || 0) + (r.ct || 0); e.cost += r.c || 0; e.last = Math.max(e.last, r.t); e.models.add(r.m);
            map.set(k, e);
        });
        return Array.from(map.values()).map(e => {
            const s = e.sessionId && (this.sessions || []).find(x => x.id === e.sessionId);
            return { ...e, models: Array.from(e.models), title: s ? s.title : e.sessionId ? '(محادثة محذوفة)' : '(طلبات أدوات)' };
        }).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
    };
    /** Month-to-date projection + 14-day trend (#899). */
    P.forecastCost = function (records = this.loadUsage(), now = Date.now()) {
        const d = new Date(now);
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
        const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        const elapsed = Math.max(1, (now - monthStart) / DAY);
        const mtd = records.filter(r => r.t >= monthStart).reduce((n, r) => n + (r.c || 0), 0);
        const last14 = records.filter(r => r.t >= now - 14 * DAY).reduce((n, r) => n + (r.c || 0), 0) / 14;
        const remaining = daysInMonth - elapsed;
        const linear = mtd / elapsed * daysInMonth;
        const trend = mtd + last14 * remaining;
        const projected = (linear + trend) / 2;
        const budget = parseFloat(this.settings.monthlyBudget) || 0;
        return { mtd, daily: last14, linear, trend, projected, budget, overBudget: !!budget && projected > budget, daysLeft: Math.ceil(remaining) };
    };
    /** Suggest cheaper models with similar capability for the paid models you use most (#895). */
    P.suggestCheaperModels = function (records = this.loadUsage()) {
        const models = this.availableModels || [];
        const byModel = {};
        records.forEach(r => { if (r.c > 0) { const e = (byModel[r.m] = byModel[r.m] || { cost: 0, pt: 0, ct: 0 }); e.cost += r.c; e.pt += r.pt || 0; e.ct += r.ct || 0; } });
        return Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5).map(([id, u]) => {
            const cur = models.find(m => m.id === id);
            if (!cur) return null;
            const curPrice = (cur.pricing.prompt || 0) + (cur.pricing.completion || 0);
            const alts = models.filter(m => m.id !== id && m.context_length >= Math.min(cur.context_length, 32000) && (!cur.is_vision || m.is_vision) && (!cur.is_reasoning || m.is_reasoning || m.is_free) && ((m.pricing.prompt || 0) + (m.pricing.completion || 0)) < curPrice * 0.6)
                .map(m => ({ id: m.id, name: m.name, free: m.is_free, cost: u.pt * (m.pricing.prompt || 0) + u.ct * (m.pricing.completion || 0) }))
                .sort((a, b) => a.cost - b.cost || (b.free - a.free));
            const pick = alts.filter(a => !a.free).slice(0, 1).concat(alts.filter(a => a.free).slice(0, 1));
            return pick.length ? { model: id, name: cur.name, spent: u.cost, alternatives: pick.map(a => ({ ...a, saving: Math.max(0, u.cost - a.cost) })) } : null;
        }).filter(Boolean);
    };
    P.buildInvoice = function (ym, records = this.loadUsage()) {
        const [y, m] = ym.split('-').map(Number);
        const from = new Date(y, m - 1, 1).getTime(), to = new Date(y, m, 1).getTime();
        const rs = records.filter(r => r.t >= from && r.t < to);
        const byModel = {};
        rs.forEach(r => { const e = (byModel[r.m] = byModel[r.m] || { requests: 0, pt: 0, ct: 0, cost: 0, unknown: false }); e.requests++; e.pt += r.pt || 0; e.ct += r.ct || 0; e.cost += r.c || 0; if (r.cu) e.unknown = true; });
        const lines = Object.entries(byModel).map(([model, e]) => ({ model, ...e })).sort((a, b) => b.cost - a.cost);
        return { ym, from, to, lines, chats: this.costPerChat(rs).slice(0, 15), total: lines.reduce((n, l) => n + l.cost, 0), requests: rs.length, tokens: lines.reduce((n, l) => n + l.pt + l.ct, 0) };
    };
    P.invoiceCSV = function (inv) {
        const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
        return ['model,requests,prompt_tokens,completion_tokens,cost_usd'].concat(inv.lines.map(l => [q(l.model), l.requests, l.pt, l.ct, l.cost.toFixed(6)].join(','))).concat([`${q('TOTAL')},${inv.requests},,,${inv.total.toFixed(6)}`]).join('\n');
    };
    P.invoiceHTML = function (inv) {
        const esc = (x) => this.escapeHTML(x);
        const month = new Date(inv.from).toLocaleDateString('ar', { month: 'long', year: 'numeric' });
        return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>فاتورة ${esc(inv.ym)}</title><style>body{font-family:system-ui,Tahoma,sans-serif;padding:32px;color:#111}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:right}th{background:#f4f4f5}td.n{font-family:monospace;direction:ltr;text-align:left}.tot{font-size:1.3em;font-weight:700}.muted{color:#666;font-size:.85em}</style></head><body>
            <h1>فاتورة استهلاك الذكاء الاصطناعي</h1><div class="muted">OX-Alpha Workbench Pro — ${esc(month)} — صدرت ${new Date().toLocaleString('ar')}</div>
            <table><thead><tr><th>النموذج</th><th>الطلبات</th><th>رموز الإدخال</th><th>رموز الإخراج</th><th>التكلفة</th></tr></thead><tbody>
            ${inv.lines.map(l => `<tr><td class="n">${esc(l.model)}</td><td>${l.requests}</td><td>${l.pt.toLocaleString('en')}</td><td>${l.ct.toLocaleString('en')}</td><td class="n">$${l.cost.toFixed(4)}${l.unknown ? ' *' : ''}</td></tr>`).join('') || '<tr><td colspan="5">لا يوجد استهلاك</td></tr>'}
            </tbody></table><div class="tot">الإجمالي: $${inv.total.toFixed(4)}</div><div class="muted">${inv.requests} طلب • ${inv.tokens.toLocaleString('en')} رمز. * تكلفة تقديرية (السعر غير معروف). الأسعار حسب OpenRouter وقت الطلب.</div>
            <h3>أعلى المحادثات تكلفة</h3><table><tbody>${inv.chats.map(c => `<tr><td>${esc(c.title)}</td><td>${c.requests} طلب</td><td class="n">$${c.cost.toFixed(4)}</td></tr>`).join('')}</tbody></table></body></html>`;
    };
    P.printInvoice = function (ym) {
        const html = this.invoiceHTML(this.buildInvoice(ym));
        const w = window.open('', '_blank');
        if (!w) { this.downloadBlob(new Blob([html], { type: 'text/html' }), `invoice-${ym}.html`); return false; }
        w.document.open(); w.document.write(html); w.document.close();
        setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 300);
        return true;
    };
    P.downloadInvoiceCSV = function (ym) { this.downloadBlob(new Blob(['\ufeff' + this.invoiceCSV(this.buildInvoice(ym))], { type: 'text/csv' }), `ox-alpha-usage-${ym}.csv`); };

    // ------------------------------------------------------------------ ACTIVITY (#911, #912, #916)
    const ACT_KEY = 'ox_alpha_activity_v1';
    P.loadActivity = function () { return this._activity || (this._activity = lsGet(ACT_KEY, {})); };
    P.heartbeat = function (now = Date.now(), seconds = 30) {
        if (document.hidden || now - (this._lastInteraction || 0) > 120000) return false;
        const a = this.loadActivity(), k = dkey(now);
        a[k] = (a[k] || 0) + seconds;
        const keys = Object.keys(a).sort();
        while (keys.length > 400) delete a[keys.shift()];
        lsSet(ACT_KEY, a);
        return true;
    };
    /** Per-day stats derived from sessions, activity log, tasks and time tracking. */
    P.dailyStats = function (days = 30, now = Date.now()) {
        const act = this.loadActivity();
        const out = [];
        const msgs = [];
        (this.sessions || []).forEach(s => (s.messages || []).forEach(m => { if (m.timestamp) msgs.push(m); }));
        for (let i = days - 1; i >= 0; i--) {
            const from = sod(now) - i * DAY, to = from + DAY;
            const dm = msgs.filter(m => m.timestamp >= from && m.timestamp < to);
            const ai = dm.filter(m => m.role === 'assistant');
            out.push({
                from, key: dkey(from),
                active: act[dkey(from)] || 0,
                sent: dm.filter(m => m.role === 'user').length,
                replies: ai.length,
                code: ai.reduce((n, m) => n + ((m.content || '').match(/```/g) || []).length / 2, 0) | 0,
                edits: (this.activityLog || []).filter(e => e.t >= from && e.t < to).reduce((n, e) => n + (e.n || 1), 0),
                tasksDone: (this.tasks || []).filter(t => t.done && t.done >= from && t.done < to).length
            });
        }
        out.forEach(d => { d.score = Math.min(100, Math.round(d.active / 60 * 0.8 + d.sent * 2 + d.code * 3 + d.edits * 0.5 + d.tasksDone * 8)); });
        return out;
    };
    /** Messages per hour of day / weekday — "when am I most active?" (#465). */
    P.activityByHour = function (days = 90, now = Date.now()) {
        const hours = new Array(24).fill(0), weekdays = new Array(7).fill(0);
        const since = now - days * DAY;
        (this.sessions || []).forEach(s => (s.messages || []).forEach(m => {
            if (m.role !== 'user' || !m.timestamp || m.timestamp < since) return;
            const d = new Date(m.timestamp);
            hours[d.getHours()]++; weekdays[d.getDay()]++;
        }));
        const peak = hours.indexOf(Math.max(...hours));
        return { hours, weekdays, peakHour: hours[peak] ? peak : null, peakDay: weekdays.some(Boolean) ? weekdays.indexOf(Math.max(...weekdays)) : null };
    };
    P.streak = function (now = Date.now()) {
        const stats = this.dailyStats(120, now).reverse();
        let n = 0;
        for (let i = 0; i < stats.length; i++) {
            const d = stats[i];
            if (d.sent || d.active >= 300 || d.edits) n++;
            else if (i === 0) continue; // today not started yet
            else break;
        }
        return n;
    };

    // ------------------------------------------------------------------ SKILLS + TOPICS (#922, #925, #926)
    const LANG_ALIAS = { js: 'JavaScript', javascript: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TypeScript', py: 'Python', python: 'Python', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS', sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell', shell: 'Shell', ps1: 'PowerShell', powershell: 'PowerShell', json: 'JSON', yaml: 'YAML', yml: 'YAML', md: 'Markdown', markdown: 'Markdown', java: 'Java', kt: 'Kotlin', kotlin: 'Kotlin', swift: 'Swift', go: 'Go', golang: 'Go', rs: 'Rust', rust: 'Rust', c: 'C', h: 'C', cpp: 'C++', 'c++': 'C++', cc: 'C++', hpp: 'C++', cs: 'C#', csharp: 'C#', php: 'PHP', rb: 'Ruby', ruby: 'Ruby', dart: 'Dart', vue: 'Vue', svelte: 'Svelte', r: 'R', lua: 'Lua', dockerfile: 'Docker', docker: 'Docker', mermaid: 'Mermaid', graphql: 'GraphQL', gql: 'GraphQL', cobol: 'COBOL', fortran: 'Fortran', xml: 'XML', toml: 'TOML' };
    const TECH = ['react', 'next.js', 'vue', 'angular', 'svelte', 'node', 'express', 'django', 'flask', 'fastapi', 'laravel', 'spring', 'docker', 'kubernetes', 'github actions', 'git', 'sql', 'postgres', 'mysql', 'mongodb', 'redis', 'firebase', 'supabase', 'tailwind', 'bootstrap', 'api', 'rest', 'graphql', 'jwt', 'oauth', 'test', 'jest', 'pytest', 'ci/cd', 'aws', 'vercel', 'linux', 'regex', 'pandas', 'numpy', 'machine learning', 'llm', 'prompt', 'websocket', 'pwa', 'flutter', 'react native', 'typescript', 'python', 'javascript', 'css', 'html', 'performance', 'security', 'database', 'algorithm', 'قاعدة بيانات', 'واجهة', 'خوارزمية', 'اختبار', 'تصميم', 'أداء', 'أمان', 'نشر', 'تطبيق جوال', 'ذكاء اصطناعي'];
    P.skillMap = function () {
        const langs = {};
        const add = (l, n, src) => { const name = LANG_ALIAS[String(l).toLowerCase()]; if (!name) return; const e = (langs[name] = langs[name] || { name, blocks: 0, files: 0, lines: 0 }); e[src] += n; };
        (this.sessions || []).forEach(s => (s.messages || []).forEach(m => {
            const re = /```([\w+#.-]+)?\n([\s\S]*?)```/g;
            let x;
            while ((x = re.exec(m.content || ''))) { if (x[1]) { add(x[1], 1, 'blocks'); add(x[1], x[2].split('\n').length, 'lines'); } }
        }));
        this.virtualProjectFiles.forEach((f, p) => {
            const name = p.split('/').pop().toLowerCase();
            const ext = name === 'dockerfile' ? 'dockerfile' : name.includes('.') ? name.split('.').pop() : '';
            if (ext && f && typeof f.content === 'string' && !f.dataUrl) { add(ext, 1, 'files'); add(ext, f.content.split('\n').length, 'lines'); }
        });
        const list = Object.values(langs).map(l => ({ ...l, xp: l.blocks * 10 + l.files * 25 + Math.round(l.lines / 20) })).sort((a, b) => b.xp - a.xp);
        list.forEach(l => { l.level = l.xp >= 1500 ? 'خبير' : l.xp >= 500 ? 'متقدم' : l.xp >= 120 ? 'متوسط' : 'مبتدئ'; });
        return list;
    };
    const STOP = new Set('في من على إلى الى عن مع هذا هذه ذلك التي الذي ما ماذا كيف لماذا هل أن ان كان كل أو او ثم قد لا لم لن هو هي نحن انا أنا انت أنت لي لك به بها فيه عند بعد قبل حتى اريد أريد اعطني أعطني اكتب قم بعمل لكي كما يا ايضا أيضاً يمكن الكود كود the a an and or of to in on for is are with this that it be how what why can you me my i do use using make create write code please'.split(' '));
    P.topicStats = function (days = 90, now = Date.now()) {
        const since = now - days * DAY;
        const texts = [];
        (this.sessions || []).forEach(s => (s.messages || []).forEach(m => { if (m.role === 'user' && (m.timestamp || s.createdAt || 0) >= since) texts.push(String(m.content || '').toLowerCase()); }));
        const all = texts.join('\n');
        const tech = TECH.map(t => [t, (all.match(new RegExp('(^|[^\\p{L}])' + t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(?=$|[^\\p{L}])', 'gu')) || []).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 15);
        const words = {};
        all.replace(/```[\s\S]*?```/g, ' ').split(/[^\p{L}\p{N}+#.]+/u).forEach(w => { w = w.replace(/^[.]+|[.]+$/g, ''); if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) words[w] = (words[w] || 0) + 1; });
        return { tech, words: Object.entries(words).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 30), messages: texts.length };
    };

    // ------------------------------------------------------------------ ACHIEVEMENTS (#915)
    const ACHIEVEMENTS = [
        ['first-chat', '🌱', 'البداية', 'أرسل أول رسالة', (c) => c.sent >= 1],
        ['msgs-100', '💬', 'محاور', '100 رسالة', (c) => c.sent >= 100],
        ['msgs-1000', '🗣️', 'خبير الحوار', '1000 رسالة', (c) => c.sent >= 1000],
        ['streak-7', '🔥', 'أسبوع متواصل', 'نشاط 7 أيام متتالية', (c) => c.streak >= 7],
        ['streak-30', '🌋', 'شهر متواصل', 'نشاط 30 يوماً متتالية', (c) => c.streak >= 30],
        ['coder', '🧑‍💻', 'مبرمج', '50 كتلة كود', (c) => c.code >= 50],
        ['polyglot', '🌍', 'متعدد اللغات', 'استخدام 5 لغات برمجة', (c) => c.langs >= 5],
        ['project', '📁', 'صاحب مشروع', '10 ملفات في المشروع', (c) => c.files >= 10],
        ['tasks-10', '✅', 'منجز', 'إنهاء 10 مهام', (c) => c.tasksDone >= 10],
        ['tasks-100', '🏆', 'آلة إنتاج', 'إنهاء 100 مهمة', (c) => c.tasksDone >= 100],
        ['reviewer', '🔍', 'مراجع', 'حل 10 تعليقات كود', (c) => c.resolved >= 10],
        ['sharer', '🔗', 'متعاون', 'مشاركة محادثة أو مشروع', (c) => c.shares >= 1],
        ['artist', '🎨', 'رسام', 'رسم على السبورة', (c) => c.drawings >= 1],
        ['night-owl', '🦉', 'بومة الليل', 'رسالة بين 1 و 4 فجراً', (c) => c.night],
        ['saver', '💰', 'مقتصد', '50 طلباً بنماذج مجانية', (c) => c.free >= 50],
        ['focused', '⏳', 'مركّز', '10 ساعات عمل مسجلة', (c) => c.activeSec >= 36000]
    ];
    P.achievementContext = function () {
        let sent = 0, code = 0, night = false;
        (this.sessions || []).forEach(s => (s.messages || []).forEach(m => {
            if (m.role === 'user') { sent++; const h = new Date(m.timestamp || 0).getHours(); if (m.timestamp && h >= 1 && h < 4) night = true; }
            else code += (((m.content || '').match(/```/g) || []).length / 2) | 0;
        }));
        const usage = this.loadUsage ? this.loadUsage() : [];
        return {
            sent, code, night, streak: this.streak(),
            langs: this.skillMap().filter(l => l.name !== 'Markdown' && l.name !== 'JSON').length,
            files: this.virtualProjectFiles.size,
            tasksDone: (this.tasks || []).filter(t => t.status === 'done').length,
            resolved: (this.codeComments || []).filter(c => c.resolved).length,
            shares: this.loadShareRecords ? this.loadShareRecords().length : 0,
            drawings: ((this._wb && this._wb.items) || []).length,
            free: usage.filter(r => (r.c || 0) === 0 && !r.cu).length,
            activeSec: Object.values(this.loadActivity()).reduce((a, b) => a + b, 0)
        };
    };
    P.computeAchievements = function () {
        const ctx = this.achievementContext();
        const earned = lsGet('ox_alpha_achievements_v1', {});
        const fresh = [];
        const list = ACHIEVEMENTS.map(([id, icon, title, desc, test]) => {
            let ok = false;
            try { ok = !!test(ctx); } catch (e) {}
            if (ok && !earned[id]) { earned[id] = Date.now(); fresh.push({ id, icon, title }); }
            return { id, icon, title, desc, earned: earned[id] || null };
        });
        if (fresh.length) lsSet('ox_alpha_achievements_v1', earned);
        return { list, fresh, ctx };
    };
    P.checkAchievements = function () {
        const { fresh } = this.computeAchievements();
        fresh.slice(0, 2).forEach(a => this.showToast(`${a.icon} إنجاز جديد: <b>${this.escapeHTML(a.title)}</b>`, 'success'));
        return fresh;
    };

    // ------------------------------------------------------------------ PROJECT QUALITY (#901-#904, #908, #910)
    const CODE_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|py|java|kt|go|rs|c|cc|cpp|h|hpp|cs|php|rb|swift|dart|vue|svelte)$/i;
    const BRANCH_RE = /\b(if|elif|for|while|case|catch|except)\b|&&|\|\||\?\?|\?(?![.:])/g;
    P.analyzeFile = function (path, content) {
        const lines = String(content || '').split('\n');
        const isPy = /\.py$/i.test(path);
        const code = lines.filter(l => l.trim() && !/^\s*(\/\/|#|\*|\/\*)/.test(l));
        const complexity = code.reduce((n, l) => n + ((l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').match(BRANCH_RE) || []).length), 0);
        // Nesting depth
        let depth = 0, maxDepth = 0;
        if (isPy) lines.forEach(l => { if (l.trim()) maxDepth = Math.max(maxDepth, Math.floor((l.match(/^\s*/)[0].replace(/\t/g, '    ').length) / 4)); });
        else lines.forEach(l => { const s = l.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, ''); for (const ch of s) { if (ch === '{') maxDepth = Math.max(maxDepth, ++depth); else if (ch === '}') depth = Math.max(0, depth - 1); } });
        // Functions + their length
        const fnRe = isPy ? /^\s*(?:async\s+)?def\s+(\w+)/ : /(?:function\s*\*?\s*(\w+)\s*\(|(\w+)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|\w+\s*=>)|^\s*(?:async\s+|static\s+|public\s+|private\s+|protected\s+)*(\w+)\s*\([^)]*\)\s*\{)/;
        const fns = [];
        lines.forEach((l, i) => {
            const m = fnRe.exec(l);
            if (!m) return;
            const name = m[1] || m[2] || m[3];
            if (!name || /^(if|for|while|switch|catch|return|function)$/.test(name)) return;
            let end = i;
            if (isPy) {
                const ind = l.match(/^\s*/)[0].length;
                end = i + 1;
                while (end < lines.length && (!lines[end].trim() || lines[end].match(/^\s*/)[0].length > ind)) end++;
                end--;
                while (end > i && !lines[end].trim()) end--; // trailing blank lines are not part of the function
            } else {
                let d = 0, seen = false;
                for (let j = i; j < lines.length && j < i + 2000; j++) {
                    for (const ch of lines[j].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')) { if (ch === '{') { d++; seen = true; } else if (ch === '}') d--; }
                    if (seen && d <= 0) { end = j; break; }
                    if (!seen && j > i + 1) break;
                }
            }
            const body = lines.slice(i, end + 1);
            fns.push({ name, line: i + 1, length: end - i + 1, complexity: 1 + body.reduce((n, b) => n + ((b.match(BRANCH_RE) || []).length), 0) });
        });
        const todos = lines.reduce((n, l) => n + (/\b(TODO|FIXME|HACK|XXX)\b/.test(l) ? 1 : 0), 0);
        return { path, lines: lines.length, code: code.length, complexity, maxDepth, functions: fns.length, longFunctions: fns.filter(f => f.length > 60), complexFunctions: fns.filter(f => f.complexity > 12), fns, todos, isTest: /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.\w+$|(^|\/)test_\w+\.py$/i.test(path) };
    };
    /** Exact duplicate 6-line windows (normalized) across files (#904). */
    P.findDuplicates = function (files, windowSize = 6) {
        const seen = new Map();
        files.forEach(([path, content]) => {
            const lines = String(content).split('\n').map((l, i) => [l.trim().replace(/\s+/g, ' '), i + 1]).filter(([l]) => l.length > 3 && !/^[{}()[\];,]+$/.test(l) && !/^(\/\/|#|import |from |export \{|\*)/.test(l));
            for (let i = 0; i + windowSize <= lines.length; i++) {
                const key = lines.slice(i, i + windowSize).map(x => x[0]).join('\n');
                if (key.length < 120) continue;
                const arr = seen.get(key) || [];
                if (!arr.some(a => a.path === path && Math.abs(a.line - lines[i][1]) < windowSize)) arr.push({ path, line: lines[i][1] });
                seen.set(key, arr);
            }
        });
        const groups = [];
        const covered = new Set();
        seen.forEach((locs, key) => {
            if (locs.length < 2) return;
            const sig = locs.map(l => `${l.path}:${Math.floor(l.line / windowSize)}`).join('|');
            if (covered.has(sig)) return;
            covered.add(sig);
            groups.push({ locations: locs, snippet: key.split('\n').slice(0, 3).join('\n') });
        });
        return groups.slice(0, 50);
    };
    P.projectQualityReport = function () {
        const files = Array.from(this.virtualProjectFiles.entries()).filter(([p, f]) => CODE_EXT.test(p) && f && typeof f.content === 'string' && !f.dataUrl && f.content.length < 400000 && !/(^|\/)(node_modules|dist|build|vendor)\/|\.min\.js$/.test(p)).map(([p, f]) => [p, f.content]);
        const analyses = files.map(([p, c]) => this.analyzeFile(p, c));
        const src = analyses.filter(a => !a.isTest), tests = analyses.filter(a => a.isTest);
        const dupes = this.findDuplicates(files);
        const srcLines = src.reduce((n, a) => n + a.code, 0), testLines = tests.reduce((n, a) => n + a.code, 0);
        const fnCount = src.reduce((n, a) => n + a.functions, 0);
        const long = src.flatMap(a => a.longFunctions.map(f => ({ ...f, path: a.path })));
        const complex = src.flatMap(a => a.complexFunctions.map(f => ({ ...f, path: a.path })));
        const todos = analyses.reduce((n, a) => n + a.todos, 0);
        const deep = src.filter(a => a.maxDepth > 5);
        const big = src.filter(a => a.lines > 600);
        const testRatio = srcLines ? testLines / srcLines : 0;
        const per = (n) => (fnCount ? n / fnCount : 0);
        let score = 100;
        score -= Math.min(20, Math.round(per(complex.length) * 100));
        score -= Math.min(15, Math.round(per(long.length) * 80));
        score -= Math.min(15, dupes.length * 2);
        score -= Math.min(10, deep.length * 3);
        score -= Math.min(10, big.length * 3);
        score -= Math.min(5, Math.floor(todos / 3));
        score -= testRatio === 0 ? 15 : testRatio < 0.2 ? 8 : 0;
        score = Math.max(0, Math.min(100, score));
        const rec = [];
        if (!tests.length && src.length) rec.push(['fa-vial', 'لا توجد اختبارات — ابدأ باختبار الدوال الأساسية (اطلب من الذكاء توليدها).']);
        else if (testRatio < 0.2 && src.length) rec.push(['fa-vial', `نسبة الاختبارات منخفضة (${Math.round(testRatio * 100)}%) — الهدف 30% على الأقل.`]);
        if (complex.length) rec.push(['fa-diagram-project', `${complex.length} دالة معقدة (تعقيد > 12) — قسّمها إلى دوال أصغر، أبرزها: ${complex.sort((a, b) => b.complexity - a.complexity).slice(0, 3).map(f => `${f.name} (${f.complexity})`).join('، ')}.`]);
        if (long.length) rec.push(['fa-ruler-vertical', `${long.length} دالة طويلة (> 60 سطراً) — استخرج أجزاءها في دوال مسماة.`]);
        if (dupes.length) rec.push(['fa-clone', `${dupes.length} مقطع مكرر — انقل الكود المشترك إلى دالة/وحدة واحدة.`]);
        if (deep.length) rec.push(['fa-layer-group', `تداخل عميق في ${deep.length} ملف — استخدم الإرجاع المبكر (early return).`]);
        if (big.length) rec.push(['fa-file-lines', `${big.length} ملف كبير (> 600 سطر) — قسّمه حسب المسؤوليات.`]);
        if (todos) rec.push(['fa-list-check', `${todos} ملاحظة TODO/FIXME — حوّلها إلى مهام.`]);
        return {
            score, grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E',
            files: analyses.length, srcFiles: src.length, testFiles: tests.length, srcLines, testLines, testRatio, functions: fnCount,
            complexity: src.reduce((n, a) => n + a.complexity, 0), long, complex, dupes, todos, deep, big, analyses, recommendations: rec
        };
    };
    P.refactorFileAI = function (path) {
        const f = this.virtualProjectFiles.get(path);
        if (!f) return null;
        const a = this.analyzeFile(path, f.content);
        const issues = [...a.complexFunctions.map(x => `- الدالة ${x.name} (سطر ${x.line}) تعقيدها ${x.complexity}`), ...a.longFunctions.map(x => `- الدالة ${x.name} (سطر ${x.line}) طولها ${x.length} سطراً`), a.maxDepth > 5 ? `- عمق التداخل ${a.maxDepth}` : '', a.todos ? `- ${a.todos} TODO` : ''].filter(Boolean).join('\n');
        const prompt = `أعد هيكلة الملف \`${path}\` لتحسين قابلية القراءة والصيانة دون تغيير السلوك.\n\nالمشاكل المرصودة:\n${issues || '- (لا مشاكل كبيرة — حسّن التسمية والبنية)'}\n\nأعد الملف كاملاً في كتلة كود واحدة ثم اشرح التغييرات في نقاط.\n\n\`\`\`${path.split('.').pop()}\n${String(f.content).slice(0, 60000)}\n\`\`\``;
        this.closeModals();
        this.insertIntoInput(prompt);
        return prompt;
    };

    // ------------------------------------------------------------------ REPORTS (#919, #920)
    P.buildActivityReport = function (period = 'day', now = Date.now()) {
        const days = period === 'month' ? 30 : period === 'week' ? 7 : 1;
        const stats = this.dailyStats(days, now);
        const sum = (k) => stats.reduce((n, d) => n + d[k], 0);
        const from = stats[0].from;
        const usage = (this.loadUsage ? this.loadUsage() : []).filter(r => r.t >= from);
        const cost = usage.reduce((n, r) => n + (r.c || 0), 0);
        const doneTasks = (this.tasks || []).filter(t => t.done && t.done >= from);
        const touched = Array.from(new Set((this.activityLog || []).filter(e => e.t >= from).map(e => e.path)));
        const topics = this.topicStats(days, now).tech.slice(0, 5).map(([t]) => t);
        const title = period === 'month' ? `🗓️ التقرير الشهري (${new Date(from).toLocaleDateString('ar')} — ${new Date(now).toLocaleDateString('ar')})` : period === 'week' ? `📅 التقرير الأسبوعي (${new Date(from).toLocaleDateString('ar')} — ${new Date(now).toLocaleDateString('ar')})` : `📆 التقرير اليومي — ${new Date(now).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' })}`;
        return [
            title,
            `⏱️ وقت العمل: ${mins(sum('active'))} • 💬 رسائل: ${sum('sent')} • 🧩 كتل كود: ${sum('code')} • ✏️ تعديلات ملفات: ${sum('edits')}`,
            `✅ مهام منجزة: ${doneTasks.length}${doneTasks.length ? '\n' + doneTasks.slice(0, 10).map(t => `  - ${t.title}`).join('\n') : ''}`,
            touched.length ? `📁 ملفات عُدلت (${touched.length}): ${touched.slice(0, 8).join('، ')}${touched.length > 8 ? '…' : ''}` : '',
            `🤖 طلبات AI: ${usage.length} • التكلفة: ${usd(cost)}`,
            topics.length ? `🏷️ المواضيع: ${topics.join('، ')}` : '',
            `🔥 السلسلة: ${this.streak(now)} يوم`
        ].filter(Boolean).join('\n');
    };
    P.reportSummaryAI = async function (period) {
        const box = document.getElementById('ins-ai');
        if (!this.settings.apiKey?.trim() || !this.streamOpenRouter) { this.showToast('يلزم مفتاح OpenRouter', 'warning'); return null; }
        if (box) { box.style.display = ''; box.innerHTML = '<span class="live-step-spinner"></span>'; }
        try {
            const model = (this.routeForCategory && this.routeForCategory('chat')) || this.settings.selectedModel;
            const r = await this.streamOpenRouter({
                model, maxTokens: 700,
                messages: [{ role: 'user', content: `حوّل بيانات النشاط هذه إلى ملخص ${period === 'month' ? 'شهري' : period === 'week' ? 'أسبوعي' : 'يومي'} محفز وموجز بالعربية (Markdown): أبرز الإنجازات، ملاحظة عن الإنتاجية، و3 اقتراحات عملية للفترة القادمة.\n\n${this.buildActivityReport(period)}` }],
                onDelta: (c) => { if (box) box.innerHTML = this.renderMarkdownSafe(c); }
            });
            if (box) box.innerHTML = this.renderMarkdownSafe(r.content);
            return r.content;
        } catch (e) { if (box) box.innerHTML = `<span class="text-red">❌ ${this.escapeHTML(e.message)}</span>`; return null; }
    };

    // ------------------------------------------------------------------ PANEL
    const bars = (items, valueFn, labelFn, titleFn) => {
        const max = Math.max(1e-9, ...items.map(valueFn));
        return `<div class="hub-chart">${items.map(it => `<div class="hub-bar-col" title="${titleFn(it)}"><div class="hub-bar" style="height:${Math.max(2, Math.round(valueFn(it) / max * 100))}%"></div><span>${labelFn(it)}</span></div>`).join('')}</div>`;
    };
    P.openInsights = function (tab = 'usage') {
        this._insTab = tab;
        this.openPanel({
            title: 'التقارير والإحصاءات', icon: 'fa-chart-line',
            tabs: [['usage', 'fa-coins', 'التكاليف'], ['activity', 'fa-person-running', 'النشاط'], ['skills', 'fa-brain', 'المهارات'], ['quality', 'fa-medal', 'جودة المشروع'], ['reports', 'fa-file-lines', 'التقارير']].map(([id, icon, label]) => ({ id, icon, label, onclick: `app.openInsights('${id}')` })), activeTab: tab,
            body: '<div id="ins-root"></div>'
        });
        this.renderInsights();
    };
    P.renderInsights = function () {
        const root = document.getElementById('ins-root');
        if (!root) return;
        const esc = (x) => this.escapeHTML(x);
        const tab = this._insTab || 'usage';
        if (tab === 'usage') {
            const recs = this.loadUsage();
            const unit = this._insUnit || 'week';
            const b = this.usageBuckets(recs, unit, 12);
            const f = this.forecastCost(recs);
            const chats = this.costPerChat(recs).slice(0, 12);
            const cheaper = this.suggestCheaperModels(recs);
            const ym = this._insMonth || new Date().toISOString().slice(0, 7);
            const months = Array.from(new Set(recs.map(r => new Date(r.t).toISOString().slice(0, 7)).concat([new Date().toISOString().slice(0, 7)]))).sort().reverse();
            root.innerHTML = `<div class="hub-stats-grid">
                    <div class="hub-stat-card"><div class="hub-stat-title">هذا الشهر حتى الآن</div><div class="hub-stat-value">${usd(f.mtd)}</div><div class="hub-stat-sub">متوسط يومي ${usd(f.daily)}</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">التوقع لنهاية الشهر</div><div class="hub-stat-value" style="color:${f.overBudget ? 'var(--danger)' : 'inherit'}">${usd(f.projected)}</div><div class="hub-stat-sub">${f.budget ? `الميزانية $${f.budget}${f.overBudget ? ' — ستتجاوزها ⚠️' : ' ✅'}` : `${f.daysLeft} يوماً متبقية`}</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">إجمالي الطلبات</div><div class="hub-stat-value">${recs.length.toLocaleString('en')}</div><div class="hub-stat-sub">${this.formatTokens ? this.formatTokens(recs.reduce((n, r) => n + (r.pt || 0) + (r.ct || 0), 0)) : ''} رمز</div></div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-chart-column"></i> الاستهلاك ${unit === 'month' ? 'الشهري' : 'الأسبوعي'}
                    <span class="gh-spacer"></span><button class="fx-link ${unit === 'week' ? 'active' : ''}" onclick="app._insUnit='week'; app.renderInsights()">أسبوعي</button><button class="fx-link ${unit === 'month' ? 'active' : ''}" onclick="app._insUnit='month'; app.renderInsights()">شهري</button></div>
                    ${bars(b, x => x.cost || x.tokens / 1e6, x => x.label, x => `${x.label}: ${usd(x.cost)} • ${x.requests} طلب • ${x.tokens.toLocaleString('en')} رمز`)}
                    <div class="text-dim plat-help">${b.every(x => !x.cost) ? 'الأعمدة تمثل عدد الرموز (كل الاستهلاك مجاني).' : 'الأعمدة تمثل التكلفة بالدولار.'}</div></div>
                ${cheaper.length ? `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-piggy-bank"></i> وفّر المال — بدائل أرخص</div>${cheaper.map(c => `<div class="ins-cheaper"><div><b dir="ltr">${esc(c.name)}</b> <span class="text-dim">أنفقت ${usd(c.spent)}</span></div>${c.alternatives.map(a => `<div class="hub-model-row"><span class="truncate" dir="ltr">↳ ${esc(a.name)}${a.free ? ' 🆓' : ''}</span><span class="text-emerald">وفر ${usd(a.saving)}</span><button class="fx-link" onclick="app.settings.selectedModel=${JSON.stringify(a.id).replace(/"/g, '&quot;')}; app.persistSettings(); app.renderUIState(); app.showToast('تم اختيار النموذج','success')">استخدمه</button></div>`).join('')}</div>`).join('')}</div>` : ''}
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-comments-dollar"></i> التكلفة لكل محادثة</div>
                    ${chats.map(c => `<div class="hub-model-row"><span class="truncate">${c.sessionId && this.sessions.some(s => s.id === c.sessionId) ? `<a href="#" onclick="event.preventDefault(); app.closeModals(); app.switchSession ? app.switchSession('${c.sessionId}') : (app.activeSessionId='${c.sessionId}', app.renderUIState())">${esc(c.title)}</a>` : esc(c.title)}</span><span class="text-dim">${c.requests} طلب</span><span>${usd(c.cost)}</span></div>`).join('') || '<div class="text-dim plat-help">لا بيانات بعد.</div>'}</div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-file-invoice-dollar"></i> الفاتورة الشهرية</div>
                    <div class="gh-row"><select class="form-input-box" style="max-width:160px" onchange="app._insMonth=this.value">${months.map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${m}</option>`).join('')}</select>
                    <button class="sidebar-btn-util gh-btn" onclick="app.printInvoice(app._insMonth || '${ym}')"><i class="fa-solid fa-print"></i> طباعة / PDF</button><button class="sidebar-btn-util gh-btn" onclick="app.downloadInvoiceCSV(app._insMonth || '${ym}')"><i class="fa-solid fa-file-csv"></i> CSV</button></div></div>`;
        } else if (tab === 'activity') {
            const stats = this.dailyStats(30);
            const today = stats[stats.length - 1];
            const week = stats.slice(-7);
            const weeks = [];
            for (let i = 11; i >= 0; i--) { const slice = this.dailyStats(7, Date.now() - i * 7 * DAY); weeks.push({ from: slice[0].from, sent: slice.reduce((n, d) => n + d.sent, 0), active: slice.reduce((n, d) => n + d.active, 0) }); }
            const ach = this.computeAchievements();
            root.innerHTML = `<div class="hub-stats-grid">
                    <div class="hub-stat-card"><div class="hub-stat-title">وقت العمل اليوم</div><div class="hub-stat-value">${mins(today.active)}</div><div class="hub-stat-sub">الأسبوع ${mins(week.reduce((n, d) => n + d.active, 0))}</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">الإنتاجية اليوم</div><div class="hub-stat-value">${today.score}</div><div class="hub-stat-sub">متوسط الأسبوع ${Math.round(week.reduce((n, d) => n + d.score, 0) / 7)}</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">السلسلة</div><div class="hub-stat-value">🔥 ${this.streak()}</div><div class="hub-stat-sub">يوم متتالٍ</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">الإنجازات</div><div class="hub-stat-value">${ach.list.filter(a => a.earned).length}/${ach.list.length}</div><div class="hub-stat-sub">🏅</div></div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-bolt"></i> الإنتاجية اليومية (30 يوماً)</div>${bars(stats, d => d.score, d => new Date(d.from).getDate(), d => `${d.key}: ${d.score} • ${mins(d.active)} • ${d.sent} رسالة • ${d.code} كود • ${d.edits} تعديل • ${d.tasksDone} مهمة`)}</div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-chart-line"></i> التقدم الأسبوعي (12 أسبوعاً)</div>${bars(weeks, w => w.sent + w.active / 600, w => new Date(w.from).toLocaleDateString('ar', { day: 'numeric', month: 'numeric' }), w => `${w.sent} رسالة • ${mins(w.active)}`)}</div>
                ${(() => { const h = this.activityByHour(); const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; return `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-clock"></i> أكثر الأوقات نشاطاً${h.peakHour !== null ? ` <span class="text-dim">— الذروة ${h.peakHour}:00 • ${days[h.peakDay]}</span>` : ''}</div>${bars(h.hours.map((n, i) => ({ n, i })), x => x.n, x => (x.i % 3 === 0 ? x.i : ''), x => `${x.i}:00 — ${x.n} رسالة`)}</div>`; })()}
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-medal"></i> الإنجازات</div><div class="ach-grid">${ach.list.map(a => `<div class="ach ${a.earned ? 'earned' : ''}" title="${esc(a.desc)}${a.earned ? ' — ' + new Date(a.earned).toLocaleDateString('ar') : ''}"><span class="ach-icon">${a.icon}</span><b>${esc(a.title)}</b><small>${esc(a.desc)}</small></div>`).join('')}</div></div>`;
        } else if (tab === 'skills') {
            const skills = this.skillMap();
            const topics = this.topicStats();
            const maxXp = Math.max(1, ...skills.map(s => s.xp));
            const maxW = Math.max(1, ...topics.words.map(w => w[1]));
            root.innerHTML = `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-brain"></i> خريطة المهارات</div><div class="text-dim plat-help">محسوبة من كتل الكود في محادثاتك وملفات مشروعك.</div>
                    ${skills.map(s => `<div class="hub-model-row"><span class="truncate"><b>${esc(s.name)}</b> <small class="text-dim">${s.level}</small></span><div class="hub-model-bar"><i style="width:${Math.round(s.xp / maxXp * 100)}%"></i></div><span class="text-dim">${s.blocks} كتلة • ${s.files} ملف</span></div>`).join('') || '<div class="text-dim plat-help">لا كود بعد.</div>'}</div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-tags"></i> المواضيع التقنية (90 يوماً)</div><div class="topic-cloud">${topics.tech.map(([t, n]) => `<span class="topic-chip" style="font-size:${0.75 + Math.min(0.6, n / Math.max(1, topics.tech[0][1]) * 0.6)}rem">${esc(t)} <small>${n}</small></span>`).join('') || '<span class="text-dim">—</span>'}</div></div>
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-cloud"></i> أكثر الكلمات</div><div class="topic-cloud">${topics.words.map(([w, n]) => `<span class="topic-chip muted" style="opacity:${0.5 + n / maxW * 0.5}">${esc(w)}</span>`).join('') || '<span class="text-dim">—</span>'}</div><div class="text-dim plat-help">من ${topics.messages} رسالة.</div></div>`;
        } else if (tab === 'quality') {
            const r = this.projectQualityReport();
            this._qualityReport = r;
            const color = r.score >= 75 ? 'var(--success)' : r.score >= 50 ? 'var(--warning)' : 'var(--danger)';
            const worst = r.analyses.filter(a => !a.isTest).sort((a, b) => (b.complexity + b.longFunctions.length * 10) - (a.complexity + a.longFunctions.length * 10)).slice(0, 12);
            root.innerHTML = r.files ? `<div class="hub-stats-grid">
                    <div class="hub-stat-card"><div class="hub-stat-title">درجة الجودة</div><div class="hub-stat-value" style="color:${color}">${r.score} <small>${r.grade}</small></div><div class="hub-stat-sub">من 100</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">الكود</div><div class="hub-stat-value">${r.srcLines.toLocaleString('en')}</div><div class="hub-stat-sub">سطر في ${r.srcFiles} ملف • ${r.functions} دالة</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">الاختبارات</div><div class="hub-stat-value">${Math.round(r.testRatio * 100)}%</div><div class="hub-stat-sub">${r.testFiles} ملف اختبار</div></div>
                    <div class="hub-stat-card"><div class="hub-stat-title">التكرار</div><div class="hub-stat-value">${r.dupes.length}</div><div class="hub-stat-sub">مقطع مكرر • ${r.todos} TODO</div></div></div>
                ${r.recommendations.length ? `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-lightbulb"></i> توصيات</div>${r.recommendations.map(([i, t]) => `<div class="plat-rec"><i class="fa-solid ${i}"></i><span>${esc(t)}</span></div>`).join('')}</div>` : ''}
                <div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-file-code"></i> الملفات الأحوج للتحسين</div>
                    <div class="q-table"><div class="q-row q-head"><span>الملف</span><span>أسطر</span><span>تعقيد</span><span>تداخل</span><span>طويلة</span><span></span></div>
                    ${worst.map(a => `<div class="q-row"><span class="truncate" dir="ltr"><a href="#" onclick="event.preventDefault(); app.closeModals(); app.openProjectFile(app.ghVal(${this.ghRef(a.path)}))">${esc(a.path)}</a></span><span>${a.lines}</span><span class="${a.complexity > 60 ? 'text-red' : ''}">${a.complexity}</span><span class="${a.maxDepth > 5 ? 'text-amber' : ''}">${a.maxDepth}</span><span>${a.longFunctions.length}</span><span><button class="fx-link" onclick="app.refactorFileAI(app.ghVal(${this.ghRef(a.path)}))"><i class="fa-solid fa-wand-magic-sparkles"></i> أعد الهيكلة</button></span></div>`).join('')}</div></div>
                ${r.dupes.length ? `<div class="hub-section"><div class="hub-section-title"><i class="fa-solid fa-clone"></i> كود مكرر</div>${r.dupes.slice(0, 10).map(d => `<details class="sr-file"><summary dir="ltr">${d.locations.map(l => `${esc(l.path)}:${l.line}`).join(' ↔ ')}</summary><pre class="pv-code" dir="ltr">${esc(d.snippet)}…</pre></details>`).join('')}</div>` : ''}`
                : '<div class="gh-empty">لا توجد ملفات كود في المشروع — استورد مستودعاً أو ملفات أولاً.</div>';
        } else {
            const p = this._insPeriod || 'day';
            const text = this.buildActivityReport(p);
            this._insReportText = text;
            root.innerHTML = `<div class="gh-toolbar"><button class="fx-link ${p === 'day' ? 'active' : ''}" onclick="app._insPeriod='day'; app.renderInsights()">يومي</button><button class="fx-link ${p === 'week' ? 'active' : ''}" onclick="app._insPeriod='week'; app.renderInsights()">أسبوعي</button><button class="fx-link ${p === 'month' ? 'active' : ''}" onclick="app._insPeriod='month'; app.renderInsights()">شهري</button></div>
                <pre class="ins-report" dir="auto">${esc(text)}</pre>
                <div class="gh-toolbar"><button class="sidebar-btn-util gh-btn" onclick="app.copyText(app._insReportText, 'تم نسخ التقرير')"><i class="fa-solid fa-copy"></i> نسخ</button>
                    <button class="sidebar-btn-util gh-btn" onclick="app.reportSummaryAI('${p}')"><i class="fa-solid fa-wand-magic-sparkles"></i> ملخص بالذكاء</button>
                    ${this.sendToWebhook ? `<button class="sidebar-btn-util gh-btn" onclick="app.sendToWebhook(app._insReportText)"><i class="fa-solid fa-paper-plane"></i> إرسال للفريق</button>` : ''}</div>
                <div id="ins-ai" class="gh-card gh-md" style="display:none"></div>`;
        }
    };

    // ------------------------------------------------------------------ PALETTE + INIT
    const _origPalette = P.buildPaletteCommands;
    if (_origPalette) {
        P.buildPaletteCommands = function () {
            const self = this, S = 'التقارير';
            return _origPalette.call(this).concat([
                { section: S, icon: 'fa-coins', label: 'تحليل التكاليف والتوقعات', hint: 'Costs', run: () => self.openInsights('usage') },
                { section: S, icon: 'fa-person-running', label: 'النشاط والإنجازات', hint: 'Activity', run: () => self.openInsights('activity') },
                { section: S, icon: 'fa-brain', label: 'خريطة المهارات', hint: 'Skills', run: () => self.openInsights('skills') },
                { section: S, icon: 'fa-medal', label: 'تقرير جودة المشروع', hint: 'Quality', run: () => self.openInsights('quality') },
                { section: S, icon: 'fa-file-lines', label: 'التقرير اليومي / الأسبوعي', hint: 'Report', run: () => self.openInsights('reports') }
            ]);
        };
    }
    P.initSprint5Insights = function () {
        this._lastInteraction = Date.now();
        const touch = () => { this._lastInteraction = Date.now(); };
        ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, touch, { passive: true }));
        this._heartbeatTimer = setInterval(() => this.heartbeat(), 30000);
        setTimeout(() => { try { this.checkAchievements(); } catch (e) {} }, 6000);
        this._achTimer = setInterval(() => { try { this.checkAchievements(); } catch (e) {} }, 10 * 60000);
    };
    if (window.app) {
        try { window.app.initSprint5Insights(); } catch (e) { console.error('Sprint 5 insights init failed', e); }
    }
})();
