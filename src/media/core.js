/* Files & Media studio shell: tabs/sections, source pickers, output card (save/download/gallery/attach). */
import { esc, call, btn, pbtn, empty, fmtBytes, kindOf, mimeOf, entryBytes, blobBytes, makeBlob, bytesToDataUrl, baseName, filesOf, val, win } from './shared.js';

export const TAB_DEFS = {
    browse: [['props', 'خصائص الملف', 'fmxProps'], ['list', 'قائمة', 'fmxViewList'], ['kanban', 'Kanban', 'fmxViewKanban'], ['timeline', 'خط زمني', 'fmxViewTimeline'], ['calendar', 'تقويم', 'fmxViewCalendar'], ['map', 'خريطة', 'fmxViewMap'], ['tree', 'شجرة المجلدات', 'fmxTreeDiagram'], ['shortcuts', 'اختصارات', 'fmxShortcuts'], ['archive', 'الأرشيف والمخفي', 'fmxArchive']],
    smart: [['organize', 'تنظيم تلقائي', 'fmxOrganize'], ['names', 'أسماء أفضل', 'fmxNames'], ['classify', 'تصنيف ووسوم', 'fmxClassify'], ['search', 'بحث بالمعنى', 'fmxSemantic'], ['summary', 'تلخيص مجلد', 'fmxSummary'], ['missing', 'ملفات ناقصة', 'fmxMissing']],
    share: [['link', 'رابط مشاركة', 'fmxShareLink'], ['tracked', 'مشاركة مع تتبع', 'fmxTrackedShares'], ['cloud', 'التخزين السحابي', 'fmxCloud'], ['sync', 'مزامنة GitHub', 'fmxGitSync'], ['perms', 'الصلاحيات', 'fmxPerms'], ['window', 'نافذة جديدة', 'fmxWindows']],
    convert: [['archive', 'ضغط وفك', 'fmxArchiveTools'], ['pdf', 'أدوات PDF', 'fmxPdfTools'], ['images', 'ضغط ودمج الصور', 'fmxImageTools'], ['scan', 'فحص الملفات', 'fmxScan'], ['preview', 'معاينات خاصة', 'fmxPreviews']],
    start: [['templates', 'قوالب المشاريع', 'fmxTemplates'], ['describe', 'مشروع من وصف', 'fmxFromDescription'], ['import', 'استيراد', 'fmxImport'], ['publish', 'نشر وتصدير', 'fmxPublish']],
    image: [['generate', 'توليد صور', 'fmxImgGenerate'], ['ai', 'تحرير بالذكاء', 'fmxImgAI'], ['local', 'تأثيرات محلية', 'fmxImgLocal'], ['meme', 'Meme وملصقات', 'fmxMeme'], ['vector', 'تحويل إلى SVG', 'fmxVectorize']],
    video: [['convert', 'تحويل وضغط', 'fmxVideoConvert'], ['merge', 'قص ودمج', 'fmxVideoMerge'], ['audio', 'استخراج الصوت', 'fmxVideoAudio'], ['gif', 'GIF', 'fmxGif'], ['subs', 'ترجمة مرئية', 'fmxSubtitles'], ['code', 'فيديو من الكود', 'fmxCodeVideo']],
    audio: [['editor', 'محرر الصوت', 'fmxAudioEditor'], ['fx', 'تنقية وتغيير الصوت', 'fmxAudioFx'], ['sfx', 'مؤثرات صوتية', 'fmxSfx'], ['library', 'مكتبة الأصوات والموسيقى', 'fmxSoundLibrary'], ['music', 'توليد موسيقى وأغنية', 'fmxMusicGen'], ['karaoke', 'كاريوكي', 'fmxKaraoke']],
    voice: [['tts', 'نص إلى كلام', 'fmxTTS'], ['stt', 'كلام إلى نص', 'fmxSTT'], ['talk', 'مكالمة مع الذكاء', 'fmxWalkie'], ['translate', 'ترجمة فورية', 'fmxLiveTranslate'], ['commands', 'أوامر صوتية', 'fmxVoiceCommands'], ['coach', 'مدرب النطق واللغة', 'fmxCoach'], ['analyze', 'تحليل الكلام', 'fmxSpeechAnalysis']],
    call: [['room', 'غرفة الاتصال', 'fmxCallRoom'], ['ai', 'محضر ذكي', 'fmxCallAI'], ['present', 'وضع العرض', 'fmxPresent']],
    create: [['avatar', 'أفاتار متحدث', 'fmxAvatar'], ['podcast', 'بودكاست', 'fmxPodcast'], ['audiobook', 'كتاب صوتي', 'fmxAudiobook'], ['news', 'نشرة أخبار', 'fmxNews'], ['ad', 'إعلان', 'fmxAd'], ['comic', 'قصة مصورة', 'fmxComic'], ['kids', 'كتاب أطفال', 'fmxKidsBook']],
    player: [['library', 'قوائم التشغيل', 'fmxPlayer'], ['history', 'سجل المشاهدة', 'fmxPlayHistory'], ['share', 'مشاركة وتضمين', 'fmxMediaShare']]
};

