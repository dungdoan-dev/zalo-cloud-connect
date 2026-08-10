import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import WebSocket, { WebSocketServer } from 'ws';
import { timingSafeEqual } from 'node:crypto';
import { encodePcmToUlaw } from './codec.js';
import { SipCaller } from './sip-caller.js';
import { buildSipTarget, ZccClient } from './zcc-client.js';
import { getZaloAccount, getZaloConfig, getTelephonyConfig, publicTelephonyConfig, saveTelephonyConfig, saveTelephonyDraft, syncFreeSwitchRuntime, upsertEmployee } from './runtime-config.js';
import { storeWebhook } from './webhook-store.js';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = join(ROOT_DIR, '../public/index.html');
const SOFTPHONE_PATH = join(ROOT_DIR, '../public/softphone.html');
const SETTINGS_PATH = join(ROOT_DIR, '../public/settings.html');
const PUBLIC_DIR = resolve(ROOT_DIR, '../public');
const SIP_JS_DIR = resolve(ROOT_DIR, '../node_modules/sip.js/lib');
const MAX_JSON_BYTES = 64 * 1024;

const config = Object.freeze({
  port: readIntegerEnv('PORT', 3000),
  publicIp: process.env.ZALO_PUBLIC_IP,
  localIp: process.env.ZALO_LOCAL_IP,
  rtpMinPort: readIntegerEnv('ZALO_RTP_MIN_PORT', 10000),
  rtpMaxPort: readIntegerEnv('ZALO_RTP_MAX_PORT', 10100),
  callEngine: process.env.CALL_ENGINE === 'freeswitch' ? 'freeswitch' : 'direct',
  pbxWssUrl: process.env.PBX_WSS_URL || '',
  pbxSipDomain: process.env.PBX_SIP_DOMAIN || '',
  pbxWsUpstream: process.env.PBX_WS_UPSTREAM || `ws://${process.env.ZALO_LOCAL_IP || '127.0.0.1'}:5066`,
  turnUrl: process.env.WEBRTC_TURN_URL || '',
  turnUsername: process.env.WEBRTC_TURN_USERNAME || '',
  turnPassword: process.env.WEBRTC_TURN_PASSWORD || '',
});
const configAdminPassword = process.env.CONFIG_ADMIN_PASSWORD || '';
const webhookSecret = process.env.WEBHOOK_SECRET || '';
const execFileAsync = promisify(execFile);

function rewriteSipTransport(data, from, to) {
  if (Buffer.isBuffer(data)) return data;
  return String(data).replaceAll(`SIP/2.0/${from}`, `SIP/2.0/${to}`);
}

/**
 * FreeSWITCH is behind the Node WebSocket proxy, so Sofia sees the proxy's
 * private VPC address as its local interface and may put that address in the
 * ICE candidate lines.  That address is not routable from the browser.  Keep
 * the media ports/ICE credentials unchanged, but advertise the EC2 Elastic IP
 * in SDP sent back to the browser.
 */
function rewriteSdpForBrowser(data) {
  if (Buffer.isBuffer(data) || !config.localIp || !config.publicIp) return data;
  const message = String(data);
  const separator = message.indexOf('\r\n\r\n');
  if (separator < 0 || !/content-type\s*:\s*application\/sdp/i.test(message.slice(0, separator))) {
    return message;
  }

  const headers = message.slice(0, separator);
  const body = message.slice(separator + 4);
  const rewrittenBody = body.replaceAll(config.localIp, config.publicIp);
  if (rewrittenBody === body) return message;

  console.log(`[sip-proxy] SDP ICE rewrite ${config.localIp} -> ${config.publicIp}`);

  const rewrittenHeaders = headers.replace(
    /content-length\s*:\s*\d+/i,
    `Content-Length: ${Buffer.byteLength(rewrittenBody)}`,
  );
  return `${rewrittenHeaders}\r\n\r\n${rewrittenBody}`;
}

const sseClients = new Set();
const mediaClients = new Set();
let activeCaller = null;

function readIntegerEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new TypeError(`${name} phải là số nguyên.`);
  return parsed;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function sendError(res, error, status = 400) {
  sendJson(res, { error: error.message, code: error.code }, status);
}

function contentType(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  })[extname(path)] || 'application/octet-stream';
}

function sendFile(res, path) {
  res.writeHead(200, { 'Content-Type': contentType(path), 'Cache-Control': 'no-cache' });
  res.end(readFileSync(path));
}

