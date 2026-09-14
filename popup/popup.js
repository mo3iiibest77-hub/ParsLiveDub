// ParsLiveDub v1.6.6 - Professional UI JavaScript
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

// DOM Elements
const statusCard = document.getElementById('statusCard');
const statusIndicator = document.getElementById('statusIndicator');
const statusPrimary = document.getElementById('statusPrimary');
const statusSecondary = document.getElementById('statusSecondary');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const statsRow = document.getElementById('statsRow');
const delayStat = document.getElementById('delayStat');
const genderStat = document.getElementById('genderStat');
const qualityStat = document.getElementById('qualityStat');
const langSelect = document.getElementById('langSelect');
const apiKeyInput = document.getElementById('apiKey');
const toggleBtn = document.getElementById('toggleBtn');
const toggleIcon = document.getElementById('toggleIcon');
const toggleText = document.getElementById('toggleText');
const testBtn = document.getElementById('testBtn');
const lipsyncToggle = document.getElementById('lipsyncToggle');
const genderToggle = document.getElementById('genderToggle');
const delaySelect = document.getElementById('delaySelect');

// Populate language dropdown
LANGUAGES.forEach(lang => {
  const option = document.createElement('option');
  option.value = lang.code;
  option.textContent = lang.label;
  langSelect.appendChild(option);
});

// Helper: Format delay for display
function formatDelay(ms) {
  const seconds = ms / 1000;
  return seconds.toFixed(seconds >= 10 ? 0 : 1) + 's';
}

// Helper: Gender code to word
function genderWord(code) {
  if (code === 'm') return 'Male';
  if (code === 'f') return 'Female';
  return 'Unknown';
}

// Update UI based on state
function setUi(state) {
  const active = !!state.pldActive;
  const status = state.pldStatus || (active ? 'live' : 'idle');
  const error = state.pldError || '';

  // Update status card
  statusCard.className = 'status-card ' + status;
  statusIndicator.className = 'status-indicator ' + status;

  // Update status text
  const statusMessages = {
    idle: ['Ready', 'Not active'],
    connecting: ['Connecting...', 'To Gemini Live'],
    capturing: ['Capturing...', 'Tab audio'],
    reconnecting: ['Reconnecting...', 'Lost connection'],
    live: ['Live Dubbing', 'Translation active'],
    error: ['Stopped', 'Encountered error'],
  };

  const [primary, secondary] = statusMessages[status] || ['Unknown', ''];
  statusPrimary.textContent = primary;
  statusSecondary.textContent = secondary;

  // Error handling
  if (error) {
    errorText.textContent = error;
    errorMessage.hidden = false;
    statusCard.classList.add('error');
  } else {
    errorMessage.hidden = true;
  }

  // Update stats if active
  if (active || status === 'live') {
    statsRow.hidden = false;

    // Delay stat
    const delay = state.pldAppliedDelayMs || state.pldMeasuredDelayMs || 2900;
    delayStat.textContent = formatDelay(delay);

    // Gender stat
    const srcGender = genderWord(state.pldSrcGender);
    const outGender = genderWord(state.pldOutGender);
    if (state.pldSrcGender && state.pldSrcGender !== 'u') {
      genderStat.textContent = `${srcGender} → ${outGender}`;
    } else {
      genderStat.textContent = 'Detecting...';
    }

    // Quality stat (simulated based on various factors)
    let quality = 'Good';
    if (error) quality = 'Error';
    else if (state.pldSrcGender && state.pldOutGender && state.pldSrcGender !== state.pldOutGender) {
      quality = 'Gender matched';
    }
    qualityStat.textContent = quality;
  } else {
    statsRow.hidden = true;
  }

  // Update toggle button
  if (active) {
    toggleIcon.textContent = '⏹';
    toggleText.textContent = 'Stop Dubbing';
    toggleBtn.classList.add('stop-button');
  } else {
    toggleIcon.textContent = '▶';
    toggleText.textContent = 'Start Live Dubbing';
    toggleBtn.classList.remove('stop-button');
  }
}