/** Source picker: project files of the given kinds + media gallery + upload. */
export function sourcePicker(app, id, kinds, { label = 'المصدر', accept = '', multiple = false } = {}) {
    const files = app.projectPaths ? app.projectPaths().filter(p => kinds.includes(kindOf(p))) : [];
    const gallery = (app.mediaItems || []).filter(m => kinds.includes(kindOf(m.name)));
    const opts = [['', '— اختر —'], ...files.map(p => ['p:' + p, '📁 ' + p]), ...gallery.map(m => ['g:' + m.id, '🎞️ ' + m.name])];
    return `<div class="fmx-src"><label class="fmx-field"><span>${label}</span><select id="${id}" class="form-input-box">${opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>
        <label class="fmx-field"><span>أو ارفع ملفاً</span><input id="${id}-file" type="file" class="form-input-box" ${accept ? `accept="${accept}"` : ''} ${multiple ? 'multiple' : ''}></label></div>`;
}

/** Resolve a picker (or a {path}/{blob,name}/{bytes,name} object) to [{name, bytes, mime, blob}]. */
export async function readSources(app, idOrSrc) {
    const out = [];
    const push = async (name, blob, bytes) => { bytes = bytes || await blobBytes(blob); const mime = (blob && blob.type) || mimeOf(name); out.push({ name, bytes, mime, blob: blob || makeBlob([bytes], mime) }); };
    if (idOrSrc && typeof idOrSrc === 'object') {
        const list = Array.isArray(idOrSrc) ? idOrSrc : [idOrSrc];
        for (const s of list) {
            if (s.path) { const e = app.virtualProjectFiles.get(s.path); if (e) await push(baseName(s.path), null, entryBytes(e)); }
            else if (s.bytes) await push(s.name || 'file', null, s.bytes);
            else if (s.blob) await push(s.name || s.blob.name || 'file', s.blob);
        }
        return out;
    }
    for (const f of filesOf(idOrSrc + '-file')) await push(f.name, f);
    const v = val(idOrSrc);
    if (!out.length && v) {
        if (v.startsWith('p:')) { const p = v.slice(2), e = app.virtualProjectFiles.get(p); if (e) await push(baseName(p), null, entryBytes(e)); }
        if (v.startsWith('g:')) { const m = (app.mediaItems || []).find(x => x.id === v.slice(2)); const b = m && (m.blob || (m.blobId && app.getBlob(m.blobId))); if (b) await push(m.name, b); }
    }
    return out;
}

