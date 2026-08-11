import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.WHATSAPP_CALLING_CONFIG_FILE || resolve(ROOT_DIR, '../data/whatsapp-calling.json');
const FS_RUNTIME_DIR = process.env.FREESWITCH_RUNTIME_DIR || resolve(ROOT_DIR, '../data/freeswitch');
const VARS_FILE = resolve(FS_RUNTIME_DIR, 'whatsapp-vars.xml');
const DIALPLAN_FILE = resolve(FS_RUNTIME_DIR, 'whatsapp-dialplan.xml');

const secretFields = ['accessToken', 'appSecret', 'webhookVerifyToken', 'sipUserPassword'];
const envDefaults = {
  id: process.env.WHATSAPP_ACCOUNT_ID || 'whatsapp-default',
  name: process.env.WHATSAPP_ACCOUNT_NAME || 'WhatsApp Business Calling',
  enabled: process.env.WHATSAPP_CALLING_ENABLED === 'true',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  wabaId: process.env.WHATSAPP_WABA_ID || '',
  businessPhoneE164: process.env.WHATSAPP_BUSINESS_PHONE || '',
  graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0',
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  appSecret: process.env.WHATSAPP_APP_SECRET || '',
  webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
  sipHostname: process.env.WHATSAPP_SIP_HOSTNAME || '',
  sipPort: process.env.WHATSAPP_SIP_PORT || '5061',
  sipUserPassword: process.env.WHATSAPP_SIP_USER_PASSWORD || '',
  webhookDelivery: process.env.WHATSAPP_SIP_WEBHOOK_DELIVERY !== 'false',
  inboundTargetType: process.env.WHATSAPP_INBOUND_TARGET_TYPE || 'extension',
  inboundTargetId: process.env.WHATSAPP_INBOUND_TARGET_ID || '',
};

let saved = loadConfig();

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
  } catch {
    // A malformed local file must not make the calling server unavailable.
  }
  return normalizeConfig(envDefaults);
}

function normalizeConfig(input = {}) {
  const config = {
    id: String(input.id || envDefaults.id).trim(),
    name: String(input.name || envDefaults.name).trim(),
    enabled: input.enabled === true || input.enabled === 'true',
    phoneNumberId: String(input.phoneNumberId || '').trim(),
    wabaId: String(input.wabaId || '').trim(),
    businessPhoneE164: normalizeE164(input.businessPhoneE164 || ''),
    graphApiVersion: normalizeGraphApiVersion(input.graphApiVersion || envDefaults.graphApiVersion),
    accessToken: String(input.accessToken || '').trim(),
    appSecret: String(input.appSecret || '').trim(),
    webhookVerifyToken: String(input.webhookVerifyToken || '').trim(),
    sipHostname: normalizeHostname(input.sipHostname || ''),
    sipPort: normalizePort(input.sipPort),
    sipUserPassword: String(input.sipUserPassword || '').trim(),
    webhookDelivery: input.webhookDelivery !== false && input.webhookDelivery !== 'false',
    inboundTargetType: input.inboundTargetType === 'employee' ? 'employee' : 'extension',
    inboundTargetId: String(input.inboundTargetId || '').trim(),
  };
  return config;
}

function normalizeE164(value) {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  if (!compact) return '';
  return compact.startsWith('+') ? compact : `+${compact}`;
}

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function normalizePort(value) {
  const parsed = Number(value || 5061);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 5061;
}

function normalizeGraphApiVersion(value) {
  const version = String(value || '').trim();
  return /^v\d+\.\d+$/.test(version) ? version : 'v25.0';
}

function writeAtomic(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, { encoding: 'utf8', mode });
  renameSync(temporary, path);
}

function validateConfig(config) {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(config.id)) throw new Error('Mã tài khoản WhatsApp chỉ gồm chữ, số, dấu gạch ngang hoặc gạch dưới.');
  if (!config.name) throw new Error('Nhập tên tài khoản WhatsApp.');
  if (!config.enabled) return;
  if (!/^\+?[1-9]\d{7,14}$/.test(config.businessPhoneE164)) throw new Error('Số WhatsApp Business phải ở định dạng E.164, ví dụ +14155550123.');
  if (!/^\d+$/.test(config.phoneNumberId)) throw new Error('Phone Number ID của WhatsApp không hợp lệ.');
  if (!isHostname(config.sipHostname)) throw new Error('SIP hostname phải là tên miền công khai có TLS, không dùng IP hoặc ngrok.');
  if (!config.accessToken) throw new Error('Thiếu System User Access Token của Meta.');
  if (!config.appSecret) throw new Error('Thiếu Meta App Secret để xác thực webhook.');
  if (!config.webhookVerifyToken) throw new Error('Thiếu Webhook Verify Token của Meta.');
  if (!config.inboundTargetId) throw new Error('Chọn extension hoặc nhân viên nhận cuộc gọi WhatsApp.');
}

