/* Special previews: PSD composite (#553), Figma embed (#553), 3D STL/OBJ (#556), GeoJSON/GPX/KML/CSV maps (#557 #635). */
import { esc, call, btn, card, empty, extOf, fromUtf8, newCanvas, val } from './shared.js';
import { sourcePicker, readSources } from './core.js';

// ------------------------------------------------------------------ PSD
/** Decode the merged (composite) image of a PSD (v1, 8-bit RGB/Gray, raw or RLE). Returns {width, height, rgba}. */
export function decodePSD(bytes) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== '8BPS') throw new Error('ليس ملف PSD');
    if (v.getUint16(4) !== 1) throw new Error('صيغة PSB غير مدعومة');
    const channels = v.getUint16(12), height = v.getUint32(14), width = v.getUint32(18), depth = v.getUint16(22), mode = v.getUint16(24);
    if (depth !== 8) throw new Error(`عمق ${depth}-bit غير مدعوم (8-bit فقط)`);
    if (mode !== 3 && mode !== 1) throw new Error('نمط الألوان غير مدعوم (RGB أو رمادي فقط)');
    let o = 26;
    for (let s = 0; s < 3; s++) o += 4 + v.getUint32(o); // color mode data, image resources, layer & mask info
    const comp = v.getUint16(o); o += 2;
    const plane = width * height, planes = [];
    if (comp === 0) { for (let c = 0; c < channels; c++) { planes.push(bytes.subarray(o, o + plane)); o += plane; } }
    else if (comp === 1) {
        const counts = [];
        for (let i = 0; i < channels * height; i++) { counts.push(v.getUint16(o)); o += 2; }
        for (let c = 0; c < channels; c++) {
            const out = new Uint8Array(plane);
            for (let y = 0; y < height; y++) {
                const end = o + counts[c * height + y];
                let p = y * width;
                while (o < end) {
                    const n = (bytes[o] << 24) >> 24; o++;
                    if (n >= 0) { for (let i = 0; i <= n; i++) out[p++] = bytes[o++]; }
                    else if (n !== -128) { const b = bytes[o++]; for (let i = 0; i < 1 - n; i++) out[p++] = b; }
                }
            }
            planes.push(out);
        }
    } else throw new Error('ضغط ZIP في PSD غير مدعوم');
    const rgba = new Uint8ClampedArray(plane * 4);
    const gray = mode === 1;
    for (let i = 0; i < plane; i++) {
        rgba[i * 4] = planes[0][i];
        rgba[i * 4 + 1] = gray ? planes[0][i] : planes[1][i];
        rgba[i * 4 + 2] = gray ? planes[0][i] : planes[2][i];
        rgba[i * 4 + 3] = (gray ? planes[1] : planes[3]) ? (gray ? planes[1] : planes[3])[i] : 255;
    }
    return { width, height, rgba, channels, mode: gray ? 'gray' : 'rgb' };
}

