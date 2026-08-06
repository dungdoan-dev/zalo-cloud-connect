import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const file = process.env.WEBHOOK_LOG_FILE || resolve(ROOT_DIR, '../data/webhooks.ndjson');

export function storeWebhook(payload, metadata = {}) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({
    receivedAt: new Date().toISOString(),
    metadata,
    payload,
  })}\n`, { encoding: 'utf8', mode: 0o600 });
}
