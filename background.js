// ParsLiveDub - Background Service Worker
// Professional real-time Persian live dubbing

let currentSession = null;
let offscreenCreated = false;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ParsLiveDub] Extension installed');
});

// Create offscreen document for audio processing
async function ensureOffscreenDocument() {
  if (offscreenCreated) return;
  
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length > 0) {
    offscreenCreated = true;
    return;
  }
  
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Audio capture and playback for live Persian dubbing'
  });
  
  offscreenCreated = true;
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'START_DUBBING':
      return await startDubbing(message.tabId, message.apiKey, message.targetLang);
    case 'STOP_DUBBING':
      return await stopDubbing();
    case 'GET_STATUS':
      return { isActive: !!currentSession, session: currentSession };
    case 'GET_API_KEY':
      const result = await chrome.storage.local.get(['geminiApiKey']);
      return { apiKey: result.geminiApiKey || '' };
    default:
      return { error: 'Unknown message type' };
  }
}

async function startDubbing(tabId, apiKey, targetLang = 'fa') {
  if (currentSession) {
    await stopDubbing();
  }
  
  if (!apiKey) {
    return { success: false, error: 'API Key is required' };
  }
  
  try {
    await ensureOffscreenDocument();
    
    // Get stream ID for tab capture
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(id);
        }
      });
    });
    
    // Send to offscreen document
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START',
      streamId,
      apiKey,
      targetLang,
      tabId
    });
    
    currentSession = {
      tabId,
      startTime: Date.now(),
      targetLang
    };
    
    // Update badge
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
    
    return { success: true };
  } catch (error) {
    console.error('[ParsLiveDub] Start error:', error);
    return { success: false, error: error.message };
  }
}

async function stopDubbing() {
  if (!currentSession) return { success: true };
  
  try {
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' });
  } catch (e) {
    // Offscreen might already be closed
  }
  
  currentSession = null;
  chrome.action.setBadgeText({ text: '' });
  
  return { success: true };
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentSession && currentSession.tabId === tabId) {
    stopDubbing();
  }
});