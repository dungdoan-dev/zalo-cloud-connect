import { readSettings, saveSettings } from '/floating-softphone.js';

const form = document.getElementById('sip-settings');
const extension = document.getElementById('extension');
const password = document.getElementById('password');
const remember = document.getElementById('remember-password');
const message = document.getElementById('message');
const wssUrl = document.getElementById('pbx-wss-url');
const sipDomain = document.getElementById('pbx-sip-domain');
const connectionNote = document.getElementById('connection-note');
const assignedEmployee = document.getElementById('assigned-employee');
const assignedOa = document.getElementById('assigned-oa');
const saved = readSettings();

extension.value = saved.extension;
password.value = saved.password;
remember.checked = saved.rememberPassword;

async function loadConnectionInfo() {
  try {
    const response = await fetch(`/api/config?extension=${encodeURIComponent(extension.value.trim())}`);
    const runtime = await response.json();
    if (!response.ok || !runtime.pbx?.wssUrl || !runtime.pbx?.sipDomain) throw new Error(runtime.error || 'Khong the tai cau hinh tong dai.');
    wssUrl.value = runtime.pbx.wssUrl;
    sipDomain.value = runtime.pbx.sipDomain;
    if (runtime.extensionProfile?.employee) {
      assignedEmployee.value = `${runtime.extensionProfile.employee.name} (${runtime.extensionProfile.employee.id})`;
      assignedOa.value = runtime.accounts.find((item) => item.id === runtime.extensionProfile.accountId)?.name || runtime.extensionProfile.accountId;
      connectionNote.textContent = `SIP address: sip:${extension.value.trim()}@${runtime.pbx.sipDomain}. Extension is assigned to ${runtime.extensionProfile.employee.name}.`;
    } else if (extension.value.trim()) {
      assignedEmployee.value = '';
      assignedOa.value = '';
      connectionNote.textContent = 'Extension chua duoc gan nhan vien va Zalo OA trong Settings.';
    } else {
      assignedEmployee.value = '';
      assignedOa.value = '';
      connectionNote.textContent = `SIP address: sip:extension@${runtime.pbx.sipDomain}. WSS is managed by the server.`;
    }
    return runtime;
  } catch (error) {
    wssUrl.value = '';
    sipDomain.value = '';
    assignedEmployee.value = '';
    assignedOa.value = '';
    connectionNote.textContent = error.message;
    return null;
  }
}

void loadConnectionInfo();
extension.addEventListener('change', () => { void loadConnectionInfo(); });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const runtime = await loadConnectionInfo();
  if (!runtime?.extensionProfile?.employee) {
    message.textContent = 'Extension chua duoc gan nhan vien. Hay gan trong /settings truoc khi ket noi.';
    return;
  }
  saveSettings({ extension: extension.value.trim(), password: password.value, rememberPassword: remember.checked });
  message.textContent = 'Đã lưu. Đang kết nối Floating Call…';
  window.dispatchEvent(new Event('simlydent-softphone-settings'));
});

document.getElementById('clear-settings').addEventListener('click', () => {
  localStorage.removeItem('simlydent-softphone-settings');
  extension.value = '';
  password.value = '';
  void loadConnectionInfo();
  message.textContent = 'Đã xóa cấu hình khỏi thiết bị này.';
  window.dispatchEvent(new Event('simlydent-softphone-settings'));
});
