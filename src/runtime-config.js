import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.ZALO_CONFIG_FILE || resolve(ROOT_DIR, '../data/zalo-config.json');
const FS_RUNTIME_FILE = process.env.FREESWITCH_RUNTIME_VARS_FILE || resolve(ROOT_DIR, '../data/zcc-runtime-vars.xml');
const defaults = {
  accessToken: process.env.ZALO_OA_ACCESS_TOKEN || '',
  appId: process.env.ZALO_APP_ID || '',
  oaId: process.env.ZALO_OA_ID || '',
  inboundId: process.env.ZCC_INBOUND_ID || process.env.ZALO_INBOUND_ID || '',
};

let saved = {};
try {
  if (existsSync(CONFIG_FILE)) saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
} catch {
  saved = {};
}

export function getZaloConfig() {
  return { ...defaults, ...saved };
}

export function saveZaloConfig({ accessToken, appId, oaId, inboundId }) {
  const next = {
    accessToken: accessToken || getZaloConfig().accessToken,
    appId: String(appId || '').trim(),
    oaId: String(oaId || '').trim(),
    inboundId: String(inboundId || '').trim(),
  };
  if (!next.accessToken || !/^\d+$/.test(next.appId) || !/^\d+$/.test(next.oaId) || !/^\d+$/.test(next.inboundId)) {
    throw new Error('Access Token, App ID, OA ID và inbound ID không hợp lệ.');
  }
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  const temp = `${CONFIG_FILE}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, CONFIG_FILE);
  writeFreeSwitchVars(next);
  saved = next;
  return next;
}

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writeFreeSwitchVars({ appId, oaId, inboundId }) {
  const domain = `${appId}.zcc.openapi.zaloapp.com`;
  mkdirSync(dirname(FS_RUNTIME_FILE), { recursive: true });
  const content = `<include>\n  <X-PRE-PROCESS cmd="set" data="zcc_domain=${xml(domain)}"/>\n  <X-PRE-PROCESS cmd="set" data="zcc_oa_id=${xml(oaId)}"/>\n  <X-PRE-PROCESS cmd="set" data="zcc_inbound_id=${xml(inboundId)}"/>\n</include>\n`;
  const temp = `${FS_RUNTIME_FILE}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, FS_RUNTIME_FILE);

  const fsCli = '/usr/local/freeswitch/bin/fs_cli';
  if (existsSync(fsCli)) {
    const child = spawn(fsCli, ['-x', 'reloadxml'], { stdio: 'ignore', detached: true });
    child.unref();
  }
}
