# القرآن الكريم — Quran Audio PWA

استماع لتلاوات القرآن الكريم بأصوات كبار القرّاء. مشغّل عائم لا ينقطع عند التنقل، مفضلة، 177 قناة بث، ووضع ليلي — يعمل كتطبيق ويب تقدّمي (PWA) قابل للتثبيت ويعمل بلا إنترنت.

**Live:** https://Abdelhaamed.github.io/quran_api/

## التشغيل

```bash
npm install
npm run dev      # خادم التطوير
npm run build    # بناء الإنتاج إلى dist/
npm run preview  # معاينة بناء الإنتاج
npm test         # 302 اختباراً
node scripts/verify-ui.mjs   # فحص آلي بال Chromium الحقيقي (26 فحصاً)
```

## البنية

Vanilla JS + Vite. لا إطار عمل، لا `new Audio()`، لا `AudioContext`.

```
src/
  main.js          التهيئة والتوصيل فقط
  api/             client.js (مهلة + إعادة + رسائل عربية) · quran.js
  state/           store.js (pub/sub بمصدر حقيقة واحد) · persist.js
  audio/           engine.js (عنصر <audio> واحد دائم) · queue.js · mediaSession.js
  ui/              shell/search/reciters/surahs/favorites/radio/player/icons.js
  utils/           arabic.js (تطبيع) · dom.js · favorites.js · ayah-counts.js
  styles/          tokens.css · base.css · components.css
```

## قاعدتان غير قابلتين للتفاوض

**1. عنصر `<audio>` واحد للجلسة كاملة.** إنشاء `new Audio()` لكل سورة يجعل متصفح الجوال يعامله طلب صوت جديداً فيحظر التشغيل التلقائي. إعادة استخدام العنصر تحفظ التفعيل، فتبدأ السورة التالية بلا لمسة — مُثبت على جهاز Android حقيقي مع قفل الشاشة.

**2. الصوت لا يمر عبر `AudioContext` إطلاقاً.** النظام يعلّق السياق عند قفل الشاشة فيقتل الصوت بعد ثوانٍ. لهذا لا يُضبط `crossOrigin` على العنصر: `<audio src>` المباشر لا يحتاج CORS.

## مسار `base` — اقرأ قبل النشر

المستودع اسمه `quran_api`، وGitHub Pages يخدم من مسار فرعي، لذا `vite.config.js` يضبط `base: '/quran_api/'`. **أي خطأ هنا يُعطّل التثبيت كـ PWA بصمت**: الـ service worker يُسجَّل بنطاق `/quran_api/`، والأيقونات و`manifest.webmanifest` تُحل نسبياً إليه.

## فخ `moshaf_type` — لا تستخدم الرقم

قيم `moshaf_type` الحقيقية شفرات مبهمة (`11`، `222`، `213`…) وليست `1/2/3` كما توثّق واجهة `api_2` القديمة. **استخراج أسلوب التلاوة يتم من `moshaf.name`** عبر `deriveStyle()`. استخدام الرقم يُسمّي 215 قارئاً خطأً.

## حقائق API (مُتحقق منها حيّاً)

الأساس `https://mp3quran.net/api/v3` · بلا مصادقة · `CORS: *`.

| النقطة | الحجم | المحتوى |
|---|---|---|
| `reciters?language=ar` | 191KB | 241 قارئاً · 287 تركيبة |
| `suwar?language=ar` | 12KB | 114 سورة (`makkia`/`start_page`/`end_page`، بلا عدد آيات) |
| `riwayat?language=ar` | 2.4KB | 20 رواية |
| `radios?language=ar` | 38KB | 177 قناة (بلا حقل تصنيف — التصنيف من الكلمات داخل الأسماء) |

- `moshaf.id` فريد عالمياً (287/287) ⇒ مفتاح المفضلة `${surahId}:${moshafId}`.
- ملفات السور `Accept-Ranges: bytes` (التقديم يعمل)؛ البث `Accept-Ranges: none` (بلا تقديم).
- `surah_list` تختلف بين تركيبات القارئ الواحد — الطابور يُبنى من المصحف المختار.

## القيود المعروفة

- **iOS 26**: انحدار مُبلّغ عنه في PWA المثبّتة يُعطّل الصوت بعد أول استخدام. عيب Apple، لا حل برمجي. التصميم Android-first.
- **WebKit 261858**: انتقال السورة التالية أثناء قفل الشاشة على iOS غير مضمون.
- `mp3quran.net` طرف ثالث بلا SLA — كاش 24 ساعة + تدهور رشيق.

## التوثيق

- المواصفة: `docs/superpowers/specs/2026-10-01-quran-platform-redesign-design.md`
- خطة التنفيذ: `docs/superpowers/plans/2026-10-01-quran-platform-redesign.md`
