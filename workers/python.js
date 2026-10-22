/* ==============================================================================
   OX-Alpha Workbench Pro — Python worker (Pyodide, same-origin file)
   Runs Python off the main thread (#152): project files are written to the
   Pyodide FS so imports between files work, stdin comes from the run dialog
   (#224), os.environ from the env panel (#225), packages are loaded from the
   imports or from "# pip: pkg" comments via micropip, and tests (unittest,
   pytest-style functions, parametrize, raises, approx) are reported one by one
   (#162, #163). In Node (tests) `createRuntime(loadPyodide, post)` is used.
   ============================================================================== */
/* eslint-env worker */
'use strict';
var PYODIDE_VERSION = '0.27.7';
var PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/';
var ROOT = '/home/pyodide/project';

var PY_SETUP = [
    'import sys, os, json',
    '_root = _ox_root',
    'for _k, _m in list(sys.modules.items()):',
    '    _f = getattr(_m, "__file__", None) or ""',
    '    if _f.startswith(_root + "/"):',
    '        del sys.modules[_k]',
    'for _p in [_ox_entry_dir, _root]:',
    '    if _p in sys.path: sys.path.remove(_p)',
    '    sys.path.insert(0, _p)',
    'os.chdir(_root)',
    'os.environ.update(json.loads(_ox_env))',
    'sys.argv = [_ox_entry]',
    'import ast as _ast, inspect as _inspect',
    'async def _ox_exec(src, path, g):',
    '    code = compile(src, path, "exec", flags=_ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)',
    '    try:',
    '        r = eval(code, g)',
    '        if _inspect.iscoroutine(r): await r',
    '    except SystemExit as e:',
    '        if e.code in (None, 0): return 0',
    '        if isinstance(e.code, int): return e.code',
    '        print(e.code, file=sys.stderr)',
    '        return 1',
    '    return 0'
].join('\n');

