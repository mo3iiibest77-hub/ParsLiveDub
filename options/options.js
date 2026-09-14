const apiKeyInput = document.getElementById('apiKeyInput');
const saveBtn = document.getElementById('saveBtn');
const toggleVisibility = document.getElementById('toggleVisibility');
const saveStatus = document.getElementById('saveStatus');

// Load existing key
chrome.storage.local.get(['geminiApiKey'], (result) => {
  if (result.geminiApiKey) {
    apiKeyInput.value = result.geminiApiKey;
  }
});

toggleVisibility.addEventListener('click', () => {
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    toggleVisibility.textContent = 'مخفی';
  } else {
    apiKeyInput.type = 'password';
    toggleVisibility.textContent = 'نمایش';
  }
});

saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  
  if (!key) {
    saveStatus.textContent = 'لطفاً کلید را وارد کنید';
    saveStatus.className = 'status-msg error';
    return;
  }
  
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    saveStatus.textContent = '✓ کلید با موفقیت ذخیره شد';
    saveStatus.className = 'status-msg success';
    
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 3000);
  });
});