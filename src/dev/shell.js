/* #155 A bash-like shell over the project's virtual file system (pure; the UI lives in term.js).
   Pipes |, redirects > >>, && || ;, $VAR / ~ expansion, globs, quoting. Built-ins cover the
   everyday file commands; `node/python/ruby/php/go/run/npm/yarn/pnpm/npx/git/open` are delegated. */

/** Tokenise one command line → [{ t:'w', v } | { t:'op', v }]. Throws on unterminated quotes. */
export function tokenize(line, env = {}) {
    const out = [];
    let i = 0, cur = null, glob = false;
    const push = () => { if (cur != null) out.push({ t: 'w', v: cur, glob }); cur = null; glob = false; };
    const expand = (name) => (name === '?' ? String(env['?'] ?? 0) : env[name] != null ? String(env[name]) : '');
    while (i < line.length) {
        const c = line[i];
        if (c === ' ' || c === '\t') { push(); i++; continue; }
        if (c === '#' && cur == null) break;
        if (c === '\'') { const e = line.indexOf('\'', i + 1); if (e < 0) throw new Error('علامة اقتباس غير مغلقة'); cur = (cur || '') + line.slice(i + 1, e); i = e + 1; continue; }
        if (c === '"') {
            let j = i + 1, s = '';
            while (j < line.length && line[j] !== '"') {
                if (line[j] === '\\' && /["\\$`]/.test(line[j + 1] || '')) { s += line[j + 1]; j += 2; continue; }
                if (line[j] === '$') { const m = /^\$(\{(\w+)\}|(\w+|\?))/.exec(line.slice(j)); if (m) { s += expand(m[2] || m[3]); j += m[0].length; continue; } }
                s += line[j++];
            }
            if (j >= line.length) throw new Error('علامة اقتباس غير مغلقة');
            cur = (cur || '') + s; i = j + 1; continue;
        }
        if (c === '\\') { cur = (cur || '') + (line[i + 1] || ''); i += 2; continue; }
        const two = line.slice(i, i + 2);
        if (two === '&&' || two === '||' || two === '>>') { push(); out.push({ t: 'op', v: two }); i += 2; continue; }
        if (c === '|' || c === ';' || c === '>' || c === '<') { push(); out.push({ t: 'op', v: c }); i++; continue; }
        if (c === '$') { const m = /^\$(\{(\w+)\}|(\w+|\?))/.exec(line.slice(i)); if (m) { cur = (cur || '') + expand(m[2] || m[3]); i += m[0].length; continue; } }
        if (c === '~' && cur == null && (line[i + 1] === '/' || line[i + 1] == null || line[i + 1] === ' ')) { cur = env.HOME || '/'; i++; continue; }
        if (c === '*' || c === '?') glob = true;
        cur = (cur || '') + c; i++;
    }
    push();
    return out;
}
/** Split tokens into a list of pipelines joined by && || ; */
export function parse(tokens) {
    const seq = [];
    let pipeline = [], cmd = { argv: [], redirs: [] }, join = ';';
    const endCmd = () => { if (cmd.argv.length || cmd.redirs.length) pipeline.push(cmd); cmd = { argv: [], redirs: [] }; };
    const endPipe = (next) => { endCmd(); if (pipeline.length) seq.push({ join, pipeline }); pipeline = []; join = next; };
    for (let i = 0; i < tokens.length; i++) {
        const tk = tokens[i];
        if (tk.t === 'w') { cmd.argv.push(tk); continue; }
        if (tk.v === '|') { endCmd(); continue; }
        if (tk.v === '>' || tk.v === '>>' || tk.v === '<') { const f = tokens[++i]; if (!f || f.t !== 'w') throw new Error('مسار إعادة التوجيه مفقود'); cmd.redirs.push({ op: tk.v, file: f.v }); continue; }
        endPipe(tk.v);
    }
    endPipe(';');
    return seq;
}
export function normPath(cwd, p) {
    const parts = (String(p || '').startsWith('/') ? [] : String(cwd || '/').split('/')).concat(String(p || '').split('/'));
    const out = [];
    parts.forEach(s => { if (!s || s === '.') return; if (s === '..') out.pop(); else out.push(s); });
    return '/' + out.join('/');
}
const rel = (abs) => abs.replace(/^\/+/, '');
export function globToRegex(g) {
    let re = '';
    for (const c of g) re += c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + re + '$');
}
const HELP = `الأوامر المتاحة:
  ls [-la] [مسار]   cd مسار   pwd   tree [مسار]   cat ملف...   head/tail [-n N] ملف
  echo نص [> ملف | >> ملف]   touch ملف   mkdir [-p] مجلد   rm [-rf] مسار   mv من إلى   cp [-r] من إلى
  grep [-inrvc] نمط [ملفات]   find [مسار] [-name نمط] [-type f|d]   wc [-lwc]   sort [-rnu]   uniq   sed 's/أ/ب/g'
  env   export K=V   history   clear   date   which   true   false   help
  تشغيل: node ملف | run ملف | python ملف | ruby/php/go ملف | open ملف
  حزم: npm | yarn | pnpm | npx (init, install/add, uninstall/remove, ls, outdated, view, run, test, search)
  git status | git log | git diff — ودمج: أمر1 | أمر2 ، أمر1 && أمر2 ، أمر > ملف`;

/**
 * createShell({ fs, delegate, env }) — fs: { list():string[], read(p), write(p, text), remove(paths[]), move(a,b), copy(a,b), mkdir(p), isFolder(p) }
 * delegate(name, args, ctx) → Promise<{ code, out }> | null for commands owned by the app (node, npm, git…).
 */
export function createShell({ fs, delegate = null, env: env0 = {} } = {}) {
    const env = { HOME: '/', USER: 'ox', SHELL: '/bin/oxsh', PATH: '/usr/bin', '?': 0, ...env0 };
    const state = { cwd: '/', history: [] };
    const files = () => fs.list().map(p => '/' + p);
    const isFile = (abs) => fs.read(rel(abs)) != null;
    const isDir = (abs) => abs === '/' || fs.isFolder(rel(abs)) || files().some(f => f.startsWith(abs.replace(/\/$/, '') + '/'));
    const children = (abs) => {
        const base = abs === '/' ? '/' : abs.replace(/\/$/, '') + '/';
        const out = new Map();
        files().forEach(f => { if (!f.startsWith(base)) return; const rest = f.slice(base.length); const name = rest.split('/')[0]; out.set(name, rest.includes('/') ? 'd' : out.get(name) || 'f'); });
        (fs.folders ? fs.folders() : []).forEach(d => { const a = '/' + d; if (a.startsWith(base) && a !== abs) { const name = a.slice(base.length).split('/')[0]; if (name) out.set(name, 'd'); } });
        return Array.from(out.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    };
    const expandGlob = (word) => {
        if (!word.glob) return [word.v];
        const abs = normPath(state.cwd, word.v), dir = abs.slice(0, abs.lastIndexOf('/')) || '/', re = globToRegex(abs.slice(abs.lastIndexOf('/') + 1));
        const hits = children(dir).filter(([n]) => re.test(n) && !n.startsWith('.')).map(([n]) => (word.v.includes('/') ? word.v.slice(0, word.v.lastIndexOf('/') + 1) : '') + n);
        return hits.length ? hits : [word.v];
    };
    const flags = (args, known) => {
        const f = {}, rest = [];
        let n = null;
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (/^-n$/.test(a) && known.includes('N')) { n = +args[++i]; continue; }
            if (/^-\d+$/.test(a) && known.includes('N')) { n = +a.slice(1); continue; }
            if (/^-[a-zA-Z]+$/.test(a) && a.slice(1).split('').every(ch => known.includes(ch))) { a.slice(1).split('').forEach(ch => { f[ch] = true; }); continue; }
            rest.push(a);
        }
        return { f, rest, n };
    };
    const readArg = (p) => { const abs = normPath(state.cwd, p); const t = fs.read(rel(abs)); if (t == null) throw new Error(`${p}: لا يوجد ملف بهذا الاسم`); return t; };
    const B = {
        help: () => HELP,
        pwd: () => state.cwd,
        cd: ([p]) => { const abs = normPath(state.cwd, p || env.HOME); if (!isDir(abs)) throw new Error(`cd: ${p}: ليس مجلداً`); state.cwd = abs; return ''; },
        ls: (args) => {
            const { f, rest } = flags(args, 'la1');
            const targets = rest.length ? rest : ['.'];
            return targets.map(t => {
                const abs = normPath(state.cwd, t);
                if (isFile(abs)) return f.l ? `-rw-r--r--  ${String((fs.read(rel(abs)) || '').length).padStart(7)}  ${t}` : t;
                if (!isDir(abs)) throw new Error(`ls: ${t}: لا يوجد`);
                const list = children(abs).filter(([n]) => f.a || !n.startsWith('.'));
                const body = f.l ? list.map(([n, k]) => `${k === 'd' ? 'drwxr-xr-x' : '-rw-r--r--'}  ${k === 'd' ? '      -' : String((fs.read(rel(normPath(abs, n))) || '').length).padStart(7)}  ${n}${k === 'd' ? '/' : ''}`).join('\n') : list.map(([n, k]) => n + (k === 'd' ? '/' : '')).join(f['1'] ? '\n' : '  ');
                return targets.length > 1 ? `${t}:\n${body}` : body;
            }).join('\n\n');
        },
        tree: ([p]) => {
            const root = normPath(state.cwd, p || '.');
            const lines = [p || '.'];
            let nd = 0, nf = 0;
            const rec = (abs, prefix) => {
                const list = children(abs).filter(([n]) => !n.startsWith('.') && n !== 'node_modules');
                list.forEach(([n, k], i) => { const last = i === list.length - 1; lines.push(prefix + (last ? '└── ' : '├── ') + n); if (k === 'd') { nd++; rec(normPath(abs, n), prefix + (last ? '    ' : '│   ')); } else nf++; });
            };
            rec(root, '');
            return lines.join('\n') + `\n\n${nd} مجلد، ${nf} ملف`;
        },
        cat: (args, stdin) => (args.length ? args.map(readArg).join('') : stdin),
        head: (args, stdin) => { const { rest, n } = flags(args, 'N'); return (rest.length ? readArg(rest[0]) : stdin).split('\n').slice(0, n || 10).join('\n'); },
        tail: (args, stdin) => { const { rest, n } = flags(args, 'N'); const l = (rest.length ? readArg(rest[0]) : stdin).replace(/\n$/, '').split('\n'); return l.slice(-(n || 10)).join('\n'); },
        echo: (args) => { const { f, rest } = flags(args, 'ne'); let s = rest.join(' '); if (f.e) s = s.replace(/\\n/g, '\n').replace(/\\t/g, '\t'); return f.n ? { raw: s } : s; },
        touch: (args) => { args.forEach(p => { const r = rel(normPath(state.cwd, p)); if (fs.read(r) == null) fs.write(r, ''); }); return ''; },
        mkdir: (args) => { const { rest } = flags(args, 'p'); rest.forEach(p => fs.mkdir(rel(normPath(state.cwd, p)))); return ''; },
        rm: (args) => {
            const { f, rest } = flags(args, 'rfR');
            const paths = [];
            rest.forEach(p => {
                const abs = normPath(state.cwd, p);
                if (isFile(abs)) paths.push(rel(abs));
                else if (isDir(abs)) { if (!f.r && !f.R) throw new Error(`rm: ${p}: مجلد (استخدم -r)`); paths.push(rel(abs)); }
                else if (!f.f) throw new Error(`rm: ${p}: لا يوجد`);
            });
            if (paths.length) fs.remove(paths);
            return '';
        },
        mv: (args) => { if (args.length < 2) throw new Error('mv: يلزم مصدر وهدف'); const to = normPath(state.cwd, args[args.length - 1]); args.slice(0, -1).forEach(a => { const from = normPath(state.cwd, a); const dest = isDir(to) && !isFile(to) ? normPath(to, from.split('/').pop()) : to; fs.move(rel(from), rel(dest)); }); return ''; },
        cp: (args) => {
            const { f, rest } = flags(args, 'rR');
            if (rest.length < 2) throw new Error('cp: يلزم مصدر وهدف');
            const to = normPath(state.cwd, rest[rest.length - 1]);
            rest.slice(0, -1).forEach(a => {
                const from = normPath(state.cwd, a);
                if (isFile(from)) { const dest = isDir(to) && !isFile(to) ? normPath(to, from.split('/').pop()) : to; fs.write(rel(dest), fs.read(rel(from))); }
                else if (isDir(from)) { if (!f.r && !f.R) throw new Error(`cp: ${a}: مجلد (استخدم -r)`); const base = isDir(to) ? normPath(to, from.split('/').pop()) : to; files().filter(x => x.startsWith(from + '/')).forEach(x => fs.write(rel(base + x.slice(from.length)), fs.read(rel(x)))); }
                else throw new Error(`cp: ${a}: لا يوجد`);
            });
            return '';
        },
        grep: (args, stdin) => {
            const { f, rest } = flags(args, 'inrvcl');
            if (!rest.length) throw new Error('grep: يلزم نمط');
            let re;
            try { re = new RegExp(rest[0], f.i ? 'i' : ''); } catch (e) { re = new RegExp(rest[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.i ? 'i' : ''); }
            let targets = rest.slice(1);
            const sources = [];
            if (!targets.length && (f.r || stdin == null)) targets = f.r ? ['.'] : [];
            if (!targets.length) sources.push([null, stdin || '']);
            targets.forEach(t => {
                const abs = normPath(state.cwd, t);
                if (isFile(abs)) sources.push([t, fs.read(rel(abs))]);
                else if (isDir(abs) && f.r) files().filter(x => x.startsWith(abs === '/' ? '/' : abs + '/') && !x.includes('/node_modules/')).forEach(x => sources.push([x.slice(1), fs.read(rel(x))]));
            });
            const out = [];
            let count = 0;
            sources.forEach(([name, text]) => {
                let c = 0;
                String(text || '').split('\n').forEach((l, i) => { if (re.test(l) !== !!f.v) { c++; if (!f.c && !f.l) out.push(`${name && sources.length > 1 ? name + ':' : ''}${f.n ? i + 1 + ':' : ''}${l}`); } });
                if (f.l && c) out.push(name);
                if (f.c) out.push(`${name && sources.length > 1 ? name + ':' : ''}${c}`);
                count += c;
            });
            return { text: out.join('\n'), code: count ? 0 : 1 };
        },
        find: (args) => {
            let start = '.', name = null, type = null;
            for (let i = 0; i < args.length; i++) { if (args[i] === '-name' || args[i] === '-iname') name = globToRegex(args[++i]); else if (args[i] === '-type') type = args[++i]; else start = args[i]; }
            const abs = normPath(state.cwd, start), base = abs === '/' ? '' : abs;
            const out = new Set();
            files().filter(f => f.startsWith(base + '/')).forEach(f => {
                const relp = f.slice(base.length + 1).split('/');
                for (let k = 1; k <= relp.length; k++) {
                    const isF = k === relp.length, nm = relp[k - 1];
                    if (type === 'f' && !isF) continue;
                    if (type === 'd' && isF) continue;
                    if (name && !name.test(nm)) continue;
                    out.add((start === '.' ? '.' : start.replace(/\/$/, '')) + '/' + relp.slice(0, k).join('/'));
                }
            });
            return Array.from(out).sort().join('\n');
        },
        wc: (args, stdin) => {
            const { f, rest } = flags(args, 'lwc');
            const all = !f.l && !f.w && !f.c;
            const one = (t, name) => [f.l || all ? (t.match(/\n/g) || []).length : null, f.w || all ? (t.match(/\S+/g) || []).length : null, f.c || all ? t.length : null].filter(x => x != null).map(x => String(x).padStart(6)).join(' ') + (name ? ' ' + name : '');
            return rest.length ? rest.map(p => one(readArg(p), p)).join('\n') : one(stdin || '');
        },
        sort: (args, stdin) => { const { f, rest } = flags(args, 'rnu'); let l = (rest.length ? readArg(rest[0]) : stdin || '').replace(/\n$/, '').split('\n'); l.sort(f.n ? (a, b) => parseFloat(a) - parseFloat(b) : (a, b) => a.localeCompare(b)); if (f.r) l.reverse(); if (f.u) l = Array.from(new Set(l)); return l.join('\n'); },
        uniq: (args, stdin) => (args.length ? readArg(args[0]) : stdin || '').replace(/\n$/, '').split('\n').filter((l, i, a) => i === 0 || l !== a[i - 1]).join('\n'),
        sed: (args, stdin) => {
            const { f, rest } = flags(args, 'i');
            const m = /^s(.)(.*?)\1(.*?)\1([gi]*)$/.exec(rest[0] || '');
            if (!m) throw new Error("sed: الصيغة المدعومة s/نمط/بديل/g");
            const re = new RegExp(m[2], m[4].includes('i') ? (m[4].includes('g') ? 'gi' : 'i') : m[4]);
            if (f.i) { rest.slice(1).forEach(p => fs.write(rel(normPath(state.cwd, p)), readArg(p).replace(re, m[3]))); return ''; }
            return (rest[1] ? readArg(rest[1]) : stdin || '').replace(re, m[3]);
        },
        env: () => Object.entries(env).filter(([k]) => k !== '?').map(([k, v]) => `${k}=${v}`).join('\n'),
        export: (args) => { args.forEach(a => { const i = a.indexOf('='); if (i > 0) env[a.slice(0, i)] = a.slice(i + 1); }); return ''; },
        unset: (args) => { args.forEach(a => delete env[a]); return ''; },
        history: () => state.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n'),
        date: () => new Date().toString(),
        which: (args) => args.map(a => (B[a] ? `${a}: أمر مدمج` : DELEGATED.includes(a) ? `/usr/bin/${a}` : `${a} غير موجود`)).join('\n'),
        true: () => '',
        false: () => ({ text: '', code: 1 }),
        clear: () => ({ clear: true, text: '' })
    };
    const DELEGATED = ['node', 'run', 'python', 'python3', 'ruby', 'php', 'go', 'npm', 'yarn', 'pnpm', 'npx', 'git', 'open', 'code', 'deno', 'bun', 'ts-node', 'tsx'];
    async function runCmd(cmd, stdin, io) {
        const argv = cmd.argv.flatMap(expandGlob);
        // VAR=value cmd …
        while (argv.length && /^\w+=/.test(argv[0]) && argv.length > 1) { const a = argv.shift(); const i = a.indexOf('='); env[a.slice(0, i)] = a.slice(i + 1); }
        if (argv.length === 1 && /^\w+=/.test(argv[0])) { const i = argv[0].indexOf('='); env[argv[0].slice(0, i)] = argv[0].slice(i + 1); return { text: '', code: 0 }; }
        const [name, ...args] = argv;
        const inRedir = cmd.redirs.find(r => r.op === '<');
        if (inRedir) stdin = readArg(inRedir.file);
        if (!name) return { text: stdin || '', code: 0 };
        if (B[name]) {
            const r = await B[name](args, stdin);
            if (r && typeof r === 'object') return { text: r.raw != null ? r.raw : r.text || '', code: r.code || 0, clear: r.clear, raw: r.raw != null };
            return { text: r == null ? '' : String(r), code: 0 };
        }
        if (delegate) {
            const r = await delegate(name, args, { cwd: state.cwd, env, stdin, io, rel: (p) => rel(normPath(state.cwd, p)) });
            if (r) return { text: r.out || '', code: r.code || 0, streamed: !!r.streamed };
        }
        return { text: '', err: `${name}: الأمر غير موجود — اكتب help`, code: 127 };
    }
    async function exec(line, io = { out() {}, err() {}, clear() {} }) {
        const src = String(line || '').trim();
        if (!src) return 0;
        state.history.push(src);
        if (state.history.length > 500) state.history.shift();
        let seq;
        try { seq = parse(tokenize(src, env)); } catch (e) { io.err(e.message); env['?'] = 2; return 2; }
        let code = 0;
        for (const { join, pipeline } of seq) {
            if ((join === '&&' && code !== 0) || (join === '||' && code === 0)) continue;
            let data = null;
            for (let k = 0; k < pipeline.length; k++) {
                const cmd = pipeline[k];
                let r;
                try { r = await runCmd(cmd, data, io); } catch (e) { io.err(String(e.message || e)); r = { text: '', code: 1 }; }
                if (r.clear) io.clear();
                if (r.err) io.err(r.err);
                code = r.code;
                data = r.text;
                const outRedir = cmd.redirs.find(x => x.op === '>' || x.op === '>>');
                if (outRedir) {
                    const p = rel(normPath(state.cwd, outRedir.file));
                    const prev = outRedir.op === '>>' ? (fs.read(p) || '') : '';
                    const text = data && !/\n$/.test(data) && !r.raw ? data + '\n' : data || '';
                    fs.write(p, prev + text);
                    data = '';
                }
            }
            if (data) io.out(data);
            env['?'] = code;
        }
        return code;
    }
    const complete = (partial) => {
        const words = partial.split(/\s+/);
        const last = words[words.length - 1] || '';
        if (words.length === 1) return Object.keys(B).concat(DELEGATED).filter(c => c.startsWith(last)).sort();
        const abs = normPath(state.cwd, last.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : '.');
        const prefix = last.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : '';
        const stem = last.slice(prefix.length);
        return children(abs).filter(([n]) => n.startsWith(stem)).map(([n, k]) => prefix + n + (k === 'd' ? '/' : ''));
    };
    return { exec, state, env, complete, prompt: () => `ox:${state.cwd === '/' ? '~' : '~' + state.cwd}$ `, commands: Object.keys(B), delegated: DELEGATED };
}
