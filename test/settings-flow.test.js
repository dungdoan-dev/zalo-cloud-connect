import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('settings draft preserves employee-to-extension assignments after reload and final save', async () => {
  const root = mkdtempSync(join(tmpdir(), 'simlydent-settings-'));
  const configFile = join(root, 'zalo-config.json');
  const runtimeDir = join(root, 'freeswitch');
  const originalConfigFile = process.env.ZALO_CONFIG_FILE;
  const originalRuntimeDir = process.env.FREESWITCH_RUNTIME_DIR;

  try {
    writeFileSync(configFile, JSON.stringify({
      accounts: [{
        id: 'dental', name: 'Zalo OA Nha Khoa', accessToken: 'test-token',
        appId: '33273821605778414', oaId: '4372227074994145661', inboundId: '4372227074994145661101',
      }],
      employees: [],
      extensions: [
        { id: '1002', name: 'Nhanh2', password: 'password-1002', accountId: 'dental', employeeId: 'employee-1002' },
        { id: '1003', name: 'Nhanh3', password: 'password-1003', accountId: 'dental', employeeId: 'employee-1003' },
      ],
    }));
    process.env.ZALO_CONFIG_FILE = configFile;
    process.env.FREESWITCH_RUNTIME_DIR = runtimeDir;

    const runtime = await import(`../src/runtime-config.js?settings-flow=${Date.now()}`);
    runtime.saveTelephonyDraft({
      employees: [
        { id: 'employee-1002', name: 'Nhanh2', department: 'Le tan', active: true },
        { id: 'employee-1003', name: 'Nhanh3', department: 'Le tan', active: true },
      ],
    });

    const draft = runtime.publicTelephonyConfig();
    assert.deepEqual(draft.extensions.map(({ id, employeeId }) => ({ id, employeeId })), [
      { id: '1002', employeeId: 'employee-1002' },
      { id: '1003', employeeId: 'employee-1003' },
    ]);

    runtime.saveTelephonyConfig({
      accounts: [{
        id: 'dental', name: 'Zalo OA Nha Khoa', appId: '33273821605778414', oaId: '4372227074994145661',
        inboundId: '4372227074994145661101', inboundStrategy: 'direct', inboundTargetType: 'employee', inboundTargetId: 'employee-1003',
      }],
      employees: draft.employees,
      extensions: draft.extensions,
    });

    const persisted = JSON.parse(readFileSync(configFile, 'utf8'));
    assert.equal(persisted.extensions.find((item) => item.id === '1003').employeeId, 'employee-1003');
    assert.match(readFileSync(join(runtimeDir, 'dialplan.xml'), 'utf8'), /bridge" data="user\/1003"/);
  } finally {
    if (originalConfigFile === undefined) delete process.env.ZALO_CONFIG_FILE;
    else process.env.ZALO_CONFIG_FILE = originalConfigFile;
    if (originalRuntimeDir === undefined) delete process.env.FREESWITCH_RUNTIME_DIR;
    else process.env.FREESWITCH_RUNTIME_DIR = originalRuntimeDir;
    rmSync(root, { recursive: true, force: true });
  }
});