// Load saved state
function loadState() {
  chrome.storage.local.get([
    'geminiApiKey',
    'targetLang',
    'pldActive',
    'pldStatus',
    'pldError',
    'pldLipsync',
    'pldMatchGender',
    'pldSyncOffsetMs',
    'pldAppliedDelayMs',
    'pldMeasuredDelayMs',
    'pldSrcGender',
    'pldOutGender',
  ], data => {
    if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
    if (data.targetLang) langSelect.value = data.targetLang;
    if (data.pldLipsync !== undefined) lipsyncToggle.checked = data.pldLipsync;
    if (data.pldMatchGender !== undefined) genderToggle.checked = data.pldMatchGender;
    if (data.pldSyncOffsetMs !== undefined) delaySelect.value = String(data.pldSyncOffsetMs);
    setUi(data);
  });
}

// Listen for storage changes
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get([
    'pldActive',
    'pldStatus',
    'pldError',
    'pldAppliedDelayMs',
    'pldMeasuredDelayMs',
    'pldSrcGender',
    'pldOutGender',
  ], setUi);
});

// Get current settings
function currentSettings() {
  return {
    lipsync: lipsyncToggle.checked,
    matchGender: genderToggle.checked,
    syncOffsetMs: Number(delaySelect.value) || 0,
  };
}

// Persist settings
function persistSettings() {
  const settings = currentSettings();
  chrome.storage.local.set({
    pldLipsync: settings.lipsync,
    pldMatchGender: settings.matchGender,
    pldSyncOffsetMs: settings.syncOffsetMs,
  });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'update-settings', ...settings }).catch(() => {});
}

// Toggle event listeners
lipsyncToggle.addEventListener('change', persistSettings);
genderToggle.addEventListener('change', persistSettings);
delaySelect.addEventListener('change', persistSettings);

// API key auto-save
apiKeyInput.addEventListener('change', () => {
  chrome.storage.local.set({ geminiApiKey: apiKeyInput.value.trim() });
});

// Language auto-save
langSelect.addEventListener('change', () => {
  chrome.storage.local.set({ targetLang: langSelect.value });
});

// Ensure offscreen document exists
function ensureOffscreen(done) {
  const create = async () => {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
        justification: 'Capture tab audio and play live translated audio',
      });
      setTimeout(done, 150);
    } catch (err) {
      const msg = String(err?.message || err);
      if (/already/i.test(msg)) done();
      else done(err);
    }
  };

  if (!chrome.runtime.getContexts) return create();

  chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }, existing => {
    if (existing?.length) done();
    else create();
  });
}

// Request host permission
function requestHostAccess(cb) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cb();
  };

  setTimeout(finish, 350);
  if (!chrome.permissions?.request) return finish();

  chrome.permissions.request({ origins: ['https://generativelanguage.googleapis.com/*'] }, finish);
}

// Notify content script
function notifyTab(tabId, payload) {
  if (!tabId) return;

  chrome.tabs.sendMessage(tabId, { type: 'PLD_PING' }, res => {
    const missing = !!(chrome.runtime.lastError || !res?.ok);
    const send = () => chrome.tabs.sendMessage(tabId, payload).catch(() => {});

    if (missing && chrome.scripting?.executeScript) {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/sync.js'],
      }, () => setTimeout(send, 120));
      return;
    }

    send();
  });
}

