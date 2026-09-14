const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const statusDot  = document.getElementById('statusDot');
const openSettings = document.getElementById('openSettings');

async function refresh() {
  const st = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (st.isActive) {
    startBtn.hidden = true;
    stopBtn.hidden = false;
    statusText.textContent = 'در حال دوبله...';
    statusDot.className = 'status-dot on';
  } else {
    startBtn.hidden = false;
    stopBtn.hidden = true;
    statusText.textContent = 'آماده';
    statusDot.className = 'status-dot';
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusText.textContent = 'در حال اتصال...';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { apiKey } = await chrome.runtime.sendMessage({ type: 'GET_API_KEY' });
    if (!apiKey) {
      statusText.textContent = 'کلید API تنظیم نشده';
      statusDot.className = 'status-dot err';
      chrome.runtime.openOptionsPage();
      startBtn.disabled = false;
      return;
    }
    const res = await chrome.runtime.sendMessage({
      type: 'START_DUBBING',
      tabId: tab.id,
      apiKey,
      targetLang: 'fa'
    });
    if (!res.success) {
      statusText.textContent = res.error || 'خطا';
      statusDot.className = 'status-dot err';
    }
    await refresh();
  } catch (e) {
    statusText.textContent = 'خطا: ' + e.message;
    statusDot.className = 'status-dot err';
  }
  startBtn.disabled = false;
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
  await refresh();
  stopBtn.disabled = false;
});

openSettings.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
setInterval(refresh, 2000);
