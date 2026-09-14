# PROJECT_CONTEXT.md

Complete context for ParsLiveDub so any AI assistant can continue development without prior explanation.

---

## 1. Project Overview

- **Name:** ParsLiveDub
- **Type:** Chrome Extension (Manifest V3), tested on Lemur Browser (Android/Chromium)
- **Goal:** Real-time live dubbing of any browser tab (mainly YouTube) into 70+ languages using Google Gemini Live Translate API
- **Repo:** https://github.com/mo3iiibest77-hub/ParsLiveDub
- **Current version:** 1.6.4

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
├── manifest.json          # MV3 manifest, version 1.6.4
├── background.js          # Service Worker: badge, storage, message routing
├── offscreen/
│   ├── offscreen.html     # Offscreen document host
│   ├── offscreen.js       # Core: audio capture, WebSocket to Gemini, playback, pitch
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
6. `offscreen.js` plays back audio via Web Audio API (`latencyHint: "interactive"`)
7. Delay measured via rolling median of first 6 chunks (`measuredDelayMs`)
8. `background.js` relays latency to `content/sync.js` via `PLD_SYNC` message
9. `content/sync.js` shows HUD pill on video; on desktop tries canvas frame-delay lipsync; on mobile uses `playbackRate` trick

---

## 5. Key Constants (offscreen.js)

- `CHUNK_MS = 60` (was 100, reduced in v1.6.4)
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
- `pitchShiftKeepLength()`: OLA (overlap-add) grain=240, hopOut=120
- **KNOWN BUG:** When voice is classified as female, pitch shift introduces heavy noise/artifacts. Male works fine. The OLA implementation is too simple — needs proper windowing or replacement with a better algorithm.

---

## 7. Lipsync (content/sync.js)

- **Desktop:** canvas frame-buffer delay — captures video frames every 48ms, shows delayed frame on canvas overlay, hides real video
- **Mobile/Lemur:** canvas approach causes black screen (YouTube CORS) → **DISABLED**
- **Mobile fallback (v1.6.4):** `playbackRate` trick — slows video by `lagSec/25`, restores after `lagSec+0.8s`
- HUD pill shown on video: `"Dub live · picture kept"` on mobile, `"Lipsync Xs"` on desktop

---

## 8. What Works ✅

- Gemini WebSocket connection with valid API key
- Live dubbing starts and plays translated audio
- Male voice dubbing: clean, no artifacts
- Video no longer goes black on mobile (fixed in v1.6.3)
- Chunk size reduced to 60ms (v1.6.4)
- Rolling median delay measurement (v1.6.4)
- `playbackRate` mobile sync attempt (v1.6.4)

---

## 9. Known Issues ❌

- Audio/video sync still not perfect (~2.5–3.5s delay, inherent Gemini latency)
- Female voice detection → noisy/distorted output (pitch shift OLA bug)
- Canvas lipsync disabled on mobile (YouTube CORS blocks `drawImage` from video)
- `playbackRate` trick on mobile: YouTube sometimes ignores or fights the rate change

---

## 10. Immediate Next Task

**Fix the female voice pitch shift noise bug in `offscreen.js`.**

**Root cause:** `pitchShiftKeepLength()` uses a basic OLA (overlap-add) without proper phase vocoder or cross-correlation. When ratio is 1.28 (female→male correction), the grain boundaries don't align well → produces clicking/noise artifacts.

**Fix options (in order of complexity):**

- **A)** Improve OLA with cross-correlation for grain alignment (WSOLA) — medium complexity, stays in-browser
- **B)** Skip pitch shift entirely for ratio < 1.35 and just pass audio through — quick workaround, loses gender correction
- **C)** Use Web Audio API native `playbackRate` on a BufferSource — simpler but changes duration
- **D)** Disable `matchGender` feature entirely and remove the noise — simplest, loses the feature

The developer wants **option A (WSOLA)** attempted first.

---

## 11. Roadmap (in priority order)

1. Fix female voice pitch shift noise (WSOLA or better OLA) — **CURRENT**
2. Improve audio/video sync on mobile beyond `playbackRate` trick
3. Professional UI redesign
4. Native Android app (Google login, auto API key, ExoPlayer for full sync control)

---

## 12. Development Notes

- No npm, no build step — edit JS files directly and reload extension in Lemur
- To test: load unpacked from zip in `chrome://extensions` (Developer mode on)
- Lemur Browser: must enable site access for `generativelanguage.googleapis.com`
- Turn off other dubbing extensions before testing (`tabCapture` conflict)
- Server for editing: Ubuntu 22.04 on Doprax, repo cloned at `~/ParsLiveDub`
- Push via: `git push https://TOKEN@github.com/mo3iiibest77-hub/ParsLiveDub.git main`

---

## 13. AI Continuation Instructions

If you are an AI reading this file:

- Do **NOT** ask for re-explanation of the project. This file is the full context.
- **Current priority:** fix the noisy female pitch shift in `offscreen.js` → `pitchShiftKeepLength()`
- All edits go in the files listed in section 3
- After any fix, bump version in `manifest.json` (1.6.4 → 1.6.5 etc.)
- Write code changes as complete file replacements or precise diffs
- Do not add dependencies — this is vanilla JS only
