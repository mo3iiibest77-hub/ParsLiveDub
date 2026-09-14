const startBtn = document.getElementById('startBtn');
const stopBtn  = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const statusDot  = document.getElementById('statusDot');
const openSettings = document.getElementById('openSettings');

async function refresh() {
  try {
    const st = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (st && st.isActive) {
      startBtn.hidden = true;
      stopBtn.hidden = false;
      statusText.textContent = 'در حال دوبله زنده...';
      statusDot.className = 'status-dot on';
    } else {
      startBtn.hidden = false;
      stopBtn.hidden = true;
      statusText.textContent = 'آماده';
      statusDot.className = 'status-dot';
    }
  } catch (e) {
    statusText.textContent = 'خطا در ارتباط';
    statusDot.className = 'status-dot err';
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusText.textContent = 'در حال اتصال به Gemini...';
  statusDot.className = 'status-dot';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      statusText.textContent = 'تب فعال پیدا نشد';
      statusDot.className = 'status-dot err';
      startBtn.disabled = false;
      return;
    }

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

    if (res && res.success) {
      await refresh();
    } else {
      statusText.textContent = (res && res.error) ? res.error : 'خطا در شروع';
      statusDot.className = 'status-dot err';
    }
  } catch (e) {
    statusText.textContent = 'خطا: ' + (e.message || e);
    statusDot.className = 'status-dot err';
  }

  startBtn.disabled = false;
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  statusText.textContent = 'در حال توقف...';
  try {
    await chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
  } catch (_) {}
  await refresh();
  stopBtn.disabled = false;
});

openSettings.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

refresh();
setInterval(refresh, 1800);
