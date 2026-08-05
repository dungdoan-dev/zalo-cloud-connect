import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('softphone dùng SIP.js cục bộ và không chứa credential thật', () => {
  const script = read('../public/softphone.js');
  const html = read('../public/softphone.html');
  assert.match(script, /\/vendor\/sip\.js\/platform\/web\/index\.js/);
  assert.match(script, /authorizationPassword: ui\.password\.value/);
  assert.match(script, /api\/check-consent/);
  assert.match(script, /onReject: \(response\)/);
  assert.match(script, /X-Session-Id/);
  assert.doesNotMatch(`${script}\n${html}`, /ZALO_OA_ACCESS_TOKEN|CHANGE_ME_STRONG_PASSWORD/);
});

test('dialplan ZCC giữ OA ID cho From và route 101 cho inbound', () => {
  const variables = read('../deploy/freeswitch/conf/zcc-vars.xml');
  const outbound = read('../deploy/freeswitch/conf/dialplan/default/10_zcc_outbound.xml');
  const inbound = read('../deploy/freeswitch/conf/dialplan/zcc.xml');
  const profile = read('../deploy/freeswitch/conf/sip_profiles/zcc.xml');

  assert.match(variables, /zcc_oa_id=2565558072518292002/);
  assert.match(variables, /zcc_inbound_id=2565558072518292002101/);
  assert.match(outbound, /sip_from_user=\$\$\{zcc_oa_id\}/);
  assert.doesNotMatch(outbound, /2565558072518292002101/);
  assert.match(inbound, /\^\$\$\{zcc_inbound_id\}\$/);
  assert.match(profile, /name="sip-port" value="5060"/);
  assert.match(profile, /name="outbound-codec-prefs" value="PCMU"/);
});
