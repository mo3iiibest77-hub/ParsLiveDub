const LANGUAGES = [
  { code: "fa", label: "Persian (فارسی)" },
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic (العربية)" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "zh-Hans", label: "Chinese (Simplified)" },
  { code: "zh-Hant", label: "Chinese (Traditional)" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "th", label: "Thai" },
  { code: "he", label: "Hebrew" },
  { code: "sv", label: "Swedish" },
  { code: "cs", label: "Czech" },
  { code: "el", label: "Greek" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "no", label: "Norwegian" },
  { code: "ms", label: "Malay" },
  { code: "bn", label: "Bengali" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "fil", label: "Filipino" },
  { code: "sw", label: "Swahili" },
  { code: "az", label: "Azerbaijani" },
  { code: "kk", label: "Kazakh" },
  { code: "uz", label: "Uzbek" },
];

const statusCard = document.getElementById("statusCard");
const statusText = document.getElementById("statusText");
const errorText = document.getElementById("errorText");
const langSelect = document.getElementById("langSelect");
const apiKeyInput = document.getElementById("apiKey");
const toggleBtn = document.getElementById("toggleBtn");
const testBtn = document.getElementById("testBtn");

LANGUAGES.forEach((lang) => {
  const opt = document.createElement("option");
  opt.value = lang.code;
  opt.textContent = lang.label;
  langSelect.appendChild(opt);
});

function setUi(state) {
  const active = !!state.pldActive;
  const status = state.pldStatus || (active ? "live" : "idle");
  const err = state.pldError || "";

  statusCard.className = "status " + (err ? "err" : active || status === "connecting" || status === "capturing" || status === "reconnecting" ? (status === "live" ? "live" : "busy") : "idle");

  if (err) statusText.textContent = "Stopped";
  else if (status === "live") statusText.textContent = "Live dubbing";
  else if (status === "connecting") statusText.textContent = "Connecting to Gemini…";
  else if (status === "capturing") statusText.textContent = "Capturing tab audio…";
  else if (status === "reconnecting") statusText.textContent = "Reconnecting…";
  else statusText.textContent = "Ready";

  errorText.hidden = !err;
  errorText.textContent = err;

  toggleBtn.textContent = active ? "Stop" : "Start dubbing";
  toggleBtn.className = active ? "primary stop" : "primary";
}

function loadState() {
  chrome.storage.local.get(
    ["geminiApiKey", "targetLang", "pldActive", "pldStatus", "pldError"],
    (data) => {
      if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
      if (data.targetLang) langSelect.value = data.targetLang;
      setUi(data);
    }
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  chrome.storage.local.get(["pldActive", "pldStatus", "pldError"], setUi);
});

function ensureOffscreen(done) {
  const create = async () => {
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen/offscreen.html",
        reasons: ["USER_MEDIA"],
        justification: "Capture tab audio and play live dubbed audio",
      });
      setTimeout(done, 150);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (/already/i.test(msg)) done();
      else done(err);
    }
  };
  if (!chrome.runtime.getContexts) return create();
  chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }, (existing) => {
    if (existing && existing.length) done();
    else create();
  });
}


function requestHostAccess(cb) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cb();
  };
  setTimeout(finish, 350);
  if (!chrome.permissions || !chrome.permissions.request) return finish();
  chrome.permissions.request(
    { origins: ["https://generativelanguage.googleapis.com/*"] },
    finish
  );
}


toggleBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const targetLanguageCode = langSelect.value || "fa";
  chrome.storage.local.set({ geminiApiKey: apiKey, targetLang: targetLanguageCode });

  if (toggleBtn.classList.contains("stop")) {
    chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => {});
    chrome.storage.local.set({ pldActive: false, pldStatus: "idle", pldError: "" });
    return;
  }

  if (!apiKey) {
    setUi({ pldActive: false, pldStatus: "error", pldError: "Paste your Gemini API key first." });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      setUi({ pldActive: false, pldStatus: "error", pldError: "No active tab." });
      return;
    }
    if (tab.url && /^(chrome|chrome-extension|edge|about):/.test(tab.url)) {
      setUi({ pldActive: false, pldStatus: "error", pldError: "Open a YouTube (or other media) tab, then start." });
      return;
    }

    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        const raw = (chrome.runtime.lastError && chrome.runtime.lastError.message) || "Could not capture this tab.";
        let message = raw;
        if (/active stream/i.test(raw)) {
          message = "Another extension is already capturing this tab. Turn off livdub / Persian Live Dub, refresh YouTube, then retry.";
        }
        setUi({ pldActive: false, pldStatus: "error", pldError: message });
        return;
      }

      requestHostAccess(() => {
        ensureOffscreen((err) => {
          if (err) {
            setUi({ pldActive: false, pldStatus: "error", pldError: String(err.message || err) });
            return;
          }
          chrome.storage.local.set({
            pldActive: true,
            pldStatus: "connecting",
            pldError: "",
            pldTabId: tab.id,
          });
          chrome.runtime.sendMessage({
            target: "offscreen",
            type: "start",
            tabId: tab.id,
            streamId,
            apiKey,
            targetLanguageCode,
          });
        });
      });
    });
  });
});

testBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setUi({ pldActive: false, pldStatus: "error", pldError: "Paste your Gemini API key first." });
    return;
  }
  chrome.storage.local.set({ geminiApiKey: apiKey });
  testBtn.disabled = true;
  statusText.textContent = "Testing Gemini…";
  statusCard.className = "status busy";

  requestHostAccess(() => {
    const url =
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
      encodeURIComponent(apiKey);
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      finishTest(false, "Timed out waiting for Gemini setupComplete.");
    }, 12000);

    function finishTest(ok, message) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      testBtn.disabled = false;
      try { ws.close(); } catch (_) {}
      setUi({
        pldActive: false,
        pldStatus: ok ? "idle" : "error",
        pldError: ok ? "" : message,
      });
      if (ok) statusText.textContent = "Gemini connection OK";
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: "models/gemini-3.5-live-translate-preview",
          generationConfig: {
            responseModalities: ["AUDIO"],
            translationConfig: {
              targetLanguageCode: langSelect.value || "fa",
              echoTargetLanguage: true,
            },
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
        if (parsed.setupComplete) finishTest(true);
        else if (parsed.error && parsed.error.message) finishTest(false, parsed.error.message);
      } catch (_) {}
    };
    ws.onerror = () => finishTest(false, "WebSocket failed. If Lemur shows a site-access toggle for generativelanguage.googleapis.com, turn it on.");
    ws.onclose = (ev) => {
      if (!settled) finishTest(false, ev.reason || ("Closed before setup (" + (ev.code || "?") + ")"));
    };
  });
});

apiKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ geminiApiKey: apiKeyInput.value.trim() });
});
langSelect.addEventListener("change", () => {
  chrome.storage.local.set({ targetLang: langSelect.value });
});

loadState();
