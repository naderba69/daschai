/* Community: health files — LICENSE (#502), CONTRIBUTING (#503), CODE_OF_CONDUCT (#504), FUNDING.yml (#505),
   issue templates (#506), PR template (#507), CODEOWNERS (#509); wiki pages kept in docs/wiki/ (#525-#527);
   sponsors (#528) and sponsoring (#529). */
import { esc, call } from './shared.js';
import { card, btn, empty, note, input, link } from './core.js';

export const WIKI_DIR = 'docs/wiki';

const MIT = (y, who) => `MIT License\n\nCopyright (c) ${y} ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
const ISC = (y, who) => `ISC License\n\nCopyright (c) ${y} ${who}\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n`;
const UNLICENSE = () => `This is free and unencumbered software released into the public domain.\n\nAnyone is free to copy, modify, publish, use, compile, sell, or\ndistribute this software, either in source code form or as a compiled\nbinary, for any purpose, commercial or non-commercial, and by any\nmeans.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n\nFor more information, please refer to <https://unlicense.org>\n`;
export const LICENSES = [['mit', 'MIT'], ['apache-2.0', 'Apache 2.0'], ['gpl-3.0', 'GPL v3'], ['bsd-3-clause', 'BSD 3-Clause'], ['mpl-2.0', 'MPL 2.0'], ['isc', 'ISC'], ['unlicense', 'Unlicense']];

/** Local license text when the template is short; long ones come from /licenses/{key} (pure; tested). */
export function licenseText(key, year, holder) {
    if (key === 'mit') return MIT(year, holder);
    if (key === 'isc') return ISC(year, holder);
    if (key === 'unlicense') return UNLICENSE();
    return null;
}
export const fillLicense = (body, year, holder) => String(body).replace(/\[year\]|\[yyyy\]|<year>/gi, year).replace(/\[fullname\]|\[name of copyright owner\]|<name of author>|\[owner\]/gi, holder);

export function contributingMd({ repo, owner, node, python }) {
    const setup = node ? '```bash\nnpm install\nnpm test\n```' : python ? '```bash\npython -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\npytest\n```' : '```bash\n# افتح index.html أو شغّل خادماً محلياً\nnpx serve .\n```';
    return `# المساهمة في ${repo}\n\nشكراً لاهتمامك بالمساهمة! 🎉\n\n## الإبلاغ عن مشكلة\n- ابحث أولاً في [Issues](https://github.com/${owner}/${repo}/issues) لتجنب التكرار.\n- استخدم قالب البلاغ واذكر خطوات إعادة الإنتاج والسلوك المتوقع.\n\n## بيئة التطوير\n${setup}\n\n## سير العمل\n1. أنشئ Fork ثم فرعاً: \`git checkout -b feat/my-change\`\n2. اكتب رسائل Commit واضحة بأسلوب [Conventional Commits](https://www.conventionalcommits.org/) (\`feat:\`, \`fix:\`, \`docs:\`…).\n3. أضف اختبارات للتغييرات وتأكد من نجاحها.\n4. افتح Pull Request واشرح **ماذا** و**لماذا**، واربطه بالـ Issue (\`Closes #123\`).\n\n## أسلوب الكود\n- حافظ على الأسلوب الموجود في الملفات.\n- لا تضف اعتماديات غير ضرورية.\n\n## مدونة السلوك\nبالمشاركة توافق على الالتزام بـ [مدونة السلوك](CODE_OF_CONDUCT.md).\n`;
}

export function codeOfConductMd(contact) {
    return `# مدونة السلوك (Contributor Covenant 2.1 — ملخص)\n\n## تعهدنا\nنتعهد بجعل المشاركة في مجتمعنا تجربة خالية من التحرش للجميع، بغض النظر عن العمر أو الإعاقة أو العرق أو الجنس أو الهوية أو مستوى الخبرة أو الدين أو الجنسية.\n\n## معاييرنا\nأمثلة على السلوك الإيجابي:\n- إظهار التعاطف واللطف تجاه الآخرين\n- احترام الآراء ووجهات النظر المختلفة\n- تقديم النقد البنّاء وتقبّله بلباقة\n- التركيز على ما هو أفضل للمجتمع\n\nأمثلة على السلوك غير المقبول:\n- اللغة أو الصور ذات الطابع الجنسي، والتحرش بأي شكل\n- التعليقات المهينة أو الهجمات الشخصية\n- نشر معلومات الآخرين الخاصة دون إذن\n\n## التطبيق\nيمكن الإبلاغ عن السلوك المسيء عبر: **${contact || 'البريد الإلكتروني للمشرفين'}**. ستُراجع كل البلاغات بسرية وإنصاف.\n\n## المصدر\nمقتبس من [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) الإصدار 2.1.\n`;
}

