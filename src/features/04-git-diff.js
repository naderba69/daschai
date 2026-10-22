/* ==============================================================================
   OX-Alpha Workbench Pro — Sprint 3a: Diff engine, 3-way merge, conflict-aware commits
   Ideas implemented (THOUSAND_IDEAS.md):
     #461  Visual merge-conflict resolution (3-way merge, per-conflict choice)
     #210  Compare two versions (Myers line diff, unified + side-by-side, word highlight)
     #61   AI commit message (button in the review dialog)
   Fixes:
     - the old diff compared line N with line N (one inserted line marked the rest of the file as changed)
     - the Diff button compared against the last *previewed* file, not the active file
     - commits silently overwrote changes pushed to GitHub after the file was opened
   ============================================================================== */
(function () {
    'use strict';
    if (typeof OXAlphaApp === 'undefined') return;
    const P = OXAlphaApp.prototype;

    // ------------------------------------------------------------------ MYERS DIFF
    const MAX_D = 2000; // beyond this edit distance fall back to a block replace (keeps memory bounded)

    /** Returns ops: [{ t: '=', a, b } | { t: '-', a } | { t: '+', b }] where a/b are line indexes. */
    function diffLines(a, b) {
        let pre = 0;
        while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
        let endA = a.length, endB = b.length;
        while (endA > pre && endB > pre && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
        const ops = [];
        for (let i = 0; i < pre; i++) ops.push({ t: '=', a: i, b: i });
        myersMiddle(a, b, pre, endA, pre, endB, ops);
        for (let i = 0; i < a.length - endA; i++) ops.push({ t: '=', a: endA + i, b: endB + i });
        return ops;
    }

    function myersMiddle(a, b, a0, a1, b0, b1, ops) {
        const N = a1 - a0, M = b1 - b0;
        if (N === 0) { for (let j = b0; j < b1; j++) ops.push({ t: '+', b: j }); return; }
        if (M === 0) { for (let i = a0; i < a1; i++) ops.push({ t: '-', a: i }); return; }
        const max = N + M, off = max + 1;
        const v = new Int32Array(2 * max + 3);
        const trace = [];
        let found = -1;
        outer:
        for (let d = 0; d <= Math.min(max, MAX_D); d++) {
            trace.push(v.slice(off - d, off + d + 1));
            for (let k = -d; k <= d; k += 2) {
                let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
                let y = x - k;
                while (x < N && y < M && a[a0 + x] === b[b0 + y]) { x++; y++; }
                v[off + k] = x;
                if (x >= N && y >= M) { found = d; break outer; }
            }
        }
        if (found === -1) { // too different: replace the whole block
            for (let i = a0; i < a1; i++) ops.push({ t: '-', a: i });
            for (let j = b0; j < b1; j++) ops.push({ t: '+', b: j });
            return;
        }
        const rev = [];
        let x = N, y = M;
        for (let d = found; d >= 0; d--) {
            const vv = trace[d]; // v at the start of iteration d, indexed k + d
            const get = (k) => vv[k + d];
            const k = x - y;
            if (d === 0) { while (x > 0 && y > 0) { rev.push({ t: '=', a: a0 + x - 1, b: b0 + y - 1 }); x--; y--; } break; }
            const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
            const prevX = get(prevK), prevY = prevX - prevK;
            while (x > prevX && y > prevY) { rev.push({ t: '=', a: a0 + x - 1, b: b0 + y - 1 }); x--; y--; }
            if (x === prevX) rev.push({ t: '+', b: b0 + y - 1 }); else rev.push({ t: '-', a: a0 + x - 1 });
            x = prevX; y = prevY;
        }
        for (let i = rev.length - 1; i >= 0; i--) ops.push(rev[i]);
    }

    /** Group ops into hunks with `ctx` lines of context. */
    function buildHunks(ops, ctx = 3) {
        const hunks = [];
        let i = 0;
        while (i < ops.length) {
            if (ops[i].t === '=') { i++; continue; }
            let start = Math.max(0, i - ctx), end = i;
            while (end < ops.length) {
                if (ops[end].t !== '=') { end++; continue; }
                let run = 0;
                while (end + run < ops.length && ops[end + run].t === '=') run++;
                if (end + run >= ops.length || run > ctx * 2) { end = Math.min(ops.length, end + ctx); break; }
                end += run;
            }
            hunks.push(ops.slice(start, end));
            i = end;
        }
        return hunks;
    }

    const diffStats = (ops) => ({ add: ops.filter(o => o.t === '+').length, del: ops.filter(o => o.t === '-').length });

    P.diffLines = diffLines;
    P.diffStats = diffStats;

    // ------------------------------------------------------------------ 3-WAY MERGE
    /** Change hunks of `side` relative to base: [{ bs, be, lines }] */
    function changeHunks(base, side) {
        const ops = diffLines(base, side);
        const hunks = [];
        let cur = null, baseIdx = 0;
        ops.forEach(o => {
            if (o.t === '=') { if (cur) { hunks.push(cur); cur = null; } baseIdx = o.a + 1; return; }
            if (!cur) cur = { bs: baseIdx, be: baseIdx, lines: [] };
            if (o.t === '-') { cur.be = o.a + 1; baseIdx = o.a + 1; }
            else cur.lines.push(side[o.b]);
        });
        if (cur) hunks.push(cur);
        return hunks;
    }

    function applyWithin(base, cs, ce, hunks) {
        const out = [];
        let i = cs;
        hunks.forEach(h => {
            while (i < h.bs) out.push(base[i++]);
            out.push(...h.lines);
            i = h.be;
        });
        while (i < ce) out.push(base[i++]);
        return out;
    }

    /** diff3-style merge. Returns { segments: [{type:'ok',lines}|{type:'conflict',base,ours,theirs}], conflicts } */
    function merge3(baseText, oursText, theirsText) {
        const base = baseText.split('\n'), ours = oursText.split('\n'), theirs = theirsText.split('\n');
        const all = [
            ...changeHunks(base, ours).map(h => ({ ...h, side: 'o' })),
            ...changeHunks(base, theirs).map(h => ({ ...h, side: 't' }))
        ].sort((x, y) => x.bs - y.bs || x.be - y.be);
        const segments = [];
        let pos = 0, conflicts = 0, i = 0;
        const pushOk = (lines) => {
            if (!lines.length) return;
            const last = segments[segments.length - 1];
            if (last && last.type === 'ok') last.lines.push(...lines); else segments.push({ type: 'ok', lines: [...lines] });
        };
        while (i < all.length) {
            const cluster = [all[i]];
            let cs = all[i].bs, ce = all[i].be;
            i++;
            // Overlapping or touching hunks form one cluster (same rule as git: adjacent edits conflict)
            while (i < all.length && all[i].bs <= ce) { cluster.push(all[i]); ce = Math.max(ce, all[i].be); i++; }
            pushOk(base.slice(pos, cs));
            const o = cluster.filter(h => h.side === 'o'), t = cluster.filter(h => h.side === 't');
            const oursLines = applyWithin(base, cs, ce, o), theirsLines = applyWithin(base, cs, ce, t);
            if (!t.length) pushOk(oursLines);
            else if (!o.length) pushOk(theirsLines);
            else if (oursLines.join('\n') === theirsLines.join('\n')) pushOk(oursLines);
            else { segments.push({ type: 'conflict', base: base.slice(cs, ce), ours: oursLines, theirs: theirsLines }); conflicts++; }
            pos = ce;
        }
        pushOk(base.slice(pos));
        return { segments, conflicts };
    }
    P.merge3 = merge3;

    // ------------------------------------------------------------------ RENDERING
    const wordDiff = (oldLine, newLine, esc) => {
        let p = 0;
        while (p < oldLine.length && p < newLine.length && oldLine[p] === newLine[p]) p++;
        let s = 0;
        while (s < oldLine.length - p && s < newLine.length - p && oldLine[oldLine.length - 1 - s] === newLine[newLine.length - 1 - s]) s++;
        const wrap = (line) => {
            const mid = line.slice(p, line.length - s);
            if (!mid || (p === 0 && s === 0)) return esc(line);
            return esc(line.slice(0, p)) + `<span class="diff-word">${esc(mid)}</span>` + esc(line.slice(line.length - s));
        };
        return [wrap(oldLine), wrap(newLine)];
    };

    /** Render ops (old/new line arrays) as HTML. mode: 'unified' | 'split' */
    P.renderDiffHTML = function (oldLines, newLines, ops, mode = 'unified') {
        const esc = (x) => this.escapeHTML(x);
        const hunks = buildHunks(ops);
        if (!hunks.length) return '<div class="diff-line info">لا توجد فروقات — الملف مطابق.</div>';
        let html = '';
        hunks.forEach(h => {
            const firstA = h.find(o => o.a !== undefined), firstB = h.find(o => o.b !== undefined);
            const aStart = firstA ? firstA.a + 1 : 0, bStart = firstB ? firstB.b + 1 : 0;
            const aLen = h.filter(o => o.t !== '+').length, bLen = h.filter(o => o.t !== '-').length;
            html += `<div class="diff-hunk-header">@@ -${aStart},${aLen} +${bStart},${bLen} @@</div>`;
            // pair consecutive del/add runs for word highlighting & split view
            let k = 0;
            while (k < h.length) {
                if (h[k].t === '=') {
                    const o = h[k];
                    const text = esc(newLines[o.b]);
                    html += mode === 'split'
                        ? `<div class="diff-split-row"><span class="ln">${o.a + 1}</span><code>${text}</code><span class="ln">${o.b + 1}</span><code>${text}</code></div>`
                        : `<div class="diff-line"><span class="ln">${o.a + 1}</span><span class="ln">${o.b + 1}</span><code>  ${text}</code></div>`;
                    k++; continue;
                }
                const dels = [], adds = [];
                while (k < h.length && h[k].t === '-') dels.push(h[k++]);
                while (k < h.length && h[k].t === '+') adds.push(h[k++]);
                const n = Math.max(dels.length, adds.length);
                const rendered = [];
                for (let r = 0; r < n; r++) {
                    const d = dels[r], a = adds[r];
                    if (d && a && dels.length === adds.length) {
                        const [od, na] = wordDiff(oldLines[d.a], newLines[a.b], esc);
                        rendered.push([d, od, a, na]);
                    } else rendered.push([d, d ? esc(oldLines[d.a]) : '', a, a ? esc(newLines[a.b]) : '']);
                }
                if (mode === 'split') {
                    rendered.forEach(([d, dt, a, at]) => {
                        html += `<div class="diff-split-row"><span class="ln">${d ? d.a + 1 : ''}</span><code class="${d ? 'del' : 'empty'}">${dt}</code><span class="ln">${a ? a.b + 1 : ''}</span><code class="${a ? 'add' : 'empty'}">${at}</code></div>`;
                    });
                } else {
                    rendered.forEach(([d, dt]) => { if (d) html += `<div class="diff-line del"><span class="ln">${d.a + 1}</span><span class="ln"></span><code>- ${dt}</code></div>`; });
                    rendered.forEach(([, , a, at]) => { if (a) html += `<div class="diff-line add"><span class="ln"></span><span class="ln">${a.b + 1}</span><code>+ ${at}</code></div>`; });
                }
            }
        });
        return html;
    };

    /** Render a GitHub unified patch string (from the PR/compare "files" API). */
    P.renderPatchHTML = function (patch) {
        if (!patch) return '<div class="diff-line info">لا يتوفر عرض نصي (ملف ثنائي أو كبير جداً)</div>';
        const esc = (x) => this.escapeHTML(x);
        let a = 0, b = 0, html = '';
        patch.split('\n').forEach(line => {
            const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
            if (m) { a = +m[1]; b = +m[2]; html += `<div class="diff-hunk-header">${esc(line)}</div>`; return; }
            if (line.startsWith('+')) html += `<div class="diff-line add"><span class="ln"></span><span class="ln">${b++}</span><code>${esc(line)}</code></div>`;
            else if (line.startsWith('-')) html += `<div class="diff-line del"><span class="ln">${a++}</span><span class="ln"></span><code>${esc(line)}</code></div>`;
            else if (line.startsWith('\\')) html += `<div class="diff-line info"><code>${esc(line)}</code></div>`;
            else html += `<div class="diff-line"><span class="ln">${a++}</span><span class="ln">${b++}</span><code>${esc(line)}</code></div>`;
        });
        return html;
    };

    // ------------------------------------------------------------------ GITHUB FILE I/O
    const b64ToUtf8 = (b64) => new TextDecoder('utf-8').decode(Uint8Array.from(atob(String(b64).replace(/\s/g, '')), c => c.charCodeAt(0)));
    const utf8ToB64 = (text) => {
        const bytes = new TextEncoder().encode(text);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    };
    P.b64ToUtf8 = b64ToUtf8;
    P.utf8ToB64 = utf8ToB64;

    P.ghRepo = function () {
        return {
            owner: this.settings.githubOwner || 'naderba69',
            repo: this.settings.githubRepo || 'daschai',
            branch: this.settings.githubBranch || 'main'
        };
    };

    const encPath = (p) => String(p).replace(/^[/\\]+/, '').split('/').map(encodeURIComponent).join('/');
    P.ghEncodePath = encPath;

    /** Minimal GitHub REST client with friendly Arabic errors and rate-limit tracking. */
    P.gh = async function (path, { method = 'GET', body, accept, allow = [] } = {}) {
        const headers = { 'Accept': accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
        const token = this.settings.githubToken?.trim();
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch('https://api.github.com' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
        const rem = res.headers && res.headers.get('x-ratelimit-remaining');
        if (rem !== null && rem !== undefined) {
            this._ghRate = { remaining: +rem, limit: +(res.headers.get('x-ratelimit-limit') || 0), reset: +(res.headers.get('x-ratelimit-reset') || 0) };
            if (this.renderGhRate) this.renderGhRate();
        }
        if (allow.includes(res.status)) return { __status: res.status };
        if (res.status === 204 || res.status === 205) return null;
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const raw = err.message || `HTTP ${res.status}`;
            const details = (err.errors || []).map(e => e.message || e.code).filter(Boolean).join('، ');
            const msg = {
                401: 'رمز GitHub غير صالح أو منتهي — حدّثه في الإعدادات',
                403: /rate limit/i.test(raw) ? 'تجاوزت حد طلبات GitHub — أضف رمز PAT أو انتظر قليلاً' : 'صلاحيات الرمز غير كافية لهذه العملية',
                404: 'غير موجود (أو مستودع خاص يحتاج رمز PAT بصلاحية repo)',
                409: 'تعارض: تغيّر الفرع على GitHub — حدّث وأعد المحاولة',
                422: `طلب غير صالح: ${details || raw}`
            }[res.status] || raw;
            const e = new Error(msg);
            e.status = res.status; e.raw = raw;
            throw e;
        }
        const ct = res.headers && res.headers.get('content-type') || '';
        const text = await res.text();
        return ct.includes('json') ? (text ? JSON.parse(text) : null) : text;
    };

    const baseKey = (o, r, b, path) => `${o}/${r}@${b}:${String(path).replace(/^[/\\]+/, '')}`;
    P.recordGitHubBase = function (path, content, sha, ctx) {
        if (!sha) return;
        const { owner, repo, branch } = ctx || this.ghRepo();
        if (!this.ghBase) this.ghBase = new Map();
        this.ghBase.set(baseKey(owner, repo, branch, path), { sha, content });
    };
    P.getGitHubBase = function (path) {
        const { owner, repo, branch } = this.ghRepo();
        return this.ghBase ? this.ghBase.get(baseKey(owner, repo, branch, path)) : undefined;
    };

    /** Fetch a file (content + blob sha) from the active branch; null when it does not exist. */
    P.ghGetFile = async function (path) {
        const { owner, repo, branch } = this.ghRepo();
        const r = await this.gh(`/repos/${owner}/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`, { allow: [404] });
        if (!r || r.__status === 404) return null;
        if (Array.isArray(r)) throw new Error('المسار مجلد وليس ملفاً');
        let content = '';
        if (r.content && r.encoding === 'base64') content = b64ToUtf8(r.content);
        else if (r.download_url) content = await (await fetch(r.download_url)).text(); // files > 1MB
        return { sha: r.sha, content };
    };

    // Override: preview through the contents API so we know the blob sha (works for private repos too)
    P.previewGitHubFile = async function (path) {
        const title = document.getElementById('gh-file-viewer-title');
        const viewer = document.getElementById('repo-file-viewer');
        if (title) title.innerText = path;
        if (viewer) viewer.innerText = '// جاري التحميل من GitHub...';
        try {
            const f = await this.ghGetFile(path);
            if (!f) throw new Error('الملف غير موجود');
            this.selectedFileContent = { path, content: f.content, sha: f.sha };
            this.recordGitHubBase(path, f.content, f.sha);
            if (viewer) viewer.innerText = f.content;
        } catch (e) {
            if (viewer) viewer.innerText = `// تعذر تحميل الملف: ${e.message}`;
        }
    };

    // ------------------------------------------------------------------ COMMIT REVIEW FLOW
    P.toggleDiffView = function () {
        this.diffViewMode = this.diffViewMode === 'split' ? 'unified' : 'split';
        try { localStorage.setItem('ox_alpha_diff_view', this.diffViewMode); } catch (e) {}
        if (this.pendingCommit) this.renderCommitReview();
    };

    P.commitStudioFile = function () {
        if (!this.activeStudioFile) return;
        const code = document.getElementById('studio-editor-textarea')?.value ?? '';
        this.openCommitReview(this.activeStudioFile, code);
    };
    P.openDiffViewerForActiveStudioFile = P.commitStudioFile;

    // Kept for compatibility (AI-generated buttons / old calls): commit = review first
    P.commitFileToGitHub = function (path, content) { return this.openCommitReview(path, content); };
    // Code blocks in chat call openDiffModal(path, '', code): always diff against the real GitHub version
    P.openDiffModal = function (path, _oldContent, content) { return this.openCommitReview(path, content); };

    P.openCommitReview = async function (path, content, opts = {}) {
        if (!this.settings.githubToken?.trim()) {
            this.showToast('⚠️ يلزم رمز GitHub PAT في الإعدادات لعمل Commit', 'warning');
            this.openSettingsModal();
            if (this.switchSettingsTab) this.switchSettingsTab('tab-github');
            return;
        }
        const modal = document.getElementById('diff-modal');
        const box = document.getElementById('git-diff-output-box');
        if (!modal || !box) return;
        const { owner, repo, branch } = this.ghRepo();
        if (!this.diffViewMode) { try { this.diffViewMode = localStorage.getItem('ox_alpha_diff_view') || 'unified'; } catch (e) { this.diffViewMode = 'unified'; } }
        document.getElementById('diff-file-path-title').innerText = path;
        document.getElementById('diff-target-branch').innerText = `${repo}@${branch}`;
        box.innerHTML = '<div class="diff-line info"><span class="live-step-spinner"></span> جاري جلب نسخة GitHub الحالية للمقارنة...</div>';
        modal.classList.add('active');
        let remote;
        try { remote = await this.ghGetFile(path); }
        catch (e) { box.innerHTML = `<div class="diff-line del"><code>❌ ${this.escapeHTML(e.message)}</code></div>`; return; }
        const base = opts.base !== undefined ? opts.base : this.getGitHubBase(path);
        // Remote moved since we loaded the file, and differs from our version → 3-way merge
        if (!opts.skipMerge && remote && base && remote.sha !== base.sha && remote.content !== content && base.content !== remote.content) {
            this.closeModals();
            this.openMergeResolver(path, base, content, remote);
            return;
        }
        this.pendingCommit = { path, content, remote, owner, repo, branch, note: opts.note || '' };
        const msg = document.getElementById('diff-commit-message');
        if (msg && !opts.keepMessage) msg.value = opts.message || (remote ? `update ${path}` : `add ${path}`);
        this.renderCommitReview();
    };

    P.renderCommitReview = function () {
        const pc = this.pendingCommit;
        const box = document.getElementById('git-diff-output-box');
        if (!pc || !box) return;
        const oldText = pc.remote ? pc.remote.content : '';
        const oldLines = pc.remote ? oldText.split('\n') : [];
        const newLines = pc.content.split('\n');
        const ops = diffLines(oldLines, newLines);
        const st = diffStats(ops);
        pc.stats = st;
        pc.unchanged = pc.remote && oldText === pc.content;
        const stats = document.getElementById('diff-stats');
        if (stats) stats.innerHTML = `<span class="add">+${st.add}</span> <span class="del">−${st.del}</span>`;
        const label = document.getElementById('diff-view-label');
        if (label) label.textContent = this.diffViewMode === 'split' ? 'عرض موحد' : 'جنباً إلى جنب';
        const note = document.getElementById('diff-context-note');
        if (note) note.innerHTML = (pc.note ? `${pc.note} • ` : '')
            + (pc.remote ? `مقارنة مع آخر نسخة على GitHub (<code dir="ltr">${pc.remote.sha.slice(0, 7)}</code>)` : '🆕 ملف جديد — سيُنشأ على GitHub');
        box.innerHTML = pc.unchanged
            ? '<div class="diff-line info">لا توجد فروقات — الملف مطابق لنسخة GitHub.</div>'
            : this.renderDiffHTML(oldLines, newLines, ops, this.diffViewMode);
        box.classList.toggle('split', this.diffViewMode === 'split');
        const btn = document.getElementById('btn-diff-confirm-commit');
        if (btn) btn.disabled = !!pc.unchanged;
    };

    P.confirmCommitFromDiff = async function () {
        const pc = this.pendingCommit;
        if (!pc || pc.unchanged || this._committing) return;
        const message = (document.getElementById('diff-commit-message')?.value || '').trim() || `update ${pc.path}`;
        const btn = document.getElementById('btn-diff-confirm-commit');
        this._committing = true;
        if (btn) btn.disabled = true;
        try {
            const body = { message, content: utf8ToB64(pc.content), branch: pc.branch };
            if (pc.remote) body.sha = pc.remote.sha;
            const res = await this.gh(`/repos/${pc.owner}/${pc.repo}/contents/${encPath(pc.path)}`, { method: 'PUT', body });
            const newSha = res?.content?.sha;
            if (newSha) this.recordGitHubBase(pc.path, pc.content, newSha, pc);
            if (this.virtualProjectFiles.has(pc.path)) {
                const f = this.virtualProjectFiles.get(pc.path);
                this.virtualProjectFiles.set(pc.path, { ...f, content: pc.content, timestamp: Date.now() });
            }
            this.pendingCommit = null;
            this.closeModals();
            this.showToast(`✅ Commit ${(res?.commit?.sha || '').slice(0, 7)} على ${pc.branch}: ${message}`, 'success');
            if (this.isCodeStudioOpen) this.renderStudioWorkspace();
            return res;
        } catch (e) {
            if (e.status === 409 || (e.status === 422 && /sha/i.test(e.raw || ''))) {
                // Someone pushed between review and commit → re-run review (will merge if needed)
                this.showToast('⚠️ تغيّر الملف على GitHub أثناء المراجعة — جاري الدمج...', 'warning');
                const base = pc.remote ? { sha: pc.remote.sha, content: pc.remote.content } : undefined;
                return this.openCommitReview(pc.path, pc.content, { base, keepMessage: true });
            }
            this.showToast(`❌ فشل الـ Commit: ${e.message}`, 'error');
        } finally {
            this._committing = false;
            if (btn && this.pendingCommit) btn.disabled = false;
        }
    };

    P.suggestCommitMessage = async function () {
        const pc = this.pendingCommit;
        if (!pc) return;
        if (!this.settings.apiKey?.trim() || !this.streamOpenRouter) { this.showToast('يلزم مفتاح OpenRouter لاقتراح الرسالة', 'warning'); return; }
        const oldLines = pc.remote ? pc.remote.content.split('\n') : [];
        const newLines = pc.content.split('\n');
        const ops = diffLines(oldLines, newLines);
        let patch = '';
        buildHunks(ops, 2).forEach(h => h.forEach(o => {
            patch += o.t === '=' ? `  ${newLines[o.b]}\n` : o.t === '-' ? `- ${oldLines[o.a]}\n` : `+ ${newLines[o.b]}\n`;
        }));
        const input = document.getElementById('diff-commit-message');
        if (input) input.value = '✨ ...';
        try {
            const model = (this.routeForCategory && this.routeForCategory('coding', { mode: 'economy' })) || this.settings.model;
            const r = await this.streamOpenRouter({
                model, maxTokens: 120,
                messages: [{ role: 'user', content: `Write ONE git commit message in Conventional Commits format (type(scope): summary, max 72 chars, English, imperative). Output only the message.\nFile: ${pc.path}\nDiff:\n${patch.slice(0, 12000)}` }]
            });
            const line = (r.content || '').replace(/```[\s\S]*?```/g, '').split('\n').map(s => s.trim().replace(/^["'`]|["'`]$/g, '')).find(Boolean);
            if (input) input.value = line || `update ${pc.path}`;
            if (this.recordUsage) this.recordUsage({ model, usage: r.usage, promptChars: patch.length, completionChars: (r.content || '').length, durationMs: r.durationMs, source: 'commit-msg' });
        } catch (e) {
            if (input) input.value = `update ${pc.path}`;
            this.showToast('تعذر اقتراح الرسالة: ' + e.message, 'error');
        }
    };

    // ------------------------------------------------------------------ MERGE RESOLVER
    P.openMergeResolver = function (path, base, ours, remote) {
        const result = merge3(base.content, ours, remote.content);
        this.pendingMerge = { path, base, ours, remote, result, choices: result.segments.map(s => (s.type === 'conflict' ? null : 'ok')) };
        if (result.conflicts === 0) {
            // Clean auto-merge: go straight to review with an explanatory note
            const merged = result.segments.map(s => s.lines.join('\n')).join('\n');
            this.showToast('🔀 تغيّر الملف على GitHub — تم دمج التعديلات تلقائياً بدون تعارض', 'info');
            this.openCommitReview(path, merged, { skipMerge: true, note: '🔀 دمج تلقائي لتعديلاتك مع تعديلات GitHub الجديدة' });
            return result;
        }
        document.getElementById('merge-file-title').innerText = path;
        document.getElementById('merge-modal').classList.add('active');
        this.renderMergeResolver();
        return result;
    };

    P.renderMergeResolver = function () {
        const pm = this.pendingMerge;
        const body = document.getElementById('merge-body');
        if (!pm || !body) return;
        const esc = (x) => this.escapeHTML(x);
        const pre = (lines, cls) => `<pre class="merge-pre ${cls}" dir="ltr">${lines.length ? lines.map(esc).join('\n') : '<i>(فارغ — حذف)</i>'}</pre>`;
        let n = 0;
        body.innerHTML = pm.result.segments.map((s, i) => {
            if (s.type === 'ok') {
                const lines = s.lines;
                const preview = lines.length > 6 ? [...lines.slice(0, 2), `… ${lines.length - 4} سطراً بدون تعارض …`, ...lines.slice(-2)] : lines;
                return `<pre class="merge-pre ok" dir="ltr">${preview.map(esc).join('\n')}</pre>`;
            }
            n++;
            const ch = pm.choices[i];
            const btn = (v, label) => `<button class="merge-choice ${ch === v ? 'active' : ''}" onclick="app.mergeChoose(${i}, '${v}')">${label}</button>`;
            return `<div class="merge-conflict ${ch ? 'resolved' : ''}">
                <div class="merge-conflict-head"><b>تعارض ${n}</b>${btn('ours', 'نسختي')}${btn('theirs', 'نسخة GitHub')}${btn('both', 'كلاهما')}</div>
                <div class="merge-cols">
                    <div><div class="merge-col-title">نسختي (المحلية)</div>${pre(s.ours, 'ours')}</div>
                    <div><div class="merge-col-title">نسخة GitHub (<span dir="ltr">${esc(pm.remote.sha.slice(0, 7))}</span>)</div>${pre(s.theirs, 'theirs')}</div>
                </div>
            </div>`;
        }).join('');
        const left = pm.choices.filter(c => c === null).length;
        document.getElementById('merge-summary').innerHTML = left
            ? `⚠️ تغيّر الملف على GitHub بعد أن فتحته. ${pm.result.conflicts} تعارض — بقي <b>${left}</b> بدون اختيار. التعديلات غير المتعارضة دُمجت تلقائياً.`
            : '✅ تم حل كل التعارضات — تابع لمراجعة النتيجة النهائية';
        const cont = document.getElementById('merge-continue-btn');
        if (cont) cont.disabled = left > 0;
    };

    P.mergeChoose = function (i, v) {
        if (!this.pendingMerge) return;
        this.pendingMerge.choices[i] = v;
        this.renderMergeResolver();
    };

    P.mergeChooseAll = function (v) {
        if (!this.pendingMerge) return;
        this.pendingMerge.choices = this.pendingMerge.result.segments.map(s => (s.type === 'conflict' ? v : 'ok'));
        this.renderMergeResolver();
    };

    P.buildMergedText = function () {
        const pm = this.pendingMerge;
        return pm.result.segments.map((s, i) => {
            if (s.type === 'ok') return s.lines;
            const c = pm.choices[i];
            return c === 'ours' ? s.ours : c === 'theirs' ? s.theirs : [...s.ours, ...s.theirs];
        }).flat().join('\n');
    };

    P.finishMerge = function () {
        const pm = this.pendingMerge;
        if (!pm || pm.choices.some(c => c === null)) return;
        const merged = this.buildMergedText();
        this.closeModals();
        // Studio keeps the merged result so the user sees what will be committed
        if (this.virtualProjectFiles.has(pm.path)) {
            const f = this.virtualProjectFiles.get(pm.path);
            this.virtualProjectFiles.set(pm.path, { ...f, content: merged, timestamp: Date.now() });
            if (this.isCodeStudioOpen) this.renderStudioWorkspace();
        }
        this.pendingMerge = null;
        this.openCommitReview(pm.path, merged, { skipMerge: true, note: `🔀 نتيجة حل ${pm.result.conflicts} تعارض` });
    };
})();
