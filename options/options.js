const keyInput = document.getElementById('keyInput');
const saveBtn  = document.getElementById('saveBtn');
const toggleBtn = document.getElementById('toggleBtn');
const msg = document.getElementById('msg');

chrome.storage.local.get(['geminiApiKey'], (r) => {
  if (r.geminiApiKey) keyInput.value = r.geminiApiKey;
});

toggleBtn.addEventListener('click', () => {
  if (keyInput.type === 'password') {
    keyInput.type = 'text';
    toggleBtn.textContent = 'مخفی';
  } else {
    keyInput.type = 'password';
    toggleBtn.textContent = 'نمایش';
  }
});

saveBtn.addEventListener('click', () => {
  const key = keyInput.value.trim();
  if (!key) {
    msg.textContent = 'کلید را وارد کنید';
    msg.className = 'msg err';
    return;
  }
  chrome.storage.local.set({ geminiApiKey: key }, () => {
    msg.textContent = '✓ کلید ذخیره شد';
    msg.className = 'msg ok';
    setTimeout(() => msg.textContent = '', 2500);
  });
});
