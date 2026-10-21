/* Release assets (#453): list, upload (uploads.github.com), download and delete files attached to releases. */
import { esc, call, fmtBytes, fmtNum } from './shared.js';
import { card, btn, empty } from './core.js';

/** "https://uploads.github.com/repos/o/r/releases/1/assets{?name,label}" → URL with ?name= (pure; tested). */
export function assetUploadUrl(template, name, label) {
    const base = String(template || '').replace(/\{[^}]*\}$/, '');
    return `${base}?name=${encodeURIComponent(name)}${label ? `&label=${encodeURIComponent(label)}` : ''}`;
}

export function installReleases(P) {
    P.ghxReleaseAssetsList = function () {
        return this.ghxView('ghxReleaseAssetsList', [], async () => {
            const releases = await this.gh(`${this.ghRepoPath()}/releases?per_page=20`);
            this._ghxReleases = new Map(releases.map(r => [r.id, r]));
            if (!releases.length) return empty('لا توجد إصدارات — أنشئ إصداراً أولاً من تبويب «الإصدارات».');
            return `<div class="gh-detail-head"><h3><i class="fa-solid fa-paperclip"></i> ملفات الإصدارات (Assets)</h3></div>`
                + releases.map(r => card(`<span dir="ltr">${esc(r.tag_name)}</span> ${r.draft ? '<span class="gh-badge dim">مسودة</span>' : ''}${r.prerelease ? '<span class="gh-badge warn">تجريبي</span>' : ''} <span class="text-dim" style="font-size:0.72rem">${(r.assets || []).length} ملف</span>`,
                    `${(r.assets || []).map(a => `<div class="gh-check-row" data-asset="${+a.id}"><i class="fa-solid fa-file-arrow-down text-blue"></i> <a class="text-emerald" href="${esc(a.browser_download_url)}" target="_blank" rel="noopener" dir="ltr">${esc(a.name)}</a> <span class="text-dim">${fmtBytes(a.size)} • ⬇ ${fmtNum(a.download_count)}${a.label ? ' • ' + esc(a.label) : ''}</span><span class="gh-spacer"></span>${btn('', call(this, 'ghxDeleteAsset', a.id, a.name), { icon: 'fa-trash', danger: true, title: 'حذف' })}</div>`).join('') || '<div class="text-dim" style="font-size:0.76rem">لا ملفات مرفقة.</div>'}
                    <div class="gh-row" style="margin-top:6px"><input type="file" multiple id="ghx-asset-${+r.id}" class="form-input-box" style="flex:1">${btn('رفع', call(this, 'ghxUploadAssetsFromInput', r.id), { icon: 'fa-upload', primary: true })}${btn('ملفات المشروع (ZIP)', call(this, 'ghxUploadProjectZip', r.id), { icon: 'fa-file-zipper' })}</div>`,
                    { icon: 'fa-tag', actions: `<a class="sidebar-btn-util gh-btn" href="${esc(r.html_url)}" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i></a>` })).join('');
        });
    };
    P.ghxUploadAssetsFromInput = function (releaseId) {
        const el = document.getElementById(`ghx-asset-${releaseId}`);
        const files = el && el.files ? Array.from(el.files) : [];
        if (!files.length) { this.showToast('اختر ملفاً أولاً', 'warning'); return null; }
        return this.ghxUploadAssets(releaseId, files);
    };
    /** files: File/Blob objects with .name (or {name, blob}). */
    P.ghxUploadAssets = async function (releaseId, files) {
        if (!this.ghRequireToken()) return null;
        let rel = this._ghxReleases && this._ghxReleases.get(releaseId);
        if (!rel) rel = await this.gh(`${this.ghRepoPath()}/releases/${releaseId}`);
        const done = [];
        for (const f of files) {
            const blob = f.blob || f, name = f.name;
            this.showToast(`⏳ رفع ${name} (${fmtBytes(blob.size)})...`, 'info');
            try {
                const res = await this.ghFetch(assetUploadUrl(rel.upload_url, name, f.label), { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
                if (!res.ok) {
                    let msg = 'HTTP ' + res.status;
                    try { const j = await res.json(); if (j && j.errors && j.errors.some(x => x.code === 'already_exists')) msg = 'يوجد ملف بنفس الاسم'; else if (j && j.message) msg = j.message; } catch (e) {}
                    throw new Error(msg);
                }
                done.push(await res.json());
            } catch (e) { this.showToast(`❌ ${name}: ${e.message}`, 'error'); }
        }
        if (done.length) this.showToast(`✅ رُفع ${done.length} ملف`, 'success');
        if (this.ghView && this.ghView.fn === 'ghxReleaseAssetsList') this.refreshGitHubHub();
        return done;
    };
    P.ghxUploadProjectZip = async function (releaseId) {
        if (!globalThis.JSZip && this.ensureJSZip) await this.ensureJSZip().catch(() => null);
        const Z = globalThis.JSZip;
        if (!Z) { this.showToast('مكتبة ZIP غير متاحة', 'error'); return null; }
        const zip = new Z();
        for (const [path, f] of this.virtualProjectFiles.entries()) {
            if (f && f.dataUrl) { const m = /^data:[^;]*;base64,(.*)$/.exec(f.dataUrl); if (m) zip.file(path, m[1], { base64: true }); } else zip.file(path, (f && f.content) || '');
        }
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        const rel = (this._ghxReleases && this._ghxReleases.get(releaseId)) || { tag_name: 'release' };
        return this.ghxUploadAssets(releaseId, [{ name: `${this.ghRepo().repo}-${rel.tag_name}.zip`, blob: new Blob([blob], { type: 'application/zip' }) }]);
    };
    P.ghxDeleteAsset = async function (id, name) {
        if (!(await this.ghxConfirm('حذف ملف الإصدار', `حذف <b dir="ltr">${esc(name || id)}</b>؟`, { danger: true }))) return false;
        try { await this.gh(`${this.ghRepoPath()}/releases/assets/${id}`, { method: 'DELETE' }); this.showToast('حُذف الملف', 'success'); this.refreshGitHubHub(); return true; } catch (e) { this.showToast('❌ ' + e.message, 'error'); return false; }
    };
}
