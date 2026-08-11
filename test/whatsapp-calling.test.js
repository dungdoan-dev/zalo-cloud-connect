import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('WhatsApp FreeSWITCH profile is TLS-only and tracked templates contain no real credentials', () => {
  const profile = readFileSync(new URL('../deploy/freeswitch/conf/sip_profiles/whatsapp.xml', import.meta.url), 'utf8');
  const variables = readFileSync(new URL('../deploy/freeswitch/conf/whatsapp-vars.xml', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../public/whatsapp.html', import.meta.url), 'utf8');

  assert.match(profile, /name="tls-only" value="true"/);
  assert.match(profile, /name="tls-sip-port" value="\$\$\{whatsapp_sip_port\}"/);
  assert.match(profile, /name="proxy" value="wa\.meta\.vc:5061;transport=tls"/);
  assert.match(profile, /name="inbound-codec-prefs" value="OPUS,PCMU,PCMA"/);
  assert.match(variables, /data="whatsapp_sip_password="/);
  assert.doesNotMatch(variables, /WHATSAPP_ACCESS_TOKEN|test-sip-password/);
  assert.match(page, /\/api\/whatsapp\/settings/);
  assert.doesNotMatch(page, /WHATSAPP_ACCESS_TOKEN/);
});

test('WhatsApp Calling keeps credentials server-side and writes provider-specific dialplan', async () => {
  const root = mkdtempSync(join(tmpdir(), 'simlydent-whatsapp-'));
  const originalConfigFile = process.env.WHATSAPP_CALLING_CONFIG_FILE;
  const originalRuntimeDir = process.env.FREESWITCH_RUNTIME_DIR;
  process.env.WHATSAPP_CALLING_CONFIG_FILE = join(root, 'whatsapp-calling.json');
  process.env.FREESWITCH_RUNTIME_DIR = join(root, 'freeswitch');

  try {
    const calling = await import(`../src/whatsapp-calling.js?test=${Date.now()}`);
    const input = {
      id: 'wa-clinic',
      name: 'WhatsApp Clinic',
      enabled: true,
      phoneNumberId: '123456789012345',
      wabaId: '9988776655',
      businessPhoneE164: '+14155550123',
      graphApiVersion: 'v25.0',
      accessToken: 'test-system-user-token',
      appSecret: 'test-app-secret',
      webhookVerifyToken: 'test-verify-token',
      sipHostname: 'voice.example.com',
      sipPort: 5061,
      sipUserPassword: 'test-sip-password',
      inboundTargetType: 'employee',
      inboundTargetId: 'employee-1001',
    };

    const publicConfig = calling.saveWhatsAppCallingConfig(input);
    assert.equal(publicConfig.hasAccessToken, true);
    assert.equal(publicConfig.hasAppSecret, true);
    assert.equal(publicConfig.hasWebhookVerifyToken, true);
    assert.equal(publicConfig.hasSipUserPassword, true);
    assert.equal(JSON.stringify(publicConfig).includes('test-system-user-token'), false);
    assert.equal(publicConfig.outboundSupported, true);

    const body = Buffer.from('{"entry":[]}');
    const signature = `sha256=${createHmac('sha256', input.appSecret).update(body).digest('hex')}`;
    assert.equal(calling.verifyWhatsAppWebhookSignature(body, signature), true);
    assert.equal(calling.verifyWhatsAppWebhookSignature(body, 'sha256=invalid'), false);
    assert.equal(calling.isValidWhatsAppWebhookVerifyToken(input.webhookVerifyToken), true);

    calling.syncWhatsAppFreeSwitchRuntime({
      extensions: [
        { id: '1001', employeeId: 'employee-1001' },
        { id: '1002', employeeId: 'employee-1001' },
      ],
    });
    const dialplan = readFileSync(join(root, 'freeswitch', 'whatsapp-dialplan.xml'), 'utf8');
    assert.match(dialplan, /simlydent-whatsapp-inbound-wa-clinic/);
    assert.match(dialplan, /user\/1001,user\/1002/);
    assert.match(dialplan, /simlydent-whatsapp-outbound-wa-clinic/);
    assert.match(dialplan, /recordings_dir}\/whatsapp\/wa-clinic/);

    const VietnameseBusinessNumber = calling.saveWhatsAppCallingConfig({
      ...input,
      businessPhoneE164: '+84901234567',
    });
    assert.equal(VietnameseBusinessNumber.outboundSupported, false);
    assert.match(VietnameseBusinessNumber.outboundRestriction, /\+84/);
    calling.syncWhatsAppFreeSwitchRuntime({ extensions: [{ id: '1001', employeeId: 'employee-1001' }] });
    const inboundOnlyDialplan = readFileSync(join(root, 'freeswitch', 'whatsapp-dialplan.xml'), 'utf8');
    assert.doesNotMatch(inboundOnlyDialplan, /simlydent-whatsapp-outbound/);
  } finally {
    if (originalConfigFile === undefined) delete process.env.WHATSAPP_CALLING_CONFIG_FILE;
    else process.env.WHATSAPP_CALLING_CONFIG_FILE = originalConfigFile;
    if (originalRuntimeDir === undefined) delete process.env.FREESWITCH_RUNTIME_DIR;
    else process.env.FREESWITCH_RUNTIME_DIR = originalRuntimeDir;
    rmSync(root, { recursive: true, force: true });
  }
});