var PY_TESTS = [
    'import sys, os, time, json, traceback, unittest, importlib.util, inspect, itertools, types, builtins, re as _re',
    'if "pytest" not in sys.modules:',
    '    _pt = types.ModuleType("pytest")',
    '    class _Raises:',
    '        def __init__(self, exc, match=None): self.exc, self.match, self.value = exc, match, None',
    '        def __enter__(self): return self',
    '        def __exit__(self, t, v, tb):',
    '            if t is None: raise AssertionError("DID NOT RAISE " + getattr(self.exc, "__name__", str(self.exc)))',
    '            if not issubclass(t, self.exc): return False',
    '            if self.match and not _re.search(self.match, str(v)): raise AssertionError("Pattern %r not found in %r" % (self.match, str(v)))',
    '            self.value = v',
    '            return True',
    '    def _approx(expected, rel=1e-6, abs=1e-12):',
    '        class _A:',
    '            def __eq__(s, other):',
    '                if isinstance(expected, (list, tuple)):',
    '                    return len(other) == len(expected) and all(_approx(e, rel, abs) == o for e, o in zip(expected, other))',
    '                return builtins.abs(other - expected) <= max(rel * builtins.abs(expected), abs)',
    '            def __repr__(s): return "approx(%r)" % (expected,)',
    '        return _A()',
    '    class _Mark:',
    '        def parametrize(self, names, values, **kw):',
    '            nl = [n.strip() for n in names.split(",")] if isinstance(names, str) else list(names)',
    '            def deco(fn):',
    '                fn._ox_params = getattr(fn, "_ox_params", []) + [(nl, list(values))]',
    '                return fn',
    '            return deco',
    '        def skip(self, *a, **k):',
    '            if len(a) == 1 and callable(a[0]): a[0]._ox_skip = True; return a[0]',
    '            def deco(fn): fn._ox_skip = True; return fn',
    '            return deco',
    '        def skipif(self, cond, *a, **k):',
    '            def deco(fn):',
    '                if cond: fn._ox_skip = True',
    '                return fn',
    '            return deco',
    '        def __getattr__(self, name):',
    '            def deco(*a, **k):',
    '                if len(a) == 1 and callable(a[0]) and not k: return a[0]',
    '                return lambda fn: fn',
    '            return deco',
    '    def _skip(reason=""): raise unittest.SkipTest(reason)',
    '    def _fail(msg=""): raise AssertionError(msg)',
    '    _pt.raises = lambda exc, match=None: _Raises(exc, match)',
    '    _pt.approx = _approx',
    '    _pt.mark = _Mark()',
    '    _pt.fixture = lambda *a, **k: (a[0] if a and callable(a[0]) else (lambda f: f))',
    '    _pt.skip = _skip',
    '    _pt.fail = _fail',
    '    sys.modules["pytest"] = _pt',
    'def _ox_rel(s): return s.replace(_ox_root + "/", "")',
    'def _ox_err(e, tb):',
    '    frames = [f for f in traceback.extract_tb(tb) if f.filename.startswith(_ox_root)]',
    '    loc = frames[-1] if frames else None',
    '    msg = "".join(traceback.format_exception_only(type(e), e)).strip()',
    '    if isinstance(e, AssertionError) and not str(e) and loc is not None:',
    '        msg = "AssertionError: " + (loc.line or "assert failed")',
    '    stack = _ox_rel("".join(traceback.format_list(frames)))',
    '    if loc is not None: msg += "  (%s:%d)" % (_ox_rel(loc.filename), loc.lineno)',
    '    return {"message": msg, "name": type(e).__name__, "stack": stack}',
    'async def _ox_call(fn, kwargs=None):',
    '    r = fn(**(kwargs or {}))',
    '    if inspect.isawaitable(r): await r',
    'def _ox_expand(fn):',
    '    params = getattr(fn, "_ox_params", None)',
    '    if not params: return [("", {})]',
    '    out = []',
    '    for combo in itertools.product(*[[(names, v) for v in values] for names, values in params]):',
    '        kw, label = {}, []',
    '        for names, v in combo:',
    '            vals = v if len(names) > 1 else [v]',
    '            kw.update(dict(zip(names, vals)))',
    '            label.append("-".join(repr(x) for x in vals))',
    '        out.append(("[" + "-".join(label) + "]", kw))',
    '    return out',
    'def _ox_load(path):',
    '    name = os.path.splitext(os.path.basename(path))[0]',
    '    spec = importlib.util.spec_from_file_location(name, os.path.join(_ox_root, path))',
    '    mod = importlib.util.module_from_spec(spec)',
    '    sys.modules[name] = mod',
    '    spec.loader.exec_module(mod)',
    '    return mod',
    'async def _ox_run_tests(files):',
    '    results = []',
    '    t0 = time.time()',
    '    def report(r):',
    '        results.append(r)',
    '        _ox_report(json.dumps(r))',
    '    for path in files:',
    '        d = os.path.dirname(os.path.join(_ox_root, path))',
    '        if d not in sys.path: sys.path.insert(0, d)',
    '        try:',
    '            mod = _ox_load(path)',
    '        except BaseException as e:',
    '            report({"file": path, "name": path + " (import)", "status": "fail", "ms": 0, "error": _ox_err(e, e.__traceback__)})',
    '            continue',
    '        cases = []',
    '        for name, obj in list(vars(mod).items()):',
    '            if inspect.isclass(obj) and getattr(obj, "__module__", None) == mod.__name__:',
    '                if issubclass(obj, unittest.TestCase):',
    '                    for m in unittest.TestLoader().getTestCaseNames(obj): cases.append((name + " › " + m, "unittest", obj, m, {}))',
    '                elif name.startswith("Test"):',
    '                    for m in sorted(dir(obj)):',
    '                        f = getattr(obj, m)',
    '                        if m.startswith("test") and callable(f):',
    '                            for suffix, kw in _ox_expand(f): cases.append((name + " › " + m + suffix, "class", obj, m, kw))',
    '            elif inspect.isfunction(obj) and name.startswith("test") and obj.__module__ == mod.__name__:',
    '                for suffix, kw in _ox_expand(obj): cases.append((name + suffix, "func", obj, None, kw))',
    '        for label, kind, obj, m, kw in cases:',
    '            s = time.time(); err = None; status = "pass"',
    '            try:',
    '                if kind == "unittest":',
    '                    res = unittest.TestResult()',
    '                    obj(m).run(res)',
    '                    bad = res.failures + res.errors',
    '                    if res.skipped: status = "skip"',
    '                    if bad:',
    '                        status = "fail"',
    '                        txt = bad[0][1].strip()',
    '                        err = {"message": txt.split("\\n")[-1], "name": "AssertionError", "stack": _ox_rel(txt)}',
    '                else:',
    '                    fn = getattr(obj, m) if kind == "class" else obj',
    '                    if getattr(fn, "_ox_skip", False): status = "skip"',
    '                    else:',
    '                        sig = inspect.signature(fn)',
    '                        needed = [p for p in sig.parameters if p not in kw and p != "self"]',
    '                        if needed: status = "skip"',
    '                        elif kind == "class":',
    '                            inst = obj()',
    '                            if hasattr(inst, "setup_method"): inst.setup_method(getattr(inst, m))',
    '                            try: await _ox_call(getattr(inst, m), kw)',
    '                            finally:',
    '                                if hasattr(inst, "teardown_method"): inst.teardown_method(getattr(inst, m))',
    '                        else: await _ox_call(fn, kw)',
    '            except unittest.SkipTest:',
    '                status = "skip"',
    '            except BaseException as e:',
    '                status = "fail"; err = _ox_err(e, e.__traceback__)',
    '            r = {"file": path, "name": label, "status": status, "ms": int((time.time() - s) * 1000)}',
    '            if err: r["error"] = err',
    '            report(r)',
    '    summ = {"pass": 0, "fail": 0, "skip": 0, "todo": 0}',
    '    for r in results: summ[r["status"]] = summ.get(r["status"], 0) + 1',
    '    summ["total"] = len(results)',
    '    summ["ms"] = int((time.time() - t0) * 1000)',
    '    return json.dumps(summ)'
].join('\n');

