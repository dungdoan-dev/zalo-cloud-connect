import { SimpleUser } from '/vendor/sip.js/platform/web/index.js';

const byId = (id) => document.getElementById(id);
const ui = {
  wss: byId('wss'), domain: byId('domain'), extension: byId('extension'), password: byId('password'),
  callee: byId('callee'), targetType: byId('target-type'), status: byId('status'), register: byId('register'), call: byId('call'),
  answer: byId('answer'), decline: byId('decline'), mute: byId('mute'), hold: byId('hold'),
  remoteAudio: byId('remote-audio'), log: byId('log'),
};
let phone;
let callActive = false;
let lastCallFailure = '';
let runtimeConfig = {};

function writeLog(message) {
  const time = new Date().toLocaleTimeString('vi-VN');
  ui.log.textContent = `[${time}] ${message}\n${ui.log.textContent}`.slice(0, 12000);
}
function setStatus(value, tone = '') { ui.status.textContent = value; ui.status.dataset.tone = tone; }
function setCallState(active) {
  callActive = active; ui.call.textContent = active ? 'Kết thúc' : 'Gọi';
  ui.mute.disabled = !active; ui.hold.disabled = !active;
}
async function attachRemoteAudio() {
  if (!phone || !ui.remoteAudio) return;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const stream = phone.remoteMediaStream;
    if (stream) {
      if (ui.remoteAudio.srcObject !== stream) ui.remoteAudio.srcObject = stream;
      ui.remoteAudio.autoplay = true;
      ui.remoteAudio.playsInline = true;
      try { await ui.remoteAudio.play(); } catch (error) { writeLog(`Không phát được âm thanh: ${error.message}`); }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  writeLog('Không nhận được remote audio stream từ WebRTC.');
}
function sipResponse(response) {
  const message = response?.message;
  const code = message?.statusCode || 0;
  const reason = message?.reasonPhrase || 'Unknown';
  const sessionId = message?.getHeader?.('X-Session-Id');
  return { code, reason, sessionId, text: `SIP ${code || '?'} ${reason}` };
}
function describeSipFailure(code, reason) {
  const hints = {
    401: 'Sai thông tin xác thực INVITE.',
    403: 'Extension hoặc tenant chưa được cấp quyền gọi tuyến này.',
    404: 'Không tìm thấy route cho số/User ID đích.',
    407: 'Proxy yêu cầu xác thực nhưng INVITE chưa xác thực được.',
    408: 'Tổng đài không nhận được phản hồi kịp thời.',
    480: 'Đích gọi tạm thời không khả dụng.',
    486: 'Đích gọi đang bận.',
    487: 'Cuộc gọi đã bị hủy trước khi kết nối.',
    488: 'SDP/codec WebRTC không tương thích với media profile.',
    503: 'Tuyến ZCC hoặc tổng đài tạm thời không khả dụng.',
  };
  return `${code} ${reason}${hints[code] ? ` — ${hints[code]}` : ''}`;
}
function sipUri(user) {
  const value = String(user || '').trim().replace(/^sip:/, '');
  if (!value) throw new Error('Thiếu số điện thoại hoặc User ID.');
  return value.includes('@') ? `sip:${value}` : `sip:${value}@${ui.domain.value.trim()}`;
}

// ZCC requires a phone callee in E.164 form: +84xxxxxxxxx. A Zalo User ID
// remains numeric and must not receive a leading plus.
function zccPhoneTarget(value) {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  const international = compact.startsWith('0') ? `+84${compact.slice(1)}`
    : compact.startsWith('84') ? `+${compact}`
      : compact;
  if (!/^\+84\d{8,10}$/.test(international)) {
    throw new Error('Số điện thoại ZCC phải có dạng +84xxxxxxxxx.');
  }
  return international;
}
async function requirePhoneConsent(phone) {
  if (ui.targetType.value !== 'phone') return;
  const response = await fetch('/api/check-consent', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }),
  });
  const result = await response.json();
  if (!response.ok || result.error !== 0) throw new Error(result.error || result.message || 'Số điện thoại chưa cấp quyền gọi.');
  writeLog('Consent gọi thoại còn hiệu lực.');
}
function buildPhone() {
  const server = ui.wss.value.trim();
  const extension = ui.extension.value.trim();
  if (!server || !ui.domain.value.trim() || !extension || !ui.password.value) throw new Error('Cần nhập đủ WSS, SIP domain, extension và mật khẩu.');
  if (window.isSecureContext === false && !server.startsWith('ws://')) throw new Error('Trang HTTPS phải dùng WSS.');
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (runtimeConfig.webrtc?.turn?.urls) iceServers.push(runtimeConfig.webrtc.turn);
  return new SimpleUser(server, {
    aor: sipUri(extension),
    media: { constraints: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }, remote: { audio: ui.remoteAudio } },
    reconnectionAttempts: 5, reconnectionDelay: 4, sendDTMFUsingSessionDescriptionHandler: true,
    userAgentOptions: {
      sessionDescriptionHandlerFactoryOptions: {
        iceGatheringTimeout: 10000,
        // FreeSWITCH's SIP SDP may omit a=group:BUNDLE (especially on the
        // inbound leg). `max-bundle` makes Chrome reject that offer before
        // ICE/DTLS can start; balanced accepts both bundled and unbundled SDP.
        peerConnectionConfiguration: { bundlePolicy: 'balanced', rtcpMuxPolicy: 'require', iceTransportPolicy: 'all', iceServers },
      },
      authorizationUsername: extension,
      authorizationPassword: ui.password.value,
      displayName: extension,
      logBuiltinEnabled: false,
      logLevel: 'warn',
    },
    delegate: {
      onServerConnect: () => { setStatus('Đã kết nối WSS'); writeLog('WebSocket đã kết nối FreeSWITCH.'); },
      onServerDisconnect: (error) => { setStatus('Mất kết nối', 'error'); writeLog(error?.message || 'Mất kết nối FreeSWITCH.'); },
      onRegistered: () => { setStatus(`Đã đăng ký ${extension}`, 'ok'); writeLog('REGISTER thành công.'); },
      onUnregistered: () => { setStatus('Chưa đăng ký'); writeLog('Đã hủy REGISTER.'); },
      onCallCreated: () => { lastCallFailure = ''; setCallState(true); setStatus('Đang thiết lập cuộc gọi'); writeLog('SIP session đã được tạo.'); },
      onCallReceived: () => { setCallState(true); ui.answer.hidden = false; ui.decline.hidden = false; setStatus('Có cuộc gọi đến', 'ringing'); writeLog('Nhận INVITE từ FreeSWITCH.'); },
      onCallAnswered: () => { ui.answer.hidden = true; ui.decline.hidden = true; setStatus('Đang đàm thoại', 'ok'); void attachRemoteAudio(); writeLog('Cuộc gọi đã kết nối, đang gắn remote audio.'); },
      onCallHangup: () => {
        setCallState(false); ui.answer.hidden = true; ui.decline.hidden = true;
        setStatus(lastCallFailure || 'Cuộc gọi kết thúc', lastCallFailure ? 'error' : '');
        writeLog(lastCallFailure ? `Cuộc gọi thất bại: ${lastCallFailure}` : 'Cuộc gọi đã kết thúc.');
      },
      onCallHold: (held) => { ui.hold.textContent = held ? 'Tiếp tục' : 'Giữ máy'; },
      onCallDTMFReceived: (tone) => writeLog(`Nhận DTMF: ${tone}`),
    },
  });
}
async function register() {
  try {
    ui.register.disabled = true;
    if (phone) await phone.disconnect().catch(() => {});
    phone = buildPhone(); setStatus('Đang kết nối…'); await phone.connect();
    await phone.register({ requestDelegate: {
      onAccept: (response) => writeLog(`${sipResponse(response).text} (REGISTER)`),
      onReject: (response) => { const result = sipResponse(response); setStatus(`REGISTER ${describeSipFailure(result.code, result.reason)}`, 'error'); writeLog(`REGISTER bị từ chối: ${result.text}`); },
    } });
    localStorage.setItem('zcc-softphone', JSON.stringify({ wss: ui.wss.value.trim(), domain: ui.domain.value.trim(), extension: ui.extension.value.trim() }));
  } catch (error) { setStatus('Đăng ký thất bại', 'error'); writeLog(error.message); }
  finally { ui.register.disabled = false; }
}
ui.register.addEventListener('click', register);
ui.call.addEventListener('click', async () => {
  try {
    if (!phone?.isConnected()) throw new Error('Extension chưa đăng ký.');
    if (callActive) await phone.hangup();
    else {
      const targetType = ui.targetType.value === 'user_id' ? 'user_id' : 'phone';
      const callee = targetType === 'phone'
        ? zccPhoneTarget(ui.callee.value)
        : ui.callee.value.trim();
      if (!callee) throw new Error('Thiếu Zalo User ID.');
      await requirePhoneConsent(callee);
      const destination = sipUri(callee);
      writeLog(`INVITE → ${destination}`);
      await phone.call(destination, {
        extraHeaders: [`X-ZCC-Target-Type: ${targetType}`],
      }, { requestDelegate: {
        onTrying: (response) => writeLog(sipResponse(response).text),
        onProgress: (response) => { const result = sipResponse(response); writeLog(`${result.text}${result.sessionId ? ` | X-Session-Id: ${result.sessionId}` : ''}`); },
        onAccept: (response) => { const result = sipResponse(response); writeLog(`${result.text}${result.sessionId ? ` | X-Session-Id: ${result.sessionId}` : ''}`); },
        onRedirect: (response) => { const result = sipResponse(response); lastCallFailure = describeSipFailure(result.code, result.reason); writeLog(`INVITE redirect: ${result.text}`); },
        onReject: (response) => { const result = sipResponse(response); lastCallFailure = describeSipFailure(result.code, result.reason); setStatus(`Gọi thất bại: ${lastCallFailure}`, 'error'); writeLog(`INVITE bị từ chối: ${result.text}`); },
      } });
    }
  } catch (error) { setStatus('Không thể gọi', 'error'); writeLog(error.message); }
});
ui.answer.addEventListener('click', () => phone?.answer().catch((error) => writeLog(error.message)));
ui.decline.addEventListener('click', () => phone?.decline().catch((error) => writeLog(error.message)));
ui.mute.addEventListener('click', () => { if (!phone) return; if (phone.isMuted()) { phone.unmute(); ui.mute.textContent = 'Tắt mic'; } else { phone.mute(); ui.mute.textContent = 'Bật mic'; } });
ui.hold.addEventListener('click', () => phone?.[phone.isHeld() ? 'unhold' : 'hold']().catch((error) => writeLog(error.message)));
document.querySelectorAll('[data-dtmf]').forEach((button) => button.addEventListener('click', () => phone?.sendDTMF(button.dataset.dtmf).catch((error) => writeLog(error.message))));

const saved = JSON.parse(localStorage.getItem('zcc-softphone') || '{}');
const config = await fetch('/api/config').then((response) => response.json());
runtimeConfig = config;
const configuredWss = config.pbx?.wssUrl || '';
// Do not let an old ws:// value in localStorage override the HTTPS proxy URL.
const useConfiguredWss = window.isSecureContext && configuredWss.startsWith('wss://');
ui.wss.value = useConfiguredWss ? configuredWss : (saved.wss || configuredWss);
ui.domain.value = saved.domain || config.pbx?.sipDomain || ''; ui.extension.value = saved.extension || '';
setStatus(config.callEngine === 'freeswitch' ? 'Sẵn sàng đăng ký' : 'Server đang ở chế độ POC');
