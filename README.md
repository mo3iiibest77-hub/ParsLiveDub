# 🎙️ ParsLiveDub

**دوبله زنده حرفه‌ای ویدیوها و پادکست‌ها به فارسی با قدرت Gemini Live Translate**

Real-time AI live dubbing Chrome extension for Persian (Farsi).  
Works on desktop Chrome and Android (Lemur Browser).

---

## ✨ ویژگی‌های فعلی (v1.0.0)

- دوبله زنده با مدل **gemini-3.5-live-translate-preview**
- تأخیر بسیار کم
- کاهش خودکار صدای اصلی (ducking) هنگام پخش ترجمه
- رابط کاربری زیبا و کاملاً راست‌چین
- کلید API فقط روی دستگاه کاربر ذخیره می‌شود
- پشتیبانی از reconnect خودکار

---

## 🚀 نصب (Load Unpacked)

1. این ریپو را Clone یا ZIP دانلود کنید.
2. در Chrome یا Lemur Browser بروید به `chrome://extensions`
3. **Developer mode** را روشن کنید.
4. **Load unpacked** → پوشه پروژه را انتخاب کنید.
5. کلید Gemini را از [aistudio.google.com/apikey](https://aistudio.google.com/apikey) بگیرید و در تنظیمات افزونه وارد کنید.

---

## 📁 ساختار

```
ParsLiveDub/
├── manifest.json
├── background.js
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js
├── popup/
├── options/
├── icons/
├── LICENSE
└── README.md
```

---

## 🗺️ نقشه راه

- [x] ساختار پایه + اتصال Live Translate
- [x] آیکون‌های حرفه‌ای
- [x] Ducking صدای اصلی
- [ ] بهبود بافرینگ و کیفیت صدا
- [ ] تشخیص گوینده + صدای ثابت per speaker
- [ ] انتخاب صدای مختلف
- [ ] نسخه بهینه‌تر برای موبایل
- [ ] ویژگی‌های تجاری (پریمیوم)

---

## 📄 لایسنس

MIT — آزاد برای استفاده شخصی و تجاری.

ساخته‌شده با تمرکز روی کیفیت و تجربه کاربری فارسی‌زبانان.
