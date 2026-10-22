/* Sensors: motion tracking + shake (#959), activity tracking (#974), compass & GPS with Qibla (#960), AR (#957), VR (#958). */
import { esc, call, card, btn, pbtn, select, win, lsGet, lsSet, dayKey, table, sparkline } from './util.js';
import { cameraBlock } from './core.js';

// ------------------------------------------------------------------ PURE
/** Peak-based step detector on acceleration magnitude (m/s², gravity included). */
export function createStepDetector({ threshold = 1.2, minGap = 280, alpha = 0.9 } = {}) {
    let base = 9.81, above = false, last = -1e9;
    return {
        push(ax, ay, az, t) {
            const m = Math.sqrt(ax * ax + ay * ay + az * az);
            base = alpha * base + (1 - alpha) * m; // slow baseline (gravity)
            const d = m - base;
            if (!above && d > threshold && t - last > minGap) { above = true; last = t; return true; }
            if (above && d < threshold * 0.4) above = false;
            return false;
        },
        get baseline() { return base; }
    };
}
/** Shake = several strong direction reversals within a short window. */
export function createShakeDetector({ force = 15, count = 3, window: win_ = 900 } = {}) {
    let hits = [];
    return { push(ax, ay, az, t) { const m = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(az)); if (m > force) { hits = hits.filter(x => t - x < win_); hits.push(t); if (hits.length >= count) { hits = []; return true; } } return false; } };
}
export const classifyActivity = (cadence) => (cadence >= 140 ? 'running' : cadence >= 60 ? 'walking' : cadence > 5 ? 'moving' : 'still');
export const ACTIVITY_LABEL = { running: '🏃 جري', walking: '🚶 مشي', moving: '🧍 حركة خفيفة', still: '🪑 ثابت' };
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
/** Initial great-circle bearing (0 = north, clockwise). */
export function bearing(lat1, lon1, lat2, lon2) {
    const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
    return (deg(Math.atan2(y, x)) + 360) % 360;
}
export function haversine(lat1, lon1, lat2, lon2) {
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export const KAABA = [21.4225, 39.8262];
export const qibla = (lat, lon) => bearing(lat, lon, KAABA[0], KAABA[1]);
export const cardinal = (b) => ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'][Math.round(((b % 360) + 360) % 360 / 45) % 8];
/** Heading from a DeviceOrientationEvent-like object (iOS webkitCompassHeading, else absolute alpha). */
export const headingOf = (e) => (e.webkitCompassHeading != null ? e.webkitCompassHeading : e.absolute || e.alpha != null ? (360 - (e.alpha || 0)) % 360 : null);
export const compassSVG = (heading = 0, target = null) => `<svg class="pfx-compass" viewBox="-60 -60 120 120" width="180" height="180" aria-hidden="true"><g transform="rotate(${-heading})"><circle r="56" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="2"/>${['N', 'E', 'S', 'W'].map((l, i) => `<text x="${Math.sin(rad(i * 90)) * 44}" y="${-Math.cos(rad(i * 90)) * 44 + 4}" text-anchor="middle" font-size="11" fill="${l === 'N' ? '#ef4444' : 'currentColor'}">${l}</text>`).join('')}${target != null ? `<g transform="rotate(${target})"><path d="M0 -52 L5 -40 L-5 -40 Z" fill="#16a34a"/><text y="-30" text-anchor="middle" font-size="9" fill="#16a34a">🕋</text></g>` : ''}</g><path d="M0 -36 L6 0 L0 -6 L-6 0 Z" fill="#ef4444"/><circle r="3" fill="currentColor"/></svg>`;

export function installSensors(P) {
    const W = () => win();
    P.pfMotionPermission = async function () {
        const DM = W().DeviceMotionEvent, DO = W().DeviceOrientationEvent;
        try {
            if (DM && typeof DM.requestPermission === 'function' && (await DM.requestPermission()) !== 'granted') return false;
            if (DO && typeof DO.requestPermission === 'function') await DO.requestPermission().catch(() => {});
        } catch (e) { return false; }
        return !!DM;
    };

    // ------------------------------------------------------------------ MOTION + ACTIVITY (#959 #974)
    P.pfActivity = function () { return { days: {}, minutes: {}, ...lsGet('ox_perf_activity_v1', {}) }; };
    P.pfMotion = function () {
        const a = this.pfActivity(), today = dayKey(Date.now()), on = !!this._pfMotion;
        const days = Object.keys(a.days).sort().slice(-14);
        return card('تتبع الحركة', `<p class="gh-muted">مقياس التسارع يعدّ خطواتك ويكتشف هزّ الهاتف أثناء فتح التطبيق (المتصفح يوقف المستشعرات في الخلفية — لعدّ يوم كامل استعمل تطبيق الصحة في هاتفك).</p>
                <div class="gh-row">${on ? pbtn('fa-stop', 'إيقاف', call('pfMotionStop')) : pbtn('fa-person-walking', 'ابدأ التتبع', call('pfMotionStart'))}</div>
                <div id="pfx-motion" class="pfx-motion">${on ? this.pfMotionHTML() : ''}</div>
                ${select('pfx-shake', 'عند هزّ الهاتف', [['none', 'لا شيء'], ['stop', 'أوقف التوليد'], ['speak', 'اقرأ آخر رد'], ['new', 'محادثة جديدة']], this.settings.shakeAction || 'none', `onchange="app.pfSet('shakeAction', this.value)"`)}`, 'fa-person-walking')
            + card('النشاط', `<p>اليوم: <b>${a.days[today] || 0}</b> خطوة • <b>${a.minutes[today] || 0}</b> دقيقة نشاط</p>${days.length > 1 ? sparkline(days.map(d => a.days[d]), { w: 260, h: 40 }) : ''}
                ${select('pfx-break', 'تذكير بالحركة بعد الجلوس', [['0', 'معطّل'], ['30', '30 دقيقة'], ['45', '45 دقيقة'], ['60', 'ساعة']], String(this.settings.breakReminder || 0), `onchange="app.pfSetBreak(this.value)"`)}`, 'fa-heart-pulse');
    };
    P.pfMotionHTML = function () {
        const m = this._pfMotion; if (!m) return '';
        return `<div class="fmx-stats"><div><b>${m.steps}</b><small>خطوة (هذه الجلسة)</small></div><div><b>${Math.round(m.cadence)}</b><small>خطوة/دقيقة</small></div><div><b>${ACTIVITY_LABEL[classifyActivity(m.cadence)]}</b><small>النشاط</small></div><div><b>${m.mag.toFixed(1)}</b><small>تسارع m/s²</small></div></div>`;
    };
    P.pfMotionStart = async function () {
        if (this._pfMotion) return this._pfMotion;
        if (!(await this.pfMotionPermission())) { this.showToast('مستشعر الحركة غير متاح أو رُفض الإذن', 'warning'); return null; }
        const step = createStepDetector(), shake = createShakeDetector(), st = { steps: 0, cadence: 0, mag: 0, times: [] };
        let lastUI = 0, lastActiveMin = 0;
        st.handler = (e) => {
            const a = e.accelerationIncludingGravity || {}; if (a.x == null) return;
            const t = e.timeStamp || performance.now();
            st.mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
            if (step.push(a.x, a.y, a.z, t)) {
                st.steps++; st.times.push(t); st.times = st.times.filter(x => t - x < 60000);
                this._pfLastStep = Date.now();
                const act = this.pfActivity(), d = dayKey(Date.now()); act.days[d] = (act.days[d] || 0) + 1;
                const min = Math.floor(Date.now() / 60000); if (min !== lastActiveMin && st.times.length > 20) { lastActiveMin = min; act.minutes[d] = (act.minutes[d] || 0) + 1; }
                if (act.days[d] % 10 === 0) lsSet('ox_perf_activity_v1', act); else this._pfActPending = act;
            }
            st.cadence = st.times.length >= 2 ? (st.times.length - 1) / ((st.times[st.times.length - 1] - st.times[0]) / 60000 || 1) : 0;
            if (shake.push(a.x - (a.x / (st.mag || 1)) * 9.81, a.y - (a.y / (st.mag || 1)) * 9.81, a.z - (a.z / (st.mag || 1)) * 9.81, t)) this.pfOnShake();
            if (t - lastUI > 400) { lastUI = t; const el = document.getElementById('pfx-motion'); if (el) el.innerHTML = this.pfMotionHTML(); }
        };
        W().addEventListener('devicemotion', st.handler);
        this._pfMotion = st;
        if (this._pfx && this._pfx.sec === 'motion') this.pfRefresh();
        return st;
    };
    P.pfMotionStop = function () {
        const st = this._pfMotion; if (!st) return false;
        W().removeEventListener('devicemotion', st.handler);
        if (this._pfActPending) { lsSet('ox_perf_activity_v1', this._pfActPending); this._pfActPending = null; }
        this._pfMotion = null;
        if (this._pfx && this._pfx.sec === 'motion') this.pfRefresh();
        return true;
    };
    P.pfOnShake = function () {
        const a = this.settings.shakeAction;
        if (!a || a === 'none') return false;
        if (this.haptic) this.haptic([30, 30, 30]);
        return this.pfAction(a);
    };
    P.pfSetBreak = function (min) {
        const m = parseInt(min, 10) || 0;
        this.pfSet('breakReminder', m);
        clearInterval(this._pfBreakT);
        if (m) {
            this._pfLastStep = this._pfLastStep || Date.now();
            this._pfBreakT = setInterval(() => {
                if (document.hidden || Date.now() - (this._pfLastStep || 0) < m * 60000) return;
                this._pfLastStep = Date.now();
                this.showToast(`🧘 مرّت ${m} دقيقة دون حركة — قم وتمدد قليلاً`, 'info');
                if (this.pfNotify) this.pfNotify('وقت الحركة 🧘', `مرّت ${m} دقيقة على جلوسك`, { tag: 'ox-break' }).catch(() => {});
            }, 60000);
            if (!this._pfMotion) this.pfMotionStart().catch(() => {});
        }
        return m;
    };

    // ------------------------------------------------------------------ COMPASS + GPS (#960)
    P.pfGeo = function () {
        const g = this._pfGeo;
        this._pfStop = () => this.pfGeoStop();
        return card('البوصلة و GPS', `<div class="gh-row">${g ? pbtn('fa-stop', 'إيقاف', call('pfGeoStop')) : pbtn('fa-location-crosshairs', 'تشغيل', call('pfGeoStart'))}</div>
                <div class="pfx-geo"><div id="pfx-compass">${compassSVG(0, g && g.pos ? qibla(g.pos.lat, g.pos.lon) : null)}</div><div id="pfx-geo-out">${g ? this.pfGeoHTML() : '<p class="gh-muted">يعرض موقعك ودقته وسرعتك واتجاهك، واتجاه القبلة 🕋 والمسافة إلى مكة.</p>'}</div></div>`, 'fa-compass');
    };
    P.pfGeoHTML = function () {
        const g = this._pfGeo || {}, p = g.pos;
        if (!p) return '<p>يبحث عن الموقع…</p>';
        const q = qibla(p.lat, p.lon), dist = haversine(p.lat, p.lon, KAABA[0], KAABA[1]) / 1000;
        const speed = p.speed != null ? p.speed * 3.6 : null;
        return table(['', ''], [['الموقع', `<span dir="ltr">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</span>`], ['الدقة', `±${Math.round(p.acc)} م`], ['الارتفاع', p.alt != null ? Math.round(p.alt) + ' م' : '—'],
            ['السرعة', speed != null ? speed.toFixed(1) + ' كم/س' : '—'], ['الاتجاه', g.heading != null ? `${Math.round(g.heading)}° (${cardinal(g.heading)})` : '—'], ['القبلة', `${q.toFixed(1)}° (${cardinal(q)}) • ${Math.round(dist).toLocaleString('en')} كم`]])
            + `<div class="gh-row"><a class="sidebar-btn-util gh-btn" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=16/${p.lat}/${p.lon}"><i class="fa-solid fa-map"></i> الخريطة</a>${btn('fa-copy', 'نسخ الإحداثيات', call('copyText', `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`))}</div>`
            + (speed != null && speed > 20 && !this.settings.drivingMode ? `<p class="pfx-warn">🚗 يبدو أنك تقود (${Math.round(speed)} كم/س) — ${btn('fa-car', 'فعّل وضع القيادة', call('pfLoad', 'modes', 'driving'))}</p>` : '');
    };
    P.pfGeoStart = async function () {
        const geo = W().navigator && W().navigator.geolocation;
        if (!geo) { this.showToast('GPS غير متاح', 'warning'); return null; }
        await this.pfMotionPermission();
        const g = this._pfGeo = { pos: null, heading: null };
        const render = () => { const o = document.getElementById('pfx-geo-out'); if (o) o.innerHTML = this.pfGeoHTML(); const c = document.getElementById('pfx-compass'); if (c) c.innerHTML = compassSVG(g.heading || 0, g.pos ? qibla(g.pos.lat, g.pos.lon) : null); };
        g.watch = geo.watchPosition((p) => { const c = p.coords; g.pos = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, speed: c.speed, t: p.timestamp }; if (c.heading != null && !isNaN(c.heading) && g.heading == null) g.heading = c.heading; render(); },
            (e) => { this.showToast('تعذر تحديد الموقع: ' + esc(e.message || ''), 'warning'); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
        let lastR = 0;
        g.orient = (e) => { const h = headingOf(e); if (h == null) return; g.heading = h; const t = Date.now(); if (t - lastR > 150) { lastR = t; render(); } };
        const evt = 'ondeviceorientationabsolute' in W() ? 'deviceorientationabsolute' : 'deviceorientation';
        g.evt = evt; W().addEventListener(evt, g.orient);
        this._pfStop = () => this.pfGeoStop();
        render();
        return g;
    };
    P.pfGeoStop = function () {
        const g = this._pfGeo; if (!g) return false;
        try { W().navigator.geolocation.clearWatch(g.watch); } catch (e) {}
        if (g.orient) W().removeEventListener(g.evt, g.orient);
        this._pfGeo = null;
        return true;
    };

    // ------------------------------------------------------------------ AR (#957) + VR (#958)
    P.pfXRSupport = async function () {
        const xr = W().navigator && W().navigator.xr, out = { webxr: !!xr, ar: false, vr: false, orientation: !!W().DeviceOrientationEvent, camera: !!(W().navigator.mediaDevices && W().navigator.mediaDevices.getUserMedia) };
        if (xr && xr.isSessionSupported) { try { out.ar = await xr.isSessionSupported('immersive-ar'); } catch (e) {} try { out.vr = await xr.isSessionSupported('immersive-vr'); } catch (e) {} }
        return out;
    };
    P.pfXR = async function () {
        const s = await this.pfXRSupport(), yes = (b) => (b ? '✅' : '—');
        return card('الدعم في هذا الجهاز', table(['', ''], [['WebXR', yes(s.webxr)], ['AR غامر (immersive-ar)', yes(s.ar)], ['VR غامر (immersive-vr)', yes(s.vr)], ['مستشعر الاتجاه', yes(s.orientation)], ['الكاميرا', yes(s.camera)]])
                + '<p class="gh-muted">بصراحة: WebXR الكامل يعمل على Chrome Android (ARCore) ونظارات Quest/Vision Pro فقط. لذلك نوفر وضعين يعملان على أي هاتف تقريباً.</p>', 'fa-vr-cardboard')
            + card('واقع معزز (كاميرا + بوصلة)', cameraBlock(pbtn('fa-location-arrow', 'ابدأ AR', call('pfARStart'))) + '<p class="gh-muted">يرسم فوق بث الكاميرا الحي اتجاهات البوصلة واتجاه القبلة 🕋 وآخر ردّ من المساعد كبطاقة عائمة تتحرك مع دوران الهاتف.</p>', 'fa-location-arrow')
            + card('واقع افتراضي (Cardboard)', `<p class="gh-muted">عرض مجسّم (عينان) لبيئة نجمية مع لوحة آخر رد — ضع الهاتف في نظارة Cardboard وحرّك رأسك.${s.vr ? ' جهازك يدعم VR الغامر أيضاً.' : ''}</p><div class="gh-row">${pbtn('fa-vr-cardboard', 'ادخل VR', call('pfVRStart'))}</div>`, 'fa-vr-cardboard');
    };
    const lastReply = (app) => { const s = (app.sessions || []).find(x => x.id === app.activeSessionId); const m = s && (s.messages || []).slice().reverse().find(x => x.role === 'assistant'); return m ? String(typeof m.content === 'string' ? m.content : '').replace(/[#*`>_-]/g, '').slice(0, 160) : 'لا ردود بعد'; };
    const wrap = (g, text, max, lh, x, y, lines = 4) => { const words = text.split(/\s+/); let line = '', n = 0; for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > max && line) { g.fillText(line, x, y + n * lh); line = w; if (++n >= lines) return; } else line = t; } if (line) g.fillText(line, x, y + n * lh); };
    P.pfARStart = async function () {
        try { await this.pfCameraStart(); } catch (e) { return this.pfErr(e); }
        await this.pfMotionPermission();
        const c = document.getElementById('pfx-overlay'), v = document.getElementById('pfx-video'); if (!c || !v) return null;
        c.hidden = false;
        const st = { heading: 0, pitch: 90 };
        const orient = (e) => { const h = headingOf(e); if (h != null) st.heading = h; if (e.beta != null) st.pitch = e.beta; };
        const evt = 'ondeviceorientationabsolute' in W() ? 'deviceorientationabsolute' : 'deviceorientation';
        W().addEventListener(evt, orient);
        const reply = lastReply(this);
        let pos = null; try { W().navigator.geolocation.getCurrentPosition(p => { pos = p.coords; }, () => {}, { timeout: 8000 }); } catch (e) {}
        const FOV = 60;
        const draw = () => {
            if (!this._pfAR) return;
            const w = c.width = v.clientWidth || 640, h = c.height = v.clientHeight || 480, g = c.getContext('2d');
            g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.font = 'bold 18px system-ui';
            const place = (b, label, color) => { let d = ((b - st.heading + 540) % 360) - 180; if (Math.abs(d) > FOV / 2) return; const x = w / 2 + (d / (FOV / 2)) * (w / 2); g.fillStyle = color; g.fillText(label, x, h * 0.18); g.fillRect(x - 1, h * 0.2, 2, 14); };
            [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]].forEach(([l, b]) => place(b, l, l === 'N' ? '#ef4444' : '#fff'));
            if (pos) place(qibla(pos.latitude, pos.longitude), '🕋 القبلة', '#22c55e');
            const y = h * 0.55 + (90 - st.pitch) * 4; g.fillStyle = 'rgba(15,23,42,.72)'; g.fillRect(w * 0.1, y, w * 0.8, 96); g.fillStyle = '#e2e8f0'; g.font = '15px system-ui'; g.textAlign = 'right'; g.direction = 'rtl';
            wrap(g, reply, w * 0.76, 20, w * 0.88, y + 26);
            g.direction = 'ltr'; g.textAlign = 'center'; g.font = '13px system-ui'; g.fillStyle = '#fff'; g.fillText(`${Math.round(st.heading)}° ${cardinal(st.heading)}`, w / 2, h - 14);
            this._pfAR.raf = requestAnimationFrame(draw);
        };
        this._pfAR = { orient, evt };
        const stopCam = this._pfStop;
        this._pfStop = () => { if (this._pfAR) { cancelAnimationFrame(this._pfAR.raf); W().removeEventListener(evt, orient); this._pfAR = null; } if (stopCam) stopCam(); };
        draw();
        return true;
    };
    P.pfVRStart = async function () {
        await this.pfMotionPermission();
        const c = document.createElement('canvas'); c.className = 'pfx-vr'; c.setAttribute('aria-label', 'VR');
        document.body.appendChild(c);
        try { if (c.requestFullscreen) await c.requestFullscreen(); } catch (e) {}
        try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) {}
        const st = { yaw: 0, pitch: 0 }, reply = lastReply(this);
        const orient = (e) => { if (e.alpha != null) st.yaw = e.alpha; if (e.gamma != null) st.pitch = e.gamma; };
        W().addEventListener('deviceorientation', orient);
        const stars = Array.from({ length: 400 }, () => ({ yaw: Math.random() * 360, pitch: Math.random() * 140 - 70, r: Math.random() * 1.6 + 0.3 }));
        const FOV = 80;
        const eye = (g, ox, w, h, shift) => {
            g.save(); g.beginPath(); g.rect(ox, 0, w, h); g.clip();
            g.fillStyle = '#020617'; g.fillRect(ox, 0, w, h);
            for (const s of stars) { const dy = ((s.yaw - st.yaw + 540) % 360) - 180, dp = s.pitch + st.pitch; if (Math.abs(dy) > FOV / 2) continue; const x = ox + w / 2 + (dy / (FOV / 2)) * (w / 2) + shift * s.r, y = h / 2 - (dp / (FOV / 2)) * (h / 2); g.fillStyle = '#fff'; g.fillRect(x, y, s.r, s.r); }
            const dy = ((0 - st.yaw + 540) % 360) - 180;
            if (Math.abs(dy) < FOV / 2 + 20) { const x = ox + w / 2 + (dy / (FOV / 2)) * (w / 2) + shift * 4, y = h / 2 - (st.pitch / (FOV / 2)) * (h / 2); g.fillStyle = 'rgba(30,41,59,.85)'; g.fillRect(x - w * 0.35, y - 50, w * 0.7, 100); g.fillStyle = '#e2e8f0'; g.font = '14px system-ui'; g.textAlign = 'right'; g.direction = 'rtl'; wrap(g, reply, w * 0.64, 18, x + w * 0.32, y - 24); g.direction = 'ltr'; }
            g.restore();
        };
        const stop = () => { cancelAnimationFrame(this._pfVR && this._pfVR.raf); W().removeEventListener('deviceorientation', orient); c.remove(); this._pfVR = null; try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} };
        c.addEventListener('click', stop);
        const draw = () => {
            if (!this._pfVR) return;
            const w = c.width = innerWidth, h = c.height = innerHeight, g = c.getContext('2d');
            eye(g, 0, w / 2, h, 3); eye(g, w / 2, w / 2, h, -3);
            g.fillStyle = '#334155'; g.fillRect(w / 2 - 1, 0, 2, h);
            this._pfVR.raf = requestAnimationFrame(draw);
        };
        this._pfVR = { stop };
        draw();
        this.showToast('👓 المس الشاشة للخروج', 'info');
        return true;
    };
}
