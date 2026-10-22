/* Performance & Mobile hub shell: tabs/sections, settings helpers, AI helper, camera/file capture shared by the camera tools. */
import { esc, call, empty, win } from './util.js';

export const TAB_DEFS = {
    vitals: [['audit', 'تدقيق Lighthouse', 'pfAudit'], ['vitals', 'Web Vitals', 'pfWebVitals'], ['daily', 'تقارير يومية', 'pfDaily'], ['memory', 'تسريب الذاكرة', 'pfMemory'], ['usage', 'تتبع الاستخدام', 'pfUsagePanel']],
    speed: [['chunks', 'تقسيم الكود', 'pfChunks'], ['prefetch', 'التحميل المسبق', 'pfPrefetchPanel'], ['images', 'WebP / AVIF', 'pfImages'], ['compress', 'Gzip / Brotli', 'pfCompress'], ['worker', 'Web Worker', 'pfWorkerPanel']],
    data: [['db', 'قاعدة Dexie', 'pfDB'], ['storage', 'ضغط التخزين', 'pfStorage'], ['queries', 'تحسين الاستعلامات', 'pfQueries'], ['algo', 'تحسين الخوارزميات', 'pfAlgo']],
    search: [['instant', 'البحث الفوري', 'pfSearchPanel'], ['saved', 'المحفوظ والسجل', 'pfSavedSearches']],
    update: [['policy', 'سياسة التحديث', 'pfUpdatePolicy'], ['versions', 'الإصدارات والتراجع', 'pfVersions'], ['sync', 'المزامنة الخلفية', 'pfBgSync']],
    lab: [['bench', 'Benchmark', 'pfBench'], ['compare', 'قبل / بعد', 'pfBenchCompare'], ['bottleneck', 'عنق الزجاجة', 'pfBottleneck'], ['advice', 'ترقيات وبنية', 'pfAdvice'], ['forecast', 'توقع الحمل', 'pfForecast'], ['scale', 'التوسع والتوزيع', 'pfScale']],
    app: [['install', 'Android / iOS', 'pfInstall'], ['gestures', 'الإيماءات', 'pfGestures'], ['push', 'إشعارات Push', 'pfPush'], ['widgets', 'الودجات والمساعدات', 'pfWidgets'], ['watch', 'الساعة الذكية', 'pfWatch']],
    camera: [['card', 'بطاقة عمل', 'pfCard'], ['faces', 'كشف الوجوه', 'pfFaces'], ['objects', 'التعرف على الأشياء', 'pfObjects'], ['translate', 'ترجمة بالكاميرا', 'pfCamTranslate'], ['imgsearch', 'بحث بالصورة', 'pfImageSearch']],
    sensors: [['motion', 'الحركة والنشاط', 'pfMotion'], ['geo', 'البوصلة و GPS', 'pfGeo'], ['xr', 'AR / VR', 'pfXR']],
    audio: [['bgrec', 'تسجيل في الخلفية', 'pfBgRec'], ['player', 'تشغيل خلفي وشاشة القفل', 'pfPlayer'], ['voice', 'أوامر وبحث صوتي', 'pfVoice']],
    modes: [['kids', 'وضع الأطفال', 'pfKids'], ['driving', 'وضع القيادة', 'pfDriving'], ['brightness', 'السطوع', 'pfBrightness']]
};

