/* Media player: library of gallery + project audio/video, autoplay & queue (#722), playlists (#723), favourites (#724),
   watch history with resume (#725), share via Web Share / file / link (#727), embed code generator (#728). */
import { esc, call, btn, pbtn, card, empty, field, select, fmtTime, lsGet, lsSet, uid, kindOf, baseName, entryBytes, mimeOf, makeBlob, blobBytes, bytesToDataUrl, val, win } from './shared.js';

const KEY = 'ox_fmx_player_v1';
export const defaultPlayerState = () => ({ playlists: [], favorites: [], history: [], positions: {}, autoplay: true, shuffle: false, repeat: 'none', rate: 1 });
export function loadPlayerState() { return { ...defaultPlayerState(), ...lsGet(KEY, {}) }; }
export const savePlayerState = (s) => lsSet(KEY, s);
/** Next index in a queue honouring shuffle/repeat (rand injectable for tests). */
export function nextIndex(i, n, { shuffle = false, repeat = 'none', rand = Math.random } = {}) {
    if (!n) return -1;
    if (repeat === 'one') return i;
    if (shuffle) { if (n === 1) return repeat === 'all' ? 0 : -1; let j = i; while (j === i) j = Math.floor(rand() * n); return j; }
    if (i + 1 < n) return i + 1;
    return repeat === 'all' ? 0 : -1;
}
/** Push a history entry (dedup by id, newest first, cap 200). */
export function pushHistory(hist, entry, cap = 200) { return [{ ...entry, t: entry.t || Date.now() }].concat((hist || []).filter(h => h.id !== entry.id)).slice(0, cap); }
/** YouTube/Vimeo/SoundCloud page URL → embeddable URL (or null). */
export function toEmbedUrl(url) {
    const u = String(url || '').trim();
    let m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/.exec(u);
    if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
    m = /vimeo\.com\/(?:video\/)?(\d+)/.exec(u);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    if (/soundcloud\.com\//.test(u)) return `https://w.soundcloud.com/player/?url=${encodeURIComponent(u)}`;
    return null;
}
/** Embed snippet for a hosted URL. */
export function embedCode({ url, kind = 'video', title = '', autoplay = false, loop = false, width = 640, responsive = true } = {}) {
    const e = toEmbedUrl(url), at = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const flags = `${autoplay ? ' autoplay muted' : ''}${loop ? ' loop' : ''}`;
    if (e) {
        const src = `${e}${autoplay ? (e.includes('?') ? '&' : '?') + 'autoplay=1' : ''}`;
        const ifr = `<iframe src="${at(src)}" title="${at(title || 'media')}" ${responsive ? 'style="position:absolute;inset:0;width:100%;height:100%;border:0"' : `width="${width}" height="${Math.round(width * 9 / 16)}" style="border:0"`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>`;
        return responsive && !/soundcloud/.test(e) ? `<div style="position:relative;padding-top:56.25%">${ifr}</div>` : ifr;
    }
    if (kind === 'audio') return `<audio src="${at(url)}" controls preload="metadata"${flags} title="${at(title)}" style="width:100%;max-width:${width}px"></audio>`;
    if (kind === 'image') return `<img src="${at(url)}" alt="${at(title)}" loading="lazy" style="max-width:100%;height:auto">`;
    return `<video src="${at(url)}" controls playsinline preload="metadata"${flags} title="${at(title)}" style="width:100%;max-width:${width}px;height:auto"></video>`;
}

export function installPlayer(P) {
    const W = () => win();
    const out = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; return el; };
    const st = (app) => (app._fmxPlayer = app._fmxPlayer || loadPlayerState());
    const save = (app) => savePlayerState(st(app));
    /** Library: gallery audio/video + project audio/video files → [{id, name, kind, src}] */
    P.fmxMediaLibrary = async function () {
        if (this.loadMediaItems) await this.loadMediaItems();
        const g = (this.mediaItems || []).filter(m => /^(audio|video)/.test(m.type || '')).map(m => ({ id: 'g:' + m.id, name: m.name, kind: (m.type || '').split('/')[0], created: m.created }));
        const p = this.projectPaths().filter(x => ['audio', 'video'].includes(kindOf(x))).map(x => ({ id: 'p:' + x, name: x, kind: kindOf(x) }));
        return (this._fmxLib = g.concat(p));
    };
    P.fmxMediaBlob = async function (id) {
        if (id.startsWith('g:')) { const m = (this.mediaItems || []).find(x => x.id === id.slice(2)); return m && (m.blob || (m.blobId && await this.getBlob(m.blobId))); }
        if (id.startsWith('p:')) { const e = this.virtualProjectFiles.get(id.slice(2)); return e ? makeBlob([entryBytes(e)], mimeOf(id)) : null; }
        return null;
    };
    const itemRow = (app, it, i, { queue = false, pl = null } = {}) => {
        const s = st(app), fav = s.favorites.includes(it.id), pos = s.positions[it.id];
        return `<div class="gh-item static fmx-pl-item ${app._fmxNow && app._fmxNow.id === it.id ? 'active' : ''}" data-media="${esc(it.id)}"><i class="fa-solid ${it.kind === 'video' ? 'fa-film' : 'fa-music'} text-blue"></i>
            <div class="gh-item-main"><b>${esc(baseName(it.name))}</b><small>${it.id.startsWith('g:') ? 'المعرض' : 'المشروع'}${pos ? ` • توقفت عند ${fmtTime(pos)}` : ''}</small></div>
            ${btn('fa-play', '', call('fmxPlay', it.id, queue ? i : null, pl), 'gh-chip')}<button class="gh-chip ${fav ? 'active' : ''}" title="المفضلة" onclick="${call('fmxToggleFav', it.id)}"><i class="fa-${fav ? 'solid' : 'regular'} fa-star"></i></button>
            ${pl ? btn('fa-xmark', '', call('fmxPlaylistRemove', pl, it.id), 'gh-chip') : `<button class="gh-chip" title="أضف لقائمة" onclick="${call('fmxPlaylistAddPrompt', it.id)}"><i class="fa-solid fa-list-ul"></i></button>`}</div>`;
    };

    // ================================================================ PLAYER (#722 #723 #724)
    P.fmxPlayer = async function (opts = {}) {
        const s = st(this), lib = await this.fmxMediaLibrary();
        this._fmxLib = lib;
        const view = opts.view || this._fmxPlView || 'all';
        const pl = s.playlists.find(p => p.id === view);
        const list = view === 'fav' ? lib.filter(it => s.favorites.includes(it.id)) : pl ? pl.items.map(id => lib.find(it => it.id === id)).filter(Boolean) : lib;
        this._fmxMount = () => this.fmxPlayerMount();
        return `<div class="fmx-player">
            <div class="fmx-player-side">${[['all', 'fa-photo-film', 'الكل', lib.length], ['fav', 'fa-star', 'المفضلة', s.favorites.length]].map(([id, ic, l, n]) => `<button class="gh-chip ${view === id ? 'active' : ''}" onclick="${call('fmxPlayerView', id)}"><i class="fa-solid ${ic}"></i> ${l} <small>${n}</small></button>`).join('')}
                <div class="fmx-card-h">قوائم التشغيل</div>${s.playlists.map(p => `<button class="gh-chip ${view === p.id ? 'active' : ''}" data-pl="${esc(p.id)}" onclick="${call('fmxPlayerView', p.id)}"><i class="fa-solid fa-list"></i> ${esc(p.name)} <small>${p.items.length}</small></button>`).join('')}${btn('fa-plus', 'قائمة جديدة', 'app.fmxPlaylistNew()', 'gh-chip')}</div>
            <div class="fmx-player-main">
                <div id="fmx-pl-stage" class="fmx-pl-stage">${this._fmxNow ? '' : empty('اختر مقطعاً للتشغيل')}</div>
                <div class="gh-row"><label class="gh-check"><input id="fmx-pl-auto" type="checkbox" ${s.autoplay ? 'checked' : ''} onchange="${call('fmxPlayerSet', 'autoplay', null)}"> تشغيل تلقائي للتالي</label><label class="gh-check"><input id="fmx-pl-shuffle" type="checkbox" ${s.shuffle ? 'checked' : ''} onchange="${call('fmxPlayerSet', 'shuffle', null)}"> عشوائي</label>
                ${select('fmx-pl-repeat', 'التكرار', [['none', 'بلا'], ['all', 'القائمة'], ['one', 'المقطع']], s.repeat, `onchange="${call('fmxPlayerSet', 'repeat', null)}"`)}${select('fmx-pl-rate', 'السرعة', ['0.5', '0.75', '1', '1.25', '1.5', '2'], String(s.rate), `onchange="${call('fmxPlayerSet', 'rate', null)}"`)}
                ${pl ? `${btn('fa-play', 'تشغيل القائمة', call('fmxPlay', (list[0] || {}).id || '', 0, pl.id))}${btn('fa-pen', 'إعادة تسمية', call('fmxPlaylistRename', pl.id))}${btn('fa-trash', 'حذف القائمة', call('fmxPlaylistDelete', pl.id))}` : list.length ? btn('fa-play', 'تشغيل الكل', call('fmxPlay', list[0].id, 0, view)) : ''}</div>
                <div class="fmx-pl-list">${list.map((it, i) => itemRow(this, it, i, { queue: true, pl: pl ? pl.id : null })).join('') || empty(view === 'fav' ? 'لا مفضلة بعد — اضغط ⭐ على أي مقطع' : 'لا وسائط صوت/فيديو في المعرض أو المشروع')}</div>
            </div></div>`;
    };
    P.fmxPlayerView = function (id) { this._fmxPlView = id; return this.fmxLoad('player', 'library', { view: id }); };
    P.fmxPlayerSet = function (k) {
        const s = st(this);
        if (k === 'autoplay') s.autoplay = !!val('fmx-pl-auto');
        if (k === 'shuffle') s.shuffle = !!val('fmx-pl-shuffle');
        if (k === 'repeat') s.repeat = val('fmx-pl-repeat') || 'none';
        if (k === 'rate') { s.rate = +val('fmx-pl-rate') || 1; const m = document.querySelector('#fmx-pl-stage video, #fmx-pl-stage audio'); if (m) m.playbackRate = s.rate; }
        save(this);
        return s;
    };
    P.fmxPlayerMount = function () { if (this._fmxNow) this.fmxRenderStage(); };
    /** Play an item; queueIndex/view define the queue for autoplay. */
    P.fmxPlay = async function (id, queueIndex = null, view = null) {
        if (!id) return null;
        let lib = this._fmxLib || await this.fmxMediaLibrary(), it = lib.find(x => x.id === id);
        if (!it) { lib = await this.fmxMediaLibrary(); it = lib.find(x => x.id === id); } // cache may be stale after file changes
        const s = st(this);
        if (!it) { this.showToast('المقطع غير موجود', 'warning'); return null; }
        const v = view || this._fmxPlView || 'all', pl = s.playlists.find(p => p.id === v);
        const queue = (v === 'fav' ? lib.filter(x => s.favorites.includes(x.id)) : pl ? pl.items.map(i => lib.find(x => x.id === i)).filter(Boolean) : lib).map(x => x.id);
        const blob = await this.fmxMediaBlob(id);
        if (!blob) { this.showToast('تعذر قراءة المقطع', 'error'); return null; }
        if (this._fmxNow && this._fmxNow.url) try { W().URL.revokeObjectURL(this._fmxNow.url); } catch (e) {}
        this._fmxNow = { ...it, url: W().URL.createObjectURL(blob), queue, qi: queueIndex != null ? queueIndex : queue.indexOf(id) };
        if (!document.getElementById('fmx-pl-stage')) await this.openFilesHub('player', 'library', { view: v });
        this.fmxRenderStage(true);
        return this._fmxNow;
    };
    P.fmxRenderStage = function (autoplay = false) {
        const n = this._fmxNow, s = st(this), stage = document.getElementById('fmx-pl-stage');
        if (!n || !stage) return null;
        stage.innerHTML = `<${n.kind === 'video' ? 'video playsinline' : 'audio'} id="fmx-pl-media" controls src="${esc(n.url)}"></${n.kind === 'video' ? 'video' : 'audio'}><div class="gh-row"><b>${esc(baseName(n.name))}</b><span class="gh-spacer"></span>${btn('fa-backward-step', '', 'app.fmxPlayStep(-1)', 'gh-chip')}${btn('fa-forward-step', '', 'app.fmxPlayStep(1)', 'gh-chip')}${btn('fa-share-nodes', 'مشاركة', call('fmxShareMedia', n.id), 'gh-chip')}${btn('fa-code', 'تضمين', call('fmxLoad', 'player', 'share', { id: n.id }), 'gh-chip')}</div>`;
        document.querySelectorAll('.fmx-pl-item').forEach(el => el.classList.toggle('active', el.dataset.media === n.id));
        const m = document.getElementById('fmx-pl-media');
        if (!m) return null;
        m.playbackRate = s.rate || 1;
        const resume = s.positions[n.id];
        m.addEventListener('loadedmetadata', () => { if (resume && resume < (m.duration || 0) - 3) m.currentTime = resume; if (autoplay) m.play().catch(() => {}); });
        let last = 0;
        m.addEventListener('timeupdate', () => { if (Math.abs(m.currentTime - last) < 5) return; last = m.currentTime; s.positions[n.id] = Math.floor(m.currentTime); s.history = pushHistory(s.history, { id: n.id, name: n.name, kind: n.kind, pos: Math.floor(m.currentTime), dur: Math.floor(m.duration || 0) }); save(this); });
        m.addEventListener('play', () => { s.history = pushHistory(s.history, { id: n.id, name: n.name, kind: n.kind, pos: Math.floor(m.currentTime), dur: Math.floor(m.duration || 0) }); save(this); });
        m.addEventListener('ended', () => { delete s.positions[n.id]; save(this); if (s.autoplay) this.fmxPlayStep(1, true); });
        return m;
    };
    P.fmxPlayStep = function (dir = 1, auto = false) {
        const n = this._fmxNow, s = st(this);
        if (!n || !n.queue.length) return null;
        const j = dir < 0 ? Math.max(0, n.qi - 1) : nextIndex(n.qi, n.queue.length, { shuffle: s.shuffle, repeat: auto ? s.repeat : (s.repeat === 'one' ? 'all' : s.repeat) });
        if (j < 0) return null;
        return this.fmxPlay(n.queue[j], j, this._fmxPlView);
    };
    P.fmxToggleFav = function (id) { const s = st(this); s.favorites = s.favorites.includes(id) ? s.favorites.filter(x => x !== id) : [id].concat(s.favorites); save(this); if (document.querySelector('.fmx-player')) this.fmxRefresh(); return s.favorites.includes(id); };
    P.fmxPlaylistNew = async function (nameArg) {
        const name = nameArg || await this.askText('قائمة تشغيل جديدة', 'قائمتي', { label: 'الاسم' });
        if (!name) return null;
        const p = { id: uid('pl'), name, items: [], created: Date.now() };
        st(this).playlists.push(p); save(this);
        if (document.querySelector('.fmx-player')) this.fmxPlayerView(p.id);
        return p;
    };
    P.fmxPlaylistAdd = function (plId, id) { const p = st(this).playlists.find(x => x.id === plId); if (!p) return null; if (!p.items.includes(id)) p.items.push(id); save(this); this.showToast(`➕ أُضيف إلى «${esc(p.name)}»`, 'success'); return p; };
    P.fmxPlaylistRemove = function (plId, id) { const p = st(this).playlists.find(x => x.id === plId); if (!p) return null; p.items = p.items.filter(x => x !== id); save(this); if (document.querySelector('.fmx-player')) this.fmxRefresh(); return p; };
    P.fmxPlaylistAddPrompt = async function (id) {
        const s = st(this);
        if (!s.playlists.length) { const p = await this.fmxPlaylistNew(); return p ? this.fmxPlaylistAdd(p.id, id) : null; }
        const r = await this.showDialog({ title: 'أضف إلى قائمة تشغيل', fields: [{ id: 'pl', label: 'القائمة', type: 'select', options: s.playlists.map(p => ({ value: p.id, label: p.name })), value: s.playlists[0].id }], buttons: [{ label: 'إضافة', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
        if (!r) return null;
        return this.fmxPlaylistAdd(r.values.pl, id);
    };
    P.fmxPlaylistRename = async function (plId) { const p = st(this).playlists.find(x => x.id === plId); if (!p) return null; const n = await this.askText('إعادة تسمية', p.name, { label: 'الاسم' }); if (n) { p.name = n; save(this); this.fmxRefresh(); } return p; };
    P.fmxPlaylistDelete = async function (plId) { const s = st(this), p = s.playlists.find(x => x.id === plId); if (!p || !(await this.askConfirm(`حذف قائمة «${p.name}»؟`))) return false; s.playlists = s.playlists.filter(x => x.id !== plId); save(this); this.fmxPlayerView('all'); return true; };

    // ================================================================ HISTORY (#725)
    P.fmxPlayHistory = function () {
        const s = st(this);
        const groups = {};
        s.history.forEach(h => { const d = new Date(h.t).toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' }); (groups[d] = groups[d] || []).push(h); });
        return card('سجل المشاهدة والاستماع', `<div class="gh-row">${btn('fa-trash', 'مسح السجل', 'app.fmxHistoryClear()')}<span class="text-dim">${s.history.length} عنصراً • يُستأنف كل مقطع من حيث توقفت</span></div>
            ${Object.entries(groups).map(([d, list]) => `<div class="fmx-card-h">${esc(d)}</div>${list.map(h => `<div class="gh-item static" data-hist="${esc(h.id)}"><i class="fa-solid ${h.kind === 'video' ? 'fa-film' : 'fa-music'} text-dim"></i><div class="gh-item-main"><b>${esc(baseName(h.name))}</b><small>${new Date(h.t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })} • ${fmtTime(h.pos)}${h.dur ? ' / ' + fmtTime(h.dur) : ''}</small><div class="fmx-hist-bar"><i style="width:${h.dur ? Math.round(h.pos / h.dur * 100) : 0}%"></i></div></div>${btn('fa-play', 'استئناف', call('fmxPlay', h.id, null, 'all'), 'gh-chip')}${btn('fa-xmark', '', call('fmxHistoryRemove', h.id), 'gh-chip')}</div>`).join('')}`).join('') || empty('لا سجل بعد')}`, 'fa-clock-rotate-left');
    };
    P.fmxHistoryClear = async function () { if (!(await this.askConfirm('مسح سجل المشاهدة كاملاً؟'))) return false; const s = st(this); s.history = []; s.positions = {}; save(this); this.fmxRefresh(); return true; };
    P.fmxHistoryRemove = function (id) { const s = st(this); s.history = s.history.filter(h => h.id !== id); save(this); this.fmxRefresh(); return s.history; };

    // ================================================================ SHARE + EMBED (#727 #728)
    P.fmxMediaShare = async function (opts = {}) {
        const lib = await this.fmxMediaLibrary();
        const id = opts.id || (this._fmxNow && this._fmxNow.id) || (lib[0] && lib[0].id) || '';
        return card('مشاركة', `<div class="gh-row">${select('fmx-ms-item', 'المقطع', lib.map(it => [it.id, baseName(it.name)]), id)}${pbtn('fa-share-nodes', 'مشاركة (تطبيقات الجهاز)', 'app.fmxShareMedia()')}${btn('fa-link', 'رابط مشاركة', 'app.fmxShareMediaLink()')}${btn('fa-download', 'تحميل', 'app.fmxShareMediaDownload()')}</div>
                <div class="text-dim">«مشاركة» تستخدم Web Share لإرسال الملف نفسه (واتساب، بريد…) على الأجهزة الداعمة. الرابط يضمّن الملف الصغير في الرابط نفسه (مشفّراً اختيارياً).</div>`, 'fa-share-nodes')
            + card('كود التضمين', `<div class="gh-row">${field('fmx-em-url', 'رابط الملف المستضاف أو YouTube/Vimeo/SoundCloud', '', 'dir="ltr" placeholder="https://…"')}${select('fmx-em-kind', 'النوع', [['video', 'فيديو'], ['audio', 'صوت'], ['image', 'صورة']], 'video')}</div>
                <div class="gh-row"><label class="gh-check"><input id="fmx-em-auto" type="checkbox"> تشغيل تلقائي (صامت)</label><label class="gh-check"><input id="fmx-em-loop" type="checkbox"> تكرار</label><label class="gh-check"><input id="fmx-em-resp" type="checkbox" checked> متجاوب</label>${pbtn('fa-code', 'توليد', 'app.fmxEmbedGen()')}${btn('fa-file-code', 'صفحة HTML مستقلة للمقطع المختار', 'app.fmxEmbedStandalone()')}</div>
                <textarea id="fmx-em-code" class="form-input-box" dir="ltr" rows="4" readonly></textarea><div class="gh-row">${btn('fa-copy', 'نسخ', 'app.copyText(document.getElementById(\'fmx-em-code\').value)')}</div><div id="fmx-em-preview" class="fmx-em-preview"></div><div id="fmx-out"></div>`, 'fa-code');
    };
    const pick = (app, idArg) => idArg || val('fmx-ms-item') || (app._fmxNow && app._fmxNow.id);
    P.fmxShareMedia = async function (idArg) {
        const id = pick(this, idArg), blob = id && await this.fmxMediaBlob(id);
        if (!blob) { this.showToast('اختر مقطعاً', 'warning'); return null; }
        const name = baseName(id.slice(2).replace(/^m_/, '')), lib = this._fmxLib || await this.fmxMediaLibrary(), it = lib.find(x => x.id === id), fname = baseName((it && it.name) || name);
        const N = W().navigator;
        try {
            const file = new (W().File)([blob], fname, { type: blob.type || mimeOf(fname) });
            if (N.canShare && N.canShare({ files: [file] })) { await N.share({ files: [file], title: fname }); return 'shared'; }
        } catch (e) { if (e && e.name === 'AbortError') return 'aborted'; }
        this.downloadBlob(blob, fname);
        this.showToast('ℹ️ المشاركة المباشرة غير مدعومة هنا — نُزِّل الملف لترسله', 'info');
        return 'downloaded';
    };
    P.fmxShareMediaDownload = async function (idArg) { const id = pick(this, idArg), blob = id && await this.fmxMediaBlob(id); if (!blob) return null; const it = (this._fmxLib || []).find(x => x.id === id); this.downloadBlob(blob, baseName((it && it.name) || 'media')); return blob; };
    P.fmxShareMediaLink = async function (idArg) {
        const id = pick(this, idArg);
        if (!id) return null;
        if (id.startsWith('p:')) return this.openFilesHub('share', 'link', { path: id.slice(2) });
        const blob = await this.fmxMediaBlob(id), it = (this._fmxLib || []).find(x => x.id === id);
        if (!blob) return null;
        if (blob.size > 1.5e6) { this.showToast('الملف كبير على رابط مضمَّن — احفظه في المشروع وادفعه إلى GitHub ثم شارك رابطه', 'warning'); return null; }
        const path = this.uniqueProjectPath('media/' + baseName((it && it.name) || 'media.bin'));
        const bytes = await blobBytes(blob);
        this.virtualProjectFiles.set(path, { content: '', dataUrl: bytesToDataUrl(bytes, blob.type || mimeOf(path)), binary: true, size: bytes.length, lang: path.split('.').pop(), timestamp: Date.now() });
        return this.openFilesHub('share', 'link', { path });
    };
    P.fmxEmbedGen = function (o = {}) {
        const url = o.url || val('fmx-em-url');
        if (!url) { this.showToast('أدخل رابطاً', 'warning'); return null; }
        const code = embedCode({ url, kind: o.kind || val('fmx-em-kind') || 'video', autoplay: o.autoplay != null ? o.autoplay : !!val('fmx-em-auto'), loop: o.loop != null ? o.loop : !!val('fmx-em-loop'), responsive: o.responsive != null ? o.responsive : val('fmx-em-resp') !== false });
        const ta = document.getElementById('fmx-em-code'); if (ta) ta.value = code;
        const pv = document.getElementById('fmx-em-preview');
        if (pv) { pv.innerHTML = ''; const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation'); f.className = 'fmx-em-frame'; f.srcdoc = `<body style="margin:0">${code}</body>`; pv.appendChild(f); }
        return code;
    };
    P.fmxEmbedStandalone = async function (idArg) {
        const id = pick(this, idArg), blob = id && await this.fmxMediaBlob(id);
        if (!blob) { this.showToast('اختر مقطعاً', 'warning'); return null; }
        const it = (this._fmxLib || await this.fmxMediaLibrary()).find(x => x.id === id), name = baseName((it && it.name) || 'media'), kind = (it && it.kind) || 'video';
        if (blob.size > 25e6) this.showToast('⚠️ الملف كبير — الصفحة ستكون ثقيلة', 'warning');
        const src = bytesToDataUrl(await blobBytes(blob), blob.type || mimeOf(name));
        const html = `<!doctype html><html lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font-family:system-ui}video,audio{max-width:96vw;max-height:88vh}</style></head><body>${embedCode({ url: src, kind, title: name, responsive: false, width: 960 }).replace(src.replace(/&/g, '&amp;'), src)}</body></html>`;
        this.fmxOutput(makeBlob([html], 'text/html'), name.replace(/\.[^.]+$/, '') + '-player.html', { note: 'صفحة مستقلة تعمل دون اتصال — يمكن رفعها لأي استضافة وتضمينها بـ iframe' });
        return html;
    };
    P.openMediaPlayer = function () { return this.openFilesHub('player', 'library'); };
}
