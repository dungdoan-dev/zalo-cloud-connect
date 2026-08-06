import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.ZALO_CONFIG_FILE || resolve(ROOT_DIR, '../data/zalo-config.json');
const defaults = {
  accessToken: process.env.ZALO_OA_ACCESS_TOKEN || '',
  appId: process.env.ZALO_APP_ID || '',
  oaId: process.env.ZALO_OA_ID || '',
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

export function saveZaloConfig({ accessToken, appId, oaId }) {
  const next = {
    accessToken: accessToken || getZaloConfig().accessToken,
    appId: String(appId || '').trim(),
    oaId: String(oaId || '').trim(),
  };
  if (!next.accessToken || !/^\d+$/.test(next.appId) || !/^\d+$/.test(next.oaId)) {
    throw new Error('Access Token, App ID và OA ID không hợp lệ.');
  }
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  const temp = `${CONFIG_FILE}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, CONFIG_FILE);
  saved = next;
  return next;
}

export function getConfigFile() {
  return CONFIG_FILE;
}
