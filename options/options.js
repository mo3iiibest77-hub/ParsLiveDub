const keyInput = document.getElementById("keyInput");
const saveBtn = document.getElementById("saveBtn");
const toggleBtn = document.getElementById("toggleBtn");
const testBtn = document.getElementById("testBtn");
const msg = document.getElementById("msg");
const lipsync = document.getElementById("lipsync");
const gender = document.getElementById("gender");

chrome.storage.local.get(["geminiApiKey", "pldLipsync", "pldMatchGender"], (r) => {
  if (r.geminiApiKey) keyInput.value = r.geminiApiKey;
  lipsync.checked = r.pldLipsync !== false;
  gender.checked = r.pldMatchGender !== false;
});

lipsync.addEventListener("change", () => {
  chrome.storage.local.set({ pldLipsync: lipsync.checked });
  chrome.runtime.sendMessage({ target: "offscreen", type: "update-settings", lipsync: lipsync.checked }).catch(() => {});
});
gender.addEventListener("change", () => {
  chrome.storage.local.set({ pldMatchGender: gender.checked });
  chrome.runtime.sendMessage({ target: "offscreen", type: "update-settings", matchGender: gender.checked }).catch(() => {});
});

toggleBtn.addEventListener("click", () => {
  const show = keyInput.type === "password";
  keyInput.type = show ? "text" : "password";
  toggleBtn.textContent = show ? "Hide" : "Show";
});

saveBtn.addEventListener("click", () => {
  const key = keyInput.value.trim();
  if (!key) {
    msg.textContent = "Paste an API key first.";
    msg.className = "msg err";
    return;
  }
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    msg.textContent = "Key saved on this device.";
    msg.className = "msg ok";
  });
});

testBtn.addEventListener("click", () => {
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    msg.textContent = "Paste an API key first.";
    msg.className = "msg err";
    return;
  }
  chrome.storage.local.set({ geminiApiKey: apiKey });
  msg.textContent = "Connecting…";
  msg.className = "msg";
  testBtn.disabled = true;

  const run = () => {
    const url =
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
      encodeURIComponent(apiKey);
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => finish(false, "Timed out waiting for setupComplete."), 12000);

    function finish(ok, text) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      testBtn.disabled = false;
      try { ws.close(); } catch (_) {}
      msg.textContent = text;
      msg.className = ok ? "msg ok" : "msg err";
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/gemini-3.5-live-translate-preview",
          generationConfig: {
            responseModalities: ["AUDIO"],
            translationConfig: { targetLanguageCode: "fa", echoTargetLanguage: true },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
    };
    ws.onmessage = async (event) => {
      try {
        const raw = typeof event.data === "string"
          ? event.data
          : event.data instanceof Blob
            ? await event.data.text()
            : new TextDecoder().decode(event.data);
        const parsed = JSON.parse(raw);
        if (parsed.setupComplete) finish(true, "Gemini Live Translate accepted the key.");
        else if (parsed.error && parsed.error.message) finish(false, parsed.error.message);
      } catch (_) {}
    };
    ws.onerror = () => finish(false, "WebSocket failed. Check network/VPN and site access.");
    ws.onclose = (ev) => {
      if (!settled) finish(false, ev.reason || ("Closed before setup (" + ev.code + ")"));
    };
  };

  if (chrome.permissions && chrome.permissions.request) {
    chrome.permissions.request({ origins: ["https://generativelanguage.googleapis.com/*"] }, run);
  } else {
    run();
  }
});
