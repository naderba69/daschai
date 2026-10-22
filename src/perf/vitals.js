/* Lighthouse-style audit (#820), Core Web Vitals with attribution (#830), daily performance reports (#844),
   memory-leak detection (#848) and local usage analytics (#843). */
import { esc, call, card, empty, stats, table, pbtn, btn, fmtBytes, fmtMs, percentile, median, linreg, sparkline, rateBadge, rate, RATE_LABEL, mdTable, download, json, win } from './util.js';

// ------------------------------------------------------------------ PURE: scoring
/** Lighthouse v10 metric thresholds [good, poor] and weights. */
export const VITAL_TH = { fcp: [1800, 3000], lcp: [2500, 4000], tbt: [200, 600], cls: [0.1, 0.25], inp: [200, 500], si: [3400, 5800], ttfb: [800, 1800] };
export const VITAL_WEIGHTS = { fcp: 10, si: 10, lcp: 25, tbt: 30, cls: 25 };
/** 0..100 score for one metric: 100 at 0, 90 at "good", 50 at "poor", → 0 at 2.5× poor (piecewise linear). */
export function metricScore(v, [good, poor]) {
    if (v == null || isNaN(v)) return null;
    if (v <= good) return Math.round(100 - (v / good) * 10);
    if (v <= poor) return Math.round(90 - ((v - good) / (poor - good)) * 40);
    const end = poor * 2.5;
    return Math.max(0, Math.round(50 - ((v - poor) / (end - poor)) * 50));
}
/** Weighted performance score (missing metrics are skipped and weights renormalised). */
export function perfScore(m) {
    let sum = 0, w = 0;
    const parts = {};
    for (const [k, wt] of Object.entries(VITAL_WEIGHTS)) {
        const s = metricScore(m[k], VITAL_TH[k]);
        parts[k] = s;
        if (s != null) { sum += s * wt; w += wt; }
    }
    return { score: w ? Math.round(sum / w) : null, parts };
}
/** Static best-practice checks over a snapshot of the page. Each → { id, ok, title, fix, weight } */
export function auditChecks(s) {
    const c = (id, ok, title, fix, weight = 1) => ({ id, ok: !!ok, title, fix, weight });
    return [
        c('https', s.https, 'الموقع يعمل عبر HTTPS', 'انشر عبر HTTPS (Vercel يفعل ذلك تلقائياً)', 2),
        c('viewport', s.viewport, 'وسم viewport موجود', 'أضف <meta name="viewport" content="width=device-width, initial-scale=1">'),
        c('lang', s.lang, 'لغة الصفحة محددة (lang)', 'أضف lang="ar" إلى وسم html'),
        c('sw', s.sw, 'Service Worker مسجل (عمل دون اتصال)', 'سجّل sw.js', 2),
        c('manifest', s.manifest, 'ملف manifest مرتبط', 'أضف <link rel="manifest">'),
        c('icons', s.pngIcons, 'أيقونات PNG بمقاس 192 و512 (للتثبيت على Android)', 'أضف icons/icon-192.png و icon-512.png إلى manifest', 2),
        c('blocking', s.blockingScripts <= 3, `سكربتات تحجب العرض: ${s.blockingScripts}`, 'أضف defer/async أو حمّلها عند الحاجة', 2),
        c('dom', s.domNodes < 1500, `حجم DOM: ${s.domNodes} عنصر`, 'قلل العناصر الظاهرة (عرض افتراضي/كسول للقوائم الطويلة)', 1),
        c('images', s.imagesNoSize === 0, `صور بلا أبعاد: ${s.imagesNoSize}`, 'حدد width/height لتجنب إزاحة التخطيط (CLS)', 1),
        c('legacyimg', s.legacyImages === 0, `صور بصيغ قديمة كبيرة: ${s.legacyImages}`, 'حوّلها إلى WebP/AVIF من تبويب «السرعة»', 1),
        c('fontdisplay', s.fontDisplay, 'الخطوط تستعمل font-display: swap', 'أضف &display=swap لرابط Google Fonts'),
        c('preconnect', s.preconnect >= 1, `preconnect لمصادر خارجية: ${s.preconnect}`, 'أضف <link rel="preconnect"> لأهم النطاقات'),
        c('transfer', s.transfer == null || s.transfer < 600 * 1024, `حجم النقل الأولي: ${s.transfer == null ? '—' : fmtBytes(s.transfer)}`, 'قسّم الكود وأجّل غير الضروري', 2),
        c('longtasks', s.longTasks < 10, `مهام طويلة منذ الفتح: ${s.longTasks}`, 'انقل الأعمال الثقيلة إلى Web Worker', 1)
    ];
}
export function checksScore(checks) {
    const tot = checks.reduce((n, x) => n + x.weight, 0), ok = checks.filter(x => x.ok).reduce((n, x) => n + x.weight, 0);
    return tot ? Math.round(ok / tot * 100) : 100;
}
/** Total Blocking Time estimate from long-task durations (each task's time above 50ms). */
export const tbtFrom = (durations) => Math.round((durations || []).reduce((n, d) => n + Math.max(0, d - 50), 0));

