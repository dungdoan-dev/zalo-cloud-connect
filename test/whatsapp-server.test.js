import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const environmentKeys = [
  'PORT', 'CALL_ENGINE', 'CONFIG_ADMIN_PASSWORD', 'ZALO_CONFIG_FILE',
  'WHATSAPP_CALLING_CONFIG_FILE', 'FREESWITCH_RUNTIME_DIR', 'WEBHOOK_LOG_FILE',
];

test('WhatsApp webhook is HMAC-verified and configuration never returns secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'simlydent-whatsapp-server-'));
  const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  let server;

  try {
    process.env.PORT = '0';
    process.env.CALL_ENGINE = 'direct';
    process.env.CONFIG_ADMIN_PASSWORD = 'test-admin-password';
    process.env.ZALO_CONFIG_FILE = join(root, 'zalo-config.json');
    process.env.WHATSAPP_CALLING_CONFIG_FILE = join(root, 'whatsapp-calling.json');
    process.env.FREESWITCH_RUNTIME_DIR = join(root, 'freeswitch');
    process.env.WEBHOOK_LOG_FILE = join(root, 'webhooks.ndjson');
    writeFileSync(process.env.ZALO_CONFIG_FILE, JSON.stringify({
      accounts: [],
      employees: [{ id: 'employee-1001', name: 'Nhan vien test', department: '', active: true }],
      extensions: [{ id: '1001', name: 'May nhanh test', password: 'password-1001', accountId: '', employeeId: 'employee-1001' }],
    }));

    ({ server } = await import(`../src/server.js?whatsapp-server=${Date.now()}`));
    if (!server.address()) await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const passwordHeaders = { 'x-config-password': process.env.CONFIG_ADMIN_PASSWORD };
    const pageResponse = await fetch(`${base}/whatsapp`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /WhatsApp Business Calling/);
    const input = {
      id: 'wa-clinic', name: 'WhatsApp Clinic', enabled: true,
      phoneNumberId: '123456789012345', businessPhoneE164: '+14155550123',
      graphApiVersion: 'v25.0', accessToken: 'test-system-user-token',
      appSecret: 'test-app-secret', webhookVerifyToken: 'test-verify-token',
      sipHostname: 'voice.example.com', sipPort: 5061,
      inboundTargetType: 'extension', inboundTargetId: '1001',
    };

    const saveResponse = await fetch(`${base}/api/whatsapp/settings`, {
      method: 'PUT',
      headers: { ...passwordHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const saved = await saveResponse.json();
    assert.equal(saveResponse.status, 200);
    assert.equal(saved.whatsapp.hasAppSecret, true);
    assert.equal(JSON.stringify(saved).includes(input.appSecret), false);
    assert.equal(JSON.stringify(saved).includes(input.accessToken), false);

    const brokenRoute = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { ...passwordHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts: [], employees: [], extensions: [] }),
    });
    assert.equal(brokenRoute.status, 400);
    assert.match((await brokenRoute.json()).error, /WhatsApp 1001/);

    const configResponse = await fetch(`${base}/api/config`);
    const runtime = await configResponse.json();
    assert.equal(configResponse.status, 200);
    assert.equal(runtime.whatsapp.id, input.id);
    assert.equal(JSON.stringify(runtime).includes(input.appSecret), false);

    const verification = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${input.webhookVerifyToken}&hub.challenge=challenge-value`);
    assert.equal(verification.status, 200);
    assert.equal(await verification.text(), 'challenge-value');

    const body = JSON.stringify({ entry: [{ id: 'waba-id', changes: [{ value: { calls: [{ id: 'wacid-1' }] } }] }] });
    const signature = `sha256=${createHmac('sha256', input.appSecret).update(body).digest('hex')}`;
    const webhook = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
      body,
    });
    assert.equal(webhook.status, 200);
    assert.deepEqual(await webhook.json(), { ok: true });

    const rejected = await fetch(`${base}/webhooks/whatsapp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=bad' }, body,
    });
    assert.equal(rejected.status, 401);
  } finally {
    if (server?.listening) {
      server.close();
      await once(server, 'close');
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