// ------------------------------------------------------------------ 3D
/** Parse STL (binary or ASCII) or OBJ into {triangles: Float32Array(9 per tri)}. */
export function parseModel(bytes, ext) {
    const tris = [];
    if (ext === 'stl') {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const n = bytes.length >= 84 ? v.getUint32(80, true) : 0;
        if (bytes.length === 84 + n * 50 && n > 0) {
            for (let i = 0; i < n; i++) { const b = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) tris.push(v.getFloat32(b + k * 4, true)); }
        } else {
            const txt = fromUtf8(bytes);
            const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
            let m;
            while ((m = re.exec(txt))) tris.push(+m[1], +m[2], +m[3]);
            tris.length -= tris.length % 9;
        }
    } else if (ext === 'obj') {
        const verts = [];
        for (const line of fromUtf8(bytes).split(/\r?\n/)) {
            const p = line.trim().split(/\s+/);
            if (p[0] === 'v') verts.push([+p[1], +p[2], +p[3]]);
            else if (p[0] === 'f') {
                const idx = p.slice(1).map(x => { const i = parseInt(x.split('/')[0], 10); return i < 0 ? verts.length + i : i - 1; });
                for (let k = 1; k + 1 < idx.length; k++) [idx[0], idx[k], idx[k + 1]].forEach(i => { const q = verts[i] || [0, 0, 0]; tris.push(q[0], q[1], q[2]); });
            }
        }
    } else throw new Error('صيغة نموذج غير مدعومة');
    if (!tris.length) throw new Error('لا مثلثات في النموذج');
    return { triangles: Float32Array.from(tris), count: tris.length / 9 };
}
export function modelBounds(t) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], t[i + k]); max[k] = Math.max(max[k], t[i + k]); }
    return { min, max, center: min.map((m, k) => (m + max[k]) / 2), size: Math.max(...max.map((m, k) => m - min[k])) || 1 };
}
/** Software renderer (flat shading, painter's algorithm). */
export function renderModel(canvas, model, { yaw = 0.6, pitch = -0.4, zoom = 1, color = [56, 189, 248] } = {}) {
    const t = model.triangles, b = modelBounds(t), W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = Math.min(W, H) * 0.7 * zoom / b.size, cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = (i) => { const x = t[i] - b.center[0], y = t[i + 1] - b.center[1], z = t[i + 2] - b.center[2]; const x1 = x * cy - y * sy, y1 = x * sy + y * cy; const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp; return [W / 2 + x1 * s, H / 2 - z2 * s, y2]; };
    const faces = [];
    for (let i = 0; i < t.length; i += 9) {
        const a = proj(i), c = proj(i + 3), d = proj(i + 6);
        const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz) || 1;
        faces.push({ p: [a, c, d], z: (a[2] + c[2] + d[2]) / 3, light: Math.abs(nz / len) * 0.75 + Math.abs(ny / len) * 0.1 + 0.15 });
    }
    faces.sort((f, g) => g.z - f.z);
    ctx.fillStyle = '#131314'; ctx.fillRect(0, 0, W, H);
    for (const f of faces) {
        ctx.beginPath(); ctx.moveTo(f.p[0][0], f.p[0][1]); ctx.lineTo(f.p[1][0], f.p[1][1]); ctx.lineTo(f.p[2][0], f.p[2][1]); ctx.closePath();
        ctx.fillStyle = `rgb(${color.map(c => Math.round(c * f.light)).join(',')})`; ctx.fill();
    }
    return faces.length;
}