// Main toggle button handler
toggleBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  const targetLanguageCode = langSelect.value || 'fa';
  const settings = currentSettings();

  // Save settings
  chrome.storage.local.set({
    geminiApiKey: apiKey,
    targetLang: targetLanguageCode,
    pldLipsync: settings.lipsync,
    pldMatchGender: settings.matchGender,
    pldSyncOffsetMs: settings.syncOffsetMs,
  });

  // Stop action
  if (toggleBtn.classList.contains('stop-button')) {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
    chrome.storage.local.get(['pldTabId'], data => {
      notifyTab(data.pldTabId, { type: 'PLD_STOP' });
    });
    chrome.storage.local.set({ pldActive: false, pldStatus: 'idle', pldError: '' });
    return;
  }

  // Start action
  if (!apiKey) {
    setUi({ pldError: 'Please paste your Gemini API key first.' });
    apiKeyInput.focus();
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs?.[0];
    if (!tab?.id) {
      setUi({ pldError: 'No active tab found.' });
      return;
    }

    // Ensure not on a restricted page
    if (tab.url && /^(chrome|chrome-extension|edge|about):/.test(tab.url)) {
      setUi({
        pldError: 'Please open a YouTube (or other video) tab before starting.',
      });
      return;
    }

    // Get tab capture stream
    chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, streamId => {
      if (chrome.runtime.lastError || !streamId) {
        const err = chrome.runtime.lastError?.message || 'Cannot capture tab audio';
        let message = '';

        if (/active stream/i.test(err)) {
          message = 'Another extension is capturing audio. ';
          message += 'Turn off other dubbing extensions, refresh YouTube, then retry.';
        } else if (/permission/i.test(err)) {
          message = 'Tab capture permission denied. ';
          message += 'Ensure YouTube has microphone/camera permissions.';
        } else if (/already in use/i.test(err)) {
          message = 'Audio device busy. Close other recording apps and try again.';
        } else {
          message = 'Cannot capture tab: ' + err;
        }

        setUi({ pldError: message });
        return;
      }

      // Request host permission and start
      requestHostAccess(() => {
        ensureOffscreen(err => {
          if (err) {
            setUi({ pldError: String(err.message || err) });
            return;
          }

          // Update UI state
          chrome.storage.local.set({
            pldActive: true,
            pldStatus: 'connecting',
            pldError: '',
            pldTabId: tab.id,
          });

          // Notify content script
          notifyTab(tab.id, {
            type: 'PLD_START',
            enabled: settings.lipsync,
            delayMs: settings.syncOffsetMs || 2900,
          });

          // Start offscreen session
          chrome.runtime.sendMessage({
            target: 'offscreen',
            type: 'start',
            tabId: tab.id,
            streamId,
            apiKey,
            targetLanguageCode,
            lipsync: settings.lipsync,
            matchGender: settings.matchGender,
            syncOffsetMs: settings.syncOffsetMs,
          });
        });
      });
    });
  });
});

// Test connection button
testBtn.addEventListener('click', () => {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    setUi({ pldError: 'Please paste your Gemini API key first.' });
    apiKeyInput.focus();
    return;
  }

  chrome.storage.local.set({ geminiApiKey: apiKey });
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';
  statusPrimary.textContent = 'Testing Gemini Connection';
  statusCard.className = 'status-card connecting';

  requestHostAccess(() => {
    const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' +
      encodeURIComponent(apiKey);
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => {
      finishTest(false, 'Connection timed out after 12 seconds.');
    }, 12000);

    function finishTest(ok, message) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';

      setUi({
        pldActive: false,
        pldStatus: ok ? 'idle' : 'error',
        pldError: ok ? '' : message,
      });

      if (ok) {
        statusPrimary.textContent = 'Connection OK';
        statusSecondary.textContent = 'Gemini Live is reachable';
      }

      try { ws.close(); } catch (_) {}
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: 'models/gemini-3.5-live-translate-preview',
          generationConfig: {
            responseModalities: ['AUDIO'],
            translationConfig: {
              targetLanguageCode: langSelect.value || 'fa',
              echoTargetLanguage: true,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      }));
    };

    ws.onmessage = async event => {
      try {
        const raw = typeof event.data === 'string'
          ? event.data
          : event.data instanceof Blob
            ? await event.data.text()
            : new TextDecoder().decode(event.data);
        const parsed = JSON.parse(raw);

        if (parsed.setupComplete) finishTest(true);
        else if (parsed.error?.message) finishTest(false, parsed.error.message);
      } catch (_) {}
    };

    ws.onerror = () => finishTest(
      false,
      'Network error. If using Lemur, enable site access for generativelanguage.googleapis.com.'
    );

    ws.onclose = ev => {
      if (!settled) finishTest(false, ev.reason || `Closed (${ev.code || 'unknown'})`);
    };
  });
});

// Initialize
document.addEventListener('DOMContentLoaded', loadState);