function isHostname(value) {
  if (!value || value.length > 253 || /^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return value.split('.').length >= 2 && value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function publicConfig(config = saved) {
  const outboundSupported = Boolean(config.businessPhoneE164) && !config.businessPhoneE164.startsWith('+84');
  return {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    businessPhoneE164: config.businessPhoneE164,
    graphApiVersion: config.graphApiVersion,
    sipHostname: config.sipHostname,
    sipPort: config.sipPort,
    webhookDelivery: config.webhookDelivery,
    inboundTargetType: config.inboundTargetType,
    inboundTargetId: config.inboundTargetId,
    hasAccessToken: Boolean(config.accessToken),
    hasAppSecret: Boolean(config.appSecret),
    hasWebhookVerifyToken: Boolean(config.webhookVerifyToken),
    hasSipUserPassword: Boolean(config.sipUserPassword),
    outboundSupported,
    outboundRestriction: outboundSupported || !config.businessPhoneE164
      ? ''
      : 'Meta chưa hỗ trợ doanh nghiệp khởi tạo WhatsApp call từ số Business có mã quốc gia +84. Chỉ nhận cuộc gọi vào.',
  };
}

export function getWhatsAppCallingConfig() {
  return structuredClone(saved);
}

export function publicWhatsAppCallingConfig() {
  return publicConfig();
}

export function saveWhatsAppCallingConfig(input = {}) {
  const next = normalizeConfig(input);
  for (const field of secretFields) next[field] = next[field] || saved[field] || '';
  validateConfig(next);
  writeAtomic(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`);
  saved = next;
  return publicConfig(next);
}

function graphUrl(config, suffix) {
  return `https://graph.facebook.com/${config.graphApiVersion}/${config.phoneNumberId}${suffix}`;
}

async function graphRequest(config, suffix, options = {}) {
  if (!config.phoneNumberId || !config.accessToken) throw new Error('Cần Phone Number ID và System User Access Token trước khi gọi Meta Graph API.');
  const response = await fetch(graphUrl(config, suffix), {
    ...options,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
  if (!response.ok) {
    const message = body?.error?.message || `Meta Graph API trả HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.meta = body?.error || body;
    throw error;
  }
  return body;
}

export async function getWhatsAppSipSettings({ includeCredentials = false } = {}) {
  const config = getWhatsAppCallingConfig();
  const suffix = `/settings${includeCredentials ? '?include_sip_credentials=true' : ''}`;
  return graphRequest(config, suffix);
}

export async function configureWhatsAppSip() {
  const config = getWhatsAppCallingConfig();
  validateConfig(config);
  const result = await graphRequest(config, '/settings', {
    method: 'POST',
    body: JSON.stringify({
      calling: {
        status: 'ENABLED',
        callback_permission_status: 'ENABLED',
        sip: {
          status: 'ENABLED',
          webhook_delivery: config.webhookDelivery ? 'ENABLED' : 'DISABLED',
          servers: [{ hostname: config.sipHostname, port: config.sipPort }],
        },
        audio: { additional_codecs: ['PCMU', 'PCMA'] },
      },
    }),
  });
  return result;
}

export async function fetchAndStoreWhatsAppSipPassword() {
  const settings = await getWhatsAppSipSettings({ includeCredentials: true });
  const sip = settings?.calling?.sip || settings?.data?.calling?.sip || {};
  const servers = Array.isArray(sip.servers) ? sip.servers : [];
  const password = servers.find((server) => server.app_id || server.hostname)?.sip_user_password
    || sip.sip_user_password
    || settings?.sip_user_password;
  if (!password) throw new Error('Meta chưa trả SIP user password. Hãy chắc chắn SIP server đã được cấu hình bằng cùng Meta App/Access Token.');
  saveWhatsAppCallingConfig({ ...saved, sipUserPassword: password });
  return publicConfig();
}

export function verifyWhatsAppWebhookSignature(rawBody, signature) {
  const config = getWhatsAppCallingConfig();
  if (!config.appSecret || !signature || !String(signature).startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', config.appSecret).update(rawBody).digest('hex')}`;
  const received = String(signature);
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function isValidWhatsAppWebhookVerifyToken(token) {
  const config = getWhatsAppCallingConfig();
  if (!config.webhookVerifyToken || !token) return false;
  const expected = Buffer.from(config.webhookVerifyToken);
  const supplied = Buffer.from(String(token));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export function syncWhatsAppFreeSwitchRuntime(telephony) {
  const config = getWhatsAppCallingConfig();
  mkdirSync(FS_RUNTIME_DIR, { recursive: true, mode: 0o2770 });
  writeAtomic(VARS_FILE, whatsappVarsXml(config), 0o640);
  writeAtomic(DIALPLAN_FILE, whatsappDialplanXml(config, telephony), 0o640);
}

function whatsappVarsXml(config) {
  return `<include>\n  <X-PRE-PROCESS cmd="set" data="whatsapp_enabled=${config.enabled ? 'true' : 'false'}"/>\n  <X-PRE-PROCESS cmd="set" data="whatsapp_account_id=${xml(config.id)}"/>\n  <X-PRE-PROCESS cmd="set" data="whatsapp_business_phone=${xml(config.businessPhoneE164)}"/>\n  <X-PRE-PROCESS cmd="set" data="whatsapp_sip_hostname=${xml(config.sipHostname)}"/>\n  <X-PRE-PROCESS cmd="set" data="whatsapp_sip_port=${config.sipPort}"/>\n  <X-PRE-PROCESS cmd="set" data="whatsapp_sip_password=${xml(config.sipUserPassword)}"/>\n</include>\n`;
}

function whatsappDialplanXml(config, telephony = { employees: [], extensions: [] }) {
  if (!config.enabled || !config.businessPhoneE164 || !config.inboundTargetId) return '<include/>\n';
  const extensions = Array.isArray(telephony.extensions) ? telephony.extensions : [];
  const targets = config.inboundTargetType === 'employee'
    ? extensions.filter((extension) => extension.employeeId === config.inboundTargetId)
    : extensions.filter((extension) => extension.id === config.inboundTargetId);
  const inbound = targets.length
    ? `  <extension name="simlydent-whatsapp-inbound-${xml(config.id)}">\n    <condition field="\${sofia_profile_name}" expression="^whatsapp$">\n      <condition field="destination_number" expression="^\\+?${regex(config.businessPhoneE164.replace(/^\+/, ''))}$">\n        <action application="set" data="hangup_after_bridge=true"/>\n        <action application="set" data="absolute_codec_string=OPUS,PCMU,PCMA"/>\n        <action application="set" data="record_stereo=true"/>\n        <action application="record_session" data="$\${recordings_dir}/whatsapp/${xml(config.id)}/$\${uuid}.wav"/>\n        <action application="bridge" data="${targets.map((target) => `user/${xml(target.id)}`).join(',')}"/>\n      </condition>\n    </condition>\n  </extension>`
    : '';
  const agentPattern = extensions.map((extension) => regex(extension.id)).join('|');
  const outbound = config.businessPhoneE164.startsWith('+84') || !agentPattern
    ? ''
    : `  <extension name="simlydent-whatsapp-outbound-${xml(config.id)}">\n    <condition field="\${sip_h_X-Call-Provider}" expression="^whatsapp$">\n      <condition field="\${sip_h_X-Provider-Account-ID}" expression="^${regex(config.id)}$">\n        <condition field="\${sip_from_user}" expression="^(${agentPattern})$">\n          <condition field="destination_number" expression="^(\\+\\d{8,20})$">\n            <action application="set" data="hangup_after_bridge=true"/>\n            <action application="set" data="absolute_codec_string=OPUS,PCMU,PCMA"/>\n            <action application="set" data="record_stereo=true"/>\n            <action application="record_session" data="$\${recordings_dir}/whatsapp/${xml(config.id)}/$\${uuid}.wav"/>\n            <action application="set" data="effective_caller_id_number=${xml(config.businessPhoneE164)}"/>\n            <action application="set" data="effective_caller_id_name=${xml(config.name)}"/>\n            <action application="set" data="sip_from_user=${xml(config.businessPhoneE164)}"/>\n            <action application="set" data="sip_from_host=${xml(config.sipHostname)}"/>\n            <action application="set" data="sip_from_uri=sip:${xml(config.businessPhoneE164)}@${xml(config.sipHostname)}"/>\n            <action application="bridge" data="sofia/gateway/whatsapp/$1"/>\n          </condition>\n        </condition>\n      </condition>\n    </condition>\n  </extension>`;
  return `<include>\n${outbound}\n${inbound}\n</include>\n`;
}

function xml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function regex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