// ------------------------------------------------------------------ GEO
/** Parse GeoJSON / GPX / KML / CSV(lat,lon) into flat features [{type:'point'|'line'|'polygon', coords:[[lon,lat]], props}]. */
export function parseGeo(text, ext) {
    const out = [];
    const add = (type, coords, props = {}) => { if (coords && coords.length) out.push({ type, coords, props }); };
    if (ext === 'gpx') {
        Array.from(text.matchAll(/<wpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/wpt>/g)).forEach(m => add('point', [[+m[2], +m[1]]], { name: (/<name>([^<]*)<\/name>/.exec(m[3]) || [])[1] || '' }));
        Array.from(text.matchAll(/<trkseg>([\s\S]*?)<\/trkseg>/g)).forEach(m => add('line', Array.from(m[1].matchAll(/<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"/g)).map(x => [+x[2], +x[1]]), { name: 'track' }));
        const rte = Array.from(text.matchAll(/<rtept[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"/g)).map(x => [+x[2], +x[1]]);
        add('line', rte, { name: 'route' });
    } else if (ext === 'kml') {
        Array.from(text.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)).forEach(m => {
            const name = (/<name>([^<]*)<\/name>/.exec(m[1]) || [])[1] || '';
            const coords = (/<coordinates>([\s\S]*?)<\/coordinates>/.exec(m[1]) || [])[1];
            if (!coords) return;
            const c = coords.trim().split(/\s+/).map(s => s.split(',').map(Number)).map(([lon, lat]) => [lon, lat]);
            add(/<Polygon>/.test(m[1]) ? 'polygon' : /<LineString>/.test(m[1]) ? 'line' : 'point', c, { name });
        });
    } else if (ext === 'csv') {
        const lines = text.trim().split(/\r?\n/), head = lines[0].split(',').map(h => h.trim().toLowerCase());
        const la = head.findIndex(h => ['lat', 'latitude', 'y'].includes(h)), lo = head.findIndex(h => ['lon', 'lng', 'long', 'longitude', 'x'].includes(h));
        if (la < 0 || lo < 0) throw new Error('no lat/lon columns');
        const nm = head.findIndex(h => ['name', 'title', 'label'].includes(h));
        lines.slice(1).forEach(l => { const c = l.split(','); if (isFinite(+c[la]) && isFinite(+c[lo]) && c[la] !== '') add('point', [[+c[lo], +c[la]]], { name: nm >= 0 ? c[nm] : '' }); });
    } else {
        const j = JSON.parse(text);
        const geom = (g, props) => {
            if (!g) return;
            if (g.type === 'Point') add('point', [g.coordinates], props);
            else if (g.type === 'MultiPoint') g.coordinates.forEach(c => add('point', [c], props));
            else if (g.type === 'LineString') add('line', g.coordinates, props);
            else if (g.type === 'MultiLineString') g.coordinates.forEach(c => add('line', c, props));
            else if (g.type === 'Polygon') add('polygon', g.coordinates[0], props);
            else if (g.type === 'MultiPolygon') g.coordinates.forEach(p => add('polygon', p[0], props));
            else if (g.type === 'GeometryCollection') g.geometries.forEach(x => geom(x, props));
        };
        if (j.type === 'FeatureCollection') j.features.forEach(f => geom(f.geometry, f.properties || {}));
        else if (j.type === 'Feature') geom(j.geometry, j.properties || {});
        else if (j.type && j.coordinates) geom(j, {});
        else throw new Error('not GeoJSON');
    }
    return out.filter(f => f.coords.every(c => isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[1]) <= 90 && Math.abs(c[0]) <= 180));
}
export function geoBounds(feats) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    feats.forEach(f => f.coords.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    const pad = Math.max(0.01, (x1 - x0) * 0.08, (y1 - y0) * 0.08);
    return { minLon: x0 - pad, maxLon: x1 + pad, minLat: Math.max(-85, y0 - pad), maxLat: Math.min(85, y1 + pad) };
}
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
export function geoSVG(feats, b, { width = 760, height = 420, colorBy = null } = {}) {
    const my0 = merc(b.minLat), my1 = merc(b.maxLat);
    const sx = width / (b.maxLon - b.minLon), sy = height / (my1 - my0), s = Math.min(sx, sy);
    const ox = (width - (b.maxLon - b.minLon) * s) / 2, oy = (height - (my1 - my0) * s) / 2;
    const P = ([lon, lat]) => [ox + (lon - b.minLon) * s, height - oy - (merc(lat) - my0) * s].map(n => +n.toFixed(1));
    const palette = ['#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171'], keys = [];
    const col = (f) => { const k = colorBy ? f[colorBy] || '' : ''; if (!keys.includes(k)) keys.push(k); return palette[keys.indexOf(k) % palette.length]; };
    const step = Math.pow(10, Math.floor(Math.log10(Math.max(b.maxLon - b.minLon, 0.001)))) || 1, grid = [];
    for (let lon = Math.ceil(b.minLon / step) * step; lon <= b.maxLon; lon += step) { const [x] = P([lon, b.minLat]); grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/><text x="${x + 2}" y="${height - 4}">${+lon.toFixed(4)}°</text>`); }
    for (let lat = Math.ceil(b.minLat / step) * step; lat <= b.maxLat; lat += step) { const [, y] = P([b.minLon, lat]); grid.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"/><text x="2" y="${y - 2}">${+lat.toFixed(4)}°</text>`); }
    const shapes = feats.map(f => {
        const c = col(f), title = `<title>${esc(f.props.name || f.props.title || f.type)}${f.file ? ' — ' + esc(f.file) : ''}</title>`;
        if (f.type === 'point') { const [x, y] = P(f.coords[0]); return `<a href="https://www.openstreetmap.org/?mlat=${f.coords[0][1]}&amp;mlon=${f.coords[0][0]}#map=15/${f.coords[0][1]}/${f.coords[0][0]}" target="_blank" rel="noopener"><circle class="fmx-geo-pt" cx="${x}" cy="${y}" r="5" fill="${c}">${title}</circle></a>`; }
        const pts = f.coords.map(P).map(p => p.join(',')).join(' ');
        return f.type === 'polygon' ? `<polygon points="${pts}" fill="${c}33" stroke="${c}" stroke-width="2">${title}</polygon>` : `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2.5">${title}</polyline>`;
    }).join('');
    return `<svg class="fmx-geo" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#0f172a"/><g class="fmx-geo-grid">${grid.join('')}</g>${shapes}</svg>`;
}

/** Figma share/file URL → embed URL. */
export function figmaEmbedUrl(url) {
    if (!/^https:\/\/(www\.)?figma\.com\/(file|design|proto|board|slides)\/[A-Za-z0-9]+/.test(String(url || '').trim())) return null;
    return `https://www.figma.com/embed?embed_host=ox-alpha&url=${encodeURIComponent(url.trim())}`;
}

export function installPreviews(P) {
    P.fmxPreviews = function () {
        return `${card('معاينة PSD / نماذج 3D / خرائط', `${sourcePicker(this, 'fmx-pv-src', ['image', '3d', 'geo', 'data'], { accept: '.psd,.stl,.obj,.geojson,.json,.gpx,.kml,.csv' })}<div class="gh-row">${btn('fa-eye', 'معاينة', "app.fmxRenderPreview('fmx-pv-src')", 'btn-new-thread gh-btn')}</div>`, 'fa-cube')}
            ${card('Figma', `<div class="gh-row"><input id="fmx-figma-url" class="form-input-box" dir="ltr" placeholder="https://www.figma.com/design/…">${btn('fa-brands fa-figma', 'تضمين', 'app.fmxFigmaEmbed()')}</div><div class="text-dim">لاستيراد الإطارات كصور وألوان التصميم استخدم تبويب «قوالب واستيراد».</div>`, 'fa-pen-ruler')}
            <div id="fmx-pv-out" class="fmx-pv-out"></div>`;
    };
    P.fmxRenderPreview = async function (src, targetId = 'fmx-pv-out') {
        const [f] = await readSources(this, src);
        const el = document.getElementById(targetId);
        if (!f) { this.showToast('اختر ملفاً', 'warning'); return null; }
        const ext = extOf(f.name);
        try {
            if (ext === 'psd') {
                const img = decodePSD(f.bytes), c = newCanvas(img.width, img.height), ctx = c.getContext('2d');
                if (ctx && ctx.putImageData && typeof ImageData !== 'undefined') ctx.putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
                if (el) { el.innerHTML = `<div class="text-dim">PSD ${img.width}×${img.height} • ${img.mode.toUpperCase()} • ${img.channels} قنوات (الصورة المدمجة)</div>`; c.className = 'fmx-pv-canvas'; el.appendChild(c); }
                this._fmxPreviewCanvas = c;
                return img;
            }
            if (ext === 'stl' || ext === 'obj') {
                const model = parseModel(f.bytes, ext), b = modelBounds(model.triangles);
                if (el) el.innerHTML = `<div class="text-dim">${model.count.toLocaleString('ar')} مثلث • الأبعاد ${b.max.map((m, k) => (m - b.min[k]).toFixed(2)).join(' × ')} — اسحب للتدوير، العجلة للتكبير</div><canvas id="fmx-3d" class="fmx-pv-canvas" width="720" height="440"></canvas>`;
                const c = document.getElementById('fmx-3d');
                const st = { yaw: 0.6, pitch: -0.4, zoom: 1 };
                if (c) {
                    renderModel(c, model, st);
                    let drag = null;
                    c.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
                    window.addEventListener('pointerup', () => { drag = null; });
                    c.addEventListener('pointermove', (e) => { if (!drag) return; st.yaw += (e.clientX - drag[0]) / 100; st.pitch += (e.clientY - drag[1]) / 100; drag = [e.clientX, e.clientY]; renderModel(c, model, st); });
                    c.addEventListener('wheel', (e) => { e.preventDefault(); st.zoom = Math.max(0.2, Math.min(5, st.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); renderModel(c, model, st); }, { passive: false });
                }
                return model;
            }
            const text = fromUtf8(f.bytes);
            const feats = parseGeo(text, ext === 'json' ? 'geojson' : ext);
            if (!feats.length) throw new Error('لا معالم جغرافية');
            if (el) el.innerHTML = `<div class="text-dim">${feats.length} معلم (نقاط ${feats.filter(x => x.type === 'point').length}، خطوط ${feats.filter(x => x.type === 'line').length}، مضلعات ${feats.filter(x => x.type === 'polygon').length}) — انقر نقطة لفتحها في OpenStreetMap</div>${geoSVG(feats, geoBounds(feats))}`;
            return feats;
        } catch (e) { if (el) el.innerHTML = empty('❌ ' + esc(e.message), true); return null; }
    };
    P.fmxFigmaEmbed = function (urlArg) {
        const u = figmaEmbedUrl(urlArg || val('fmx-figma-url'));
        const el = document.getElementById('fmx-pv-out');
        if (!u) { this.showToast('رابط Figma غير صالح', 'warning'); return null; }
        if (el) el.innerHTML = `<iframe class="fmx-figma" src="${esc(u)}" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe>`;
        return u;
    };
}
