/* Personal growth analytics: learning tracking (#914), learning paths (#927) + progress (#928), learning suggestions (#923),
   project recommendations (#924), certificates (#929), sharing achievements (#930), comparison with the average (#917),
   productivity suggestions (#918), conversation sentiment (#921). */
import { esc, call, btn, pbtn, card, empty, field, select, val, setHTML, lsGet, lsSet, uid, stats, table, bar, ago, fmtDate, DAY, dayKey, avg, sha256Hex, utf8, win } from './util.js';

// ------------------------------------------------------------------ PURE: sentiment (#921)
const POS = ['شكرا', 'شكراً', 'ممتاز', 'رائع', 'جميل', 'جيد', 'أحسنت', 'تمام', 'نجح', 'يعمل', 'اشتغل', 'مفيد', 'واضح', 'سعيد', 'أحب', 'عظيم', 'مذهل', 'perfect', 'great', 'thanks', 'thank', 'awesome', 'good', 'nice', 'works', 'love', 'excellent', 'cool', 'helpful', 'amazing', '👍', '🎉', '❤️', '😊', '🙏', '✅'];
const NEG = ['خطأ', 'مشكلة', 'لا يعمل', 'لايعمل', 'فشل', 'سيء', 'سيئ', 'معطل', 'مزعج', 'محبط', 'صعب', 'مستحيل', 'تعبت', 'غلط', 'عطل', 'ما زال', 'مازال', 'لم ينجح', 'bug', 'error', 'broken', 'fail', 'failed', 'wrong', 'bad', 'hate', 'annoying', 'stuck', 'crash', 'useless', 'terrible', 'still', '😡', '😤', '😞', '👎', '❌', '😭'];
const NEGATORS = ['لا', 'ليس', 'لم', 'لن', 'غير', 'not', "don't", 'no', 'never', "isn't", "doesn't"];
const has = (t, w) => (/^[\p{L}]/u.test(w) ? new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'iu').test(t) : t.includes(w));
export function sentiment(text) {
    const t = String(text || '').toLowerCase();
    let pos = 0, neg = 0;
    for (const w of POS) if (has(t, w)) { const negated = NEGATORS.some(n => new RegExp(`(^|[^\\p{L}])${n}\\s+${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(t)); if (negated) neg++; else pos++; }
    for (const w of NEG) if (has(t, w)) neg++;
    const bangs = (t.match(/[!؟?]{2,}/g) || []).length;
    neg += bangs * 0.5;
    const total = pos + neg;
    const score = total ? Math.round((pos - neg) / total * 100) / 100 : 0;
    return { score, pos, neg, label: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral', frustration: neg >= 2 || (bangs > 0 && neg > pos) };
}
/** Daily mood of the user's messages over the last N days. */
export function moodSeries(sessions, days = 30, now = Date.now()) {
    const since = now - days * DAY;
    const byDay = {}, worst = [];
    let n = 0, sum = 0, frustrated = 0;
    (sessions || []).forEach(s => (s.messages || []).forEach(m => {
        if (m.role !== 'user' || !m.timestamp || m.timestamp < since) return;
        const r = sentiment(m.content);
        const k = dayKey(m.timestamp);
        (byDay[k] = byDay[k] || []).push(r.score);
        n++; sum += r.score; if (r.frustration) { frustrated++; worst.push({ text: String(m.content).slice(0, 140), score: r.score, t: m.timestamp, session: s.title }); }
    }));
    const series = Object.entries(byDay).sort().map(([k, arr]) => ({ day: k, score: Math.round(avg(arr) * 100) / 100, n: arr.length }));
    return { series, average: n ? Math.round(sum / n * 100) / 100 : 0, messages: n, frustrated, worst: worst.sort((a, b) => a.score - b.score).slice(0, 5) };
}

// ------------------------------------------------------------------ PURE: learning paths (#927, #928)
export const LEARNING_PATHS = {
    frontend: { title: 'مطور واجهات Frontend', icon: '🎨', steps: [
        { id: 'html', title: 'HTML دلالي وإتاحة', keys: ['html', 'semantic', 'aria'], res: 'https://developer.mozilla.org/docs/Learn/HTML' },
        { id: 'css', title: 'CSS حديث: Flexbox و Grid', keys: ['css', 'flex', 'grid'], res: 'https://web.dev/learn/css' },
        { id: 'js', title: 'JavaScript الأساسيات', keys: ['javascript', 'js', 'function', 'array'], res: 'https://javascript.info' },
        { id: 'async', title: 'Async/Await و Fetch', keys: ['async', 'await', 'fetch', 'promise'], res: 'https://javascript.info/async' },
        { id: 'react', title: 'React والمكونات', keys: ['react', 'jsx', 'component', 'hook'], res: 'https://react.dev/learn' },
        { id: 'ts', title: 'TypeScript', keys: ['typescript', 'ts', 'interface', 'type'], res: 'https://www.typescriptlang.org/docs/' },
        { id: 'test', title: 'اختبار الواجهات', keys: ['test', 'vitest', 'jest', 'playwright'], res: 'https://vitest.dev/guide/' },
        { id: 'perf', title: 'الأداء و Web Vitals', keys: ['performance', 'lighthouse', 'lcp', 'cls'], res: 'https://web.dev/learn/performance' }] },
    backend: { title: 'مطور خلفيات Node.js', icon: '🛠️', steps: [
        { id: 'node', title: 'Node.js و npm', keys: ['node', 'npm', 'require', 'module'], res: 'https://nodejs.org/en/learn' },
        { id: 'http', title: 'HTTP و REST', keys: ['http', 'rest', 'api', 'endpoint'], res: 'https://developer.mozilla.org/docs/Web/HTTP' },
        { id: 'express', title: 'Express / Fastify', keys: ['express', 'fastify', 'middleware', 'route'], res: 'https://expressjs.com/' },
        { id: 'sql', title: 'قواعد البيانات SQL', keys: ['sql', 'postgres', 'mysql', 'query'], res: 'https://sqlbolt.com' },
        { id: 'auth', title: 'المصادقة و JWT', keys: ['auth', 'jwt', 'oauth', 'session'], res: 'https://jwt.io/introduction' },
        { id: 'test', title: 'اختبار الخلفية', keys: ['test', 'jest', 'supertest', 'mocha'], res: 'https://jestjs.io/docs/getting-started' },
        { id: 'docker', title: 'Docker والنشر', keys: ['docker', 'container', 'deploy', 'ci'], res: 'https://docs.docker.com/get-started/' }] },
    python: { title: 'Python وتحليل البيانات', icon: '🐍', steps: [
        { id: 'py', title: 'أساسيات Python', keys: ['python', 'py', 'def', 'list'], res: 'https://docs.python.org/3/tutorial/' },
        { id: 'numpy', title: 'NumPy', keys: ['numpy', 'array', 'np'], res: 'https://numpy.org/learn/' },
        { id: 'pandas', title: 'Pandas', keys: ['pandas', 'dataframe', 'csv'], res: 'https://pandas.pydata.org/docs/getting_started/' },
        { id: 'viz', title: 'التصوير البياني', keys: ['matplotlib', 'plot', 'chart', 'seaborn'], res: 'https://matplotlib.org/stable/tutorials/' },
        { id: 'ml', title: 'تعلم الآلة scikit-learn', keys: ['sklearn', 'scikit', 'model', 'regression'], res: 'https://scikit-learn.org/stable/tutorial/' },
        { id: 'api', title: 'FastAPI', keys: ['fastapi', 'flask', 'django'], res: 'https://fastapi.tiangolo.com/tutorial/' }] },
    devops: { title: 'DevOps و GitHub', icon: '🚀', steps: [
        { id: 'git', title: 'Git بعمق', keys: ['git', 'branch', 'merge', 'rebase'], res: 'https://git-scm.com/book' },
        { id: 'gh', title: 'GitHub والتعاون', keys: ['github', 'pull request', 'pr', 'review'], res: 'https://docs.github.com/get-started' },
        { id: 'ci', title: 'GitHub Actions', keys: ['actions', 'workflow', 'ci', 'yaml'], res: 'https://docs.github.com/actions' },
        { id: 'docker', title: 'Docker', keys: ['docker', 'dockerfile', 'image'], res: 'https://docs.docker.com/get-started/' },
        { id: 'k8s', title: 'Kubernetes', keys: ['kubernetes', 'k8s', 'pod', 'helm'], res: 'https://kubernetes.io/docs/tutorials/' },
        { id: 'observe', title: 'المراقبة والسجلات', keys: ['monitoring', 'logs', 'metrics', 'sentry'], res: 'https://opentelemetry.io/docs/' }] }
};
/** Steps done = manually checked OR evidenced by topics/skills/project files. */
export function pathProgress(path, { text = '', manual = {} } = {}) {
    const t = String(text).toLowerCase();
    const steps = path.steps.map(s => {
        const hits = s.keys.filter(k => has(t, k)).length;
        const auto = hits >= 2 || (hits >= 1 && s.keys.length <= 2);
        return { ...s, auto, manual: !!manual[s.id], done: !!manual[s.id] || auto };
    });
    const done = steps.filter(s => s.done).length;
    const next = steps.find(s => !s.done) || null;
    return { steps, done, total: steps.length, pct: Math.round(done / steps.length * 100), next, complete: done === steps.length };
}
/** Learning delta between two snapshots of the skill map: {name: xp}. */
export function learnDelta(prev, cur) {
    return Object.keys({ ...prev, ...cur }).map(k => ({ name: k, before: prev[k] || 0, now: cur[k] || 0, gain: (cur[k] || 0) - (prev[k] || 0) })).filter(r => r.gain !== 0 || r.now).sort((a, b) => b.gain - a.gain);
}
// ------------------------------------------------------------------ PURE: recommendations (#923, #924)
export const PROJECT_IDEAS = [
    { lang: 'JavaScript', level: 'مبتدئ', title: 'تطبيق مهام To-Do مع localStorage', skills: ['DOM', 'events', 'storage'] },
    { lang: 'JavaScript', level: 'متوسط', title: 'لوحة طقس تستهلك API مع رسوم بيانية', skills: ['fetch', 'async', 'charts'] },
    { lang: 'JavaScript', level: 'متقدم', title: 'محرر Markdown تعاوني بالوقت الحقيقي (WebRTC/CRDT)', skills: ['crdt', 'webrtc', 'architecture'] },
    { lang: 'TypeScript', level: 'متوسط', title: 'مكتبة مكونات UI مع اختبارات وتوثيق', skills: ['types', 'testing', 'storybook'] },
    { lang: 'TypeScript', level: 'متقدم', title: 'خادم GraphQL مع مصادقة وأذونات', skills: ['graphql', 'auth', 'db'] },
    { lang: 'Python', level: 'مبتدئ', title: 'سكربت لأتمتة تنظيم الملفات', skills: ['os', 'pathlib', 'cli'] },
    { lang: 'Python', level: 'متوسط', title: 'تحليل بيانات مفتوحة مع Pandas ولوحة تفاعلية', skills: ['pandas', 'viz', 'streamlit'] },
    { lang: 'Python', level: 'متقدم', title: 'API بـ FastAPI مع نموذج تعلم آلة', skills: ['fastapi', 'ml', 'docker'] },
    { lang: 'HTML', level: 'مبتدئ', title: 'موقع شخصي متجاوب مع وضع داكن', skills: ['html', 'css', 'responsive'] },
    { lang: 'CSS', level: 'متوسط', title: 'نظام تصميم بمتغيرات CSS وسمات', skills: ['tokens', 'theming', 'a11y'] },
    { lang: 'Go', level: 'متوسط', title: 'أداة CLI متزامنة لفحص الروابط', skills: ['goroutines', 'http', 'cli'] },
    { lang: 'Rust', level: 'متوسط', title: 'محلل ملفات سجلات سريع', skills: ['ownership', 'parsing', 'perf'] },
    { lang: 'SQL', level: 'متوسط', title: 'تصميم قاعدة بيانات متجر مع استعلامات تحليلية', skills: ['schema', 'joins', 'indexes'] }
];
export function recommendProjects(skills, limit = 4) {
    const top = (skills || []).slice(0, 3);
    const order = ['مبتدئ', 'متوسط', 'متقدم'];
    const out = [];
    for (const s of top) {
        const lvl = order.indexOf(s.level === 'خبير' ? 'متقدم' : s.level);
        const want = order[Math.min(2, Math.max(0, lvl + 1))];
        PROJECT_IDEAS.filter(p => p.lang === s.name).sort((a, b) => Math.abs(order.indexOf(a.level) - order.indexOf(want)) - Math.abs(order.indexOf(b.level) - order.indexOf(want))).slice(0, 2).forEach(p => out.push({ ...p, why: `يرفع مستواك في ${s.name} من ${s.level} إلى ${want}` }));
    }
    if (!out.length) PROJECT_IDEAS.filter(p => p.level === 'مبتدئ').slice(0, limit).forEach(p => out.push({ ...p, why: 'بداية مناسبة' }));
    return out.slice(0, limit);
}
// ------------------------------------------------------------------ PURE: productivity (#917, #918)
export const BENCHMARK = { activeMin: 120, sent: 15, edits: 25, tasksWeek: 8, streak: 5 };
export function compareToAverage(me, peers = []) {
    const keys = [['activeMin', 'دقائق نشاط يومياً'], ['sent', 'رسائل يومياً'], ['edits', 'تعديلات يومياً'], ['tasksWeek', 'مهام منجزة أسبوعياً'], ['streak', 'أيام متتالية'], ['commits', 'Commits أسبوعياً']];
    return keys.filter(([k]) => me[k] != null).map(([k, label]) => {
        const ref = peers.length && peers.some(p => p[k] != null) ? avg(peers.filter(p => p[k] != null).map(p => p[k])) : BENCHMARK[k];
        if (ref == null) return null;
        const diff = ref ? Math.round((me[k] - ref) / ref * 100) : 0;
        return { key: k, label, me: Math.round(me[k] * 10) / 10, avg: Math.round(ref * 10) / 10, diff, verdict: diff >= 15 ? 'above' : diff <= -15 ? 'below' : 'around', source: peers.length ? 'team' : 'benchmark' };
    }).filter(Boolean);
}
export function productivityTips({ hours = [], accuracy = null, overdue = 0, doing = 0, streak = 0, activeMin = 0, lateNight = 0, focusSessions = 0, frustrated = 0 } = {}) {
    const tips = [];
    const total = hours.reduce((a, b) => a + b, 0);
    if (total) {
        const peak = hours.indexOf(Math.max(...hours));
        tips.push({ icon: '⏰', text: `ذروة نشاطك حول الساعة ${peak}:00 — خصص هذا الوقت للمهام الصعبة وأجّل الاجتماعات.` });
        const night = hours.slice(0, 5).reduce((a, b) => a + b, 0);
        if (night / total > 0.2 || lateNight) tips.push({ icon: '🌙', text: 'نسبة كبيرة من عملك بعد منتصف الليل — النوم الكافي يحسّن التركيز ويقلل الأخطاء.' });
    }
    if (doing > 3) tips.push({ icon: '🎯', text: `لديك ${doing} مهام «قيد التنفيذ» معاً — قلّل التبديل بين المهام وأنهِ واحدة أولاً (حد WIP = 2).` });
    if (overdue > 0) tips.push({ icon: '⚠️', text: `${overdue} مهمة متأخرة — أعد تقدير مواعيدها أو قسّمها لمهام أصغر.` });
    if (accuracy != null && accuracy < 60) tips.push({ icon: '📏', text: `دقة تقديراتك ${accuracy}% — ضاعف تقديرك الأولي أو قسّم المهام الكبيرة.` });
    if (!focusSessions) tips.push({ icon: '🍅', text: 'جرّب جلسات تركيز Pomodoro (25 دقيقة) من شريط الأدوات لزيادة العمل العميق.' });
    if (streak < 3) tips.push({ icon: '🔥', text: 'ابنِ عادة يومية: 20 دقيقة يومياً أفضل من جلسة طويلة أسبوعياً.' });
    if (activeMin > 480) tips.push({ icon: '🧘', text: 'تعمل أكثر من 8 ساعات يومياً في المتوسط — خذ فواصل قصيرة كل ساعة لتجنب الإرهاق.' });
    if (frustrated >= 3) tips.push({ icon: '💡', text: 'رصدنا إحباطاً متكرراً في محادثاتك — عند التعثر 20 دقيقة اطلب مراجعة من زميل أو استخدم «اشرح الخطأ».' });
    return tips;
}
// ------------------------------------------------------------------ PURE: certificates (#929)
export function certificateSVG({ name, title, date, id, hash = '' }) {
    const e = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850" direction="rtl">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient><linearGradient id="gold" x1="0" x2="1"><stop offset="0" stop-color="#f5c542"/><stop offset="1" stop-color="#fde68a"/></linearGradient></defs>
<rect width="1200" height="850" fill="url(#g)"/><rect x="30" y="30" width="1140" height="790" fill="none" stroke="url(#gold)" stroke-width="6" rx="18"/><rect x="48" y="48" width="1104" height="754" fill="none" stroke="#f5c54255" stroke-width="2" rx="12"/>
<text x="600" y="170" text-anchor="middle" font-family="system-ui,Tahoma,sans-serif" font-size="64" font-weight="700" fill="url(#gold)">شهادة إتمام</text>
<text x="600" y="240" text-anchor="middle" font-family="system-ui,Tahoma,sans-serif" font-size="26" fill="#cbd5e1">تشهد OX-Alpha Workbench Pro بأن</text>
<text x="600" y="340" text-anchor="middle" font-family="system-ui,Tahoma,sans-serif" font-size="58" font-weight="700" fill="#ffffff">${e(name)}</text>
<line x1="330" y1="370" x2="870" y2="370" stroke="#f5c542" stroke-width="2"/>
<text x="600" y="440" text-anchor="middle" font-family="system-ui,Tahoma,sans-serif" font-size="26" fill="#cbd5e1">أتمّ بنجاح مسار</text>
<text x="600" y="510" text-anchor="middle" font-family="system-ui,Tahoma,sans-serif" font-size="44" font-weight="700" fill="#7dd3fc">${e(title)}</text>
<text x="600" y="620" text-anchor="middle" font-family="system-ui,Tahoma,sans-serif" font-size="24" fill="#94a3b8">${e(date)}</text>
<circle cx="600" cy="720" r="44" fill="url(#gold)"/><text x="600" y="734" text-anchor="middle" font-size="40">🏅</text>
<text x="80" y="790" font-family="ui-monospace,monospace" font-size="14" fill="#64748b" direction="ltr" text-anchor="start">ID ${e(id)} • SHA-256 ${e(hash.slice(0, 32))}</text></svg>`;
}

export function installGrowth(P) {
    const LEARN_KEY = 'ox_team_learn_v1', PATH_KEY = 'ox_team_path_v1', CERT_KEY = 'ox_team_certs_v1';
    const skillsNow = (app) => Object.fromEntries((app.skillMap ? app.skillMap() : []).map(s => [s.name, s.xp]));
    const learnText = (app) => {
        const t = app.topicStats ? app.topicStats(365) : { tech: [], words: [] };
        const parts = [...(t.tech || []).map(x => x[0]), ...(t.words || []).map(x => x[0]), ...(app.skillMap ? app.skillMap().map(s => s.name) : [])];
        app.virtualProjectFiles.forEach((f, p) => { parts.push(p); if (f && typeof f.content === 'string' && !f.dataUrl) parts.push(f.content.slice(0, 2000)); });
        return parts.join(' ');
    };

    // ------------------------------------------------------------------ LEARNING TRACKING (#914)
    P.tmLearnSnapshot = function (now = Date.now()) {
        const st = lsGet(LEARN_KEY, { snaps: [] });
        const k = dayKey(now);
        const cur = skillsNow(this);
        const topics = (this.topicStats ? this.topicStats(7, now).tech : []).slice(0, 10);
        st.snaps = st.snaps.filter(s => s.day !== k).concat({ day: k, t: now, skills: cur, topics }).slice(-60);
        lsSet(LEARN_KEY, st);
        return st.snaps;
    };
    P.tmLearn = async function () {
        const snaps = this.tmLearnSnapshot();
        const first = snaps.find(s => s.t >= Date.now() - 30 * DAY) || snaps[0];
        const cur = snaps[snaps.length - 1];
        const delta = learnDelta(first ? first.skills : {}, cur.skills);
        const skills = this.skillMap ? this.skillMap() : [];
        const topics = this.topicStats ? this.topicStats(30) : { tech: [] };
        const max = Math.max(1, ...skills.map(s => s.xp));
        return card('ما تعلمته مؤخراً', `${stats([['لغات/تقنيات', skills.length], ['أيام مسجلة', snaps.length], ['نمو آخر 30 يوماً', '+' + delta.reduce((n, d) => n + Math.max(0, d.gain), 0) + ' XP'], ['مواضيع هذا الشهر', (topics.tech || []).length]])}
            ${skills.length ? table(['المهارة', 'المستوى', 'XP', '', 'التقدم'], skills.slice(0, 12).map(s => { const d = delta.find(x => x.name === s.name); return [esc(s.name), esc(s.level), s.xp, bar(s.xp, max), d && d.gain ? `<span class="tmx-add">+${d.gain}</span>` : '—']; })) : empty('لا بيانات تعلم بعد — تحدّث مع الذكاء واكتب كوداً')}
            ${(topics.tech || []).length ? `<div><b>مواضيع تعلمتها هذا الشهر:</b> ${(topics.tech || []).slice(0, 12).map(([k, n]) => `<span class="fmx-tag">${esc(k)} ×${n}</span>`).join('')}</div>` : ''}`, 'fa-graduation-cap')
            + card('خط التعلم', snaps.length > 1 ? `<div class="tmx-spark">${snaps.slice(-30).map(s => { const v = Object.values(s.skills).reduce((a, b) => a + b, 0); return `<span style="height:${Math.max(4, Math.round(v / Math.max(1, ...snaps.map(x => Object.values(x.skills).reduce((a, b) => a + b, 0))) * 100))}%" title="${s.day}: ${v} XP"></span>`; }).join('')}</div>` : empty('ارجع غداً لترى تطورك — نسجل لقطة يومية تلقائياً'), 'fa-chart-line');
    };

    // ------------------------------------------------------------------ LEARNING PATH (#927) + PROGRESS (#928)
    P.tmPathState = function () { return lsGet(PATH_KEY, { path: null, manual: {}, custom: null, started: null }); };
    P.tmSetPath = function (id) { const st = this.tmPathState(); st.path = id; st.started = st.started && st.path === id ? st.started : Date.now(); lsSet(PATH_KEY, st); if (document.getElementById('tmx-sec')) this.tmRefresh(); return st; };
    P.tmToggleStep = function (stepId) { const st = this.tmPathState(); st.manual = { ...(st.manual || {}), [stepId]: !(st.manual || {})[stepId] }; lsSet(PATH_KEY, st); const pr = this.tmPathProgress(); if (pr && pr.complete) this.tmIssueCertificate(); if (document.getElementById('tmx-sec')) this.tmRefresh(); return st.manual[stepId]; };
    P.tmCurrentPath = function () { const st = this.tmPathState(); return st.path === 'custom' && st.custom ? st.custom : LEARNING_PATHS[st.path] || null; };
    P.tmPathProgress = function () { const p = this.tmCurrentPath(); return p ? pathProgress(p, { text: learnText(this), manual: this.tmPathState().manual || {} }) : null; };
    P.tmPath = async function () {
        const st = this.tmPathState(), path = this.tmCurrentPath(), pr = this.tmPathProgress();
        const choose = card('اختر مسارك', `<div class="tmx-paths">${Object.entries(LEARNING_PATHS).map(([id, p]) => `<button class="tmx-path-card ${st.path === id ? 'active' : ''}" onclick="${call('tmSetPath', id)}"><span>${p.icon}</span><b>${esc(p.title)}</b><small>${p.steps.length} خطوات</small></button>`).join('')}${st.custom ? `<button class="tmx-path-card ${st.path === 'custom' ? 'active' : ''}" onclick="${call('tmSetPath', 'custom')}"><span>✨</span><b>${esc(st.custom.title)}</b><small>مخصص</small></button>` : ''}</div>
            <div class="gh-row">${field('tm-path-goal', 'أو صِف هدفك وسيصمم الذكاء مساراً', '', 'placeholder="أريد أن أصبح مطور تطبيقات موبايل بـ Flutter"')}${btn('fa-robot', 'صمّم مساري', call('tmAIPath'))}</div>`, 'fa-route');
        if (!path) return choose;
        return choose + card(`${path.icon || '✨'} ${esc(path.title)} — ${pr.pct}%`, `${bar(pr.done, pr.total, '', '#22c55e')}<div class="tmx-note">بدأت ${st.started ? ago(st.started) : '—'} • ${pr.done}/${pr.total} خطوات • الخطوات تُعلَّم تلقائياً عندما تظهر في محادثاتك ومشروعك، أو يدوياً.</div>
            <div class="tmx-steps">${pr.steps.map((s, i) => `<div class="tmx-step ${s.done ? 'done' : ''} ${pr.next && pr.next.id === s.id ? 'next' : ''}"><label><input type="checkbox" ${s.done ? 'checked' : ''} ${s.auto && !s.manual ? 'disabled title="مكتشفة تلقائياً"' : ''} onchange="${call('tmToggleStep', s.id)}"> <b>${i + 1}. ${esc(s.title)}</b></label>${s.auto ? ' <span class="fmx-tag">🤖 مكتشفة</span>' : ''}${s.res ? ` <a href="${esc(s.res)}" target="_blank" rel="noopener">📖 المصدر</a>` : ''}${pr.next && pr.next.id === s.id ? ` ${btn('fa-chalkboard-user', 'علّمني', call('tmTeachStep', s.id))}` : ''}</div>`).join('')}</div>
            ${pr.complete ? `<div class="gh-row">${pbtn('fa-award', 'استلم شهادتك', call('tmIssueCertificate'))}</div>` : ''}<div id="tm-teach"></div>`, 'fa-list-check');
    };
    P.tmAIPath = async function (goal = val('tm-path-goal')) {
        if (!goal) return null;
        const r = await this.tmAI(`Design a practical learning path for this goal: "${goal}". Return JSON {"title": "Arabic short title", "steps": [{"id": "s1", "title": "Arabic step title", "keys": ["3-4 lowercase english keywords that indicate this skill was practiced"], "res": "one free official resource URL"}]} with 5-8 steps.`, { json: true });
        if (!r || !Array.isArray(r.steps)) return null;
        const st = this.tmPathState(); st.custom = { title: r.title || goal, icon: '✨', steps: r.steps.map((s, i) => ({ id: s.id || 's' + i, title: s.title, keys: (s.keys || []).map(String), res: s.res || '' })) }; st.path = 'custom'; st.started = Date.now(); st.manual = {};
        lsSet(PATH_KEY, st);
        if (document.getElementById('tmx-sec')) this.tmRefresh();
        return st.custom;
    };
    P.tmTeachStep = async function (id) {
        const p = this.tmCurrentPath(); const s = p && p.steps.find(x => x.id === id);
        if (!s) return null;
        this.tmBusy('tm-teach', 'OX-AI يحضّر الدرس…');
        const out = await this.tmAI(`Teach me "${s.title}" as a short practical lesson (Arabic): key concepts, a small code example, and one hands-on exercise I can do in my project.`, { kind: 'coding', maxTokens: 2000 });
        setHTML('tm-teach', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };

    // ------------------------------------------------------------------ SUGGESTIONS (#923) + PROJECT RECOMMENDATIONS (#924)
    P.tmLearnSuggestions = function () {
        const skills = this.skillMap ? this.skillMap() : [];
        const out = [];
        const pr = this.tmPathProgress();
        if (pr && pr.next) out.push({ icon: '🧭', text: `الخطوة التالية في مسارك: ${pr.next.title}`, res: pr.next.res });
        const used = new Set(); this.virtualProjectFiles.forEach((f, p) => used.add((p.split('.').pop() || '').toLowerCase()));
        skills.filter(s => s.level === 'مبتدئ' && s.files > 0).slice(0, 2).forEach(s => out.push({ icon: '📈', text: `تستخدم ${s.name} في مشروعك لكن مستواك «مبتدئ» — خصص وقتاً لتعميقه.` }));
        const errs = (this.getErrorLog ? this.getErrorLog() : []) || [];
        if (errs.some(e => /undefined|null|cannot read/i.test(String(e.message || e)))) out.push({ icon: '🛡️', text: 'تتكرر أخطاء undefined/null — تعلّم Optional chaining و TypeScript strict.', res: 'https://www.typescriptlang.org/tsconfig#strict' });
        if (![...this.virtualProjectFiles.keys()].some(p => /\.(test|spec)\./.test(p))) out.push({ icon: '🧪', text: 'لا توجد اختبارات في مشروعك — تعلّم كتابة اختبارات الوحدة.', res: 'https://vitest.dev/guide/' });
        if (!used.has('ts') && used.has('js')) out.push({ icon: '🔷', text: 'مشروعك JavaScript — الانتقال إلى TypeScript يقلل الأخطاء.', res: 'https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html' });
        if (!skills.length) out.push({ icon: '🌱', text: 'ابدأ بمسار تعلم من «مسار التعلم».' });
        return out;
    };
    P.tmLearnSuggest = async function () {
        const sugg = this.tmLearnSuggestions();
        const recs = recommendProjects(this.skillMap ? this.skillMap() : []);
        this._tmMount = () => this.tmLoadOSS();
        return card('اقتراحات تعلم لك', sugg.map(s => `<div class="gh-item"><span>${s.icon} ${esc(s.text)}</span>${s.res ? `<a href="${esc(s.res)}" target="_blank" rel="noopener">📖</a>` : ''}</div>`).join('') + `<div class="gh-row">${btn('fa-robot', 'اقتراحات مخصصة بالذكاء', call('tmAILearnSuggest'))}</div><div id="tm-ls-ai"></div>`, 'fa-lightbulb')
            + card('مشاريع مقترحة لك', recs.map(p => `<div class="tmx-market"><div><b>${esc(p.title)}</b> <small>${esc(p.lang)} • ${esc(p.level)}</small><div><small>${esc(p.why)}</small></div>${p.skills.map(x => `<span class="fmx-tag">${esc(x)}</span>`).join('')}</div>${btn('fa-play', 'ابدأه', call('tmStartProject', p.title))}</div>`).join(''), 'fa-diagram-project')
            + card('ساهم في مشاريع مفتوحة المصدر', '<div id="tm-oss"></div>', 'fa-code-fork');
    };
    P.tmStartProject = function (title) { if (this.addTask) this.addTask(`مشروع تعلم: ${title}`, { notes: 'من توصيات التعلم' }); this.showToast('📋 أُضيف المشروع لمهامك', 'success'); return true; };
    P.tmAILearnSuggest = async function () {
        this.tmBusy('tm-ls-ai', '…');
        const skills = (this.skillMap ? this.skillMap() : []).slice(0, 8).map(s => `${s.name}:${s.level}`).join(', ');
        const topics = this.topicStats ? (this.topicStats(60).tech || []).slice(0, 10).map(x => x[0]).join(', ') : '';
        const out = await this.tmAI(`My skills: ${skills || 'unknown'}. Recent topics: ${topics || 'none'}. Suggest (Arabic) the 5 most valuable things to learn next, why, and one free resource each.`, { maxTokens: 1500 });
        setHTML('tm-ls-ai', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };
    P.tmLoadOSS = async function () {
        const top = ((this.skillMap ? this.skillMap() : [])[0] || {}).name || 'JavaScript';
        const lang = { JavaScript: 'javascript', TypeScript: 'typescript', Python: 'python', Go: 'go', Rust: 'rust', Java: 'java', PHP: 'php', Ruby: 'ruby', 'C#': 'csharp' }[top] || 'javascript';
        const r = await this.gh(`/search/issues?q=${encodeURIComponent(`label:"good first issue" language:${lang} state:open is:issue`)}&sort=created&order=desc&per_page=6`).catch(() => null);
        const items = (r && r.items) || [];
        setHTML('tm-oss', items.length ? items.map(i => `<div class="gh-item"><a href="${esc(i.html_url)}" target="_blank" rel="noopener">${esc(i.title)}</a><small dir="ltr">${esc((i.repository_url || '').replace('https://api.github.com/repos/', ''))}</small></div>`).join('') : empty(`لا نتائج الآن — ابحث عن «good first issue» بلغة ${esc(top)}`));
        return items;
    };

    // ------------------------------------------------------------------ CERTIFICATES (#929) + SHARE ACHIEVEMENTS (#930)
    P.tmCertificates = function () { return lsGet(CERT_KEY, []); };
    P.tmIssueCertificate = async function (opts = {}) {
        const path = opts.path || this.tmCurrentPath();
        const pr = opts.force ? { complete: true } : this.tmPathProgress();
        if (!path || !pr || !pr.complete) { this.showToast('أكمل كل خطوات المسار أولاً', 'info'); return null; }
        const certs = this.tmCertificates();
        const existing = certs.find(c => c.title === path.title);
        if (existing) return existing;
        const name = opts.name || (lsGet('ox_team_me_v1', {}) || {}).name || this.tmMeSync();
        const id = uid('cert').toUpperCase();
        const date = new Date().toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
        const hash = await sha256Hex(utf8(JSON.stringify({ id, name, title: path.title, date })));
        const cert = { id, name, title: path.title, date, hash, t: Date.now() };
        lsSet(CERT_KEY, [cert, ...certs]);
        if (this.addXP) this.addXP(100, 'certificate');
        if (this.confetti) this.confetti({ count: 120 });
        this.showToast(`🏅 مبروك! حصلت على شهادة «${this.escapeHTML(path.title)}»`, 'success');
        return cert;
    };
    P.tmCertSVG = function (id) { const c = this.tmCertificates().find(x => x.id === id); return c ? certificateSVG(c) : null; };
    P.tmDownloadCert = function (id) { const svg = this.tmCertSVG(id); if (!svg) return null; this.downloadBlob(new (win().Blob)([svg], { type: 'image/svg+xml' }), `certificate-${id}.svg`); return svg; };
    P.tmAchievementText = function () {
        const a = this.computeAchievements ? this.computeAchievements() : { list: [] };
        const earned = a.list.filter(x => x.earned);
        const g = this.progressInfo ? this.progressInfo() : null;
        const certs = this.tmCertificates();
        return `🏆 إنجازاتي على OX-Alpha Workbench Pro\n${g ? `⭐ المستوى ${g.level} (${g.xp} XP)\n` : ''}${earned.map(x => `${x.icon} ${x.title}`).join(' • ')}${certs.length ? `\n🎓 الشهادات: ${certs.map(c => c.title).join('، ')}` : ''}\n🔥 ${this.streak ? this.streak() : 0} يوم متواصل`;
    };
    P.tmShareAchievements = async function (target = 'copy') {
        const text = this.tmAchievementText();
        if (target === 'native' && navigator.share) { try { await navigator.share({ title: 'إنجازاتي', text }); return true; } catch (e) { /* cancelled */ } }
        if (target === 'channel') { const ch = await this.tmChannelList().catch(() => []); if (!ch[0]) { this.showToast('لا توجد قناة فريق', 'warning'); return false; } await this.tmSend(ch[0].id, text, { silent: true }); this.showToast('📣 شاركت إنجازاتك مع الفريق', 'success'); return true; }
        if (target === 'gist' && this.tmHasGH()) { const g = await this.gh('/gists', { method: 'POST', body: { description: 'إنجازاتي — OX-Alpha', public: true, files: { 'achievements.md': { content: text } } } }); this.copyToClipboard(g.html_url); this.showToast('🔗 نُشرت ونُسخ الرابط', 'success'); return g.html_url; }
        if (target === 'x') { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent(text.slice(0, 270)), '_blank', 'noopener'); return true; }
        if (target === 'linkedin') { window.open('https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(text), '_blank', 'noopener'); return true; }
        this.copyToClipboard(text);
        return text;
    };
    P.tmCerts = async function () {
        const certs = this.tmCertificates();
        const a = this.computeAchievements ? this.computeAchievements() : { list: [] };
        const pr = this.tmPathProgress();
        return card('شهاداتي', certs.length ? certs.map(c => `<div class="tmx-cert"><div class="tmx-cert-prev">${certificateSVG(c)}</div><div><b>🎓 ${esc(c.title)}</b><small>${esc(c.date)} • <code dir="ltr">${esc(c.id)}</code></small><div class="gh-row">${btn('fa-download', 'تحميل SVG', call('tmDownloadCert', c.id))}</div></div></div>`).join('') : empty(pr ? `أكمل مسار «${esc(this.tmCurrentPath().title)}» (${pr.pct}%) لتحصل على شهادة` : 'اختر مسار تعلم وأكمله لتحصل على شهادة موثقة'), 'fa-award')
            + card('إنجازاتي', `<div class="tmx-badges">${a.list.map(x => `<span class="tmx-badge ${x.earned ? '' : 'locked'}" title="${esc(x.desc)}">${x.icon} ${esc(x.title)}</span>`).join('')}</div>
                <pre class="tmx-share-text">${esc(this.tmAchievementText())}</pre>
                <div class="gh-row">${pbtn('fa-copy', 'نسخ', call('tmShareAchievements', 'copy'))}${btn('fa-share-nodes', 'مشاركة', call('tmShareAchievements', 'native'))}${btn('fa-hashtag', 'قناة الفريق', call('tmShareAchievements', 'channel'))}${btn('fa-x-twitter', 'X', call('tmShareAchievements', 'x'))}${btn('fa-linkedin', 'LinkedIn', call('tmShareAchievements', 'linkedin'))}${this.tmHasGH() ? btn('fa-github', 'Gist', call('tmShareAchievements', 'gist')) : ''}</div>`, 'fa-trophy');
    };

    // ------------------------------------------------------------------ PRODUCTIVITY (#917, #918)
    P.tmMyStats = function (days = 14) {
        const d = this.dailyStats ? this.dailyStats(days) : [];
        const tr = this.computeTaskReport ? this.computeTaskReport() : { doneWeek: 0 };
        return { activeMin: avg(d.map(x => x.active / 60)), sent: avg(d.map(x => x.sent)), edits: avg(d.map(x => x.edits)), tasksWeek: tr.doneWeek || 0, streak: this.streak ? this.streak() : 0 };
    };
    P.tmProductivity = async function () {
        const me = this.tmMyStats();
        let peers = [];
        if (this.tmHasGH() && this.tmTeam()) {
            const s = await this.tmMemberStats(7).catch(() => ({}));
            const login = this.tmMeSync();
            me.commits = (s[login] || {}).commits || 0;
            peers = Object.entries(s).filter(([l]) => l !== login).map(([, v]) => ({ commits: v.commits }));
        }
        const cmp = compareToAverage(me, peers);
        const h = this.activityByHour ? this.activityByHour(60) : { hours: [] };
        const tr = this.computeTaskReport ? this.computeTaskReport() : {};
        const mood = moodSeries(this.sessions, 30);
        const tips = productivityTips({ hours: h.hours, accuracy: tr.accuracy, overdue: (tr.overdue || []).length, doing: (this.tasks || []).filter(t => t.status === 'doing').length, streak: me.streak, activeMin: me.activeMin, focusSessions: (lsGet('ox_alpha_focus_v1', {}).sessions || 0), frustrated: mood.frustrated });
        return card('مقارنة مع المتوسط', table(['المقياس', 'أنت', 'المتوسط', 'الفرق'], cmp.map(r => [esc(r.label), r.me, r.avg + (r.source === 'team' ? ' 👥' : ''), `<span class="${r.verdict === 'above' ? 'tmx-add' : r.verdict === 'below' ? 'tmx-del' : ''}">${r.diff > 0 ? '+' : ''}${r.diff}%</span>`])) + `<div class="tmx-note">👥 = متوسط فريقك على GitHub، وإلا مرجع تقريبي لمطور نشط.</div>`, 'fa-scale-balanced')
            + card('ساعات نشاطك', h.hours.some(Boolean) ? `<div class="tmx-spark tmx-hours">${h.hours.map((v, i) => `<span style="height:${Math.round(v / Math.max(1, ...h.hours) * 100)}%" title="${i}:00 — ${v}"></span>`).join('')}</div><div class="tmx-axis"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>` : empty('لا بيانات'), 'fa-clock')
            + card('اقتراحات لتحسين إنتاجيتك', tips.map(t => `<div class="gh-item"><span>${t.icon} ${esc(t.text)}</span></div>`).join('') + `<div class="gh-row">${btn('fa-robot', 'خطة مخصصة بالذكاء', call('tmAIProductivity'))}</div><div id="tm-prod-ai"></div>`, 'fa-bolt');
    };
    P.tmAIProductivity = async function () {
        this.tmBusy('tm-prod-ai', '…');
        const me = this.tmMyStats(); const h = this.activityByHour ? this.activityByHour(60) : { hours: [] };
        const out = await this.tmAI(`My developer productivity data: ${JSON.stringify({ ...me, hours: h.hours })}. Give me (Arabic) a concise weekly plan with 5 concrete habits to be more productive.`, { maxTokens: 1200 });
        setHTML('tm-prod-ai', out ? `<div class="tmx-ai-out">${this.renderMarkdownSafe ? this.renderMarkdownSafe(out) : esc(out)}</div>` : empty('لم يصل رد', true));
        return out;
    };

    // ------------------------------------------------------------------ SENTIMENT (#921)
    P.tmSentiment = async function (opts = {}) {
        const days = opts.days || 30;
        const m = moodSeries(this.sessions, days);
        const face = (s) => (s > 0.2 ? '😊' : s < -0.2 ? '😟' : '😐');
        const perSession = (this.sessions || []).slice(0, 12).map(s => { const us = (s.messages || []).filter(x => x.role === 'user'); const sc = us.length ? avg(us.map(x => sentiment(x.content).score)) : 0; return { title: s.title || 'محادثة', score: Math.round(sc * 100) / 100, n: us.length }; }).filter(x => x.n);
        return card('مزاج محادثاتك', `${stats([['المتوسط', `${face(m.average)} ${m.average}`], ['رسائل محللة', m.messages], ['لحظات إحباط', m.frustrated]])}
            ${m.series.length ? `<div class="tmx-mood">${m.series.map(x => `<span class="${x.score > 0.2 ? 'pos' : x.score < -0.2 ? 'neg' : ''}" style="height:${Math.round(Math.abs(x.score) * 100) + 6}%" title="${x.day}: ${x.score} (${x.n})"></span>`).join('')}</div>` : empty('لا رسائل في هذه الفترة')}
            <div class="tmx-note">تحليل محلي بقاموس عربي/إنجليزي (لا يُرسل شيء) — المؤشر من −1 (سلبي) إلى +1 (إيجابي).</div>`, 'fa-face-smile')
            + card('حسب المحادثة', perSession.length ? table(['المحادثة', 'الرسائل', 'المزاج'], perSession.map(s => [esc(s.title), s.n, `${face(s.score)} ${s.score}`])) : empty('—'), 'fa-comments')
            + (m.worst.length ? card('لحظات الإحباط', m.worst.map(w => `<div class="gh-item"><span>😤 ${esc(w.text)}</span><small>${esc(w.session || '')} • ${ago(w.t)}</small></div>`).join('') + '<div class="tmx-note">💡 عند التعثر: قسّم المشكلة، اطلب «اشرح الخطأ»، أو استعن بزميل في قناة الفريق.</div>', 'fa-face-frown') : '');
    };
}