export function installCore(P) {
    P.openPerfHub = async function (tab = 'vitals', sec, opts = {}) {
        if (!TAB_DEFS[tab]) tab = 'vitals';
        this.openPanel({
            title: 'الأداء والموبايل', icon: 'fa-gauge-high',
            tabs: (this.PERF_TABS || []).map(t => ({ ...t, onclick: `app.openPerfHub('${t.id}')` })), activeTab: tab,
            body: '<div id="pfx-root" class="fmx-root pfx-root"></div>'
        });
        return this.pfLoad(tab, sec, opts);
    };
    P.pfLoad = async function (tab, sec, opts = {}) {
        const defs = TAB_DEFS[tab] || TAB_DEFS.vitals;
        const def = defs.find(d => d[0] === sec) || defs.find(d => d[0] === ((this._pfSec || {})[tab])) || defs[0];
        this._pfSec = { ...(this._pfSec || {}), [tab]: def[0] };
        this._pfx = { tab, sec: def[0], opts };
        if (this._pfStop) { try { this._pfStop(); } catch (e) {} this._pfStop = null; } // leave a section → stop its camera/sensor/timers
        document.querySelectorAll('#ox-panel-tabs .gh-tab').forEach((b, i) => b.classList.toggle('active', ((this.PERF_TABS || [])[i] || {}).id === tab));
        const root = document.getElementById('pfx-root');
        if (!root) { await this.openPerfHub(tab, def[0], opts); return; }
        root.innerHTML = `<div class="ghx-subnav fmx-subnav">${defs.map(([id, label]) => `<button class="gh-chip ${id === def[0] ? 'active' : ''}" data-pf-sec="${id}" onclick="${call('pfLoad', tab, id)}">${label}</button>`).join('')}</div>
            <div id="pfx-sec" class="fmx-sec" data-pf-tab="${tab}" data-pf-sec="${def[0]}"><div class="gh-empty"><span class="live-step-spinner"></span></div></div>`;
        this.setPanelFooter('');
        this.pfTrack && this.pfTrack('perf:' + tab + '/' + def[0]);
        let html;
        try { html = await this[def[2]](opts); } catch (e) { console.error(e); html = empty('❌ ' + esc(e.message || e), true); }
        const el = document.getElementById('pfx-sec');
        if (el && el.dataset.pfSec === def[0] && el.dataset.pfTab === tab && html != null) {
            el.innerHTML = html;
            const m = this._pfMount; this._pfMount = null;
            if (typeof m === 'function') try { m(); } catch (e) { console.error(e); }
        }
        return el;
    };
    P.pfRefresh = function () { const c = this._pfx; return c ? this.pfLoad(c.tab, c.sec, c.opts) : this.openPerfHub(); };
    P.pfBusy = function (id, msg) { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="gh-empty"><span class="live-step-spinner"></span> ${msg || ''}</div>`; };
    P.pfErr = function (e, id) {
        const msg = (e && e.message) || String(e);
        if (id) { const el = document.getElementById(id); if (el) el.innerHTML = empty('❌ ' + esc(msg), true); }
        this.showToast('❌ ' + this.escapeHTML(msg), 'error');
        return null;
    };
    /** Persist one setting without touching the settings modal (saveSettings would wipe keys). */
    P.pfSet = function (key, value) { this.settings[key] = value; if (this.persistSettings) this.persistSettings(); return value; };
    P.pfAI = async function (prompt, { json = false, images, system, maxTokens = 2000, kind = 'chat', quiet = false } = {}) {
        if (!String(this.settings.apiKey || '').trim()) { if (!quiet) this.showToast('يلزم مفتاح OpenRouter في الإعدادات لهذه الميزة الذكية', 'warning'); return null; }
        if ((!this.aiRun || this.aiRun.__oxLazy) && this.loadChunk) { try { await this.loadChunk('ai'); } catch (e) { /* offline */ } }
        if (!this.aiRun) return null;
        const sys = system || 'You are OX-AI, a senior performance & mobile engineer. Answer in Arabic unless code is requested. Be concise and practical.';
        const opts = { system: sys, maxTokens, kind: images && images.length ? 'vision' : kind, images, source: 'perf', quiet: true };
        try { return json ? await this.aiJSON(prompt, opts) : await this.aiRun(prompt, opts); } catch (e) { if (!quiet) this.showToast('❌ ' + this.escapeHTML(e.message || String(e)), 'error'); return null; }
    };

    // ------------------------------------------------------------------ CAMERA / IMAGE INPUT (shared by #953 #955 #956 #968 #969)
    /** Live camera into <video id> (rear camera on phones). Registers a stopper for the section. */
    P.pfCameraStart = async function (videoId = 'pfx-video') {
        const W = win(), md = W.navigator && W.navigator.mediaDevices;
        if (!md || !md.getUserMedia) throw new Error('الكاميرا غير متاحة في هذا المتصفح — استعمل «اختيار صورة»');
        this.pfCameraStop();
        const stream = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false });
        this._pfCam = stream;
        const v = document.getElementById(videoId);
        if (v) { v.srcObject = stream; v.hidden = false; try { await v.play(); } catch (e) { /* autoplay */ } }
        this._pfStop = () => this.pfCameraStop();
        return stream;
    };
    P.pfCameraStop = function () {
        if (this._pfCam) { try { this._pfCam.getTracks().forEach(t => t.stop()); } catch (e) {} this._pfCam = null; }
        return true;
    };
    /** Current frame of the camera, or the picked file, as a (≤1600px) JPEG data URL. */
    P.pfGrabImage = async function ({ videoId = 'pfx-video', fileId = 'pfx-file', maxDim = 1600 } = {}) {
        const el = document.getElementById(fileId);
        const f = el && el.files && el.files[0];
        if (f) {
            const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
            this._pfLastImage = url;
            return url;
        }
        const v = document.getElementById(videoId);
        if (v && this._pfCam && v.videoWidth) {
            const s = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
            const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            this._pfLastImage = c.toDataURL('image/jpeg', 0.88);
            return this._pfLastImage;
        }
        if (this._pfLastImage) return this._pfLastImage;
        throw new Error('التقط صورة بالكاميرا أو اختر ملف صورة أولاً');
    };
}

/** Camera + file picker block used by the camera sections. */
export const cameraBlock = (extra = '') => `<div class="pfx-cam"><video id="pfx-video" playsinline muted hidden></video><canvas id="pfx-overlay" class="pfx-overlay" hidden></canvas><img id="pfx-shot" class="pfx-shot" alt="" hidden></div>
    <div class="gh-row"><button class="sidebar-btn-util gh-btn" onclick="app.pfCameraStart().catch(e => app.pfErr(e))"><i class="fa-solid fa-camera"></i> <span>تشغيل الكاميرا</span></button>
    <label class="sidebar-btn-util gh-btn pfx-file"><i class="fa-solid fa-image"></i> <span>اختيار صورة</span><input id="pfx-file" type="file" accept="image/*" capture="environment" hidden></label>${extra}</div>`;
