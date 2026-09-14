# 🎙️ ParsLiveDub

**دوبله زنده و حرفه‌ای ویدیوها و پادکست‌ها به زبان فارسی با قدرت Gemini AI**

Real-time AI-powered live dubbing Chrome extension for Persian (Farsi).  
Optimized for desktop Chrome and Android (Lemur Browser).

---

## ✨ ویژگی‌ها

- دوبله زنده با تأخیر بسیار کم (۱–۳ ثانیه)
- استفاده از مدل‌های پیشرفته Gemini Live
- پشتیبانی از تشخیص گوینده (در نسخه‌های بعدی کامل‌تر می‌شود)
- رابط کاربری زیبا و راست‌چین
- کلید API شما روی دستگاه خودتان می‌ماند (حریم خصوصی کامل)
- سازگار با YouTube، پادکست‌ها، اخبار و بیشتر سایت‌ها

---

## 🚀 نصب سریع (Unpacked)

1. این ریپو را Clone یا به صورت ZIP دانلود کنید.
2. در کروم یا Lemur Browser به آدرس `chrome://extensions` بروید.
3. **Developer mode** را فعال کنید.
4. روی **Load unpacked** کلیک کنید و پوشه پروژه را انتخاب کنید.
5. کلید Gemini خود را از [Google AI Studio](https://aistudio.google.com/apikey) بگیرید و در تنظیمات افزونه وارد کنید.

---

## 🛠️ ساختار پروژه

```
ParsLiveDub/
├── manifest.json
├── background.js
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
├── icons/
└── README.md
```

---

## 📋 نقشه راه (Roadmap)

- [x] ساختار پایه و اتصال به Gemini
- [ ] بهبود کیفیت صدا و مدیریت بافر
- [ ] تشخیص گوینده + صدای ثابت برای هر شخصیت
- [ ] پشتیبانی کامل از مدل Live Translate
- [ ] نسخه موبایل بهینه‌تر برای Lemur
- [ ] ویژگی‌های پولی (صدای پریمیوم، تاریخچه، ...)

---

## 📄 لایسنس

MIT License — آزاد برای استفاده شخصی و تجاری.

---

ساخته شده با ❤️ برای جامعه فارسی‌زبان
