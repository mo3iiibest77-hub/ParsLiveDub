# ParsLiveDub

Live-dub any browser tab into 70+ languages using Gemini Live Translate.

Bring your own Gemini API key. Audio goes from your tab to Google and back. Nothing is uploaded to us.

## v1.5.0 — why the previous builds failed

Gemini rejects this setup payload:

```json
"generationConfig": { "inputAudioTranscription": {} }
```

with `Unknown name inputAudioTranscription` and closes the socket. The UI then showed a fake "API key" error even when the key was valid (Persian Live Dub used the same key successfully).

This build matches the working protocol:

- transcription configs at **setup root**, not inside `generationConfig`
- `tabCapture.getMediaStreamId` from the popup click (user gesture)
- native capture sample rate, then downsample to 16 kHz
- AudioWorklet with ScriptProcessor fallback
- always stop media tracks on error so tab volume returns

## Install on Lemur Browser

1. Remove any older ParsLiveDub.
2. Turn **off** livdub / Persian Live Dub / Doblaj while testing this one.
3. `chrome://extensions` → Developer mode on.
4. Load `ParsLiveDub-v1.5.0.zip` (manifest must be at the zip root).
5. Paste your Gemini key in the popup.
6. Press **Test Gemini connection**. You should see "Gemini connection OK".
7. Open YouTube, start playback, then **Start dubbing**.

If Lemur shows a site-access toggle for `generativelanguage.googleapis.com`, turn it on.

## License

MIT
