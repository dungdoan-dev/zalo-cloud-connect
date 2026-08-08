import { SimpleUser } from '/vendor/sip.js/platform/web/index.js';

const STORAGE_KEY = 'simlydent-softphone-settings';
const defaults = { extension: '', password: '', rememberPassword: true };
let phone;
let callActive = false;

function readSettings() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return { ...defaults }; }
}

function saveSettings(values) {
  const next = { ...readSettings(), ...values };
  if (!next.rememberPassword) next.password = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function mount() {
  if (document.getElementById('zcc-float')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <aside id="zcc-float" class="zcc-float" aria-label="SimlyDent ZCC Softphone">
      <button id="zcc-float-toggle" class="zcc-float-toggle" type="button" aria-expanded="false">
        <span class="zcc-float-dot"></span><span>Gọi Zalo</span><b>⌄</b>
      </button>
      <section class="zcc-float-panel" hidden>
        <header><div><strong>SimlyDent Call</strong><small id="zcc-float-status">Chưa kết nối</small></div><a href="/softphone" title="Thiết lập">⚙</a></header>
        <label>Loại đích gọi<select id="zcc-target-type"><option value="phone">Số điện thoại</option><option value="user_id">Zalo User ID</option></select></label>
        <label>Khách hàng<input id="zcc-callee" inputmode="numeric" placeholder="84372626121"></label>
        <div id="zcc-consent-actions" class="zcc-consent-actions">
          <button id="zcc-check-consent" type="button">Kiểm tra quyền gọi</button>
          <button id="zcc-request-consent" type="button">Gửi yêu cầu gọi điện</button>
        </div>
        <div class="zcc-float-actions"><button id="zcc-call" type="button">Gọi</button><button id="zcc-answer" type="button" hidden>Nghe</button><button id="zcc-decline" type="button" hidden>Từ chối</button></div>
        <div class="zcc-float-controls"><button id="zcc-mute" type="button" disabled>Tắt mic</button><button id="zcc-hold" type="button" disabled>Giữ máy</button></div>
        <p id="zcc-float-message" class="zcc-float-message"></p><audio id="zcc-remote-audio" autoplay playsinline></audio>
      </section>
    </aside>`);
  document.head.insertAdjacentHTML('beforeend', `<style>
    .zcc-float{position:fixed;right:24px;bottom:24px;z-index:9999;font:14px/1.4 Inter,system-ui,sans-serif;color:#eef5ff}.zcc-float-toggle{display:flex;align-items:center;gap:9px;margin-left:auto;border:1px solid #2e78ed;border-radius:999px;padding:12px 16px;background:#0866e8;color:#fff;font-weight:700;box-shadow:0 12px 36px #001c4980;cursor:pointer}.zcc-float-toggle b{font-size:17px}.zcc-float-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8}.zcc-float[data-state="ready"] .zcc-float-dot{background:#31d395;box-shadow:0 0 0 4px #31d39530}.zcc-float[data-state="error"] .zcc-float-dot{background:#fb7185}.zcc-float-panel{width:330px;margin-bottom:10px;padding:16px;border:1px solid #263b58;border-radius:16px;background:#0d1b2d;box-shadow:0 22px 60px #000a}.zcc-float-panel header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}.zcc-float-panel header small{display:block;margin-top:2px;color:#9eb4cd;font-size:12px}.zcc-float-panel header a{color:#a9c9ff;font-size:18px;text-decoration:none}.zcc-float-panel label{display:block;margin:10px 0 0;color:#adc2db;font-size:12px}.zcc-float-panel input,.zcc-float-panel select,.zcc-float-panel button{width:100%;box-sizing:border-box;border:1px solid #314b6c;border-radius:9px;padding:10px;background:#071321;color:#f8fbff;font:inherit}.zcc-float-panel input,.zcc-float-panel select{margin-top:5px}.zcc-float-panel button{border:0;background:#1672ea;font-weight:700;cursor:pointer}.zcc-float-actions,.zcc-float-controls{display:grid;gap:8px;margin-top:12px}.zcc-float-actions{grid-template-columns:1fr 1fr}.zcc-float-controls{grid-template-columns:1fr 1fr}.zcc-float-controls button{background:#263b58}.zcc-float-panel #zcc-decline{background:#be3d55}.zcc-float-message{min-height:18px;margin:11px 0 0;color:#9eb4cd;font-size:12px}.zcc-float[data-state="error"] .zcc-float-message{color:#ff9fac}@media(max-width:520px){.zcc-float{right:12px;bottom:12px}.zcc-float-panel{width:min(330px,calc(100vw - 24px))}}
    .zcc-consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.zcc-consent-actions button{padding:9px 7px;background:#173c68;color:#bdddff;font-size:12px}.zcc-consent-actions #zcc-request-consent{background:#5b4011;color:#ffe3a1}
  </style>`);
}

function ui() { return Object.fromEntries(['float','float-toggle','float-status','float-message','target-type','callee','consent-actions','check-consent','request-consent','call','answer','decline','mute','hold','remote-audio'].map((name) => [`${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`, document.getElementById(`zcc-${name}`)])); }
function status(text, state = '') { const u = ui(); u.float.dataset.state = state; u.floatStatus.textContent = text; u.floatMessage.textContent = state === 'error' ? text : ''; }
function setCallState(active) { const u = ui(); callActive = active; u.call.textContent = active ? 'Kết thúc' : 'Gọi'; u.mute.disabled = !active; u.hold.disabled = !active; }
function sipUri(user, domain) { return `sip:${String(user).trim().replace(/^sip:/, '').includes('@') ? String(user).trim().replace(/^sip:/, '') : `${String(user).trim()}@${domain}`}`; }

async function attachAudio() {
  const u = ui();
  for (let i = 0; i < 20; i += 1) {
    if (phone?.remoteMediaStream) { u.remoteAudio.srcObject = phone.remoteMediaStream; await u.remoteAudio.play().catch(() => {}); return; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function connect() {
  const saved = readSettings();
  const runtime = await fetch('/api/config').then((r) => r.json());
  const wss = runtime.pbx?.wssUrl;
  const domain = runtime.pbx?.sipDomain;
  if (!saved.extension || !saved.password || !wss || !domain) { status('Thiết lập extension để bắt đầu', 'error'); return; }
  if (phone?.isConnected()) return;
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (runtime.webrtc?.turn?.urls) iceServers.push(runtime.webrtc.turn);
  phone = new SimpleUser(wss, {
    aor: sipUri(saved.extension, domain),
    media: { constraints: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }, remote: { audio: ui().remoteAudio } },
    reconnectionAttempts: 5, reconnectionDelay: 4,
    userAgentOptions: { authorizationUsername: saved.extension, authorizationPassword: saved.password, displayName: saved.extension, logBuiltinEnabled: false, sessionDescriptionHandlerFactoryOptions: { iceGatheringTimeout: 10000, peerConnectionConfiguration: { bundlePolicy: 'balanced', rtcpMuxPolicy: 'require', iceTransportPolicy: 'all', iceServers } } },
    delegate: {
      onServerConnect: () => status('Đang đăng ký…'),
      onRegistered: () => status(`Sẵn sàng · ${saved.extension}`, 'ready'),
      onServerDisconnect: () => status('Mất kết nối tổng đài', 'error'),
      onCallCreated: () => { setCallState(true); status('Đang gọi…', 'ready'); },
      onCallReceived: () => { setCallState(true); ui().answer.hidden = false; ui().decline.hidden = false; status('Cuộc gọi đến', 'ready'); },
      onCallAnswered: () => { ui().answer.hidden = true; ui().decline.hidden = true; status('Đang đàm thoại', 'ready'); void attachAudio(); },
      onCallHangup: () => { setCallState(false); ui().answer.hidden = true; ui().decline.hidden = true; status(`Sẵn sàng · ${saved.extension}`, 'ready'); },
    },
  });
  await phone.connect();
  await phone.register();
}

async function call() {
  const u = ui();
  if (callActive) return phone?.hangup();
  if (!phone?.isConnected()) throw new Error('Tổng đài chưa sẵn sàng.');
  const runtime = await fetch('/api/config').then((r) => r.json());
  const value = u.callee.value.trim();
  if (!value) throw new Error('Nhập số điện thoại hoặc Zalo User ID.');
  if (u.targetType.value === 'phone') {
    const response = await fetch('/api/check-consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: value }) });
    const data = await response.json();
    if (!response.ok || data.error !== 0) throw new Error(data.message || 'Khách hàng chưa cấp consent gọi.');
  }
  await phone.call(sipUri(value, runtime.pbx.sipDomain), { extraHeaders: [`X-ZCC-Target-Type: ${u.targetType.value}`] });
}

function currentPhone() {
  const value = ui().callee.value.trim().replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(value)) throw new Error('Nhập số điện thoại quốc tế gồm 8–15 chữ số.');
  return value;
}

async function postConsent(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.error !== 0) throw new Error(data.message || data.error || 'Yêu cầu Zalo không thành công.');
  return data;
}

async function checkConsent() {
  await postConsent('/api/check-consent', { phone: currentPhone() });
  status('Khách hàng đã cấp quyền gọi', 'ready');
}

async function requestConsent() {
  await postConsent('/api/request-consent', { phone: currentPhone(), callType: 'audio', reasonCode: 101 });
  status('Đã gửi yêu cầu gọi điện trên Zalo', 'ready');
}

function updateTargetType() {
  const isPhone = u.targetType.value === 'phone';
  u.consentActions.hidden = !isPhone;
  u.callee.placeholder = isPhone ? '84372626121' : 'Zalo User ID';
}

mount();
const u = ui();
u.floatToggle.onclick = () => { const panel = document.querySelector('.zcc-float-panel'); panel.hidden = !panel.hidden; u.floatToggle.setAttribute('aria-expanded', String(!panel.hidden)); };
u.call.onclick = () => call().catch((error) => status(error.message, 'error'));
u.checkConsent.onclick = () => checkConsent().catch((error) => status(error.message, 'error'));
u.requestConsent.onclick = () => requestConsent().catch((error) => status(error.message, 'error'));
u.targetType.onchange = updateTargetType;
u.answer.onclick = () => phone?.answer().catch((error) => status(error.message, 'error'));
u.decline.onclick = () => phone?.decline();
u.mute.onclick = () => { if (phone?.isMuted()) { phone.unmute(); u.mute.textContent = 'Tắt mic'; } else { phone?.mute(); u.mute.textContent = 'Bật mic'; } };
u.hold.onclick = () => phone?.[phone.isHeld() ? 'unhold' : 'hold']();
window.addEventListener('simlydent-softphone-settings', () => { phone?.disconnect().catch(() => {}); phone = null; void connect(); });
updateTargetType();
void connect();

export { readSettings, saveSettings };