/** FUNDING.yml from { github: 'a, b', patreon, ko_fi, open_collective, custom } (pure; tested). */
export function fundingYml(o) {
    const lines = [];
    const gh = String(o.github || '').split(/[\s,]+/).filter(Boolean);
    if (gh.length) lines.push(`github: [${gh.join(', ')}]`);
    for (const k of ['patreon', 'open_collective', 'ko_fi', 'liberapay', 'buy_me_a_coffee']) if (o[k]) lines.push(`${k}: ${String(o[k]).trim()}`);
    const custom = String(o.custom || '').split(/[\s,]+/).filter(Boolean);
    if (custom.length) lines.push(`custom: [${custom.map(u => JSON.stringify(u)).join(', ')}]`);
    return lines.join('\n') + '\n';
}

export function issueTemplates() {
    return {
        '.github/ISSUE_TEMPLATE/bug_report.yml': `name: 🐞 بلاغ عن خطأ\ndescription: أبلغ عن مشكلة لنصلحها\nlabels: [bug]\nbody:\n  - type: textarea\n    id: what\n    attributes:\n      label: ماذا حدث؟\n      description: وصف واضح للمشكلة\n    validations:\n      required: true\n  - type: textarea\n    id: steps\n    attributes:\n      label: خطوات إعادة الإنتاج\n      placeholder: |\n        1. اذهب إلى ...\n        2. اضغط على ...\n    validations:\n      required: true\n  - type: textarea\n    id: expected\n    attributes:\n      label: السلوك المتوقع\n  - type: input\n    id: env\n    attributes:\n      label: البيئة\n      placeholder: المتصفح / النظام / الإصدار\n`,
        '.github/ISSUE_TEMPLATE/feature_request.yml': `name: ✨ اقتراح ميزة\ndescription: اقترح فكرة لتحسين المشروع\nlabels: [enhancement]\nbody:\n  - type: textarea\n    id: problem\n    attributes:\n      label: ما المشكلة التي تحلها الميزة؟\n    validations:\n      required: true\n  - type: textarea\n    id: solution\n    attributes:\n      label: الحل المقترح\n  - type: textarea\n    id: alternatives\n    attributes:\n      label: بدائل فكرت بها\n`,
        '.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: true\n'
    };
}

export const PR_TEMPLATE = `## الوصف\n<!-- ماذا يغيّر هذا الـ PR ولماذا؟ -->\n\nCloses #\n\n## نوع التغيير\n- [ ] إصلاح خطأ\n- [ ] ميزة جديدة\n- [ ] تغيير جذري (Breaking)\n- [ ] توثيق\n\n## قائمة التحقق\n- [ ] اختبرت التغييرات محلياً\n- [ ] أضفت/حدّثت الاختبارات\n- [ ] حدّثت التوثيق عند الحاجة\n\n## لقطات شاشة (إن وجدت)\n`;

/** CODEOWNERS from rows [{pattern, owners:'@a @org/team'}] (pure; tested). */
export function codeownersText(rows) {
    const body = rows.filter(r => r.pattern && r.owners).map(r => `${r.pattern.trim()} ${r.owners.trim().split(/[\s,]+/).map(o => (o.startsWith('@') || o.includes('@') ? o : '@' + o)).join(' ')}`);
    return `# CODEOWNERS — يُطلب تلقائياً مراجعة هؤلاء عند تعديل المسارات\n# https://docs.github.com/articles/about-code-owners\n${body.join('\n')}\n`;
}

