# OX-Alpha for VS Code

أوامر الذكاء الاصطناعي من OX-Alpha داخل VS Code بدون أي اعتماديات خارجية.

| الأمر | الوظيفة |
|---|---|
| **OX-Alpha: Ask about selection** (`Ctrl+Alt+X`) | سؤال حر عن الكود المحدد، والإجابة تُبث في لوحة جانبية |
| **Explain code** | شرح خطوة بخطوة مع المخاطر |
| **Fix / improve selection** | اقتراح إصلاح مع خيارَي «تطبيق» و«مقارنة» (diff) |
| **Generate tests** | توليد اختبارات بإطار اللغة المعتاد |
| **Commit message** | رسالة commit بصيغة Conventional Commits من التغييرات المُدرجة |
| **Open in OX-Alpha** | يفتح المستودع (أو التحديد) في OX-Alpha Workbench |

## التثبيت

```bash
# الطريقة 1: نسخ المجلد (لا يحتاج حزماً)
cp -r extensions/vscode ~/.vscode/extensions/naderba69.ox-alpha-1.0.0
# الطريقة 2: حزمة VSIX
npx @vscode/vsce package && code --install-extension ox-alpha-1.0.0.vsix
```

ضع مفتاح OpenRouter في متغير البيئة `OPENROUTER_API_KEY`، أو في الإعداد `oxAlpha.apiKey`.
