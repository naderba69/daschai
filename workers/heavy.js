/* ==============================================================================
   OX-Alpha Workbench Pro — heavy-work worker (#814), same-origin, loaded on demand.
   Keeps big-file work off the main thread: hashing, project-wide search, stats,
   JSON format/minify, gzip, and A/B micro-benchmarks (#881/#882).
   The same `heavyTask` function runs inline in tests / when Workers are unavailable.
   ============================================================================== */
/* eslint-env worker */
'use strict';
async function sha256(text) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}
async function heavyTask(type, data) {
    data = data || {};
    if (type === 'hash') {
        var out = [];
        for (var i = 0; i < (data.files || []).length; i++) out.push({ path: data.files[i].path, sha256: await sha256(data.files[i].content || ''), bytes: (data.files[i].content || '').length });
        return out;
    }
    if (type === 'search') {
        var re = data.regex ? new RegExp(data.query, data.caseSensitive ? 'g' : 'gi') : null, q = data.caseSensitive ? data.query : String(data.query || '').toLowerCase(), hits = [];
        (data.files || []).forEach(function (f) {
            String(f.content || '').split('\n').forEach(function (line, n) {
                var ok = re ? (re.lastIndex = 0, re.test(line)) : (data.caseSensitive ? line : line.toLowerCase()).indexOf(q) >= 0;
                if (ok && hits.length < (data.limit || 500)) hits.push({ path: f.path, line: n + 1, text: line.slice(0, 200) });
            });
        });
        return hits;
    }
    if (type === 'stats') {
        var files = data.files || [], lines = 0, chars = 0, blank = 0, byExt = {};
        files.forEach(function (f) {
            var c = String(f.content || ''), ls = c.split('\n'), ext = (f.path.split('.').pop() || '').toLowerCase();
            lines += ls.length; chars += c.length; blank += ls.filter(function (l) { return !l.trim(); }).length;
            byExt[ext] = (byExt[ext] || 0) + ls.length;
        });
        return { files: files.length, lines: lines, chars: chars, blank: blank, byExt: byExt };
    }
    if (type === 'json') {
        var obj = JSON.parse(data.text);
        return data.minify ? JSON.stringify(obj) : JSON.stringify(obj, null, data.indent || 2);
    }
    if (type === 'gzip') {
        var cs = new CompressionStream('gzip'), w = cs.writable.getWriter();
        w.write(new TextEncoder().encode(data.text || '')); w.close();
        var ab = await new Response(cs.readable).arrayBuffer();
        return { raw: (data.text || '').length, gzip: ab.byteLength };
    }
    if (type === 'bench') {
        // A/B micro-benchmark of user code (runs in the worker so a slow snippet never freezes the UI)
        var make = function (src) { return new Function('i', src); }; // eslint-disable-line no-new-func
        var run = function (fn, n) { var t = performance.now(); for (var k = 0; k < n; k++) fn(k); return performance.now() - t; };
        var res = {};
        ['a', 'b'].forEach(function (key) {
            if (!data[key]) return;
            var fn = make(data[key]), n = data.iterations || 10000;
            run(fn, Math.min(1000, n)); // warm-up
            var times = []; for (var r = 0; r < (data.rounds || 5); r++) times.push(run(fn, n));
            times.sort(function (x, y) { return x - y; });
            var med = times[Math.floor(times.length / 2)];
            res[key] = { ms: med, opsPerSec: Math.round(n / (med / 1000 || 1e-9)), times: times };
        });
        return res;
    }
    throw new Error('unknown task ' + type);
}
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
    self.onmessage = function (e) {
        var d = e.data || {};
        heavyTask(d.type, d.data).then(function (result) { self.postMessage({ id: d.id, result: result }); }, function (err) { self.postMessage({ id: d.id, error: String(err && err.message || err) }); });
    };
}
if (typeof module !== 'undefined') module.exports = { heavyTask: heavyTask };
