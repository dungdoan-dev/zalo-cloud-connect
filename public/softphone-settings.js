import { readSettings, saveSettings } from '/floating-softphone.js';

const form = document.getElementById('sip-settings');
const extension = document.getElementById('extension');
const password = document.getElementById('password');
const remember = document.getElementById('remember-password');
const message = document.getElementById('message');
const saved = readSettings();

extension.value = saved.extension;
password.value = saved.password;
remember.checked = saved.rememberPassword;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  saveSettings({ extension: extension.value.trim(), password: password.value, rememberPassword: remember.checked });
  message.textContent = 'Đã lưu. Đang kết nối Floating Call…';
  window.dispatchEvent(new Event('simlydent-softphone-settings'));
});

document.getElementById('clear-settings').addEventListener('click', () => {
  localStorage.removeItem('simlydent-softphone-settings');
  extension.value = '';
  password.value = '';
  message.textContent = 'Đã xóa cấu hình khỏi thiết bị này.';
  window.dispatchEvent(new Event('simlydent-softphone-settings'));
});