/** "My Page" → "My-Page.md" (keeps Arabic letters; tested). */
export const wikiFileName = (title) => String(title || '').trim().replace(/[\\/:*?"<>|#%]+/g, '').replace(/\s+/g, '-').slice(0, 80) + '.md';

export function installCommunity(P) {
    // ------------------------------------------------------------------ HEALTH
    P.ghxCommunity = async function () {
        const rp = this.ghRepoPath();
        const [prof, paths] = await Promise.all([this.gh(`${rp}/community/profile`).catch(() => null), this.ghRepoPaths().catch(() => [])]);
        const files = (prof && prof.files) || {};
        const has = (re) => paths.some(p => re.test(p));
        const items = [
            ['license', 'LICENSE', 'fa-scale-balanced', !!files.license || has(/^(LICENSE|LICENCE|COPYING)(\.\w+)?$/i), 'app.ghxGenLicense()'],
            ['contributing', 'CONTRIBUTING.md', 'fa-hands-helping', !!files.contributing || has(/(^|\/)CONTRIBUTING\.md$/i), 'app.ghxGenContributing()'],
            ['coc', 'CODE_OF_CONDUCT.md', 'fa-handshake', !!files.code_of_conduct_file || !!files.code_of_conduct || has(/(^|\/)CODE_OF_CONDUCT\.md$/i), 'app.ghxGenCoC()'],
            ['funding', '.github/FUNDING.yml', 'fa-hand-holding-dollar', has(/^\.github\/FUNDING\.ya?ml$/i), 'app.ghxGenFunding()'],
            ['issues', 'Issue Templates', 'fa-circle-dot', !!files.issue_template || has(/^\.github\/ISSUE_TEMPLATE\//i), 'app.ghxGenIssueTemplates()'],
            ['pr', 'PR Template', 'fa-code-pull-request', !!files.pull_request_template || has(/(^|\/)pull_request_template\.md$/i), 'app.ghxGenPRTemplate()'],
            ['codeowners', 'CODEOWNERS', 'fa-user-shield', has(/^(\.github\/|docs\/)?CODEOWNERS$/), 'app.ghxGenCodeowners()'],
            ['readme', 'README', 'fa-book', !!files.readme || has(/^README(\.\w+)?$/i), "app.ghxReadmeHelp()"]
        ];
        const pct = prof && prof.health_percentage != null ? prof.health_percentage : Math.round(items.filter(i => i[3]).length / items.length * 100);
        return card(`صحة المجتمع: ${pct}%`, `<div class="ghx-progress"><div style="width:${pct}%"></div></div>
                <div class="text-dim" style="font-size:0.74rem;margin-top:4px">الملفات التي تجعل المشروع مرحِّباً بالمساهمين. كل ملف يُفتح للمراجعة قبل الـ Commit.</div>`, { icon: 'fa-heart-pulse' })
            + `<div class="ghx-health">${items.map(([id, label, icon, ok, act]) => `<div class="ghx-health-item ${ok ? 'ok' : ''}" data-health="${id}"><i class="fa-solid ${icon}"></i><b dir="ltr">${label}</b>${ok ? '<span class="gh-badge ok">✓ موجود</span>' : '<span class="gh-badge dim">مفقود</span>'}${btn(ok ? 'تحديث' : 'توليد', act, { icon: 'fa-wand-magic-sparkles', primary: !ok })}</div>`).join('')}</div>`;
    };
    P.ghxReadmeHelp = function () {
        if (this.openReadmeGenerator) return this.openReadmeGenerator();
        if (this.sendQuickPrompt) { this.closeModals(); return this.sendQuickPrompt('اكتب README.md احترافياً لهذا المشروع: الوصف، المزايا، التثبيت، الاستخدام، المساهمة، الترخيص.'); }
    };
    const holder = async (app) => { const u = await app.ghViewer().catch(() => null); return (u && (u.name || u.login)) || app.ghRepo().owner; };

    P.ghxGenLicense = async function (keyArg, holderArg) {
        const who = holderArg || await holder(this);
        let key = keyArg, name = who;
        if (!key) {
            const r = await this.showDialog({ title: 'توليد LICENSE', fields: [{ id: 'key', type: 'select', label: 'الترخيص', value: 'mit', options: LICENSES.map(([value, label]) => ({ value, label })) }, { id: 'holder', label: 'صاحب الحقوق', value: who, dir: 'auto' }], buttons: [{ label: 'معاينة', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
            if (!r) return null;
            key = r.values.key; name = r.values.holder || who;
        }
        const year = String(new Date().getFullYear());
        let text = licenseText(key, year, name);
        if (!text) { const lic = await this.gh(`/licenses/${encodeURIComponent(key)}`); text = fillLicense(lic.body, year, name); }
        return this.openCommitReview('LICENSE', text, { message: `docs: add ${key.toUpperCase()} license` });
    };
    P.ghxGenContributing = async function () {
        const paths = await this.ghRepoPaths().catch(() => []);
        const stack = this.detectStack ? this.detectStack(paths) : {};
        const { owner, repo } = this.ghRepo();
        return this.openCommitReview('CONTRIBUTING.md', contributingMd({ owner, repo, node: stack.node, python: stack.python }), { message: 'docs: add CONTRIBUTING guide' });
    };
    P.ghxGenCoC = async function (contactArg) {
        let contact = contactArg;
        if (contact == null) { const u = await this.ghViewer().catch(() => null); contact = await this.askText('مدونة السلوك', (u && u.email) || '', { label: 'بريد للتواصل عند البلاغات', placeholder: 'conduct@example.com' }); if (contact == null) return null; }
        return this.openCommitReview('CODE_OF_CONDUCT.md', codeOfConductMd(contact), { message: 'docs: add Code of Conduct' });
    };
    P.ghxGenFunding = async function (o) {
        if (!o) {
            const u = await this.ghViewer().catch(() => null);
            const r = await this.showDialog({ title: 'FUNDING.yml — زر «Sponsor»', fields: [{ id: 'github', label: 'GitHub Sponsors (أسماء مفصولة بفاصلة)', value: (u && u.login) || this.ghRepo().owner }, { id: 'ko_fi', label: 'Ko-fi' }, { id: 'patreon', label: 'Patreon' }, { id: 'open_collective', label: 'Open Collective' }, { id: 'buy_me_a_coffee', label: 'Buy Me a Coffee' }, { id: 'custom', label: 'روابط مخصصة (PayPal…)' }], buttons: [{ label: 'معاينة', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
            if (!r) return null;
            o = r.values;
        }
        const yml = fundingYml(o);
        if (!yml.trim()) { this.showToast('أدخل منصة تمويل واحدة على الأقل', 'warning'); return null; }
        return this.openCommitReview('.github/FUNDING.yml', yml, { message: 'chore: add FUNDING.yml' });
    };
    P.ghxGenIssueTemplates = async function () {
        if (!this.ghRequireToken()) return null;
        const t = issueTemplates();
        if (!(await this.ghxConfirm('قوالب Issues', `سيُضاف ${Object.keys(t).length} ملفات:<br>${Object.keys(t).map(p => `<code dir="ltr">${esc(p)}</code>`).join('<br>')}`))) return null;
        return this.ghxRunGitOp('إضافة قوالب Issues', (ops) => ops.commitFiles({ branch: this.ghRepo().branch, files: Object.entries(t).map(([path, content]) => ({ path, content })), message: 'chore: add issue templates' }));
    };
    P.ghxGenPRTemplate = function () { return this.openCommitReview('.github/pull_request_template.md', PR_TEMPLATE, { message: 'chore: add pull request template' }); };
    P.ghxGenCodeowners = async function (rows) {
        if (!rows) {
            const { owner } = this.ghRepo();
            const r = await this.showDialog({ title: 'CODEOWNERS', body: '<p class="ox-dialog-msg">سطر لكل قاعدة: <code dir="ltr">النمط  @مالك1 @org/team</code></p>', fields: [{ id: 'rules', type: 'textarea', rows: 6, dir: 'ltr', value: `*  @${owner}\n/docs/  @${owner}\n*.js  @${owner}\n.github/  @${owner}` }], buttons: [{ label: 'معاينة', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
            if (!r) return null;
            rows = String(r.values.rules || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => { const [pattern, ...owners] = l.split(/\s+/); return { pattern, owners: owners.join(' ') }; });
        }
        return this.openCommitReview('.github/CODEOWNERS', codeownersText(rows), { message: 'chore: add CODEOWNERS' });
    };

    // ------------------------------------------------------------------ WIKI (docs/wiki — editable & versioned)
    P.ghxWiki = async function () {
        const { owner, repo, branch } = this.ghRepo();
        const [list, info] = await Promise.all([this.gh(`${this.ghRepoPath()}/contents/${WIKI_DIR}?ref=${encodeURIComponent(branch)}`, { allow: [404] }).catch(() => []), this.ghRepoInfo().catch(() => ({}))]);
        const pages = Array.isArray(list) ? list.filter(f => f.type === 'file' && /\.md$/i.test(f.name)) : [];
        return note(`صفحات الويكي تُحفظ في <code dir="ltr">${WIKI_DIR}/</code> داخل المستودع — قابلة للمراجعة والـ PR ولها سجل كامل. ${info.has_wiki ? `${link('ويكي GitHub الأصلي', `https://github.com/${owner}/${repo}/wiki`, { icon: 'fa-book-open' })}` : ''}`)
            + `<div class="gh-toolbar">${btn('صفحة جديدة', 'app.ghxWikiNew()', { icon: 'fa-plus', primary: true })}${pages.length ? '' : btn('إنشاء الصفحة الرئيسية', "app.ghxWikiEdit('Home.md')", { icon: 'fa-house' })}</div>`
            + (pages.length ? `<div class="gh-list">${pages.map(p => `<div class="gh-item" data-wiki="${esc(p.name)}" onclick="${call(this, 'ghxWikiOpen', p.name)}"><i class="fa-solid fa-file-lines text-blue"></i><div class="gh-item-main"><div class="gh-item-title">${esc(p.name.replace(/\.md$/i, '').replace(/-/g, ' '))}</div><div class="gh-item-meta" dir="ltr">${esc(p.path)}</div></div>
                <div class="gh-item-actions" onclick="event.stopPropagation()">${btn('', call(this, 'ghxWikiEdit', p.name), { icon: 'fa-pen', title: 'تحرير' })}</div></div>`).join('')}</div>` : empty('لا توجد صفحات ويكي بعد.'));
    };
    P.ghxWikiRead = async function (name) {
        const f = await this.ghGetFile(`${WIKI_DIR}/${name}`);
        return f ? f.content : null;
    };
    P.ghxWikiOpen = function (name) {
        return this.ghxView('ghxWikiOpen', [name], async () => {
            const md = await this.ghxWikiRead(name);
            if (md == null) return empty('الصفحة غير موجودة');
            const html = this.renderMarkdownSafe(md).replace(/href="(?!https?:|#|mailto:)([^"]+?)(?:\.md)?"/g, (m, target) => `href="#" onclick="app.ghxWikiOpen(app.ghVal(${this.ghRef(decodeURIComponent(target).replace(/^\.\//, '') + '.md')})); return false"`);
            return `<div class="gh-detail-head"><h3>${esc(name.replace(/\.md$/i, '').replace(/-/g, ' '))}</h3><span class="gh-spacer"></span>${btn('تحرير', call(this, 'ghxWikiEdit', name), { icon: 'fa-pen', primary: true })}</div><div class="gh-md ghx-wiki">${html}</div>`;
        });
    };
    P.ghxWikiNew = async function (titleArg) {
        const title = titleArg || await this.askText('صفحة ويكي جديدة', '', { label: 'عنوان الصفحة', dir: 'auto', placeholder: 'دليل البدء' });
        if (!title) return null;
        const name = wikiFileName(title);
        return this.ghxWikiEdit(name, `# ${title}\n\n`);
    };
    P.ghxWikiEdit = async function (name, initial) {
        let content = initial;
        if (content == null) content = (await this.ghxWikiRead(name).catch(() => null)) ?? `# ${name.replace(/\.md$/i, '').replace(/-/g, ' ')}\n\n`;
        const r = await this.showDialog({ title: `تحرير: ${name}`, wide: true, fields: [{ id: 'md', type: 'textarea', rows: 18, dir: 'auto', value: content }, { id: 'msg', label: 'رسالة الـ Commit', value: `docs(wiki): update ${name}`, dir: 'ltr' }], buttons: [{ label: 'حفظ', value: 'ok', primary: true }, { label: 'إلغاء', value: null }] });
        if (!r) return null;
        if (!this.ghRequireToken()) return null;
        const sha = await this.ghxRunGitOp('حفظ صفحة الويكي', (ops) => ops.commitFiles({ branch: this.ghRepo().branch, files: [{ path: `${WIKI_DIR}/${name}`, content: r.values.md }], message: r.values.msg || `docs(wiki): update ${name}` }));
        if (sha) { this.showToast('✅ حُفظت الصفحة', 'success'); if (this.ghTab === 'community') { if (this.ghView) this.ghxWikiOpen(name); else this.ghxReload(); } }
        return sha;
    };

    // ------------------------------------------------------------------ SPONSORS (#528 #529)
    P.ghxSponsors = async function () {
        const { owner } = this.ghRepo();
        const u = this._ghxSponsorUser || owner;
        let data = null, err = '';
        if ((this.settings.githubToken || '').trim()) {
            try {
                data = await this.ghGraphQL(`query($login:String!){ repositoryOwner(login:$login){ login avatarUrl url ... on Sponsorable { hasSponsorsListing sponsorsListing { name shortDescription tiers(first:10){ nodes { name monthlyPriceInDollars isOneTime description } } } sponsors(first:50){ totalCount nodes { ... on User { login avatarUrl url } ... on Organization { login avatarUrl url } } } sponsoring(first:30){ totalCount nodes { ... on User { login avatarUrl url } ... on Organization { login avatarUrl url } } } } } }`, { login: u });
            } catch (e) { err = e.message; }
        }
        const o = data && data.repositoryOwner;
        const person = (n) => `<a class="ghx-person" href="${esc(n.url)}" target="_blank" rel="noopener" title="${esc(n.login)}"><img class="ghx-avatar" src="${esc(n.avatarUrl)}&s=64" width="32" height="32" alt="" loading="lazy"><span dir="ltr">${esc(n.login)}</span></a>`;
        return `<div class="gh-toolbar">${input('ghx-sponsor-user', { value: u, placeholder: 'اسم مستخدم أو مؤسسة', style: 'max-width:220px' })}${btn('عرض', "app._ghxSponsorUser=document.getElementById('ghx-sponsor-user').value.trim(); app.ghxReload()", { icon: 'fa-magnifying-glass' })}<span class="gh-spacer"></span>
                ${link(`رعاية ${esc(u)}`, `https://github.com/sponsors/${encodeURIComponent(u)}`, { icon: 'fa-heart' })}${btn('أضف زر Sponsor لمستودعك', 'app.ghxGenFunding()', { icon: 'fa-hand-holding-dollar' })}</div>`
            + (!data ? empty(err ? '❌ ' + esc(err) : 'أضف رمز PAT لعرض الرعاة (واجهة GraphQL).')
                : !o ? empty('الحساب غير موجود')
                : (o.hasSponsorsListing && o.sponsorsListing ? card(esc(o.sponsorsListing.name || o.login), `<div class="text-dim">${esc(o.sponsorsListing.shortDescription || '')}</div>
                        <div class="ghx-tiers">${((o.sponsorsListing.tiers && o.sponsorsListing.tiers.nodes) || []).map(t => `<div class="ghx-tier"><b>$${+t.monthlyPriceInDollars}${t.isOneTime ? '' : '/شهر'}</b><span>${esc(t.name)}</span></div>`).join('')}</div>
                        <div class="gh-row" style="margin-top:8px">${link('رعاية الآن', `https://github.com/sponsors/${encodeURIComponent(o.login)}`, { icon: 'fa-heart' })}</div>`, { icon: 'fa-hand-holding-heart' }) : note(`<b dir="ltr">${esc(o.login)}</b> لا يملك صفحة GitHub Sponsors. ${link('التسجيل في Sponsors', 'https://github.com/sponsors', { icon: 'fa-heart' })}`))
                    + card(`الرعاة (${(o.sponsors && o.sponsors.totalCount) || 0})`, `<div class="ghx-people">${((o.sponsors && o.sponsors.nodes) || []).filter(n => n && n.login).map(person).join('') || '<span class="text-dim">لا يوجد رعاة ظاهرون.</span>'}</div>`, { icon: 'fa-users' })
                    + card(`يرعى (${(o.sponsoring && o.sponsoring.totalCount) || 0})`, `<div class="ghx-people">${((o.sponsoring && o.sponsoring.nodes) || []).filter(n => n && n.login).map(person).join('') || '<span class="text-dim">—</span>'}</div>`, { icon: 'fa-heart' }));
    };
}
