const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const openOptions = document.getElementById('openOptions');

async function updateUI() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  
  if (status.isActive) {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
    statusText.textContent = 'در حال دوبله...';
    statusIndicator.classList.add('active');
    statusIndicator.classList.remove('error');
  } else {
    startBtn.style.display = 'flex';
    stopBtn.style.display = 'none';
    statusText.textContent = 'آماده';
    statusIndicator.classList.remove('active', 'error');
  }
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  statusText.textContent = 'در حال شروع...';
  
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Get API key
    const { apiKey } = await chrome.runtime.sendMessage({ type: 'GET_API_KEY' });
    
    if (!apiKey) {
      statusText.textContent = 'کلید API تنظیم نشده!';
      statusIndicator.classList.add('error');
      startBtn.disabled = false;
      // Open options
      chrome.runtime.openOptionsPage();
      return;
    }
    
    const result = await chrome.runtime.sendMessage({
      type: 'START_DUBBING',
      tabId: tab.id,
      apiKey,
      targetLang: 'fa'
    });
    
    if (result.success) {
      await updateUI();
    } else {
      statusText.textContent = result.error || 'خطا در شروع';
      statusIndicator.classList.add('error');
    }
  } catch (err) {
    statusText.textContent = 'خطا: ' + err.message;
    statusIndicator.classList.add('error');
  }
  
  startBtn.disabled = false;
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: 'STOP_DUBBING' });
  await updateUI();
  stopBtn.disabled = false;
});

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Initial UI update
updateUI();

// Refresh status every 2 seconds while popup is open
setInterval(updateUI, 2000);