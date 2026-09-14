let currentSession = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ParsLiveDub] 1.3 installed");
});

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: "offscreen/offscreen.html",
    reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Capture tab audio and play Persian live dubbing",
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message || String(err) });
  });
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case "START_DUBBING":
      return startDubbing(msg.tabId, msg.apiKey, msg.targetLang || "fa");
    case "STOP_DUBBING":
      return stopDubbing();
    case "GET_STATUS":
      return { isActive: !!currentSession, session: currentSession };
    case "GET_API_KEY": {
      const data = await chrome.storage.local.get(["geminiApiKey"]);
      return { apiKey: data.geminiApiKey || "" };
    }
    default:
      return { error: "Unknown message" };
  }
}

async function startDubbing(tabId, apiKey, targetLang) {
  if (!apiKey) return { success: false, error: "API Key required. Open Settings." };
  if (!tabId) return { success: false, error: "No active tab." };
  if (currentSession) await stopDubbing();

  try {
    await ensureOffscreen();

    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!id) reject(new Error("Could not capture this tab."));
        else resolve(id);
      });
    });

    const res = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_START",
      streamId,
      apiKey,
      targetLang,
      tabId,
    });
    if (res && res.success === false) {
      return { success: false, error: res.error || "Offscreen start failed" };
    }

    currentSession = { tabId, startTime: Date.now(), targetLang };
    chrome.action.setBadgeText({ text: "ON" });
    chrome.action.setBadgeBackgroundColor({ color: "#10B981" });
    return { success: true };
  } catch (err) {
    console.error("[ParsLiveDub] start error", err);
    return { success: false, error: err.message };
  }
}

async function stopDubbing() {
  try {
    await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
  } catch (_) {}
  currentSession = null;
  chrome.action.setBadgeText({ text: "" });
  return { success: true };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentSession && currentSession.tabId === tabId) stopDubbing();
});
