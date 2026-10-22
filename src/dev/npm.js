/* #156 npm / yarn / pnpm commands against the real npm registry (package.json is edited in the
   virtual project; node_modules cannot exist in the browser — code runs on the built-in runtime). */

const REG = 'https://registry.npmjs.org/';
export function parseSpec(spec) {
    const s = String(spec || '').trim();
    const at = s.lastIndexOf('@');
    if (at > 0) return { name: s.slice(0, at), range: s.slice(at + 1) || 'latest' };
    return { name: s, range: 'latest' };
}
export function parseVer(v) {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.-]+))?/.exec(String(v || '').trim());
    return m ? { major: +m[1], minor: m[2] != null ? +m[2] : null, patch: m[3] != null ? +m[3] : null, pre: m[4] || '' } : null;
}
export function cmpVer(a, b) {
    const x = parseVer(a), y = parseVer(b);
    if (!x || !y) return 0;
    for (const k of ['major', 'minor', 'patch']) { const d = (x[k] || 0) - (y[k] || 0); if (d) return d > 0 ? 1 : -1; }
    if (x.pre && !y.pre) return -1;
    if (!x.pre && y.pre) return 1;
    return x.pre < y.pre ? -1 : x.pre > y.pre ? 1 : 0;
}
function cmpOne(v, comp) {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*v?([\dxX*]+(?:\.[\dxX*]+)?(?:\.[\dxX*]+)?(?:-[\w.-]+)?)$/.exec(comp.trim());
    if (!m) return comp.trim() === '' || comp.trim() === '*';
    const op = m[1] || '', r = parseVer(m[2].replace(/[xX*]/g, '')) || { major: null, minor: null, patch: null, pre: '' };
    const wild = /[xX*]/.test(m[2]) || r.minor == null || r.patch == null;
    const pv = parseVer(v);
    if (!pv) return false;
    const base = `${r.major || 0}.${r.minor || 0}.${r.patch || 0}${r.pre ? '-' + r.pre : ''}`;
    if (op === '^') {
        if (cmpVer(v, base) < 0) return false;
        if ((r.major || 0) > 0) return pv.major === r.major;
        if ((r.minor || 0) > 0 || r.patch == null) return pv.major === 0 && pv.minor === (r.minor || 0);
        return pv.major === 0 && pv.minor === 0 && pv.patch === r.patch;
    }
    if (op === '~') return cmpVer(v, base) >= 0 && pv.major === r.major && (r.minor == null || pv.minor === r.minor);
    if (op === '>=') return cmpVer(v, base) >= 0;
    if (op === '>') return cmpVer(v, base) > 0;
    if (op === '<=') return cmpVer(v, base) <= 0;
    if (op === '<') return cmpVer(v, base) < 0;
    if (wild) { if (r.major == null) return true; if (pv.major !== r.major) return false; return r.minor == null || pv.minor === r.minor; }
    return cmpVer(v, base) === 0;
}
/** Minimal semver range check: ^ ~ >= > <= < = x-ranges, hyphen ranges, || unions. */
export function satisfies(v, range) {
    const pv = parseVer(v);
    if (!pv) return false;
    return String(range || '*').split('||').some(set => {
        set = set.trim();
        const hy = /^(\S+)\s+-\s+(\S+)$/.exec(set);
        if (hy) return cmpVer(v, hy[1]) >= 0 && cmpVer(v, hy[2]) <= 0;
        if (pv.pre && !/-/.test(set)) return false;
        return set.split(/\s+/).filter(Boolean).every(c => cmpOne(v, c)) || set === '';
    });
}
export function maxSatisfying(versions, range) {
    return versions.filter(v => satisfies(v, range)).sort(cmpVer).pop() || null;
}
export function resolveVersion(packument, range = 'latest') {
    const tags = packument['dist-tags'] || {};
    if (tags[range]) return tags[range];
    const versions = Object.keys(packument.versions || {});
    if (versions.includes(range)) return range;
    return maxSatisfying(versions, range);
}
const pad = (s, n) => String(s).padEnd(n);

