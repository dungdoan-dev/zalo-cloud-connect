import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.ZALO_CONFIG_FILE || resolve(ROOT_DIR, '../data/zalo-config.json');
const FS_RUNTIME_DIR = process.env.FREESWITCH_RUNTIME_DIR || resolve(ROOT_DIR, '../data/freeswitch');
const DIRECTORY_FILE = resolve(FS_RUNTIME_DIR, 'directory.xml');
const DIALPLAN_FILE = resolve(FS_RUNTIME_DIR, 'dialplan.xml');

const legacyDefaults = {
  accessToken: process.env.ZALO_OA_ACCESS_TOKEN || '',
  appId: process.env.ZALO_APP_ID || '',
  oaId: process.env.ZALO_OA_ID || '',
  inboundId: process.env.ZCC_INBOUND_ID || process.env.ZALO_INBOUND_ID || '',
};

let saved = loadConfig();

function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
  } catch {
    // Fall back to environment configuration; the settings page can repair it.
  }
  if (legacyDefaults.appId && legacyDefaults.oaId && legacyDefaults.inboundId) {
    return normalizeConfig({ accounts: [{ id: 'default', name: 'Zalo OA', ...legacyDefaults }], extensions: [] });
  }
  return { accounts: [], extensions: [] };
}

function normalizeConfig(input = {}) {
  if (!Array.isArray(input.accounts)) {
    const legacy = { accessToken: input.accessToken || legacyDefaults.accessToken, appId: input.appId || legacyDefaults.appId, oaId: input.oaId || legacyDefaults.oaId, inboundId: input.inboundId || legacyDefaults.inboundId };
    return legacy.appId ? { accounts: [{ id: 'default', name: 'Zalo OA', ...legacy }], extensions: [] } : { accounts: [], extensions: [] };
  }
  return {
    accounts: input.accounts.map((account) => ({ id: String(account.id || ''), name: String(account.name || ''), accessToken: String(account.accessToken || ''), appId: String(account.appId || ''), oaId: String(account.oaId || ''), inboundId: String(account.inboundId || '') })),
    extensions: Array.isArray(input.extensions) ? input.extensions.map((extension) => ({ id: String(extension.id || ''), name: String(extension.name || ''), password: String(extension.password || ''), accountId: String(extension.accountId || '') })) : [],
  };
}

export function getTelephonyConfig() {
  return structuredClone(saved);
}

// Compatibility for the direct-call POC. Production FreeSWITCH calls use the
// account ID from the SIP header and do not expose an OA token to browsers.
export function getZaloConfig() {
  const primary = saved.accounts[0] || {};
  return { ...primary, accounts: saved.accounts, extensions: saved.extensions };
}

export function getZaloAccount(accountId) {
  const account = saved.accounts.find((item) => item.id === String(accountId || ''));
  if (!account) throw new Error('Không tìm thấy cấu hình Zalo OA.');
  return { ...account };
}

export function publicTelephonyConfig() {
  return {
    accounts: saved.accounts.map(({ id, name, appId, oaId, inboundId }) => ({ id, name, appId, oaId, inboundId })),
    extensions: saved.extensions.map(({ id, name, accountId }) => ({ id, name, accountId })),
  };
}

export function saveTelephonyConfig(input) {
  const previousAccounts = new Map(saved.accounts.map((account) => [account.id, account]));
  const previousExtensions = new Map(saved.extensions.map((extension) => [extension.id, extension]));
  const next = normalizeConfig(input);
  next.accounts = next.accounts.map((account) => ({
    ...account,
    accessToken: account.accessToken || previousAccounts.get(account.id)?.accessToken || '',
  }));
  next.extensions = next.extensions.map((extension) => ({
    ...extension,
    password: extension.password || previousExtensions.get(extension.id)?.password || '',
  }));
  validateConfig(next, previousAccounts);
  writeAtomic(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, 0o600);
  writeFreeSwitchRuntime(next);
  saved = next;
  return publicTelephonyConfig();
}

export function syncFreeSwitchRuntime() {
  writeFreeSwitchRuntime(saved);
}

// Legacy caller retained for CLI integrations. It updates the first OA only.
export function saveZaloConfig({ accessToken, appId, oaId, inboundId }) {
  const current = saved.accounts[0];
  const result = saveTelephonyConfig({
    accounts: [{ id: current?.id || 'default', name: current?.name || 'Zalo OA', accessToken: accessToken || current?.accessToken || '', appId, oaId, inboundId }],
    extensions: saved.extensions.filter((extension) => extension.accountId === (current?.id || 'default')),
  });
  return result.accounts[0];
}

