/* ==============================================================================
   OX-Alpha Workbench Pro — polyglot worker (same-origin file, loaded on demand) — #153
   Ruby: ruby.wasm (CRuby 3.4 compiled to WASI) from jsDelivr, runs fully in this worker.
   PHP:  php-wasm (PHP 8 compiled to WASM) from jsDelivr, runs fully in this worker.
   Go:   no in-browser Go toolchain is practical, so code is compiled & run remotely by the
         public Wandbox API (https://wandbox.org) — needs network; the code leaves the device.
   In Node (tests) `createPolyglot({ loadRuby, loadPhp, fetch })` is used with fakes.
   ============================================================================== */
/* eslint-env worker */
'use strict';
var RUBY_PKG = 'https://cdn.jsdelivr.net/npm/@ruby/3.4-wasm-wasi@2.10.1/dist/';
var PHP_URL = 'https://cdn.jsdelivr.net/npm/php-wasm@0.2.0/PhpWeb.mjs';
var WANDBOX = 'https://wandbox.org/api/';

function createPolyglot(opts) {
    var rubyP = null, phpP = null, goCompiler = null;
    var fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch.bind(self) : null);
    function rubyStdin(stdin) { return stdin ? "require 'stringio'\n$stdin = StringIO.new(" + JSON.stringify(String(stdin)) + ")\n" : ''; }
    function runRuby(job, emit) {
        if (!rubyP) rubyP = Promise.resolve(opts.loadRuby(emit));
        return rubyP.then(function (rb) {
            var out = [], err = [];
            rb.sink.out = function (t) { out.push(t); emit('stdout', t); };
            rb.sink.err = function (t) { err.push(t); emit('stderr', t); };
            return Promise.resolve(rb.createVM()).then(function (vm) {
                try {
                    var prefix = rubyStdin(job.stdin);
                    vm.eval(prefix + "$stdout.sync = true\n" + job.code);
                    return { exitCode: 0 };
                } catch (e) {
                    var msg = String(e && e.message || e);
                    if (/SystemExit|exit/i.test(msg) && !/Error/.test(msg)) return { exitCode: 0 };
                    emit('stderr', msg + '\n');
                    return { exitCode: 1, error: msg.split('\n')[0] };
                }
            });
        });
    }
    function runPhp(job, emit) {
        if (!phpP) phpP = Promise.resolve(opts.loadPhp());
        return phpP.then(function (PhpWeb) {
            var php = new PhpWeb();
            var onOut = function (e) { emit('stdout', [].concat(e.detail).join('')); };
            var onErr = function (e) { emit('stderr', [].concat(e.detail).join('')); };
            php.addEventListener('output', onOut);
            php.addEventListener('error', onErr);
            var ready = php.binary ? Promise.resolve(php.binary) : Promise.resolve();
            return ready.then(function () {
                var code = /^\s*<\?php/.test(job.code) || /<\?php/.test(job.code) ? job.code : '<?php\n' + job.code;
                if (job.stdin && php.inputString) php.inputString(job.stdin);
                return php.run(code);
            }).then(function (exit) {
                php.removeEventListener('output', onOut);
                php.removeEventListener('error', onErr);
                var c = typeof exit === 'number' ? exit : 0;
                return { exitCode: c, error: c ? 'exit code ' + c : undefined };
            });
        });
    }
    function wandboxCompiler() {
        if (goCompiler) return Promise.resolve(goCompiler);
        return fetchFn(WANDBOX + 'list.json').then(function (r) { if (!r.ok) throw new Error('Wandbox HTTP ' + r.status); return r.json(); }).then(function (list) {
            var go = (list || []).filter(function (c) { return /^go$/i.test(c.language) || /^Go$/.test(c.language); });
            var pick = go.find(function (c) { return !/head/i.test(c.name); }) || go[0];
            if (!pick) throw new Error('Wandbox لا يوفر مترجم Go حالياً');
            goCompiler = pick.name;
            return goCompiler;
        });
    }
    function runGo(job, emit) {
        if (!fetchFn) return Promise.reject(new Error('fetch غير متاح'));
        return wandboxCompiler().then(function (compiler) {
            emit('info', '☁ يُرسل الكود إلى Wandbox (' + compiler + ') للترجمة والتشغيل…\n');
            return fetchFn(WANDBOX + 'compile.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: job.code, compiler: compiler, stdin: job.stdin || '', save: false }) });
        }).then(function (r) { if (!r.ok) throw new Error('Wandbox HTTP ' + r.status); return r.json(); }).then(function (res) {
            if (res.compiler_error) emit('stderr', res.compiler_error);
            if (res.program_output) emit('stdout', res.program_output);
            if (res.program_error) emit('stderr', res.program_error);
            var code = res.status != null ? +res.status : (res.compiler_error ? 1 : 0);
            return { exitCode: code, error: code ? (res.compiler_error ? 'خطأ ترجمة' : 'exit code ' + code) : undefined, remote: true };
        });
    }
    function run(job, emit) {
        var t0 = Date.now();
        var lang = String(job.lang || '').toLowerCase();
        var p = lang === 'ruby' ? runRuby(job, emit) : lang === 'php' ? runPhp(job, emit) : lang === 'go' ? runGo(job, emit) : Promise.reject(new Error('لغة غير مدعومة: ' + lang));
        return p.then(function (r) { r.ms = Date.now() - t0; return r; }, function (e) {
            var msg = String(e && e.message || e);
            if (lang === 'go' && /Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)) msg += ' — تعذر الوصول إلى Wandbox (الشبكة أو سياسة CORS)';
            return { exitCode: 1, error: msg, ms: Date.now() - t0 };
        });
    }
    return { run: run };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createPolyglot: createPolyglot, RUBY_PKG: RUBY_PKG, PHP_URL: PHP_URL, WANDBOX: WANDBOX };
} else if (typeof self !== 'undefined' && typeof importScripts === 'function') {
    var poly = createPolyglot({
        loadRuby: function (emit) {
            emit('info', '⏳ تحميل Ruby (ruby.wasm ~ عدة ميغابايت، مرة واحدة)…\n');
            importScripts(RUBY_PKG + 'browser.umd.js');
            var lib = self['ruby-wasm-wasi'];
            var sink = { out: function () {}, err: function () {} };
            // ruby.wasm prints through console.log / console.warn → route them to the current job
            self.console.log = function () { sink.out(Array.prototype.join.call(arguments, ' ') + '\n'); };
            self.console.warn = function () { sink.err(Array.prototype.join.call(arguments, ' ') + '\n'); };
            var modP = (WebAssembly.compileStreaming ? WebAssembly.compileStreaming(fetch(RUBY_PKG + 'ruby+stdlib.wasm')) : fetch(RUBY_PKG + 'ruby+stdlib.wasm').then(function (r) { return r.arrayBuffer(); }).then(function (b) { return WebAssembly.compile(b); }));
            return modP.then(function (mod) {
                return { sink: sink, createVM: function () { return lib.DefaultRubyVM(mod, { consolePrint: true }).then(function (r) { return r.vm; }); } };
            });
        },
        loadPhp: function () { return import(PHP_URL).then(function (m) { return m.PhpWeb || (m.default && m.default.PhpWeb) || m.default; }); }
    });
    self.onmessage = function (e) {
        var msg = e.data || {};
        if (msg.type !== 'run') return;
        poly.run(msg, function (stream, text) { self.postMessage({ id: msg.id, type: 'out', stream: stream, text: text }); })
            .then(function (r) { self.postMessage(Object.assign({ id: msg.id, type: 'done' }, r)); });
    };
}
