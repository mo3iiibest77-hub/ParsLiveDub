# PROJECT_CONTEXT.md

Complete context for ParsLiveDub so any AI assistant can continue development without prior explanation.

**Standing rule for every AI working on this repo:** After *any* code or behavior change, update this file in the same session (version, what changed, what works, known issues, next task). Do not wait for the user to ask.

---

## 1. Project Overview

- **Name:** ParsLiveDub
- **Type:** Chrome Extension (Manifest V3), tested on Lemur Browser (Android/Chromium)
- **Goal:** Real-time live dubbing of any browser tab (mainly YouTube) into 70+ languages using Google Gemini Live Translate API
- **Repo:** https://github.com/mo3iiibest77-hub/ParsLiveDub
- **Current version:** 1.6.6 `**Phase A stabilization complete**`

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
├── PROJECT_CONTEXT.md     # This file — always keep in sync with reality
├── manifest.json          # MV3 manifest, version 1.6.5
├── background.js          # Service Worker: badge, storage, message routing
├── offscreen/
│   ├── offscreen.html     # Offscreen document host
│   ├── offscreen.js       # Core: audio capture, WebSocket to Gemini, playback, WSOLA pitch
│   └── pcm-worklet.js     # AudioWorklet: 1024-sample PCM capture buffer
├── content/
│   └── sync.js            # Content script: lipsync HUD, mobile playbackRate trick
├── popup/
│   ├── popup.html
│   ├── popup.js           # UI: API key, language, lipsync toggle, start/stop
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
└── icons/
```

---

## 4. Architecture & Data Flow

1. User clicks Start → `popup.js` calls `chrome.tabCapture.getMediaStreamId()`
2. `background.js` creates Offscreen Document
3. `offscreen.js` receives MediaStream → AudioWorklet captures PCM → downsampled to 16kHz
4. PCM chunks sent over WebSocket to Gemini Live Translate (`CHUNK_MS = 60ms`)
5. Gemini returns translated PCM audio (~24kHz)
6. Optional gender match: F0 estimate → pitch ratio → `pitchShiftKeepLength()` (WSOLA)
7. `offscreen.js` plays back audio via Web Audio API (`latencyHint: "interactive"`)
8. Delay measured via rolling median of first 6 chunks (`measuredDelayMs`)
9. `background.js` relays latency to `content/sync.js` via `PLD_SYNC` message
10. `content/sync.js` shows HUD on video; desktop may canvas-delay frames; mobile never hides video (playbackRate trick only)

---

## 5. Key Constants (offscreen.js)

- `CHUNK_MS = 60` (was 100 in older builds; reduced in v1.6.4)
- `INPUT_SAMPLE_RATE = 16000`
- `OUTPUT_SAMPLE_RATE = 24000`
- `DEFAULT_DELAY_MS = 2900`
- `MAX_RECONNECT_ATTEMPTS = 4`
- `INPUT_HOLD_MAX_S = 5`
- `playbackLead = 0.15`
- `nextPlayTime` gap: if `< now+0.05` → set to `now+0.15`

---

## 6. Gender/Pitch Matching (offscreen.js)

- `estimateF0()` uses autocorrelation on PCM windows
- `classifyGender()`: f0 < 155Hz → male, f0 > 180Hz → female
- `updatePitchRatio()`: if src=female & out=male → ratio 1.28 (pitch up); if src=male & out=female → ratio 0.78 (pitch down)
- `pitchShiftKeepLength()` (v1.6.5): **WSOLA-style**
  - `grain = 512`, `hopOut = 128`, `hopIn = hopOut * ratio`, `searchWin = 80`
  - Hanning window
  - `bestOffset(inPos)` searches nearby positions (energy-based score; not full cross-correlation with previous grain yet)
  - Overlap-add into `out` + normalize by window sum (`norm`)
- **Status:** Replaced naive OLA (grain=240) that caused heavy noise on female correction. User must re-test female voices on Lemur. If artifacts remain, improve `bestOffset` to true cross-correlation against the last written grain overlap region.

---

## 7. Lipsync (content/sync.js)

- **Desktop:** canvas frame-buffer delay — captures video frames ~every 48ms, delayed overlay, hides real video only after non-blank frames proven
- **Mobile/Lemur:** canvas `drawImage` from YouTube video is unreliable (black frames / CORS) → visual hide **DISABLED**
- **Mobile (v1.6.3+):** never set video `opacity: 0`; HUD shows `Dub live · picture kept`
- **Mobile fallback (v1.6.4):** `playbackRate` trick — temporarily slow video by `lagSec/25`, restore after `lagSec+0.8s` (YouTube may fight this)
- HUD: mobile `Dub live · picture kept`; desktop `Lipsync Xs` when canvas path active

---

## 8. What Works ✅

- Gemini WebSocket connection with valid API key
- Live dubbing starts and plays translated audio
- Male voice dubbing: historically clean
- Video no longer goes black on mobile (v1.6.3)
- Chunk size 60ms (v1.6.4)
- Rolling median delay measurement (v1.6.4)
- Mobile `playbackRate` sync attempt (v1.6.4)
- WSOLA pitch-shift replacement shipped (v1.6.5) — pending user verification on female speech

---

## 9. Known Issues ❌

- Audio/video sync still imperfect (~2.5–3.5s is largely Gemini Live latency; client can only shave buffers)
- Female pitch correction: WSOLA upgraded with true cross-correlation for continuity (v1.6.6) — needs verification on device
- Canvas lipsync disabled on mobile
- `playbackRate` trick on mobile: YouTube sometimes ignores or resets rate

---

## 10. Immediate Next Task

1. **User test v1.6.6** on Lemur with female speakers — verify improved WSOLA cross-correlation
2. Professional UI redesign (Phase B)
3. Improve mobile A/V sync beyond `playbackRate`
4. Native Android app (when user gives separate prompt)

---

## 11. Roadmap (priority)

1. Validate / harden female pitch shift (v1.6.5 WSOLA → refine if needed) — **CURRENT**
2. Better mobile audio/video sync
3. Professional UI redesign
4. Native Android app (Google login, auto API key, ExoPlayer for sync control)

---

## 12. Changelog (recent)

| Version | Notes |
|--------|--------|
| 1.6.3 | Never hide YouTube video on Android/Lemur (fix black screen) |
| 1.6.4 | `CHUNK_MS=60`, interactive latency hint, rolling delay measure, mobile `playbackRate` sync |
| 1.6.5 | Replace basic OLA pitch shift with WSOLA-style `pitchShiftKeepLength` (grain 512, hop 128, search window, normalize) |
| 1.6.6 | **Phase A stabilization** — Improved cross-correlation in WSOLA, robust audio context cleanup, better error messages for WebSocket errors and tab capture conflicts |

---

## 13. Development Notes

- No npm, no build step — edit JS files directly and reload extension in Lemur
- Load unpacked / ZIP with `manifest.json` at ZIP root (or load the extracted folder that contains it)
- After extension reload, fully close and reopen the YouTube tab so content scripts refresh
- Lemur: allow site access for `generativelanguage.googleapis.com`
- Disable other dubbing extensions (`tabCapture` conflict)
- Server: Ubuntu 22.04 on Doprax, clone at `~/ParsLiveDub`
- If `git push` rejects: `git pull --rebase` then push (remote may have docs commits from other sessions)
- **Never paste GitHub PATs in chat**; revoke if exposed

---

## 14. AI Continuation Instructions

If you are an AI reading this file:

- Do **NOT** ask for re-explanation of the project. This file is the full context.
- **Always** update `PROJECT_CONTEXT.md` after every material change (same PR/commit batch when possible).
- Bump `manifest.json` version on each user-facing fix (1.6.5 → 1.6.6 …).
- Vanilla JS only — no new dependencies.
- Prefer complete function replacements or precise diffs over vague advice.
- Current verification focus: female-voice quality after WSOLA (v1.6.5).
