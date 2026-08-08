import { SimpleUser } from '/vendor/sip.js/platform/web/index.js';

const STORAGE_KEY = 'simlydent-softphone-settings';
let phone;
let callActive = false;

function settings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function mount() {
  if (document.getElementById('zcc-float')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <aside id="zcc-float" class="zcc-float" aria-label="SimlyDent ZCC Softphone">
      <button id="zcc-float-toggle" class="zcc-float-toggle" type="button" aria-expanded="false">☎ Gọi Zalo</button>
      <section id="zcc-float-panel" class="zcc-float-panel" hidden>
        <header><div><strong>SimlyDent Call</strong><small id="zcc-status">Chưa kết nối</small></div><a href="/softphone" title="Thiết lập">⚙</a></header>
        <label>Loại đích gọi<select id="zcc-target-type"><option value="phone">Số điện thoại</option><option value="user_id">Zalo User ID</option></select></label>
        <label>Khách hàng<input id="zcc-callee" inputmode="numeric" placeholder="0372626121 hoặc +84372626121"></label>
        <div id="zcc-consent-actions" class="zcc-consent-actions"><button id="zcc-check-consent" type="button">Kiểm tra quyền gọi</button><button id="zcc-request-consent" type="button">Gửi yêu cầu gọi</button></div>
        <div class="zcc-float-actions"><button id="zcc-call" type="button">Gọi</button><button id="zcc-answer" type="button" hidden>Nghe</button><button id="zcc-decline" type="button" hidden>Từ chối</button></div>
        <div class="zcc-float-actions"><button id="zcc-mute" type="button" disabled>Tắt mic</button><button id="zcc-hold" type="button" disabled>Giữ máy</button></div>
        <p id="zcc-message" aria-live="polite"></p><audio id="zcc-remote-audio" autoplay playsinline></audio>
      </section>
    </aside>`);
  document.head.insertAdjacentHTML('beforeend', `<style>
    .zcc-float{position:fixed;right:24px;bottom:24px;z-index:9999;font:14px/1.4 system-ui,sans-serif;color:#eef5ff}.zcc-float-toggle{border:0;border-radius:999px;padding:12px 18px;background:#0866e8;color:#fff;font-weight:700;box-shadow:0 12px 36px #001c4980;cursor:pointer}.zcc-float-panel{width:330px;margin-bottom:10px;padding:16px;border:1px solid #263b58;border-radius:16px;background:#0d1b2d;box-shadow:0 22px 60px #000a}.zcc-float-panel header{display:flex;justify-content:space-between}.zcc-float-panel header small{display:block;color:#9eb4cd}.zcc-float-panel header a{color:#a9c9ff;font-size:18px}.zcc-float-panel label{display:block;margin:10px 0 0;color:#adc2db;font-size:12px}.zcc-float-panel input,.zcc-float-panel select,.zcc-float-panel button{width:100%;box-sizing:border-box;border:1px solid #314b6c;border-radius:9px;padding:10px;background:#071321;color:#f8fbff;font:inherit}.zcc-float-panel input,.zcc-float-panel select{margin-top:5px}.zcc-float-panel button{border:0;background:#1672ea;font-weight:700;cursor:pointer}.zcc-float-actions,.zcc-consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.zcc-consent-actions button{background:#173c68;font-size:12px}.zcc-consent-actions #zcc-request-consent{background:#755414}.zcc-float-panel #zcc-decline{background:#be3d55}.zcc-float-panel #zcc-mute,.zcc-float-panel #zcc-hold{background:#263b58}.zcc-float-panel p{min-height:18px;margin:11px 0 0;color:#bdddff;font-size:12px}@media(max-width:520px){.zcc-float{right:12px;bottom:12px}.zcc-float-panel{width:min(330px,calc(100vw - 24px))}}
  </style>`);
}

function ui() { return Object.fromEntries(['float','float-toggle','float-panel','status','target-type','callee','consent-actions','check-consent','request-consent','call','answer','decline','mute','hold','message','remote-audio'].map((name) => [name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), document.getElementById(`zcc-${name}`)])); }
function status(text, error = false) { const u = ui(); u.status.textContent = text; u.message.textContent = error ? text : ''; u.floatToggle.style.background = error ? '#be3d55' : '#0866e8'; }
function sipUri(user, domain) { return `sip:${String(user).trim().replace(/^sip:/, '')}@${domain}`; }

// ZCC phone targets must be E.164 (+84...). User IDs must stay numeric.
function zccPhoneTarget(value) {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  const target = compact.startsWith('0') ? `+84${compact.slice(1)}` : compact.startsWith('84') ? `+${compact}` : compact;
  if (!/^\+84\d{8,10}$/.test(target)) throw new Error('Số điện thoại ZCC phải có dạng +84xxxxxxxxx.');
  return target;
}

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.error !== 0) throw new Error(data.message || data.error || 'Yêu cầu Zalo không thành công.');
  return data;
}

async function attachAudio() {
  for (let index = 0; index < 20; index += 1) { if (phone?.remoteMediaStream) { ui().remoteAudio.srcObject = phone.remoteMediaStream; await ui().remoteAudio.play().catch(() => {}); return; } await new Promise((resolve) => setTimeout(resolve, 250)); }
}

async function connect() {
  const saved = settings();
  const runtime = await fetch('/api/config').then((response) => response.json());
  if (!saved.extension || !saved.password || !runtime.pbx?.wssUrl || !runtime.pbx?.sipDomain) { status('Vào ⚙ để thiết lập extension', true); return; }
  if (phone?.isConnected()) return;
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (runtime.webrtc?.turn?.urls) iceServers.push(runtime.webrtc.turn);
  phone = new SimpleUser(runtime.pbx.wssUrl, { aor: sipUri(saved.extension, runtime.pbx.sipDomain), media: { constraints: { audio: true, video: false }, remote: { audio: ui().remoteAudio } }, reconnectionAttempts: 5, reconnectionDelay: 4, userAgentOptions: { authorizationUsername: saved.extension, authorizationPassword: saved.password, displayName: saved.extension, logBuiltinEnabled: false, sessionDescriptionHandlerFactoryOptions: { iceGatheringTimeout: 10000, peerConnectionConfiguration: { bundlePolicy: 'balanced', rtcpMuxPolicy: 'require', iceServers } } }, delegate: { onServerConnect: () => status('Đang đăng ký…'), onRegistered: () => status(`Sẵn sàng · ${saved.extension}`), onServerDisconnect: () => status('Mất kết nối tổng đài', true), onCallCreated: () => { callActive = true; ui().call.textContent = 'Kết thúc'; ui().mute.disabled = false; ui().hold.disabled = false; status('Đang gọi…'); }, onCallReceived: () => { callActive = true; ui().answer.hidden = false; ui().decline.hidden = false; status('Cuộc gọi đến'); }, onCallAnswered: () => { ui().answer.hidden = true; ui().decline.hidden = true; status('Đang đàm thoại'); void attachAudio(); }, onCallHangup: () => { callActive = false; ui().call.textContent = 'Gọi'; ui().mute.disabled = true; ui().hold.disabled = true; ui().answer.hidden = true; ui().decline.hidden = true; status(`Sẵn sàng · ${saved.extension}`); } } });
  await phone.connect(); await phone.register();
}

mount();
const u = ui();
u.floatToggle.onclick = () => { u.floatPanel.hidden = !u.floatPanel.hidden; u.floatToggle.setAttribute('aria-expanded', String(!u.floatPanel.hidden)); };
u.targetType.onchange = () => { const isPhone = u.targetType.value === 'phone'; u.consentActions.hidden = !isPhone; u.callee.placeholder = isPhone ? '0372626121 hoặc +84372626121' : 'Zalo User ID'; };
u.call.onclick = async () => { try { if (callActive) return phone?.hangup(); if (!phone?.isConnected()) throw new Error('Tổng đài chưa sẵn sàng.'); const runtime = await fetch('/api/config').then((response) => response.json()); const targetType = u.targetType.value; const callee = targetType === 'phone' ? zccPhoneTarget(u.callee.value) : u.callee.value.trim(); if (!callee) throw new Error('Nhập Zalo User ID.'); if (targetType === 'phone') await post('/api/check-consent', { phone: callee }); await phone.call(sipUri(callee, runtime.pbx.sipDomain), { extraHeaders: [`X-ZCC-Target-Type: ${targetType}`] }); } catch (error) { status(error.message, true); } };
u.checkConsent.onclick = () => post('/api/check-consent', { phone: zccPhoneTarget(u.callee.value) }).then(() => status('Khách hàng đã cấp quyền gọi')).catch((error) => status(error.message, true));
u.requestConsent.onclick = () => post('/api/request-consent', { phone: zccPhoneTarget(u.callee.value), callType: 'audio', reasonCode: 101 }).then(() => status('Đã gửi yêu cầu gọi điện')).catch((error) => status(error.message, true));
u.answer.onclick = () => phone?.answer().catch((error) => status(error.message, true));
u.decline.onclick = () => phone?.decline();
u.mute.onclick = () => { if (phone?.isMuted()) phone.unmute(); else phone?.mute(); };
u.hold.onclick = () => phone?.[phone.isHeld() ? 'unhold' : 'hold']();
window.addEventListener('simlydent-softphone-settings', () => { phone?.disconnect().catch(() => {}); phone = null; void connect(); });
void connect();
