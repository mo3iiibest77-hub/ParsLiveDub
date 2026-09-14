# ParsLiveDub

Live-dub any browser tab into 70+ languages using Gemini Live Translate.

Bring your own Gemini API key. Audio goes from your tab to Google and back. Nothing is uploaded to us.

## v1.6.1

- **Lipsync:** measures Gemini delay (~3 s) and delays *video pixels only*. Tab audio stays live so capture does not loop delayed sound.
- **Male / female matching:** estimates pitch on the source and on the dub. If Gemini flips gender, output is pitch-shifted back.
- Working Live Translate protocol (transcription configs at setup root).
- Canvas-based frame buffer (no CORS bitmap failures on YouTube).
- Injects the lipsync script if the tab was open before install.

Toggle both features in the popup. Use **Sync delay → Auto** unless a specific video needs a manual 2–4.5 s offset.

## Install on Lemur Browser

1. Remove any older ParsLiveDub.
2. Turn **off** livdub / Persian Live Dub / Doblaj while testing this one.
3. `chrome://extensions` → Developer mode on.
4. Load `ParsLiveDub-v1.6.1.zip` (manifest must be at the zip root — do not load GitHub’s Download ZIP).
5. Paste your Gemini key in the popup.
6. Press **Test Gemini connection**. You should see "Gemini connection OK".
7. Open YouTube, **refresh the tab**, start playback, then **Start dubbing**.

If Lemur shows a site-access toggle for `generativelanguage.googleapis.com`, turn it on.

A pill on the video (`Lipsync 2.9s`) means picture delay is active. Turn Lipsync off if the overlay is heavy on a phone.

## Limits

Gemini Live Translate has no speaker IDs and no gender prompt. Matching is pitch-based and approximate. Delay cannot go under ~1 s with this model.

## License

MIT
