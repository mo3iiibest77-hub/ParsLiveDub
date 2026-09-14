# 🎙️ ParsLiveDub v1.2.0

**دوبله زنده حرفه‌ای ویدیوها و پادکست‌ها به فارسی با قدرت Gemini Live Translate**

Real-time AI live dubbing for Persian. Optimized for desktop Chrome and **Lemur Browser** on Android.

---

## ✨ ویژگی‌های v1.2

- دوبله زنده با مدل **gemini-3.5-live-translate-preview**
- دو context جداگانه: ۱۶kHz برای ارسال + ۲۴kHz برای پخش (کیفیت صدا بهتر)
- پشتیبانی کامل از **raw PCM**
- Ducking هوشمند صدای اصلی
- Reconnect خودکار
- رابط کاربری راست‌چین و وضوح شفاف

---

## 🚀 نصب روی **Lemur Browser** (اندروید)

### مرحله ۱: دانلود پروژه
۱. برو به: https://github.com/mo3iiibest77-hub/ParsLiveDub
۲. روی دکمه سبز **Code** کلیک کن و **Download ZIP** را بزن.
۳. فایل ZIP را اکستراکت کن.

### مرحله ۲: نصب در Lemur Browser
۱. Lemur Browser را باز کن.
۲. در نوار آدرس بنویس: `chrome://extensions`
۳. گزینه **Developer mode** (حالت توسعه‌دهنده) را روشن کن (بالا سمت راست).
۴. روی دکمه **Load unpacked** کلیک کن.
۵. پوشه‌ای که از ZIP اکستراکت کردی را انتخاب کن (پوشه‌ای که داخلش `manifest.json` وجود دارد).

### مرحله ۳: تنظیم کلید API
۱. روی آیکون افزونه کلیک کن یا از صفحه اکستنشن‌ها روی **Details** برو و **Extension options** را بزن.
۲. کلید Gemini خودت را از [aistudio.google.com/apikey](https://aistudio.google.com/apikey) بگیر.
۳. کلید را پیست کن و **ذخیره** کن.

### مرحله ۴: تست
۱. یک ویدیو یوتیوب (یا هر صفحه‌ای که صدا دارد) باز کن.
۲. روی آیکون **ParsLiveDub** کلیک کن.
۳. دکمه **شروع دوبله** را بزن.
۴. بعد از چند ثانیه باید صدای فارسی شروع به پخش کند.

---

## 💡 نکات مهم برای تست

- بهترین نتیجه با **هدفون**.
- اگر صدا نیامد، کلید API را چک کن و از صحت فعال بودنش مطمئن شو.
- روی برخی ویدیوهای DRM (مثل Netflix) کار نمی‌کند.
- اگر آیکون نمایش داده نشد، اشکالی ندارد — افزونه باز هم کار می‌کند.

---

## 🗒️ نقشه راه

- [x] ساختار پایه + Live Translate
- [x] Dual sample-rate (16k + 24k)
- [x] Raw PCM + Ducking + Reconnect
- [ ] بهبود بیشتر کیفیت روی موبایل
- [ ] تشخیص گوینده + صدای ثابت
- [ ] ویژگی‌های تجاری

---

MIT License — آزاد برای استفاده شخصی و تجاری.
