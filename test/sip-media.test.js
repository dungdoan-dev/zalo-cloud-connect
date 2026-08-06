import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSdp, parseRtpPayload } from '../src/sip-caller.js';
import { encodePcmToUlaw, ulawToPcm16 } from '../src/codec.js';

test('SDP quảng bá public IP, cổng cố định và chỉ offer PCMU', () => {
  const sdp = buildSdp('16.176.236.109', 10000);
  assert.match(sdp, /^c=IN IP4 171\.236\.49\.4$/m);
  assert.match(sdp, /^m=audio 10000 RTP\/AVP 0 101$/m);
  assert.match(sdp, /^a=rtpmap:0 PCMU\/8000$/m);
  assert.doesNotMatch(sdp, /PCMA/);
});

test('RTP parser xử lý CSRC, extension và padding', () => {
  const payload = Buffer.alloc(160, 0xff);
  const packet = Buffer.alloc(12 + 4 + 4 + 4 + payload.length + 4);
  packet[0] = 0xb1; // V=2, padding, extension, CC=1
  packet[1] = 0x00; // PCMU
  packet.writeUInt16BE(42, 2);
  packet.writeUInt32BE(320, 4);
  let offset = 12;
  packet.writeUInt32BE(123, offset); offset += 4; // CSRC
  packet.writeUInt16BE(0xbede, offset);
  packet.writeUInt16BE(1, offset + 2); offset += 4; // 1 word extension
  packet.writeUInt32BE(456, offset); offset += 4;
  payload.copy(packet, offset); offset += payload.length;
  packet.fill(4, offset); // 4 bytes RTP padding

  const result = parseRtpPayload(packet);
  assert.equal(result.payloadType, 0);
  assert.equal(result.sequence, 42);
  assert.equal(result.timestamp, 320);
  assert.deepEqual(result.payload, payload);
});

test('PCM silence encode thành PCMU silence', () => {
  const pcm = Buffer.alloc(320);
  const ulaw = encodePcmToUlaw(pcm);
  assert.equal(ulaw.length, 160);
  assert.ok(ulaw.every((byte) => byte === 0xff));
  assert.equal(ulawToPcm16(0xff), 0);
});
