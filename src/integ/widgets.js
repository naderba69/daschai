/* ==============================================================================
   OX-Alpha — Sprint 14 widgets chunk (assets/studio/widgets-[hash].mjs), loaded when the browser is idle.
   Enhances the live DOM: chat tables → sortable/filterable/paged/exportable (#319), image runs → carousels (#318),
   long <select>s → searchable (#314), images → lazy + blur-up (#299), [data-lottie] icons (#280).
   Each feature can be switched off in Integrations → Components (ox_ix_v1.widgets).
   ============================================================================== */
import WIDGETS_CSS from './widgets.css';
import * as wlib from './wlib.js';

export const lib = wlib;
const DEFAULTS = { tables: true, carousel: true, dropdowns: true, progressive: true, lottie: true, lottieToasts: false };
export const widgetCfg = () => { try { return { ...DEFAULTS, ...((JSON.parse(localStorage.getItem('ox_ix_v1')) || {}).widgets || {}) }; } catch (e) { return { ...DEFAULTS }; } };

export function enhance(root, cfg = widgetCfg()) {
    const out = { tables: 0, carousels: 0, selects: 0, images: 0, lotties: 0 };
    if (!root || !root.querySelectorAll) return out;
    if (cfg.tables) root.querySelectorAll('.message-content table, .markdown-body table, table.ix-datatable').forEach(t => { if (wlib.enhanceTable(t)) out.tables++; });
    if (cfg.carousel) { out.carousels += wlib.autoCarousels(root); root.querySelectorAll('.ox-carousel:not([data-ox-carousel])').forEach(c => { if (wlib.enhanceCarousel(c)) out.carousels++; }); }
    if (cfg.dropdowns) root.querySelectorAll('select').forEach(s => { if (!s.closest('[data-no-enhance]') && wlib.enhanceSelect(s)) out.selects++; });
    if (cfg.progressive) out.images += wlib.progressiveImages(root);
    if (cfg.lottie) out.lotties += wlib.mountLotties(root);
    return out;
}

export function install(app) {
    const P = Object.getPrototypeOf(app);
    if (P.__oxWidgets) return P.__oxWidgets;
    if (typeof document !== 'undefined' && !document.getElementById('ox-widgets-css')) {
        const st = document.createElement('style');
        st.id = 'ox-widgets-css';
        st.textContent = WIDGETS_CSS;
        document.head.appendChild(st);
    }
    P.wgEnhance = function (root) { return enhance(root || document.body); };
    P.wgLib = () => wlib;
    P.wgLottie = function (el, name, opts) { const d = typeof name === 'string' ? wlib.LOTTIE_ICONS[name] : name; return d && el ? wlib.playLottie(el, d, opts) : null; };
    if (typeof document !== 'undefined' && document.body) {
        enhance(document.body);
        let queued = new Set(), scheduled = false;
        const flush = () => { scheduled = false; const roots = [...queued]; queued = new Set(); const cfg = widgetCfg(); roots.forEach(r => { if (r.isConnected) enhance(r, cfg); }); };
        const obs = new MutationObserver((muts) => {
            muts.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1 && !n.closest('.ox-tbar, .ox-carousel, .cm-editor, svg')) queued.add(n.parentElement || n); }));
            if (queued.size && !scheduled) { scheduled = true; (window.requestAnimationFrame || setTimeout)(flush); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        P._wgObserver = obs;
        // Optional: animated check on success toasts
        const _toast = P.showToast;
        if (_toast && !_toast.__oxWg) {
            const w = function (msg, type) {
                const r = _toast.apply(this, arguments);
                try {
                    if (type === 'success' && widgetCfg().lottieToasts) {
                        const t = document.querySelector('.toast:last-child, .toast-container > :last-child');
                        if (t && !t.querySelector('.ox-lt')) { const i = document.createElement('span'); i.className = 'ox-lt'; t.prepend(i); wlib.playLottie(i, wlib.LOTTIE_ICONS.check, { loop: false }); }
                    }
                } catch (e) { /* cosmetic */ }
                return r;
            };
            w.__oxWg = true;
            P.showToast = w;
        }
    }
    P.__oxWidgets = { lib: wlib, enhance };
    return P.__oxWidgets;
}
