# ParsLiveDub v1.3.0

Real-time Persian live dubbing for Chrome and Lemur Browser.
Powered by Gemini Live Translate (`gemini-3.5-live-translate-preview`).

## Load on Lemur Browser

1. Download `ParsLiveDub-v1.3.0.zip` (manifest.json is at the ZIP root).
2. Open `chrome://extensions`
3. Enable Developer mode
4. Tap **Load *.zip/*.crx/*.user.js file**
5. Choose this ZIP — do not use GitHub's nested "Download ZIP" unless you open the inner folder that contains `manifest.json`.
6. Open extension options, paste a Gemini API key from https://aistudio.google.com/apikey
7. Play a YouTube video, tap the extension icon, start dubbing.

## Desktop Chrome

Use Load unpacked on the extracted folder that contains `manifest.json`.

## Engine notes

- Capture: 16 kHz PCM, 100 ms chunks
- Playback: 24 kHz raw PCM
- `realtimeInput.audio` (not mediaChunks)
- Offscreen document for tabCapture + playback
- ScriptProcessor is kept in the audio graph via a muted gain so chunks actually fire
