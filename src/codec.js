/**
 * G.711 µ-law (PCMU) codec — thuần JS, không phụ thuộc thư viện ngoài.
 * Standard: ITU-T G.711 Appendix A
 */

const BIAS = 0x84; // 132
const CLIP = 32635;

// Bảng decode pre-computed (256 entries)
const ULAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let u = ~i & 0xff;
  const sign     = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let value = (mantissa << 1) + 33;
  value <<= exponent;
  value -= 33;
  ULAW_DECODE_TABLE[i] = sign ? -value : value;
}

/**
 * Encode một mẫu PCM 16-bit signed → µ-law byte (0–255).
 * @param {number} sample  Int16, -32768..32767
 * @returns {number} µ-law byte 0–255
 */
export function pcm16ToUlaw(sample) {
  let s = sample;
  const sign = (s < 0) ? 0x80 : 0;
  if (s < 0) s = -s;
  if (s > CLIP) s = CLIP;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1) {}
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

/**
 * Decode µ-law byte → PCM 16-bit signed.
 * @param {number} ulaw  0–255
 * @returns {number} Int16
 */
export function ulawToPcm16(ulaw) {
  return ULAW_DECODE_TABLE[ulaw & 0xff];
}

/**
 * Encode buffer của Int16 PCM → Buffer µ-law.
 * @param {Buffer} pcmBuf  Little-endian Int16 samples
 * @returns {Buffer}
 */
export function encodePcmToUlaw(pcmBuf) {
  const samples = pcmBuf.length >> 1;
  const out = Buffer.allocUnsafe(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = pcm16ToUlaw(pcmBuf.readInt16LE(i * 2));
  }
  return out;
}

/**
 * Decode Buffer µ-law → Buffer Int16 PCM (little-endian).
 * @param {Buffer} ulawBuf
 * @returns {Buffer}
 */
export function decodeUlawToPcm(ulawBuf) {
  const out = Buffer.allocUnsafe(ulawBuf.length * 2);
  for (let i = 0; i < ulawBuf.length; i++) {
    out.writeInt16LE(ulawToPcm16(ulawBuf[i]), i * 2);
  }
  return out;
}

/**
 * Decode Buffer µ-law → Float32Array (normalized -1..1).
 * Dùng phía browser (playback qua WebAudio).
 * @param {Uint8Array} ulawBuf
 * @returns {Float32Array}
 */
export function ulawToFloat32(ulawBuf) {
  const f32 = new Float32Array(ulawBuf.length);
  for (let i = 0; i < ulawBuf.length; i++) {
    f32[i] = ULAW_DECODE_TABLE[ulawBuf[i]] / 32768;
  }
  return f32;
}