/** Daily aggregate → summary row { day, n, lcp(p75), cls(p75), inp(p75), fcp, boot(median), lt, heap } */
export function dailyRows(daily) {
    return Object.keys(daily || {}).sort().map(day => {
        const r = daily[day];
        return { day, n: r.n || 0, lcp: percentile(r.lcp, 0.75), cls: percentile(r.cls, 0.75), inp: percentile(r.inp, 0.75), fcp: percentile(r.fcp, 0.75), boot: median(r.boot || []), lt: r.lt || 0, heap: median(r.heap || []) };
    });
}
/** Compare the latest day with the average of the previous 7 → [{ metric, now, before, change% , worse }] */
export function dailyTrend(rows) {
    if (rows.length < 2) return [];
    const last = rows[rows.length - 1], prev = rows.slice(-8, -1);
    return ['lcp', 'cls', 'inp', 'boot'].map(k => {
        const vals = prev.map(r => r[k]).filter(v => v != null);
        if (last[k] == null || !vals.length) return null;
        const before = vals.reduce((n, v) => n + v, 0) / vals.length;
        const change = before ? Math.round((last[k] - before) / before * 100) : 0;
        return { metric: k, now: last[k], before, change, worse: change > 15 };
    }).filter(Boolean);
}
/** Heap / DOM growth analysis over samples [{t, heap, nodes}] → { suspect, heapSlope (bytes/min), nodeSlope, r2, minutes, reasons[] } */
export function leakAnalysis(samples, { minMinutes = 10, heapPerMin = 512 * 1024, nodesPerMin = 40 } = {}) {
    const s = (samples || []).filter(x => x && x.t);
    if (s.length < 4) return { suspect: false, minutes: 0, heapSlope: 0, nodeSlope: 0, r2: 0, reasons: ['عينات غير كافية — اترك التطبيق مفتوحاً بضع دقائق'] };
    const t0 = s[0].t, xs = s.map(x => (x.t - t0) / 60000), minutes = xs[xs.length - 1];
    const hs = s.filter(x => x.heap != null);
    const h = hs.length >= 4 ? linreg(hs.map(x => (x.t - t0) / 60000), hs.map(x => x.heap)) : { b: 0, r2: 0 };
    const n = linreg(xs, s.map(x => x.nodes || 0));
    const reasons = [];
    if (h.b > heapPerMin && h.r2 > 0.6) reasons.push(`الذاكرة تنمو باستمرار بمعدل ${fmtBytes(Math.round(h.b))}/دقيقة (R²=${h.r2.toFixed(2)})`);
    if (n.b > nodesPerMin && n.r2 > 0.6) reasons.push(`عناصر DOM تزيد ${Math.round(n.b)} عنصر/دقيقة — نوافذ أو عناصر لا تُزال`);
    return { suspect: minutes >= minMinutes && reasons.length > 0, minutes: Math.round(minutes), heapSlope: Math.round(h.b), nodeSlope: Math.round(n.b * 10) / 10, r2: +(Math.max(h.r2, n.r2)).toFixed(2), reasons };
}
/** Sizes of the app's growing collections (arrays / Maps / Sets / plain objects) — a cheap "heap snapshot". */
export function collectionSizes(obj, limit = 25) {
    const out = [];
    for (const k of Object.keys(obj || {})) {
        let v; try { v = obj[k]; } catch (e) { continue; }
        if (!v || typeof v !== 'object' || (typeof Node !== 'undefined' && v instanceof Node)) continue;
        const size = Array.isArray(v) ? v.length : v instanceof Map || v instanceof Set ? v.size : Object.getPrototypeOf(v) === Object.prototype ? Object.keys(v).length : null;
        if (size != null) out.push({ key: k, size });
    }
    return out.sort((a, b) => b.size - a.size).slice(0, limit);
}
/** Growth between two collectionSizes snapshots. */
export const growth = (before, after) => after.map(a => { const b = (before || []).find(x => x.key === a.key); return { key: a.key, before: b ? b.size : 0, after: a.size, delta: a.size - (b ? b.size : 0) }; }).filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta);
/** Usage counters → top features [{ key, label, count }] */
export function topUsage(usage, n = 15) {
    const LABEL = { sendUserMessage: 'إرسال رسالة', createNewSession: 'محادثة جديدة', toggleCodeStudio: 'استوديو الكود', openGlobalSearch: 'البحث الشامل', openCommandPalette: 'لوحة الأوامر', startVoiceAgent: 'الوكيل الصوتي', openScanner: 'الماسح', openTasks: 'المهام', openWhiteboard: 'السبورة', openTeamHub: 'الفريق', openFilesMedia: 'الملفات والوسائط', openGitHubPro: 'GitHub', openAILab: 'مختبر AI', openPerfHub: 'الأداء والموبايل' };
    return Object.entries((usage && usage.counts) || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count, label: LABEL[key] || key.replace(/^panel:/, '🗔 ').replace(/^perf:/, '⚡ ').replace(/^action:/, '⌚ ') }));
}