/** Strip Pyodide-internal frames and make paths project-relative. */
function cleanTraceback(text, root) {
    root = root || ROOT;
    var lines = String(text || '').split('\n'), out = [], skip = false;
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        var m = /^\s*File "([^"]+)"/.exec(l);
        if (m) { skip = m[1].indexOf('/lib/python') === 0 || m[1].indexOf('_pyodide') >= 0 || m[1] === '<exec>'; if (skip) continue; }
        else if (skip && /^\s{4,}/.test(l)) continue;
        else skip = false;
        out.push(l.split(root + '/').join(''));
    }
    return out.join('\n').trim();
}
function pipRequirements(files) {
    var reqs = [];
    Object.keys(files).forEach(function (p) {
        if (!/\.py$/.test(p)) return;
        var re = /^#\s*(?:pip|requires?|requirements)\s*:\s*(.+)$/gim, m;
        while ((m = re.exec(files[p]))) m[1].split(/[\s,]+/).forEach(function (x) { if (x && reqs.indexOf(x) < 0) reqs.push(x); });
    });
    if (files['requirements.txt']) files['requirements.txt'].split('\n').forEach(function (l) { l = l.replace(/#.*/, '').trim(); if (l && reqs.indexOf(l) < 0) reqs.push(l); });
    return reqs;
}

function createRuntime(loadPyodide, post, opts) {
    opts = opts || {};
    var pyodide = null, loading = null, written = [], queue = Promise.resolve();
    function ensure(id) {
        if (pyodide) return Promise.resolve(pyodide);
        if (!loading) {
            var t0 = Date.now();
            post({ id: id, type: 'status', text: '📦 تحميل Pyodide ' + PYODIDE_VERSION + ' (WebAssembly)...' });
            loading = Promise.resolve(loadPyodide()).then(function (py) {
                pyodide = py;
                post({ id: id, type: 'status', text: '✅ بايثون ' + py.version + ' جاهز (' + (Date.now() - t0) + 'ms)', loaded: true });
                post({ type: 'ready' });
                return py;
            }, function (e) { loading = null; throw e; });
        }
        return loading;
    }
    function mkdirp(FS, dir) {
        var parts = dir.split('/').filter(Boolean), cur = '';
        parts.forEach(function (p) { cur += '/' + p; try { FS.mkdir(cur); } catch (e) { /* exists */ } });
    }
    function writeFiles(py, files) {
        var FS = py.FS;
        written.forEach(function (p) { try { FS.unlink(p); } catch (e) { /* gone */ } });
        written = [];
        mkdirp(FS, ROOT);
        Object.keys(files).forEach(function (rel) {
            if (/(^|\/)\.\.(\/|$)/.test(rel)) return;
            var full = ROOT + '/' + rel;
            mkdirp(FS, full.slice(0, full.lastIndexOf('/')));
            FS.writeFile(full, files[rel]);
            written.push(full);
        });
    }
    function loadPackages(py, id, files, codes) {
        var reqs = pipRequirements(files);
        var chain = Promise.resolve();
        if (py.loadPackagesFromImports) {
            // pytest is provided by the built-in shim → don't download the real one (11 wheels)
            var src = codes.join('\n').replace(/^\s*(?:import\s+pytest\b|from\s+pytest\b).*$/gm, '');
            chain = chain.then(function () {
                return py.loadPackagesFromImports(src, { messageCallback: function (m) { if (/Loading|Loaded/.test(m)) post({ id: id, type: 'status', text: '📦 ' + m }); }, errorCallback: function () {} });
            }).catch(function (e) { post({ id: id, type: 'out', level: 'warn', text: '⚠️ تعذر تحميل بعض الحزم: ' + (e.message || e) }); });
        }
        if (reqs.length) {
            chain = chain.then(function () {
                post({ id: id, type: 'status', text: '📦 micropip install ' + reqs.join(' ') });
                return py.loadPackage('micropip').then(function () {
                    var mp = py.pyimport('micropip');
                    return mp.install(reqs);
                });
            }).catch(function (e) { post({ id: id, type: 'out', level: 'warn', text: '⚠️ micropip: ' + String(e.message || e).split('\n').slice(-1)[0] }); });
        }
        return chain;
    }
    function run(msg) {
        var id = msg.id;
        var files = msg.files || {};
        var entry = msg.entry || 'main.py';
        var stdinText = String(msg.stdin || '');
        return ensure(id).then(function (py) {
            writeFiles(py, files);
            var lines = stdinText ? stdinText.replace(/\r\n/g, '\n').split('\n') : [], idx = 0;
            // While packages load, Pyodide's own chatter goes to the status line, not the user's output
            py.setStdout({ batched: function (s) { post({ id: id, type: 'status', text: '📦 ' + s }); } });
            py.setStderr({ batched: function (s) { post({ id: id, type: 'status', text: '📦 ' + s }); } });
            py.setStdin({ stdin: function () { var v = idx < lines.length ? lines[idx++] : null; post({ id: id, type: 'stdin', value: v }); return v == null ? null : v + '\n'; }, autoEOF: true });
            var g = py.globals;
            g.set('_ox_root', ROOT);
            g.set('_ox_entry', entry);
            g.set('_ox_entry_dir', (ROOT + '/' + entry).slice(0, (ROOT + '/' + entry).lastIndexOf('/')));
            g.set('_ox_env', JSON.stringify(msg.env || {}));
            py.runPython(PY_SETUP);
            var codes = msg.mode === 'test' ? (msg.tests || []).map(function (t) { return files[t] || ''; }) : [files[entry] || ''];
            return loadPackages(py, id, files, codes).then(function () {
                py.setStdout({ batched: function (s) { post({ id: id, type: 'out', level: 'log', text: s }); } });
                py.setStderr({ batched: function (s) { post({ id: id, type: 'out', level: 'error', text: s }); } });
                if (msg.mode === 'test') {
                    g.set('_ox_report', function (json) { post({ id: id, type: 'test', result: JSON.parse(json) }); });
                    py.runPython(PY_TESTS);
                    var runTests = g.get('_ox_run_tests');
                    var pyList = py.toPy(msg.tests || []);
                    return Promise.resolve(runTests(pyList)).then(function (summary) {
                        runTests.destroy && runTests.destroy();
                        var s = JSON.parse(String(summary));
                        post({ id: id, type: 'done', success: s.fail === 0, summary: s, error: s.fail ? s.fail + ' اختبار فشل' : undefined });
                    });
                }
                var dict = py.globals.get('dict');
                var scope = dict();
                dict.destroy && dict.destroy();
                scope.set('__name__', '__main__');
                scope.set('__file__', ROOT + '/' + entry);
                var exec = g.get('_ox_exec');
                return Promise.resolve(exec(files[entry] || '', ROOT + '/' + entry, scope)).then(function (code) {
                    exec.destroy && exec.destroy();
                    scope.destroy && scope.destroy();
                    code = Number(code) || 0;
                    post({ id: id, type: 'done', success: code === 0, error: code ? 'SystemExit: ' + code : undefined });
                });
            });
        }).catch(function (e) {
            var text = String((e && e.message) || e);
            var exit = /SystemExit: ?(\S*)\s*$/.exec(text.trim());
            if (exit) {
                var code = exit[1];
                var ok = !code || code === '0' || code === 'None';
                post({ id: id, type: 'done', success: ok, error: ok ? undefined : 'SystemExit: ' + code });
                return;
            }
            post({ id: id, type: 'done', success: false, error: cleanTraceback(text) });
        });
    }
    return {
        handle: function (msg) {
            if (!msg || msg.type !== 'run') return Promise.resolve();
            queue = queue.then(function () { return run(msg); });
            return queue;
        },
        ensure: ensure
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRuntime: createRuntime, cleanTraceback: cleanTraceback, pipRequirements: pipRequirements, PYODIDE_VERSION: PYODIDE_VERSION, PYODIDE_CDN: PYODIDE_CDN, ROOT: ROOT };
} else if (typeof importScripts === 'function') {
    var runtime = null;
    self.onmessage = function (e) {
        var msg = e.data || {};
        if (!runtime) {
            try {
                importScripts(PYODIDE_CDN + 'pyodide.js');
            } catch (err) {
                self.postMessage({ id: msg.id, type: 'done', success: false, error: 'تعذر تحميل Pyodide من ' + PYODIDE_CDN + ' — تحقق من الاتصال بالإنترنت' });
                return;
            }
            runtime = createRuntime(function () { return self.loadPyodide({ indexURL: PYODIDE_CDN }); }, function (m) { self.postMessage(m); });
        }
        runtime.handle(msg);
    };
}
