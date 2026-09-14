function setBadge(text, color) {
  try {
    chrome.action.setBadgeText({ text: text || "" });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch (_) {}
}

function persist(partial) {
  chrome.storage.local.set(partial);
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
  if (message.type === "error") {
    persist({
      pldActive: false,
      pldStatus: "error",
      pldError: message.message || "Unknown error",
    });
    setBadge("");
    return;
  }
  if (message.type === "stopped" || message.type === "ended") {
    persist({ pldActive: false, pldStatus: "idle", pldError: "" });
    setBadge("");
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
  persist({ pldActive: false, pldStatus: "idle", pldError: "" });
});
