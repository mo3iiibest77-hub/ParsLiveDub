function setBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text: text || "" });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {}
}

function persist(partial) {
  chrome.storage.local.set(partial);
}

function sendToTab(tabId, payload) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, payload).catch(() => {});
  } catch (_) {}
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.target !== "background") return;

  if (message.type === "ready") {
    persist({ pldActive: true, pldStatus: "live", pldError: "" });
    setBadge("ON", "#10B981");
    return;
  }
  if (message.type === "status") {
    persist({ pldStatus: message.status || "", pldError: "" });
    return;
  }
  if (message.type === "latency") {
    persist({
      pldMeasuredDelayMs: message.measuredMs || message.ms || 0,
      pldAppliedDelayMs: message.ms || 0,
      pldSrcGender: message.srcGender || "u",
      pldOutGender: message.outGender || "u",
    });
    chrome.storage.local.get(["pldTabId", "pldLipsync"], (data) => {
      const tabId = message.tabId || data.pldTabId;
      const enabled = message.lipsync !== undefined ? !!message.lipsync : data.pldLipsync !== false;
      sendToTab(tabId, { type: "PLD_SYNC", delayMs: message.ms, enabled });
    });
    return;
  }
  if (message.type === "error") {
    persist({
      pldActive: false,
      pldStatus: "error",
      pldError: message.message || "Unknown error",
    });
    setBadge("");
    chrome.storage.local.get(["pldTabId"], (data) => {
      sendToTab(data.pldTabId, { type: "PLD_STOP" });
    });
    return;
  }
  if (message.type === "stopped" || message.type === "ended") {
    persist({ pldActive: false, pldStatus: "idle", pldError: "" });
    setBadge("");
    chrome.storage.local.get(["pldTabId"], (data) => {
      sendToTab(data.pldTabId, { type: "PLD_STOP" });
    });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(["pldTabId", "pldActive"], (data) => {
    if (data.pldActive && data.pldTabId === tabId) {
      chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => {});
      persist({ pldActive: false, pldStatus: "idle", pldError: "", pldTabId: null });
      setBadge("");
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  persist({
    pldActive: false,
    pldStatus: "idle",
    pldError: "",
    pldLipsync: true,
    pldMatchGender: true,
    pldSyncOffsetMs: 0,
  });
});
