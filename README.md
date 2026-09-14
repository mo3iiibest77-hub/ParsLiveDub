# 🎙️ ParsLiveDub

**دوبله زنده حرفه‌ای ویدیوها و پادکست‌ها به فارسی با قدرت Gemini Live Translate**

Real-time AI live dubbing Chrome extension for Persian (Farsi).  
Works on desktop Chrome and Android (Lemur Browser).

---

## ✨ ویژگی‌های فعلی (v1.1)

- دوبله زنده با مدل **gemini-3.5-live-translate-preview**
- پشتیبانی کامل از **raw PCM** (بهبود کیفیت و پایداری صدا)
- تأخیر بسیار کم
- کاهش هوشمند صدای اصلی (ducking) هنگام پخش ترجمه
- reconnect خودکار در صورت قطع شدن ارتباط
- رابط کاربری زیبا و کاملاً راست‌چین
- کلید API فقط روی دستگاه کاربر ذخیره می‌شود

---

## 🚀 نصب (Load Unpacked)

1. این ریپو را Clone یا به صورت ZIP دانلود کنید.
2. در Chrome یا Lemur Browser بروید به `chrome://extensions`
3. **Developer mode** را روشن کنید.
4. **Load unpacked** → پوشه پروژه را انتخاب کنید.
5. کلید Gemini را از [aistudio.google.com/apikey](https://aistudio.google.com/apikey) بگیرید و در تنظیمات افزونه وارد کنید.

> **نکته آیکون:** اگر آیکون‌ها نمایش داده نشدند، پوشه `icons` را از نسخه محلی یا release اضافه کنید (فایل‌های PNG 16/32/48/128).

---

## 📁 ساختار

```
ParsLiveDub/
├── manifest.json
├── background.js
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js      ← موتور اصلی صدا (v1.1)
├── popup/
├── options/
├── icons/
├── LICENSE
└── README.md
```

---

## 🗺️ نقشه راه

- [x] ساختار پایه + اتصال Live Translate
- [x] پشتیبانی raw PCM + ducking هوشمند
- [x] reconnect خودکار
- [ ] بهبود resampling و کیفیت صدا در موبایل
- [ ] تشخیص گوینده + صدای ثابت per speaker
- [ ] انتخاب صدای مختلف
- [ ] نسخه بهینه‌تر برای Lemur Browser
- [ ] ویژگی‌های تجاری (پریمیوم / اشتراک)

---

## 📄 لایسنس

MIT — آزاد برای استفاده شخصی و تجاری.

ساخته‌شده با تمرکز روی کیفیت و تجربه کاربری فارسی‌زبانان.
