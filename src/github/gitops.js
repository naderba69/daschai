/* Git operations through the GitHub REST "git data" API — no local git needed.
   Cherry-pick (#422), rebase (#423), reorder (#425), reword (#426), revert (#427), multi-file commits,
   and the network-graph lane layout (#430).

   Cherry-pick technique (3-way merge done by GitHub):
     C = commit to pick (parent P), H = target head.
     1. S = commit{ tree: H.tree, parents: [P] } on a temporary branch
     2. POST /merges { base: tmp, head: C }  → merge base is P, so the result = H + (P→C)
     3. N = commit{ tree: merge.tree, parents: [H], message/author of C }  → fast-forward target to N
   Revert = cherry-pick of a synthetic commit R{ tree: P.tree, parents: [C] } (applies C→P). */
import { encRef, shortSha, headline } from './shared.js';

export function gitOps(app, rp) {
    rp = rp || app.ghRepoPath();
    const g = (p, o) => app.gh(rp + p, o);
    const authorOf = (c) => (c && c.author && c.author.name ? { name: c.author.name, email: c.author.email, date: c.author.date } : undefined);
    const tmpName = () => `ox-tmp/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    const ops = {
        rp,
        async headOf(branch) { const r = await g(`/git/ref/heads/${encRef(branch)}`); return r.object.sha; },
        getCommit: (sha) => g(`/git/commits/${sha}`),
        createCommit({ message, tree, parents, author }) {
            const body = { message, tree, parents };
            if (author) body.author = author;
            return g('/git/commits', { method: 'POST', body });
        },
        setRef: (branch, sha, force = false) => g(`/git/refs/heads/${encRef(branch)}`, { method: 'PATCH', body: { sha, force } }),
        createRef: (branch, sha) => g('/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha } }),
        deleteRef: (branch) => g(`/git/refs/heads/${encRef(branch)}`, { method: 'DELETE' }).catch(() => null),

        /** Apply commit `sha` on top of `headSha`; returns { sha, empty }. Throws e.conflict on merge conflicts. */
        async pickOnto(headSha, sha, { message } = {}) {
            const C = await ops.getCommit(sha);
            if (!C.parents || C.parents.length !== 1) throw new Error(`لا يمكن تطبيق ${shortSha(sha)}: commit دمج أو جذري`);
            const H = await ops.getCommit(headSha);
            const tmp = tmpName();
            const S = await ops.createCommit({ message: 'ox: temp', tree: H.tree.sha, parents: [C.parents[0].sha] });
            await ops.createRef(tmp, S.sha);
            try {
                const M = await g('/merges', { method: 'POST', body: { base: tmp, head: sha, commit_message: 'ox: temp merge' }, allow: [409] });
                if (M && M.__status === 409) {
                    const e = new Error(`تعارض عند تطبيق ${shortSha(sha)} «${headline(C.message)}» — حلّه عبر PR`);
                    e.conflict = sha; e.status = 409;
                    throw e;
                }
                const tree = M && M.commit ? M.commit.tree.sha : H.tree.sha;
                if (tree === H.tree.sha) return { sha: headSha, empty: true };
                const N = await ops.createCommit({ message: message || C.message, tree, parents: [headSha], author: authorOf(C) });
                return { sha: N.sha, empty: false };
            } finally { await ops.deleteRef(tmp); }
        },

        /** Replay commits (oldest first) onto `ontoSha`; returns { sha, applied, skipped }. */
        async replay(ontoSha, shas, { messages = {}, onStep } = {}) {
            let head = ontoSha;
            const applied = [], skipped = [];
            for (let i = 0; i < shas.length; i++) {
                if (onStep) onStep(i, shas.length, shas[i]);
                const r = await ops.pickOnto(head, shas[i], { message: messages[shas[i]] });
                if (r.empty) skipped.push(shas[i]); else { applied.push(shas[i]); head = r.sha; }
            }
            return { sha: head, applied, skipped };
        },

        async cherryPick(branch, sha) {
            const head = await ops.headOf(branch);
            const r = await ops.pickOnto(head, sha);
            if (r.empty) return { sha: head, empty: true };
            await ops.setRef(branch, r.sha, false);
            return r;
        },

        async revert(branch, sha) {
            const C = await ops.getCommit(sha);
            if (!C.parents || C.parents.length !== 1) throw new Error('التراجع عن commit دمج غير مدعوم');
            const Pc = await ops.getCommit(C.parents[0].sha);
            const R = await ops.createCommit({ message: `Revert "${headline(C.message)}"\n\nThis reverts commit ${sha}.`, tree: Pc.tree.sha, parents: [sha] });
            const head = await ops.headOf(branch);
            const r = await ops.pickOnto(head, R.sha);
            if (r.empty) return { sha: head, empty: true };
            await ops.setRef(branch, r.sha, false);
            return r;
        },

        /** First-parent chain from the branch head down to (and including) `targetSha`, oldest first. */
        async firstParentChain(branch, targetSha, max = 100) {
            const list = await g(`/commits?sha=${encodeURIComponent(branch)}&per_page=${Math.min(100, max)}`);
            const bySha = new Map(list.map(c => [c.sha, c]));
            const chain = [];
            let cur = list[0];
            while (cur) {
                chain.push(cur);
                if (cur.sha === targetSha || (targetSha && cur.sha.startsWith(targetSha) && targetSha.length >= 7)) return chain.reverse();
                const p = cur.parents && cur.parents[0];
                cur = p ? bySha.get(p.sha) : null;
            }
            if (!targetSha) return chain.reverse();
            throw new Error('الـ commit ليس ضمن آخر ' + max + ' commit في هذا الفرع');
        },

        /** Change the message of any recent commit; descendants are recreated with identical trees (no merges needed). */
        async reword(branch, sha, message) {
            const chain = await ops.firstParentChain(branch, sha);
            const map = new Map();
            let newHead = null;
            for (let i = 0; i < chain.length; i++) {
                const c = chain[i];
                const parents = (c.parents || []).map(p => map.get(p.sha) || p.sha);
                const msg = i === 0 ? message : c.commit.message;
                const n = await ops.createCommit({ message: msg, tree: c.commit.tree.sha, parents, author: authorOf(c.commit) });
                map.set(c.sha, n.sha);
                newHead = n.sha;
            }
            await ops.setRef(branch, newHead, true);
            return { sha: newHead, rewritten: chain.length };
        },

        /** Reorder the last N commits of a branch: `order` = their shas in the desired order (oldest first). */
        async reorder(branch, order) {
            const chain = await ops.firstParentChain(branch, null, Math.max(order.length + 1, 10));
            const last = chain.slice(-order.length);
            const set = new Set(last.map(c => c.sha));
            if (order.length !== last.length || !order.every(s => set.has(s))) throw new Error('القائمة لا تطابق آخر الـ commits في الفرع — حدّث وأعد المحاولة');
            if (last.some(c => (c.parents || []).length !== 1)) throw new Error('لا يمكن إعادة ترتيب commits دمج');
            const base = last[0].parents[0].sha;
            const r = await ops.replay(base, order);
            await ops.setRef(branch, r.sha, true);
            return r;
        },

        /** Rebase `head` onto the tip of `base` (linear commits only). */
        async rebase(head, base, { onStep } = {}) {
            const cmp = await g(`/compare/${encRef(base)}...${encRef(head)}`);
            const commits = cmp.commits || [];
            if (!commits.length) return { sha: null, applied: [], skipped: [], upToDate: true, nothing: true };
            if (+cmp.behind_by === 0) return { sha: commits[commits.length - 1].sha, applied: [], skipped: [], upToDate: true };
            if (commits.some(c => (c.parents || []).length !== 1)) throw new Error('الفرع يحتوي commits دمج — استخدم PR بدلاً من Rebase');
            const onto = await ops.headOf(base);
            const r = await ops.replay(onto, commits.map(c => c.sha), { onStep });
            await ops.setRef(head, r.sha, true);
            return { ...r, upToDate: false };
        },

        /**
         * Commit many files at once: files = [{ path, content, encoding?: 'utf-8'|'base64', delete?: true }].
         * Creates the branch from `from` when it does not exist yet.
         */
        async commitFiles({ branch, files, message, from }) {
            let headSha;
            try { headSha = await ops.headOf(branch); } catch (e) {
                if (e.status !== 404 && e.status !== 409) throw e;
                if (!from) throw e;
                headSha = await ops.headOf(from);
                await ops.createRef(branch, headSha);
            }
            const head = await ops.getCommit(headSha);
            const tree = [];
            for (const f of files) {
                if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
                if (f.sha) { tree.push({ path: f.path, mode: f.mode || '100644', type: 'blob', sha: f.sha }); continue; }
                const blob = await g('/git/blobs', { method: 'POST', body: { content: f.content == null ? '' : String(f.content), encoding: f.encoding || 'utf-8' } });
                tree.push({ path: f.path, mode: f.mode || '100644', type: 'blob', sha: blob.sha });
            }
            const t = await g('/git/trees', { method: 'POST', body: { base_tree: head.tree.sha, tree } });
            const c = await ops.createCommit({ message, tree: t.sha, parents: [headSha] });
            await ops.setRef(branch, c.sha, false);
            return c.sha;
        }
    };
    return ops;
}

/**
 * Lane layout for a commit graph. commits: [{ sha, parents: [sha…] }] newest first.
 * Returns { rows: [{ sha, col }], edges: [{ from: [row, col], to: [row, col], merge }], width }.
 */
export function layoutGraph(commits) {
    const lanes = [];
    const rows = [];
    const index = new Map();
    commits.forEach((c, row) => {
        let col = lanes.indexOf(c.sha);
        if (col === -1) { col = lanes.indexOf(null); if (col === -1) { col = lanes.length; lanes.push(null); } }
        for (let k = 0; k < lanes.length; k++) if (k !== col && lanes[k] === c.sha) lanes[k] = null;
        rows.push({ sha: c.sha, col });
        index.set(c.sha, row);
        const ps = c.parents || [];
        lanes[col] = ps[0] || null;
        for (let k = 1; k < ps.length; k++) {
            if (lanes.includes(ps[k])) continue;
            let free = lanes.indexOf(null);
            if (free === -1) { free = lanes.length; lanes.push(null); }
            lanes[free] = ps[k];
        }
    });
    const edges = [];
    commits.forEach((c, row) => {
        (c.parents || []).forEach((p, k) => {
            const pr = index.get(p);
            if (pr === undefined) { edges.push({ from: [row, rows[row].col], to: [commits.length, rows[row].col], merge: k > 0, open: true }); return; }
            edges.push({ from: [row, rows[row].col], to: [pr, rows[pr].col], merge: k > 0 });
        });
    });
    const width = rows.reduce((m, r) => Math.max(m, r.col + 1), 1);
    return { rows, edges, width };
}

export function graphSVG(layout, { rowH = 28, colW = 16, labels = {} } = {}) {
    const colors = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#f87171', '#2dd4bf', '#94a3b8'];
    const x = (c) => 10 + c * colW, y = (r) => rowH / 2 + r * rowH;
    const h = Math.max(rowH, (layout.rows.length) * rowH);
    const w = 20 + layout.width * colW;
    const paths = layout.edges.map(e => {
        const [r1, c1] = e.from, [r2, c2] = e.to;
        const color = colors[(e.merge ? c2 : c1) % colors.length];
        const d = c1 === c2 ? `M${x(c1)},${y(r1)} L${x(c2)},${Math.min(y(r2), h)}` : `M${x(c1)},${y(r1)} C${x(c1)},${y(r1) + rowH * 0.8} ${x(c2)},${y(r1) + rowH * 0.2} ${x(c2)},${y(r1) + rowH} L${x(c2)},${Math.min(y(r2), h)}`;
        return `<path d="${d}" stroke="${color}" fill="none" stroke-width="2"${e.open ? ' stroke-dasharray="3 3"' : ''}/>`;
    }).join('');
    const dots = layout.rows.map((r, i) => `<circle cx="${x(r.col)}" cy="${y(i)}" r="${labels[r.sha] ? 5.5 : 4}" fill="${colors[r.col % colors.length]}" stroke="var(--bg-elevated, #111)" stroke-width="2"/>`).join('');
    return { svg: `<svg class="ghx-graph-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths}${dots}</svg>`, width: w, rowH };
}
