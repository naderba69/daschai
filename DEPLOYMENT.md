# 🚀 دليل النشر — OX-Alpha Workbench Pro v2

## النشر على Vercel (موصى به)
1. اربط المستودع `naderba69/daschai` في https://vercel.com/new
2. اترك الإعدادات افتراضية — `vercel.json` يحدد كل شيء ويتقدّم على إعدادات اللوحة:
   - أمر البناء `npm run vercel-build` = `node build.js --minify` ثم `scripts/stage-public.cjs`
   - مجلد المخرجات `public/`: ينسخ إليه السكربت ملفات الموقع فقط (index.html وsw.js وmanifest.json وversion.json وCHANGELOG.md ومجلدات assets وworkers وicons وwidgets)، فلا تُنشر المصادر ولا الاختبارات ولا package.json
3. أضف متغيرات البيئة إن وجدت (لا حاجة — المفاتيح في localStorage)
4. اضغط Deploy — سيعمل `vercel.json` تلقائياً (Security Headers + Rewrites)
5. للتحقق محلياً قبل الدفع: `npm run vercel-build` ثم `npx serve public`. و`npm test` يفحص أن `vercel.json` لا يحوي مفاتيح يرفضها Vercel وأن مجلد المخرجات كامل

## النشر عبر Termux (آمن محدث)
```bash
pkg update -y && pkg install git nodejs -y
cd ~/storage/downloads || cd /sdcard/Download
unzip -o ox-alpha-workbench-pro.zip -d ~/daschai && cd ~/daschai
node build.js --minify
git init && git branch -M main
git add . && git commit -m "feat: OX-Alpha Pro v2 — audited & secured"
git remote add origin https://github.com/naderba69/daschai.git
git push -u origin main --force
```

## التحقق المحلي
```bash
npm install
npm run build
npm run preview  # ثم افتح http://localhost:3000
```

## متغيرات البيئة
لا حاجة لملف `.env` في الإنتاج — المفاتيح تُحفظ في المتصفح فقط.
للتطوير المحلي، انسخ `.env.example` إلى `.env.local`.

## الأمان
- جميع المفاتيح في `localStorage` فقط، لا تُرسل لخادم وسيط.
- CSP و HSTS مفعلة عبر `vercel.json`.
- استخدم PAT برمز دقيق الصلاحيات `repo` فقط.