function validateConfig(config, previousAccounts) {
  const accountIds = new Set();
  for (const account of config.accounts) {
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(account.id) || accountIds.has(account.id)) throw new Error('Mã OA phải duy nhất, gồm chữ/số, dấu gạch ngang hoặc gạch dưới.');
    if (!account.name.trim() || !/^\d+$/.test(account.appId) || !/^\d+$/.test(account.oaId) || !/^\d+$/.test(account.inboundId)) throw new Error('Tên OA, App ID, OA ID và mã phân luồng không hợp lệ.');
    if (!(account.accessToken || previousAccounts.get(account.id)?.accessToken)) throw new Error(`Thiếu Access Token cho OA ${account.name}.`);
    accountIds.add(account.id);
  }
  const extensionIds = new Set();
  for (const extension of config.extensions) {
    if (!/^\d{2,8}$/.test(extension.id) || extensionIds.has(extension.id)) throw new Error('Extension phải duy nhất, gồm 2–8 chữ số.');
    if (!extension.name.trim() || !accountIds.has(extension.accountId)) throw new Error('Máy nhánh phải có tên và thuộc một Zalo OA.');
    if (!extension.password || extension.password.length < 8) throw new Error(`Mật khẩu extension ${extension.id} cần ít nhất 8 ký tự.`);
    extensionIds.add(extension.id);
  }
}

function writeFreeSwitchRuntime(config) {
  mkdirSync(FS_RUNTIME_DIR, { recursive: true, mode: 0o2770 });
  writeAtomic(DIRECTORY_FILE, directoryXml(config.extensions), 0o640);
  writeAtomic(DIALPLAN_FILE, dialplanXml(config), 0o640);
  const fsCli = '/usr/local/freeswitch/bin/fs_cli';
  if (existsSync(fsCli)) {
    const child = spawn(fsCli, ['-x', 'reloadxml'], { stdio: 'ignore', detached: true });
    child.unref();
  }
}

function directoryXml(extensions) {
  return `<include>\n${extensions.map((extension) => `  <user id="${xml(extension.id)}">\n    <params><param name="password" value="${xml(extension.password)}"/></params>\n    <variables>\n      <variable name="user_context" value="default"/>\n      <variable name="accountcode" value="${xml(extension.id)}"/>\n      <variable name="effective_caller_id_name" value="${xml(extension.name)}"/>\n      <variable name="effective_caller_id_number" value="${xml(extension.id)}"/>\n    </variables>\n  </user>`).join('\n')}\n</include>\n`;
}

function dialplanXml(config) {
  const accounts = new Map(config.accounts.map((account) => [account.id, account]));
  const outbound = config.accounts.map((account) => {
    const agents = config.extensions.filter((extension) => extension.accountId === account.id).map((extension) => extension.id);
    if (!agents.length) return '';
    const agentPattern = agents.map(regex).join('|');
    const domain = `${account.appId}.zcc.openapi.zaloapp.com`;
    return `  <extension name="simlydent-outbound-${xml(account.id)}">\n    <condition field="\${sip_h_X-ZCC-Account-ID}" expression="^${regex(account.id)}$">\n      <condition field="\${sip_from_user}" expression="^(${agentPattern})$">\n        <condition field="destination_number" expression="^(\\+?\\d{8,20})$">\n          <action application="set" data="hangup_after_bridge=true"/>\n          <action application="set" data="absolute_codec_string=PCMU"/>\n          <action application="set" data="record_stereo=true"/>\n          <action application="record_session" data="$\${recordings_dir}/zcc/\${uuid}.wav"/>\n          <action application="set" data="sip_from_user=${xml(account.oaId)}"/>\n          <action application="set" data="sip_from_uri=sip:${xml(account.oaId)}@${xml(domain)}"/>\n          <action application="bridge" data="sofia/zcc/$1@${xml(domain)};transport=tcp"/>\n        </condition>\n      </condition>\n    </condition>\n  </extension>`;
  }).filter(Boolean).join('\n');
  const inbound = config.accounts.map((account) => {
    const agents = config.extensions.filter((extension) => extension.accountId === account.id).map((extension) => `user/${extension.id}`);
    if (!agents.length) return '';
    return `  <extension name="simlydent-inbound-${xml(account.id)}">\n    <condition field="destination_number" expression="^${regex(account.inboundId)}$">\n      <action application="set" data="absolute_codec_string=PCMU"/>\n      <action application="set" data="hangup_after_bridge=true"/>\n      <action application="bridge" data="${agents.join(',')}"/>\n    </condition>\n  </extension>`;
  }).filter(Boolean).join('\n');
  return `<include>\n${outbound}\n${inbound}\n</include>\n`;
}

function writeAtomic(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, content, { mode });
  renameSync(temp, path);
}

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function regex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
