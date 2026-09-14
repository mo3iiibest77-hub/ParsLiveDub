# PROJECT_CONTEXT.md

Complete context for ParsLiveDub so any AI assistant can continue development without prior explanation.

**Standing rule:** After any material change, update this file in the same session (version, what changed, what works, known issues, next task).

---

## 1. Project Overview

- **Name:** ParsLiveDub
- **Type:** Chrome Extension (Manifest V3), tested on Lemur Browser (Android/Chromium)
- **Goal:** Real-time live dubbing of any browser tab (mainly YouTube) into 70+ languages using Google Gemini Live Translate API
- **Repo:** https://github.com/mo3iiibest77-hub/ParsLiveDub
- **Current version:** 1.6.9

---

## 2. Tech Stack

- Google Gemini Live Translate API (WebSocket, BidiGenerateContent)
- Model: `models/gemini-3.5-live-translate-preview`
- Web Audio API (AudioWorklet + ScriptProcessor fallback)
- Chrome Extension APIs: `tabCapture`, `offscreen`, `storage`, `activeTab`, `scripting`
- No build system — pure vanilla JS

---

## 3. File Structure

```
ParsLiveDub/
├── PROJECT_CONTEXT.md
├── manifest.json          # version 1.6.9
├── background.js
├── offscreen/
│   ├── offscreen.html
│   ├── offscreen.js       # capture, Gemini WS, playback, WSOLA pitch
│   └── pcm-worklet.js
├── content/
│   └── sync.js            # HUD, mobile playbackRate continuous sync
├── popup/
│   ├── popup.html         # MUST link href="popup.css" (not popup-new.css)
│   ├── popup.js
│   └── popup.css
├── options/
└── icons/
```

---

## 4. Architecture & Data Flow

1. Start → `popup.js` → `tabCapture.getMediaStreamId`
2. Offscreen document captures tab PCM → 16 kHz → Gemini Live WS (`CHUNK_MS=60`)
3. Translated PCM ~24 kHz → optional WSOLA pitch → Web Audio playback
4. Measured delay → `PLD_SYNC` → `content/sync.js` HUD / mobile rate tweaks
5. Mobile: **never** hide the real video (no black screen)

---

## 5. Key Constants (offscreen.js)

- `CHUNK_MS = 60`
- `INPUT_SAMPLE_RATE = 16000` / `OUTPUT_SAMPLE_RATE = 24000`
- `INPUT_HOLD_MAX_S = 2` (was 5; Phase C)
- `playbackLead ≈ 0.08` (was 0.15; Phase C)
- ScriptProcessor fallback buffer **1024** (was 2048; Phase C)
- `DEFAULT_DELAY_MS = 2900`

---

## 6. Gender / WSOLA (offscreen.js)

- F0 → gender → pitch ratio (e.g. 1.28 / 0.78)
- `pitchShiftKeepLength`: grain 512, hopOut 128, Hanning window, overlap normalize
- `bestOffset`: normalized cross-correlation vs previous overlap when `outPos > 0`; energy fallback if correlation weak (`bestCorr < 0.3`)
- **Do not** treat `bestDelta === 0` as failure (base offset is often correct)

---

## 7. Lipsync (content/sync.js)

- Desktop: canvas delay only after non-blank frames
- Mobile: hide disabled; HUD `Dub live · picture kept`
- Mobile continuous `playbackRate` adjustments (v1.6.8) — YouTube may still fight; no opacity:0

---

## 8. What Works ✅

- Gemini live dubbing with API key
- Male voice generally clean
- No black screen on mobile (v1.6.3+)
- Phase C buffer reductions shipped
- **v1.6.9:** popup CSS loads (`href="popup.css"`) — DeepSeek left `popup-new.css` which does not exist → unstyled HTML on Lemur

---

## 9. Known Issues / Risks ❌

- ~2.5–3.5s delay mostly Gemini Live latency
- Female pitch still needs device verification after WSOLA upgrades
- Continuous mobile `playbackRate` may be ignored/reset by YouTube
- ScriptProcessor 1024 + lower hold: watch for underruns on weak devices
- PROJECT_CONTEXT / roadmap text had drifted (UI listed both complete and still-todo)

---

## 10. Audit of DeepSeek changes (1.6.6–1.6.8)

| Area | Verdict |
|------|--------|
| WSOLA cross-correlation | Present and directionally correct; energy fallback logic was flawed if `bestDelta===0` |
| Cleanup / error strings | Useful |
| UI redesign HTML/CSS/JS | Good structure; **CSS link bug** broke all styling on Lemur |
| Buffer cuts 5s→2s, 2048→1024, lead 0.15→0.08 | Reasonable; validate no glitches on device |
| Continuous mobile sync | Safer than opacity hide; fragile vs YouTube player |

---

## 11. Immediate Next Task

1. User reload **v1.6.9** on Lemur — confirm styled popup
2. Test female voice + listen for underruns after buffer cuts
3. If WSOLA still noisy, further tune correlation / pass-through thresholds
4. Soften or gate continuous playbackRate if YouTube fights it
5. Native Android only when user issues separate prompt

---

## 12. Changelog (recent)

| Version | Notes |
|--------|--------|
| 1.6.6 | Phase A WSOLA correlation, cleanup, errors |
| 1.6.7 | Phase B UI redesign (**CSS filename mismatch**) |
| 1.6.8 | Phase C buffers + continuous mobile sync |
| **1.6.9** | Fix `popup.html` → `popup.css`; version bump |

---

## 13. Development Notes

- Vanilla JS only; Lemur load folder with `manifest.json`
- Fully close YouTube tab after extension reload
- Disable other tabCapture extensions
- Never commit API keys; never paste PATs in chat

---

## 14. AI Continuation Instructions

- Read this file first; do not ask for full re-explanation
- Always bump version + update this file + commit/push together
- Priority: stability on Lemur > polish > Android later
