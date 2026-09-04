# ⚡ OX-Alpha Workbench Pro (Gemini AI Edition)
### منظومة هندسة البرمجيات بالذكاء الاصطناعي ومساعد GitHub Copilot المتطور

> **المنظومة الإنتاجية المستقلة لهندسة البرمجيات، إدارة مستودعات GitHub، فك وتصدير مشاريع ZIP، وتشغيل الأكواد الحية بتصميم وتجربة مستخدم تضاهي واجهة Google Gemini.**

---

## 🌟 أبرز الميزات والترقيات الحديثة

### 1. 🚀 توليد وعرض الرسائل الطويلة بنسبة 100% دون أي انقطاع
- **محرك الاستكمال التلقائي متعدد المراحل (Multi-Pass Auto-Continue Engine):** عند وصول الرد للحد الأقصى للتوكنات (`finish_reason === 'length'`)، يقوم المحرك تلقائياً بمواصلة التوليد في نفس الرسالة دون توقف أو الحاجة للنقر اليدوي.
- **إصلاح وموازنة الماركداون أثناء البث الحي (Streaming Markdown Repairer):** يضمن بقاء كتل الأكواد والجداول والقوائم سليمة ومنسقة لحظياً دون تشوه أثناء تدفق البيانات.
- **حاوية رسائل غير مقيدة الارتفاع (Zero Truncation CSS):** إزالة أي قيود `max-height` أو `overflow: hidden` لضمان ظهور آلاف الأسطر البرمجية بسلاسة.
- **التمرير الذكي الملتصق (Smart Sticky Scroll & Scroll-To-Bottom Pill):** زر عائم ينبثق عند التمرير لأعلى للعودة بضغطة واحدة إلى أسفل الرد المتدفق.

---

### 2. ✦ واجهة فائقة تنافس تصميم Google Gemini
- **نظام الألوان الأوبسيدي الداكن (Gemini Obsidian Dark Palette):** خلفيات عميقة `#131314` و `#1e1f20` مع حدود زجاجية خفيفة وتأثيرات Blur عالي الدقة.
- **هالة وتدرج جيميناي الساحر (Gemini Aurora Gradient):** تدرج لوني ساحر يجمع بين الأزرق والبنفسجي والوردي مع أيقونة النجمة اللامعة `✦`.
- **كبسولة الإدخال العائمة (Gemini Floating Input Capsule):** حقل إدخال عائم مع توسع ديناميكي للأوامر، أزرار إرفاق الملفات ومشاريع ZIP، البحث الحي، والإملاء الصوتي.
- **شريط الاقتراحات السريعة (Quick Prompts Carousel):** شرائح سريعة لفحص المشاريع، جلب مستودعات GitHub، وكتابة ميزات جديدة مع Commit مباشر.
- **سلسلة التفكير المنطقي (DeepSeek R1 / Gemini Thinking Drawer):** نافذة قابلة للطي تعرض تفكير النماذج التوليدية خطوة بخطوة مع توقيت المعالجة وسرعة التوكنات.

---

### 3. 🛠️ تكامل GitHub المتكامل وفلترة ملفات الكاش التالفة
- **فلترة ذكية لملفات Termux الكاش:** تصفية أكثر من 13,000 ملف كاش تالف (`.cache/`, `.config/`, `.npm/`, `.termux/`, `_cacache/`) والتركيز على ملفات الكود الحقيقية والدروس.
- **1-Click Direct GitHub Commit & Push:** إمكانية عمل Commit مباشر من واجهة المحادثة إلى أي مستودع GitHub (`naderba69/daschai` وغيرها).
- **1-Click Full Project ZIP Export:** تصدير حزمة المشروع البرمجية بالكامل بضغطة زر واحدة كملف ZIP جاهز للتشغيل.
- **محرك فك ضغط ZIP في المتصفح (JSZip):** فك واستكشاف أي مشروع مضغوط محلياً وتحديد بنيته المعمارية.

---

### 4. ⚡ تشغيل الأكواد الحية والصوت
- **محرك بايثون Wasm مدمج (Pyodide):** تشغيل سكربتات بايثون مباشرة في المتصفح دون خادم خلفي مع نافذة طرفية مدمجة.
- **محرك تشغيل JavaScript:** تجربة الأكواد ومعاينتها في الوقت الفعلي.
- **النطق والاستماع الصوتي (STT / TTS):** دعم كامل للغتين العربية والإنجليزية.

---

## 📲 خطوات التثبيت والنشر عبر Termux و GitHub

لرفع التحديث الأخير مباشرة إلى مستودع GitHub `https://github.com/naderba69/daschai.git`:

1. قم بتحميل الملف المضغوط `ox-alpha-workbench-pro.zip` إلى هاتفك (مجلد `Download`).
2. افتح تطبيق **Termux** ونفذ الأوامر التالية:

```bash
# 1. الانتقال إلى مجلد التنزيلات
cd ~/storage/downloads || cd /sdcard/Download

# 2. إنشاء مجلد العمل وفك الضغط
mkdir -p ~/daschai && cd ~/daschai
unzip -o /sdcard/Download/ox-alpha-workbench-pro.zip -d .

# 3. إعداد Git والرفع إلى GitHub
git init
git branch -M main
git add .
git commit -m "feat: Upgrade OX-Alpha to Gemini UI & Infinite Streaming Engine"
git remote add origin https://github.com/naderba69/daschai.git || git remote set-url origin https://github.com/naderba69/daschai.git
git push -u origin main --force
```

---

## 🌐 النشر على Vercel
1. افتح [Vercel Dashboard](https://vercel.com/new).
2. استورد المستودع `naderba69/daschai`.
3. اضغط **Deploy** وسيعمل التطبيق مباشرة!