export function installCore(P) {
    P.openFilesHub = async function (tab = 'browse', sec, opts = {}) {
        if (!TAB_DEFS[tab]) tab = 'browse';
        this.openPanel({
            title: 'استوديو الملفات والوسائط', icon: 'fa-clapperboard',
            tabs: (this.FMX_TABS || []).map(t => ({ ...t, onclick: `app.openFilesHub('${t.id}')` })), activeTab: tab,
            body: '<div id="fmx-root" class="fmx-root"></div>'
        });
        return this.fmxLoad(tab, sec, opts);
    };
    P.fmxLoad = async function (tab, sec, opts = {}) {
        const defs = TAB_DEFS[tab] || TAB_DEFS.browse;
        const def = defs.find(d => d[0] === sec) || defs.find(d => d[0] === ((this._fmxSec || {})[tab])) || defs[0];
        this._fmxSec = { ...(this._fmxSec || {}), [tab]: def[0] };
        this._fmx = { tab, sec: def[0], opts };
        document.querySelectorAll('#ox-panel-tabs .gh-tab').forEach((b, i) => b.classList.toggle('active', (this.FMX_TABS[i] || {}).id === tab));
        let root = document.getElementById('fmx-root');
        if (!root) { await this.openFilesHub(tab, def[0], opts); return; }
        root.innerHTML = `<div class="ghx-subnav fmx-subnav">${defs.map(([id, label]) => `<button class="gh-chip ${id === def[0] ? 'active' : ''}" data-fmx-sec="${id}" onclick="${call('fmxLoad', tab, id)}">${label}</button>`).join('')}</div>
            <div id="fmx-sec" class="fmx-sec" data-fmx-tab="${tab}" data-fmx-sec="${def[0]}"><div class="gh-empty"><span class="live-step-spinner"></span></div></div>`;
        this.setPanelFooter('');
        let html;
        try { html = await this[def[2]](opts); } catch (e) { console.error(e); html = empty('❌ ' + esc(e.message || e), true); }
        const el = document.getElementById('fmx-sec');
        if (el && el.dataset.fmxSec === def[0] && el.dataset.fmxTab === tab && html != null) {
            el.innerHTML = html;
            const m = this._fmxMount; this._fmxMount = null;
            if (typeof m === 'function') try { m(); } catch (e) { console.error(e); }
        }
        return el;
    };
    P.fmxRefresh = function () { const c = this._fmx; return c ? this.fmxLoad(c.tab, c.sec, c.opts) : this.openFilesHub(); };
    P.fmxFileProps = function (path) { return this.openFilesHub('browse', 'props', { path }); };

    // ---- output card shared by every tool
    P.fmxOutput = function (blob, name, { targetId = 'fmx-out', note = '', preview = true } = {}) {
        this._fmxOut = { blob, name };
        const k = kindOf(name), url = preview && win().URL.createObjectURL ? win().URL.createObjectURL(blob) : '';
        const pv = !url ? '' : k === 'image' ? `<img class="fmx-out-img" src="${esc(url)}" alt="">` : k === 'audio' ? `<audio controls src="${esc(url)}"></audio>` : k === 'video' ? `<video class="fmx-out-img" controls src="${esc(url)}"></video>` : '';
        const html = `<div class="fmx-out" data-out-name="${esc(name)}">${pv}<div class="fmx-out-meta"><b dir="ltr">${esc(name)}</b> • ${fmtBytes(blob.size)} ${note ? '• ' + note : ''}</div>
            <div class="gh-row">${btn('fa-download', 'تحميل', call('fmxSaveOut', 'download'))}${btn('fa-folder-plus', 'حفظ في المشروع', call('fmxSaveOut', 'project'))}${['image', 'audio', 'video'].includes(k) ? btn('fa-photo-film', 'المعرض', call('fmxSaveOut', 'gallery')) : ''}${pbtn('fa-paperclip', 'إرفاق', call('fmxSaveOut', 'attach'))}</div></div>`;
        const el = document.getElementById(targetId);
        if (el) el.innerHTML = html;
        return this._fmxOut;
    };
    P.fmxSaveOut = async function (target, out = this._fmxOut) {
        if (!out) return null;
        const { blob, name } = out;
        if (target === 'download') { this.downloadBlob(blob, name); return true; }
        if (target === 'gallery') { const it = await this.addMediaItem(blob, name); this.showToast('🎞️ حُفظ في المعرض', 'success'); return it; }
        const bytes = await blobBytes(blob), k = kindOf(name);
        if (target === 'project') {
            const path = this.uniqueProjectPath ? this.uniqueProjectPath(name) : name;
            const text = ['code', 'doc', 'data', 'style'].includes(k) || /svg|json|text|csv|xml|vtt|srt/.test(blob.type || '');
            if (text) this.writeProjectFile(path, new TextDecoder().decode(bytes), 'media');
            else this.virtualProjectFiles.set(path, { content: '', dataUrl: bytesToDataUrl(bytes, blob.type || mimeOf(name)), binary: true, size: bytes.length, lang: name.split('.').pop(), timestamp: Date.now() });
            if (this.renderStudioExplorer) this.renderStudioExplorer();
            this.showToast(`📁 حُفظ ${this.escapeHTML(path)} في المشروع`, 'success');
            return path;
        }
        const att = k === 'image'
            ? { name: this.uniqueAttachmentName(name), base64: bytesToDataUrl(bytes, blob.type || mimeOf(name)), isImage: true, size: bytes.length, mime: blob.type }
            : ['audio', 'video'].includes(k)
                ? { name: this.uniqueAttachmentName(name), isMedia: true, mediaKind: k, blobId: this.putBlob(blob), size: bytes.length, mime: blob.type, textContent: `[ملف ${k} مرفق: ${name}]` }
                : { name: this.uniqueAttachmentName(name), textContent: new TextDecoder().decode(bytes).slice(0, 200000), size: bytes.length };
        this.currentAttachments.push(att);
        this.renderAttachmentTray();
        this.showToast('📎 تم الإرفاق', 'success');
        return att;
    };
    P.fmxBusy = function (id, msg) { const el = document.getElementById(id); if (el) el.innerHTML = `<div class="gh-empty"><span class="live-step-spinner"></span> ${msg || ''}</div>`; };
}