/** createNpm({ read, write, fetch, runScript }) → { exec(tool, args) → Promise<{ code, out }> } */
export function createNpm({ read, write, fetch: fetchFn, runScript }) {
    const readPkg = () => { const t = read('package.json'); if (t == null) return null; try { return JSON.parse(t); } catch (e) { throw new Error('package.json غير صالح: ' + e.message); } };
    const savePkg = (pkg) => write('package.json', JSON.stringify(pkg, null, 2) + '\n');
    const getJSON = async (url, abbreviated) => {
        if (!fetchFn) throw new Error('الشبكة غير متاحة');
        const r = await fetchFn(url, abbreviated ? { headers: { Accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' } } : undefined);
        if (r.status === 404) throw new Error('الحزمة غير موجودة في npm');
        if (!r.ok) throw new Error('npm registry HTTP ' + r.status);
        return r.json();
    };
    const enc = (name) => name.replace('/', '%2F');
    async function install(specs, dev, exact, out) {
        let pkg = readPkg();
        if (!pkg) { pkg = { name: 'project', version: '1.0.0', private: true }; out.push('📦 أُنشئ package.json'); }
        if (!specs.length) {
            const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            out.push(`✓ ${Object.keys(all).length} اعتمادية في package.json`);
            out.push('ℹ المتصفح لا يُنشئ node_modules: الحزم الأساسية (express, http, jsonwebtoken, bcryptjs, cors, events, path, util…) مدمجة في المشغّل، والبقية تُستخدم بالكود المرسل للنشر.');
            return 0;
        }
        for (const s of specs) {
            const { name, range } = parseSpec(s);
            const doc = await getJSON(REG + enc(name), true);
            const ver = resolveVersion(doc, range);
            if (!ver) { out.push(`✗ ${name}@${range}: لا يوجد إصدار مطابق`); return 1; }
            const key = dev ? 'devDependencies' : 'dependencies', other = dev ? 'dependencies' : 'devDependencies';
            pkg[key] = { ...(pkg[key] || {}), [name]: exact ? ver : '^' + ver };
            if (pkg[other] && pkg[other][name]) delete pkg[other][name];
            pkg[key] = Object.fromEntries(Object.entries(pkg[key]).sort((a, b) => a[0].localeCompare(b[0])));
            out.push(`+ ${name}@${ver}${dev ? ' (dev)' : ''}`);
        }
        savePkg(pkg);
        out.push(`✓ حُدّث package.json (${specs.length})`);
        return 0;
    }
    function uninstall(names, out) {
        const pkg = readPkg();
        if (!pkg) { out.push('لا يوجد package.json'); return 1; }
        let n = 0;
        names.forEach(nm => ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].forEach(k => { if (pkg[k] && pkg[k][nm]) { delete pkg[k][nm]; n++; out.push(`- ${nm}`); } }));
        if (n) savePkg(pkg); else out.push('لا شيء للإزالة');
        return 0;
    }
    function ls(out) {
        const pkg = readPkg();
        if (!pkg) { out.push('لا يوجد package.json'); return 1; }
        out.push(`${pkg.name || 'project'}@${pkg.version || '0.0.0'}`);
        const deps = Object.entries(pkg.dependencies || {}), dev = Object.entries(pkg.devDependencies || {});
        deps.concat(dev).forEach(([n, r], i, a) => out.push(`${i === a.length - 1 ? '└──' : '├──'} ${n}@${r}${i >= deps.length ? ' (dev)' : ''}`));
        if (!deps.length && !dev.length) out.push('└── (فارغ)');
        return 0;
    }
    async function outdated(out) {
        const pkg = readPkg();
        if (!pkg) { out.push('لا يوجد package.json'); return 1; }
        const all = Object.entries({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
        const rows = [];
        for (const [name, range] of all) {
            try {
                const doc = await getJSON(REG + enc(name), true);
                const wanted = resolveVersion(doc, range) || '—', latest = (doc['dist-tags'] || {}).latest || '—';
                const cur = (parseVer(String(range).replace(/^[\^~>=<\s]+/, '')) ? String(range).replace(/^[\^~>=<\s]+/, '') : '—');
                if (cur !== latest) rows.push([name, cur, wanted, latest]);
            } catch (e) { rows.push([name, range, '?', e.message]); }
        }
        if (!rows.length) { out.push('✓ كل الحزم محدّثة'); return 0; }
        out.push(pad('Package', 28) + pad('Current', 12) + pad('Wanted', 12) + 'Latest');
        rows.forEach(r => out.push(pad(r[0], 28) + pad(r[1], 12) + pad(r[2], 12) + r[3]));
        return 1;
    }
    async function view(spec, field, out) {
        const { name, range } = parseSpec(spec);
        const doc = await getJSON(REG + enc(name) + '/' + encodeURIComponent(range === 'latest' ? 'latest' : range));
        if (field) { const v = field.split('.').reduce((o, k) => (o == null ? o : o[k]), doc); out.push(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)); return 0; }
        out.push(`${doc.name}@${doc.version} | ${doc.license || '—'} | deps: ${Object.keys(doc.dependencies || {}).length}`);
        if (doc.description) out.push(doc.description);
        if (doc.homepage) out.push(doc.homepage);
        if (doc.dependencies && Object.keys(doc.dependencies).length) out.push('dependencies: ' + Object.entries(doc.dependencies).slice(0, 12).map(([k, v]) => `${k}@${v}`).join(', '));
        return 0;
    }
    async function search(q, out) {
        const r = await getJSON(REG + '-/v1/search?size=10&text=' + encodeURIComponent(q));
        (r.objects || []).forEach(o => out.push(`${pad(o.package.name, 30)} ${pad(o.package.version, 10)} ${(o.package.description || '').slice(0, 70)}`));
        if (!(r.objects || []).length) out.push('لا نتائج');
        return 0;
    }
    function init(out) {
        if (read('package.json') != null) { out.push('package.json موجود بالفعل'); return 0; }
        savePkg({ name: 'project', version: '1.0.0', description: '', main: 'index.js', scripts: { start: 'node index.js', test: 'jest' }, keywords: [], license: 'MIT' });
        out.push('✓ أُنشئ package.json');
        return 0;
    }
    async function run(script, args, out) {
        const pkg = readPkg() || {};
        const scripts = pkg.scripts || {};
        if (!script) { out.push('السكربتات المتاحة:'); Object.entries(scripts).forEach(([k, v]) => out.push(`  ${k}\n    ${v}`)); return 0; }
        const cmd = scripts[script];
        if (!cmd) { if (script === 'test') return runScript('test', 'jest', out); out.push(`✗ لا يوجد سكربت «${script}» في package.json`); return 1; }
        out.push(`> ${pkg.name || 'project'}@${pkg.version || ''} ${script}\n> ${cmd}${args.length ? ' ' + args.join(' ') : ''}`);
        return runScript(script, cmd + (args.length ? ' ' + args.join(' ') : ''), out);
    }
    async function exec(tool, argv) {
        const out = [];
        const args = argv.filter(a => !/^--(no-)?(save|silent|quiet|legacy-peer-deps|force|prefer-offline|no-audit|no-fund)$/.test(a));
        const dev = args.some(a => /^(-D|--save-dev|--dev|-d)$/.test(a)), exact = args.some(a => /^(-E|--save-exact|--exact)$/.test(a));
        const pos = args.filter(a => !/^-/.test(a));
        let [sub, ...rest] = pos;
        try {
            if (args.includes('-v') || args.includes('--version') || sub === '-v') { out.push({ npm: '10.9.0', yarn: '1.22.22', pnpm: '9.15.0' }[tool] + ' (محاكاة داخل المتصفح)'); return { code: 0, out: out.join('\n') }; }
            if (tool === 'yarn' && !sub) sub = 'install';
            if (tool !== 'npm' && sub === 'add') sub = 'install';
            if (tool !== 'npm' && sub === 'remove') sub = 'uninstall';
            let code;
            switch (sub) {
                case 'init': code = init(out); break;
                case 'i': case 'install': case 'add': case 'isntall': code = await install(rest, dev, exact, out); break;
                case 'un': case 'uninstall': case 'remove': case 'rm': case 'r': code = uninstall(rest, out); break;
                case 'ls': case 'list': case 'll': code = ls(out); break;
                case 'outdated': code = await outdated(out); break;
                case 'view': case 'info': case 'show': case 'v': code = await view(rest[0], rest[1], out); break;
                case 'search': case 's': case 'find': code = await search(rest.join(' '), out); break;
                case 'run': case 'run-script': code = await run(rest[0], rest.slice(1), out); break;
                case 'test': case 't': case 'start': code = await run(sub === 't' ? 'test' : sub, rest, out); break;
                case 'audit': out.push('ℹ npm audit يتطلب شجرة node_modules — استخدم «الحزم والتبعيات» في مركز GitHub لفحص الثغرات'); code = 0; break;
                case undefined: out.push(`استخدام: ${tool} <init|install|uninstall|ls|outdated|view|search|run|test|start>`); code = 0; break;
                default:
                    if (tool !== 'npm' && (readPkg() || {}).scripts && readPkg().scripts[sub]) { code = await run(sub, rest, out); break; }
                    out.push(`✗ أمر غير مدعوم: ${tool} ${sub}`); code = 1;
            }
            return { code, out: out.join('\n') };
        } catch (e) { out.push('✗ ' + (e.message || e)); return { code: 1, out: out.join('\n') }; }
    }
    return { exec, readPkg };
}