function isAdmin(req) {
  const supplied = req.headers['x-config-password'] || '';
  if (!configAdminPassword || !supplied) return false;
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(configAdminPassword);
  return a.length === b.length && timingSafeEqual(a, b);
}

function safeStaticPath(root, requestPath) {
  const path = resolve(root, requestPath.replace(/^\/+/, ''));
  const child = relative(root, path);
  if (child.startsWith('..') || path === root) return null;
  return path;
}

async function readJson(req) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BYTES) throw new Error('Request body vượt quá 64 KB.');
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Request body không phải JSON hợp lệ.');
  }
}

function broadcast(event, data = {}) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(message);
}

function broadcastAudio(ulawPayload) {
  for (const client of mediaClients) {
    if (client.readyState === 1) client.send(ulawPayload, { binary: true });
  }
}

function releaseCaller(caller) {
  if (activeCaller === caller) activeCaller = null;
}

function createCaller(callee) {
  const zalo = getZaloConfig();
  const sip = buildSipTarget({ appId: zalo.appId, oaId: zalo.oaId, callee });
  const caller = new SipCaller({
    fromUri: sip.from,
    domain: sip.domain,
    port: sip.port,
    localIp: config.localIp,
    advertisedIp: config.publicIp,
    rtpMinPort: config.rtpMinPort,
    rtpMaxPort: config.rtpMaxPort,
    transport: 'tcp',
  });

  caller.on('calling', ({ toUri }) => broadcast('calling', { toUri }));
  caller.on('ringing', () => broadcast('ringing'));
  caller.on('connected', (rtp) => {
    caller.setAudioSink?.(broadcastAudio);
    broadcast('connected', {
      ...rtp,
      publicIp: config.publicIp,
      rtpMinPort: config.rtpMinPort,
      rtpMaxPort: config.rtpMaxPort,
    });
  });
  caller.on('ended', (data) => {
    releaseCaller(caller);
    broadcast('ended', data);
  });
  caller.on('failed', (error) => {
    releaseCaller(caller);
    broadcast('failed', { message: error.message });
  });
  caller.on('sip', (data) => broadcast('sip', data));

  return { caller, sip };
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${config.port}`);

  if (req.method === 'GET' && url.pathname === '/') {
    sendFile(res, INDEX_PATH);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/softphone') {
    sendFile(res, SOFTPHONE_PATH);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/settings') {
    sendFile(res, SETTINGS_PATH);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/webhooks/zalo') {
    sendJson(res, { ok: true, endpoint: 'zalo-webhook' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/zalo') {
    if (webhookSecret && req.headers['x-webhook-secret'] !== webhookSecret) {
      sendJson(res, { error: 'Webhook secret không hợp lệ.' }, 401);
      return;
    }
    const payload = await readJson(req);
    storeWebhook(payload, {
      eventId: req.headers['x-event-id'] || null,
      userAgent: req.headers['user-agent'] || null,
      contentType: req.headers['content-type'] || null,
    });
    sendJson(res, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/softphone.js') {
    sendFile(res, join(PUBLIC_DIR, 'softphone.js'));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/floating-softphone.js' || url.pathname === '/softphone-settings.js')) {
    sendFile(res, join(PUBLIC_DIR, url.pathname.slice(1)));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/vendor/sip.js/')) {
    const path = safeStaticPath(SIP_JS_DIR, url.pathname.slice('/vendor/sip.js/'.length));
    if (!path) {
      res.writeHead(404).end('Not found');
      return;
    }
    sendFile(res, path);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    const zalo = getZaloConfig();
    const telephony = publicTelephonyConfig();
    const extension = url.searchParams.get('extension') || '';
    const extensionProfile = telephony.extensions.find((item) => item.id === extension) || null;
    const employee = extensionProfile ? telephony.employees.find((item) => item.id === extensionProfile.employeeId) || null : null;
    const assignedAccountId = extensionProfile?.accountId || '';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host;
    const browserIsHttps = forwardedProto === 'https' || (forwardedProto === '' && req.socket.encrypted);
    const browserWssUrl = browserIsHttps && forwardedHost
      ? `wss://${forwardedHost}/sip`
      : config.pbxWssUrl;
    sendJson(res, {
      callEngine: config.callEngine,
      appId: zalo.appId,
      oaId: zalo.oaId,
      accounts: telephony.accounts,
      assignedAccountId,
      extensionProfile: extensionProfile && employee ? {
        id: extensionProfile.id,
        name: extensionProfile.name,
        accountId: extensionProfile.accountId,
        employee: { id: employee.id, name: employee.name, department: employee.department },
      } : null,
      pbx: { wssUrl: browserWssUrl, sipDomain: config.pbxSipDomain },
      webrtc: config.turnUrl && config.turnUsername
        ? { turn: { urls: config.turnUrl, username: config.turnUsername, credential: config.turnPassword } }
        : { turn: null },
    });
    return;
  }

  if ((req.method === 'GET' || req.method === 'PUT') && url.pathname === '/api/settings') {
    if (!isAdmin(req)) {
      sendJson(res, { error: 'Sai hoặc thiếu mật khẩu quản trị.' }, 401);
      return;
    }
    if (req.method === 'GET') {
      sendJson(res, publicTelephonyConfig());
      return;
    }
    const body = await readJson(req);
    sendJson(res, { ok: true, ...saveTelephonyConfig({ accounts: body.accounts, employees: body.employees, extensions: body.extensions }) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/employees') {
    if (!isAdmin(req)) {
      sendJson(res, { error: 'Sai hoáº·c thiáº¿u máº­t kháº©u quáº£n trá»‹.' }, 401);
      return;
    }
    const employee = await readJson(req);
    sendJson(res, { ok: true, ...upsertEmployee(employee) });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings/draft') {
    if (!isAdmin(req)) {
      sendJson(res, { error: 'Sai hoáº·c thiáº¿u máº­t kháº©u quáº£n trá»‹.' }, 401);
      return;
    }
    const body = await readJson(req);
    sendJson(res, { ok: true, ...saveTelephonyDraft(body) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/test-inbound') {
    if (!isAdmin(req)) {
      sendJson(res, { error: 'Sai hoáº·c thiáº¿u máº­t kháº©u quáº£n trá»‹.' }, 401);
      return;
    }
    const { accountId } = await readJson(req);
    const telephony = getTelephonyConfig();
    const account = telephony.accounts.find((item) => item.id === String(accountId || ''));
    if (!account || !account.inboundId || !account.inboundTargetId) {
      sendJson(res, { error: 'OA chÆ°a cÃ³ luá»“ng Direct Extension há»£p lá»‡.' }, 400);
      return;
    }
    const fsCli = process.env.FREESWITCH_CLI || '/usr/local/freeswitch/bin/fs_cli';
    const targets = account.inboundTargetType === 'employee'
      ? telephony.extensions.filter((item) => item.accountId === account.id && item.employeeId === account.inboundTargetId)
      : telephony.extensions.filter((item) => item.accountId === account.id && item.id === account.inboundTargetId);
    if (!targets.length) {
      sendJson(res, { error: 'ÄÃ­ch nháº­n cuá»™c gá»i chÆ°a cÃ³ mÃ¡y nhÃ¡nh thuá»™c OA nÃ y.' }, 400);
      return;
    }
    const command = `originate {origination_caller_id_name=Settings-Test,origination_caller_id_number=TEST,ignore_early_media=true}loopback/${account.inboundId}/default &park()`;
    try {
      const { stdout, stderr } = await execFileAsync(fsCli, ['-x', command], { timeout: 10_000 });
      sendJson(res, { ok: true, targets: targets.map((item) => item.id), output: String(stdout || stderr || '').trim() });
    } catch (error) {
      sendJson(res, { error: `KhÃ´ng thá»ƒ táº¡o cuá»™c gá»i test FreeSWITCH: ${error.message}` }, 503);
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    const zalo = getZaloConfig();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: status\ndata: ${JSON.stringify({
      hasCall: Boolean(activeCaller),
      appId: zalo.appId,
      callEngine: config.callEngine,
      oaId: zalo.oaId ? `${zalo.oaId.slice(0, 6)}…` : undefined,
    })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/request-consent') {
    const body = await readJson(req);
    const zalo = body.accountId ? getZaloAccount(body.accountId) : getZaloConfig();
    const client = new ZccClient({ accessToken: zalo.accessToken });
    const result = await client.requestConsent({
      phone: body.phone,
      callType: body.callType || 'audio',
      reasonCode: Number(body.reasonCode) || 101,
    });
    sendJson(res, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/check-consent') {
    const body = await readJson(req);
    const zalo = body.accountId ? getZaloAccount(body.accountId) : getZaloConfig();
    const client = new ZccClient({ accessToken: zalo.accessToken });
    sendJson(res, await client.checkConsent({ phone: body.phone }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/call') {
    if (config.callEngine === 'freeswitch') {
      sendJson(res, {
        error: 'Chế độ FreeSWITCH sử dụng SIP.js tại /softphone để khởi tạo cuộc gọi.',
        softphone: '/softphone',
      }, 409);
      return;
    }

    if (activeCaller) {
      sendJson(res, { error: 'Đang có cuộc gọi khác hoạt động.' }, 409);
      return;
    }

    const body = await readJson(req);
    const { caller, sip } = createCaller(body.callee);
    activeCaller = caller;
    caller.call(sip.to, {
      ringTimeout: toPositiveInteger(body.ringTimeout, 60_000),
      callDuration: toNonNegativeInteger(body.callDuration, 0),
    }).catch(() => {});
    sendJson(res, { ok: true, to: sip.to });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/hangup') {
    activeCaller?.hangup();
    sendJson(res, { ok: true });
    return;
  }

  res.writeHead(404).end('Not found');
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => sendError(res, error));
});

const mediaServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_JSON_BYTES,
  handleProtocols: (protocols) => protocols.has('sip') ? 'sip' : protocols.values().next().value,
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (config.callEngine === 'freeswitch' && url.pathname === '/sip') {
    const protocols = req.headers['sec-websocket-protocol']
      ? String(req.headers['sec-websocket-protocol']).split(',').map((value) => value.trim()).filter(Boolean)
      : [];
    const upstream = new WebSocket(config.pbxWsUpstream, protocols.length ? protocols : undefined);
    const reject = () => { try { socket.destroy(); } catch {} };
    upstream.once('error', reject);
    upstream.once('open', () => {
      upstream.removeListener('error', reject);
      mediaServer.handleUpgrade(req, socket, head, (client) => {
        const closeBoth = () => {
          if (client.readyState === WebSocket.OPEN) client.close();
          if (upstream.readyState === WebSocket.OPEN) upstream.close();
        };
        upstream.on('error', (error) => {
          console.error(`[sip-proxy] ${error.message}`);
          closeBoth();
        });
        client.on('message', (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) {
            // SIP messages must remain text frames. ws exposes text frames as
            // Buffers on the server side, which can otherwise be re-sent as
            // binary and ignored by FreeSWITCH/SIP.js.
            // TLS is terminated by ngrok. FreeSWITCH receives plain WS, so
            // its Sofia parser must see Via: SIP/2.0/WS rather than WSS.
            const payload = isBinary ? data : rewriteSipTransport(data.toString(), 'WSS', 'WS');
            console.log(`[sip-proxy] browser -> freeswitch: ${isBinary ? 'binary' : String(payload).split(/\r?\n/, 1)[0]}`);
            upstream.send(payload);
          }
        });
        upstream.on('message', (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) {
            const payload = isBinary
              ? data
              : rewriteSdpForBrowser(rewriteSipTransport(data.toString(), 'WS', 'WSS'));
            console.log(`[sip-proxy] freeswitch -> browser: ${isBinary ? 'binary' : String(payload).split(/\r?\n/, 1)[0]}`);
            client.send(payload);
          }
        });
        client.on('close', closeBoth);
        upstream.on('close', closeBoth);
      });
    });
    return;
  }
  if (config.callEngine !== 'direct' || url.pathname !== '/media') {
    socket.destroy();
    return;
  }
  mediaServer.handleUpgrade(req, socket, head, (client) => {
    mediaServer.emit('connection', client, req);
  });
});

mediaServer.on('connection', (client) => {
  mediaClients.add(client);

  client.on('message', (data, isBinary) => {
    if (!isBinary || !activeCaller?.sendAudio) return;
    const pcm = Buffer.from(data);
    if (pcm.length < 2) return;
    const completeSamples = pcm.subarray(0, pcm.length - (pcm.length % 2));
    activeCaller.stopSilence?.();
    activeCaller.sendAudio(encodePcmToUlaw(completeSamples));
  });

  const removeClient = () => mediaClients.delete(client);
  client.on('close', removeClient);
  client.on('error', removeClient);
});

syncFreeSwitchRuntime();
server.listen(config.port, () => {
  console.log('\n🚀 Zalo Cloud Connect UI');
  console.log(`   http://localhost:${config.port}`);
  console.log(`   SDP public IP: ${config.publicIp || '(chưa cấu hình ZALO_PUBLIC_IP)'}`);
  console.log(`   RTP UDP: ${config.rtpMinPort}-${config.rtpMaxPort}\n`);
  console.log(`   Call engine: ${config.callEngine}`);
  if (config.callEngine === 'freeswitch') console.log(`   Softphone: http://localhost:${config.port}/softphone\n`);
});
