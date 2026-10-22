/* #1003 code in space: 3D code room (drag / gyroscope / stereo for phone-in-headset glasses) + WebXR immersive AR panel */
import { esc, btn, pbtn, card, empty, toggle, stats } from './util.js';

/** Cylinder layout for n panels → [{rotY, z}] */
export function ringLayout(n, radius = 900) {
    const step = 360 / Math.max(n, 1);
    const r = n <= 1 ? radius * 0.6 : Math.max(radius, (n * 520) / (2 * Math.PI));
    return Array.from({ length: n }, (_, i) => ({ rotY: +(i * step).toFixed(3), z: Math.round(r) }));
}
/** Device orientation → scene rotation (degrees), relative to the starting pose. */
export function gyroToRotation(o, base) {
    if (!o || o.alpha == null) return null;
    const b = base || { alpha: o.alpha, beta: o.beta };
    let yaw = o.alpha - b.alpha;
    if (yaw > 180) yaw -= 360;
    if (yaw < -180) yaw += 360;
    const pitch = Math.max(-60, Math.min(60, (o.beta - b.beta)));
    return { ry: +yaw.toFixed(2), rx: +(-pitch).toFixed(2) };
}
/** Code → canvas texture (for WebXR). */
export function codeCanvas(doc, title, text, { w = 1024, h = 1024, font = 22 } = {}) {
    const c = doc.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g) return c;
    g.fillStyle = 'rgba(11,16,32,0.92)'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6366f1'; g.fillRect(0, 0, w, 56);
    g.fillStyle = '#fff'; g.font = 'bold 28px system-ui, sans-serif'; g.fillText(String(title).slice(0, 60), 20, 38);
    g.font = font + 'px ui-monospace, Consolas, monospace';
    String(text).split('\n').slice(0, Math.floor((h - 80) / (font * 1.35))).forEach((l, i) => {
        g.fillStyle = '#475569'; g.fillText(String(i + 1).padStart(3, ' '), 12, 90 + i * font * 1.35);
        g.fillStyle = /^\s*(\/\/|#)/.test(l) ? '#64748b' : /\b(function|const|let|return|class|import|export|def|if|for)\b/.test(l) ? '#c4b5fd' : '#e2e8f0';
        g.fillText(l.replace(/\t/g, '    ').slice(0, 78), 70, 90 + i * font * 1.35);
    });
    return c;
}