export function installVitals(P) {
    P.pfPageSnapshot = function () {
        const d = document, s = this.getPerfStats ? this.getPerfStats() : {};
        const head = Array.from(d.head ? d.head.querySelectorAll('script[src]') : []);
        let manifest = null; try { manifest = this._pfManifest || null; } catch (e) {}
        return {
            https: (win().location && (win().location.protocol === 'https:' || /localhost|127\.0\.0\.1/.test(win().location.hostname))) || false,
            viewport: !!d.querySelector('meta[name="viewport"]'), lang: !!(d.documentElement.getAttribute('lang')),
            sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), manifest: !!d.querySelector('link[rel="manifest"]'),
            pngIcons: manifest ? (manifest.icons || []).some(i => /192/.test(i.sizes) && /png/.test(i.type)) && (manifest.icons || []).some(i => /512/.test(i.sizes) && /png/.test(i.type)) : !!d.querySelector('link[rel="icon"][type="image/png"]'),
            blockingScripts: head.filter(x => !x.async && !x.defer && x.type !== 'module').length,
            domNodes: s.domNodes || d.getElementsByTagName('*').length,
            imagesNoSize: Array.from(d.images || []).filter(i => !i.getAttribute('width') && !i.getAttribute('height') && !(i.style && i.style.width)).length,
            legacyImages: Array.from(d.images || []).filter(i => /\.(png|jpe?g|gif|bmp)(\?|$)/i.test(i.currentSrc || i.src || '') && (i.naturalWidth || 0) > 400).length,
            fontDisplay: Array.from(d.querySelectorAll('link[href*="fonts.googleapis"]')).every(l => /display=swap/.test(l.href)),
            preconnect: d.querySelectorAll('link[rel="preconnect"]').length,
            transfer: s.transfer || null, longTasks: s.longTasks || 0, longTaskMs: s.longTaskMs || 0
        };
    };
    P.pfAuditData = function () {
        const v = this.pfVitals ? this.pfVitals() : {}, s = this.getPerfStats ? this.getPerfStats() : {};
        const metrics = { fcp: v.fcp || null, lcp: v.lcp || null, cls: v.cls != null ? v.cls : null, tbt: s.longTaskMs != null ? Math.max(0, (s.longTaskMs || 0) - 50 * (s.longTasks || 0)) : null, si: s.domContentLoaded || null, inp: v.inp || null, ttfb: v.ttfb || null };
        const perf = perfScore(metrics), checks = auditChecks(this.pfPageSnapshot());
        return { metrics, perf, checks, best: checksScore(checks) };
    };
    P.pfAudit = async function () {
        try { const r = await fetch('/manifest.json', { cache: 'force-cache' }); if (r.ok) this._pfManifest = await r.json(); } catch (e) { /* offline / tests */ }
        const a = this.pfAuditData(), sc = (x) => `<div class="pfx-gauge pfx-${x == null ? 'na' : x >= 90 ? 'good' : x >= 50 ? 'ni' : 'poor'}"><b>${x == null ? '—' : x}</b></div>`;
        const names = { fcp: 'First Contentful Paint', lcp: 'Largest Contentful Paint', tbt: 'Total Blocking Time', cls: 'Cumulative Layout Shift', si: 'Speed Index (تقريبي)' };
        const rows = Object.keys(VITAL_WEIGHTS).map(k => [esc(names[k]), rateBadge(a.metrics[k], VITAL_TH[k], k === 'cls' ? (x) => x.toFixed(3) : fmtMs), a.perf.parts[k] == null ? '—' : a.perf.parts[k], VITAL_WEIGHTS[k] + '%']);
        const failed = a.checks.filter(c => !c.ok);
        return card('النتيجة', `<div class="pfx-gauges"><div>${sc(a.perf.score)}<small>الأداء</small></div><div>${sc(a.best)}<small>أفضل الممارسات + PWA</small></div></div>
                <p class="gh-muted">قياس حقيقي من جلستك الحالية (RUM) بنفس عتبات وأوزان Lighthouse. للحصول على 100: عالج البنود الحمراء أدناه.</p>`, 'fa-gauge-high')
            + card('المقاييس', table(['المقياس', 'القيمة', 'النقاط', 'الوزن'], rows), 'fa-chart-simple')
            + card(`الفحوص (${a.checks.length - failed.length}/${a.checks.length})`, `<ul class="pfx-checks">${a.checks.map(c => `<li class="${c.ok ? 'ok' : 'bad'}"><i class="fa-solid ${c.ok ? 'fa-circle-check' : 'fa-circle-xmark'}"></i> <span>${esc(c.title)}</span>${c.ok ? '' : `<small>${esc(c.fix)}</small>`}</li>`).join('')}</ul>
                <div class="gh-row">${btn('fa-copy', 'نسخ التقرير', call('pfCopyAudit'))}${btn('fa-wand-magic-sparkles', 'خطة تحسين بالذكاء', call('pfAuditAI'))}<a class="sidebar-btn-util gh-btn" href="https://pagespeed.web.dev/analysis?url=${encodeURIComponent(win().location ? win().location.origin : '')}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> PageSpeed Insights</a></div>`, 'fa-list-check');
    };
    P.pfAuditMarkdown = function () {
        const a = this.pfAuditData();
        return `# تقرير الأداء — ${new Date().toLocaleString('ar')}\n\nالأداء: **${a.perf.score ?? '—'}** • أفضل الممارسات: **${a.best}**\n\n` + mdTable(['المقياس', 'القيمة', 'النقاط'], Object.keys(VITAL_WEIGHTS).map(k => [k.toUpperCase(), a.metrics[k] ?? '—', a.perf.parts[k] ?? '—']))
            + '\n\n## بنود تحتاج إصلاحاً\n' + (a.checks.filter(c => !c.ok).map(c => `- ${c.title} — ${c.fix}`).join('\n') || '- لا شيء 🎉');
    };
    P.pfCopyAudit = function () { const md = this.pfAuditMarkdown(); this.copyText ? this.copyText(md, 'تم نسخ التقرير') : null; return md; };
    P.pfAuditAI = async function () {
        const r = await this.pfAI('هذا تقرير أداء لتطبيق ويب (SPA). اقترح خطة مرتبة حسب الأثر للوصول إلى 100 في Lighthouse مع أمثلة كود قصيرة:\n\n' + this.pfAuditMarkdown());
        if (r) this.openPanel({ title: 'خطة تحسين الأداء', icon: 'fa-wand-magic-sparkles', body: `<div class="gh-md">${this.renderMarkdownSafe(r)}</div>` });
        return r;
    };

    // ------------------------------------------------------------------ WEB VITALS (#830)
    P.pfWebVitals = function () {
        const v = this.pfVitals ? this.pfVitals() : {};
        const row = (name, key, th, fmt, attr, tip) => [`<b>${name}</b>`, rateBadge(v[key] || (key === 'cls' ? v.cls : null), th, fmt), RATE_LABEL[rate(v[key] || (key === 'cls' ? v.cls : null), th)], esc(attr || '—'), `<small>${tip}</small>`];
        return card('Core Web Vitals — هذه الجلسة', table(['المقياس', 'القيمة', 'التقييم', 'المصدر', 'كيف تحسّنه'], [
            row('LCP', 'lcp', VITAL_TH.lcp, fmtMs, v.lcpEl, 'حمّل أكبر عنصر أولاً (preload)، قلل CSS/JS المحجوب'),
            row('CLS', 'cls', VITAL_TH.cls, (x) => (+x).toFixed(3), v.clsSrc, 'احجز مساحة للصور والإعلانات والعناصر المتأخرة'),
            row('INP', 'inp', VITAL_TH.inp, fmtMs, v.inpName, 'قسّم المعالجات الطويلة، استعمل requestIdleCallback / Worker'),
            row('FCP', 'fcp', VITAL_TH.fcp, fmtMs, '', 'خفف ما قبل أول رسم: خطوط، CSS حرج مضمّن'),
            row('TTFB', 'ttfb', VITAL_TH.ttfb, fmtMs, '', 'CDN وتخزين مؤقت على الخادم')
        ]) + `<p class="gh-muted">FID (الإصدار القديم من INP): ${v.fid == null ? '— (لم يحدث تفاعل بعد)' : fmtMs(v.fid)} • عدد إزاحات التخطيط: ${v.shifts || 0}. تُحفظ القيم يومياً عند إغلاق التبويب.</p>
            <div class="gh-row">${btn('fa-rotate', 'تحديث', call('pfRefresh'))}${btn('fa-floppy-disk', 'حفظ عينة الآن', call('pfSaveDailyNow'))}</div>`, 'fa-heart-pulse');
    };
    P.pfSaveDailyNow = function () { const r = this.pfSaveDaily(); this.showToast('تم حفظ عينة اليوم', 'success'); if (this._pfx && this._pfx.sec === 'daily') this.pfRefresh(); return r; };

    // ------------------------------------------------------------------ DAILY REPORTS (#844)
    P.pfDailyRows = function () { let d = {}; try { d = JSON.parse(localStorage.getItem('ox_perf_daily_v1')) || {}; } catch (e) { d = {}; } return dailyRows(d); };
    P.pfDaily = function () {
        const rows = this.pfDailyRows(), trend = dailyTrend(rows);
        if (!rows.length) return card('التقارير اليومية', empty('لا بيانات بعد — تُسجل عينة عند كل إغلاق للتبويب. ' + btn('fa-floppy-disk', 'سجّل عينة الآن', call('pfSaveDailyNow'))), 'fa-calendar-day');
        const label = { lcp: 'LCP', cls: 'CLS', inp: 'INP', boot: 'الإقلاع' };
        return card('اتجاه اليوم مقابل متوسط الأسبوع', trend.length ? `<ul class="pfx-checks">${trend.map(t => `<li class="${t.worse ? 'bad' : 'ok'}"><i class="fa-solid ${t.change > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i> <span>${label[t.metric]}: ${t.change > 0 ? '+' : ''}${t.change}%</span>${t.worse ? '<small>تراجع ملحوظ — راجع آخر التغييرات</small>' : ''}</li>`).join('')}</ul>` : '<p class="gh-muted">يلزم يومان على الأقل للمقارنة.</p>', 'fa-arrow-trend-up')
            + card('LCP اليومي (p75)', sparkline(rows.map(r => r.lcp || 0)), 'fa-chart-line')
            + card('الأيام', table(['اليوم', 'جلسات', 'LCP p75', 'CLS p75', 'INP p75', 'الإقلاع', 'مهام طويلة', 'الذاكرة'], rows.slice(-14).reverse().map(r => [r.day, r.n, fmtMs(r.lcp), r.cls == null ? '—' : r.cls.toFixed(3), fmtMs(r.inp), fmtMs(r.boot), r.lt, r.heap ? fmtBytes(r.heap) : '—']))
                + `<div class="gh-row">${btn('fa-copy', 'نسخ Markdown', call('pfCopyDaily'))}${btn('fa-file-csv', 'CSV', call('pfDailyCSV'))}</div>`, 'fa-table');
    };
    P.pfDailyMarkdown = function () {
        const rows = this.pfDailyRows();
        return '# تقرير الأداء اليومي\n\n' + mdTable(['اليوم', 'جلسات', 'LCP', 'CLS', 'INP', 'الإقلاع', 'مهام طويلة'], rows.map(r => [r.day, r.n, r.lcp == null ? '—' : Math.round(r.lcp), r.cls == null ? '—' : r.cls.toFixed(3), r.inp == null ? '—' : Math.round(r.inp), r.boot == null ? '—' : Math.round(r.boot), r.lt]));
    };
    P.pfCopyDaily = function () { const md = this.pfDailyMarkdown(); if (this.copyText) this.copyText(md, 'تم النسخ'); return md; };
    P.pfDailyCSV = function () {
        const rows = this.pfDailyRows();
        const csv = 'day,sessions,lcp_p75,cls_p75,inp_p75,boot_median,long_tasks,heap\n' + rows.map(r => [r.day, r.n, r.lcp ?? '', r.cls ?? '', r.inp ?? '', r.boot ?? '', r.lt, r.heap ?? ''].join(',')).join('\n');
        download(this, 'ox-perf-daily.csv', csv, 'text/csv');
        return csv;
    };

    // ------------------------------------------------------------------ MEMORY LEAKS (#848)
    P.pfMemory = function () {
        const s = this.pfHeapSamples ? this.pfHeapSamples() : [];
        const a = leakAnalysis(s), now = collectionSizes(this);
        const g = this._pfSnap ? growth(this._pfSnap.sizes, now) : [];
        return card('التحليل', `<div class="pfx-verdict ${a.suspect ? 'bad' : 'ok'}"><i class="fa-solid ${a.suspect ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> ${a.suspect ? 'اشتباه تسريب ذاكرة' : 'لا مؤشرات تسريب'}</div>
                ${stats([['دقائق مراقبة', a.minutes], ['نمو الذاكرة/د', a.heapSlope ? fmtBytes(Math.max(0, a.heapSlope)) : '—'], ['نمو DOM/د', a.nodeSlope], ['عينات', s.length]])}
                ${a.reasons.length ? `<ul>${a.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`, 'fa-memory')
            + card('الذاكرة وعناصر DOM عبر الوقت', `${s.some(x => x.heap) ? sparkline(s.map(x => x.heap || 0)) : '<p class="gh-muted">المتصفح لا يكشف حجم الذاكرة (performance.memory متاح في Chrome فقط) — نراقب DOM:</p>'}${sparkline(s.map(x => x.nodes), { color: '#c58af9' })}
                <div class="gh-row">${btn('fa-plus', 'أخذ عينة الآن', call('pfSampleNow'))}${btn('fa-camera', 'لقطة للمجموعات', call('pfSnapCollections'))}</div>`, 'fa-chart-line')
            + card('أكبر مجموعات بيانات التطبيق' + (this._pfSnap ? ' — النمو منذ اللقطة' : ''), g.length ? table(['المفتاح', 'قبل', 'الآن', 'الزيادة'], g.slice(0, 12).map(x => [`<code>${esc(x.key)}</code>`, x.before, x.after, '+' + x.delta]))
                : table(['المفتاح', 'العناصر'], now.slice(0, 12).map(x => [`<code>${esc(x.key)}</code>`, x.size])), 'fa-layer-group');
    };
    P.pfSampleNow = function () { const r = this.pfSampleHeap(); this.pfRefresh(); return r; };
    P.pfSnapCollections = function () { this._pfSnap = { t: Date.now(), sizes: collectionSizes(this) }; this.showToast('📸 تم أخذ لقطة — استعمل التطبيق ثم ارجع لترى ما نما', 'info'); this.pfRefresh(); return this._pfSnap; };

    // ------------------------------------------------------------------ USAGE ANALYTICS (#843)
    P.pfUsagePanel = function () {
        const u = this.pfUsage ? this.pfUsage() : { counts: {}, days: {} }, top = topUsage(u), max = top.length ? top[0].count : 1;
        const days = Object.keys(u.days || {}).sort().slice(-30), totals = days.map(d => Object.values(u.days[d]).reduce((n, x) => n + x, 0));
        const off = this.settings.usageTracking === false;
        return card('الأكثر استعمالاً', top.length ? `<div class="pfx-bars">${top.map(t => `<div class="pfx-barrow"><span>${esc(t.label)}</span><div class="tmx-bar"><div style="width:${Math.max(3, Math.round(t.count / max * 100))}%"></div></div><b>${t.count}</b></div>`).join('')}</div>` : empty('لا بيانات بعد'), 'fa-ranking-star')
            + card('النشاط اليومي (30 يوماً)', sparkline(totals) + `<p class="gh-muted">${days.length ? days[0] + ' ← ' + days[days.length - 1] : ''}</p>`, 'fa-chart-area')
            + card('الخصوصية', `<p>العدّادات محلية بالكامل على جهازك ولا تُرسل لأي خادم.</p><label class="fmx-check"><input type="checkbox" ${off ? '' : 'checked'} onchange="app.pfSet('usageTracking', this.checked)"> تفعيل تتبع الاستخدام</label>
                <div class="gh-row">${btn('fa-file-export', 'تصدير JSON', call('pfExportUsage'))}${btn('fa-broom', 'مسح', call('pfClearUsage'))}</div>`, 'fa-user-shield');
    };
    P.pfExportUsage = function () { const u = this.pfUsage(); download(this, 'ox-usage.json', json(u), 'application/json'); return u; };
    P.pfClearUsage = function () { const u = this.pfUsage(); u.counts = {}; u.days = {}; this._pfUsageDirty = true; this.pfFlushUsage(); this.pfRefresh(); return true; };
}