export function installSpace(P) {
    const files = (app) => app.ixFiles(p => /\.(m?js|ts|tsx|jsx|py|html|css|json|md|go|rs|java|php|rb|c|cpp|cs|kt|swift|sql|sh|ya?ml)$/i.test(p)).slice(0, 12);
    P.ixCodeSpace = function (on = true, opts = {}) {
        const old = document.getElementById('ix-space');
        if (!on || old) {
            if (old) old.remove();
            const s = this._ixSpace;
            if (s) { window.removeEventListener('deviceorientation', s.onGyro); window.removeEventListener('keydown', s.onKey, true); }
            this._ixSpace = null;
            if (!on || old) return false;
        }
        const list = files(this);
        if (!list.length) { this.showToast('لا توجد ملفات كود في المشروع', 'info'); return false; }
        const stereo = opts.stereo != null ? opts.stereo : !!(document.getElementById('ix-sp-stereo') || {}).checked;
        const layout = ringLayout(list.length);
        const scene = () => `<div class="ix-sp-scene">${list.map(([p, t], i) => `<div class="ix-sp-panel" data-path="${esc(p)}" style="transform: rotateY(${layout[i].rotY}deg) translateZ(-${layout[i].z}px) rotateY(180deg)"><div class="ix-sp-h">${esc(p)}</div><pre>${esc(t.split('\n').slice(0, 60).join('\n'))}</pre></div>`).join('')}</div>`;
        const root = document.createElement('div');
        root.id = 'ix-space';
        root.className = 'ix-space' + (stereo ? ' ix-stereo' : '');
        root.innerHTML = `<div class="ix-sp-eye">${scene()}</div>${stereo ? `<div class="ix-sp-eye">${scene()}</div>` : ''}<div class="ix-sp-ui"><button data-act="gyro">🧭 الجيروسكوب</button><button data-act="stereo">👓 ${stereo ? 'عرض عادي' : 'نظارة'}</button><button data-act="close">✕</button></div>`;
        document.body.appendChild(root);
        const st = this._ixSpace = { ry: 0, rx: 0, base: null, stereo };
        const apply = () => root.querySelectorAll('.ix-sp-scene').forEach((s, i) => { s.style.transform = `translateZ(600px) rotateX(${st.rx}deg) rotateY(${st.ry + (stereo ? (i ? -1.2 : 1.2) : 0)}deg)`; });
        apply();
        let drag = null;
        root.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; drag = { x: e.clientX, y: e.clientY, ry: st.ry, rx: st.rx, moved: false }; });
        root.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true; st.ry = drag.ry + dx * 0.25; st.rx = Math.max(-45, Math.min(45, drag.rx - dy * 0.2)); apply(); });
        root.addEventListener('pointerup', (e) => {
            const was = drag && drag.moved; drag = null;
            if (was) return;
            const panel = e.target.closest('.ix-sp-panel');
            if (panel) { this.ixCodeSpace(false); if (this.openFileAt) this.openFileAt(panel.dataset.path, 1, 1); }
        });
        root.addEventListener('wheel', (e) => { st.ry += e.deltaY * 0.1; apply(); }, { passive: true });
        st.onGyro = (e) => { const r = gyroToRotation(e, st.base); if (!r) return; if (!st.base) st.base = { alpha: e.alpha, beta: e.beta }; st.ry = r.ry; st.rx = r.rx; apply(); };
        st.onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.ixCodeSpace(false); } if (e.key === 'ArrowLeft') { st.ry -= 15; apply(); } if (e.key === 'ArrowRight') { st.ry += 15; apply(); } };
        window.addEventListener('keydown', st.onKey, true);
        root.querySelector('.ix-sp-ui').addEventListener('click', async (e) => {
            const a = e.target.dataset.act;
            if (a === 'close') this.ixCodeSpace(false);
            if (a === 'stereo') { this.ixCodeSpace(false); this.ixCodeSpace(true, { stereo: !stereo }); }
            if (a === 'gyro') {
                try { if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); } catch (x) { /* iOS denied */ }
                st.base = null;
                window.addEventListener('deviceorientation', st.onGyro);
                if (stereo && root.requestFullscreen) root.requestFullscreen().catch(() => {});
                this.showToast('🧭 حرّك الجهاز للنظر حولك', 'info');
            }
        });
        return true;
    };
    // ---------------------------------------------------------------- WebXR immersive-ar (AR glasses / Android Chrome)
    P.ixXRSupported = async function () { try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { return false; } };
    P.ixCodeXR = async function () {
        if (!(await this.ixXRSupported())) { this.showToast('WebXR AR غير مدعوم هنا — استخدم «غرفة الكود» أو Chrome على Android / نظارة تدعم WebXR', 'warning'); return null; }
        const list = files(this);
        if (!list.length) return null;
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true });
        const session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root: document.body } });
        this._ixXR = session;
        await gl.makeXRCompatible();
        session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
        const ref = await session.requestReferenceSpace('local');
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
        const prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec3 p;attribute vec2 uv;uniform mat4 P,V,M;varying vec2 v;void main(){v=uv;gl_Position=P*V*M*vec4(p,1.0);}'));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v);}'));
        gl.linkProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0, 0, 1, 0.5, -0.5, 0, 1, 1, -0.5, 0.5, 0, 0, 0, 0.5, 0.5, 0, 1, 0]), gl.STATIC_DRAW);
        const tex = gl.createTexture();
        let idx = 0;
        const upload = () => { const [p, t] = list[idx]; gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, codeCanvas(document, p, t)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); };
        upload();
        session.addEventListener('select', () => { idx = (idx + 1) % list.length; upload(); });
        session.addEventListener('end', () => { this._ixXR = null; });
        const M = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1.2, 1]);
        const loc = { p: gl.getAttribLocation(prog, 'p'), uv: gl.getAttribLocation(prog, 'uv'), P: gl.getUniformLocation(prog, 'P'), V: gl.getUniformLocation(prog, 'V'), M: gl.getUniformLocation(prog, 'M') };
        const frame = (t, f) => {
            session.requestAnimationFrame(frame);
            const pose = f.getViewerPose(ref);
            if (!pose) return;
            const layer = session.renderState.baseLayer;
            gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
            gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.useProgram(prog);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.enableVertexAttribArray(loc.p); gl.vertexAttribPointer(loc.p, 3, gl.FLOAT, false, 20, 0);
            gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 20, 12);
            gl.uniformMatrix4fv(loc.M, false, M);
            for (const view of pose.views) {
                const vp = layer.getViewport(view);
                gl.viewport(vp.x, vp.y, vp.width, vp.height);
                gl.uniformMatrix4fv(loc.P, false, view.projectionMatrix);
                gl.uniformMatrix4fv(loc.V, false, view.transform.inverse.matrix);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
        };
        session.requestAnimationFrame(frame);
        this.showToast('🥽 لوحة الكود أمامك على بعد 1.2م — انقر (select) للملف التالي', 'success');
        return session;
    };
    P.ixSpace = async function () {
        const xr = await this.ixXRSupported();
        const n = files(this).length;
        return card('الكود في الفضاء', `<p class="hv-dim"><b>غرفة الكود</b>: ملفات مشروعك على شكل لوحات ثلاثية الأبعاد تحيط بك. اسحب أو استخدم الأسهم أو العجلة للدوران، أو فعّل الجيروسكوب لتنظر حولك بتحريك الهاتف، وانقر على أي لوحة لفتحها في المحرر. <b>وضع النظارة</b> يقسم الشاشة لعينين، فيعمل مع نظارات الواقع الافتراضي التي يوضع فيها الهاتف. أما <b>WebXR AR</b> فيعرض لوحة الكود في الفضاء الحقيقي من حولك على Chrome لأندرويد وعلى النظارات الداعمة لـ WebXR.</p>
            ${stats([['ملفات الكود', n], ['WebXR AR', xr ? 'مدعوم ✓' : 'غير مدعوم هنا'], ['الجيروسكوب', typeof DeviceOrientationEvent !== 'undefined' ? 'متاح' : '—']])}
            <div class="gh-row">${toggle('ix-sp-stereo', 'وضع النظارة (عينان)', false)}${pbtn('fa-cube', 'ادخل غرفة الكود', 'app.ixCodeSpace(true)')}${btn('fa-vr-cardboard', 'WebXR AR', 'app.ixCodeXR()', 'sidebar-btn-util gh-btn', xr ? '' : 'disabled')}</div>
            ${n ? '' : empty('أضف ملفات كود للمشروع أولاً')}`, 'fa-vr-cardboard');
    };
}
