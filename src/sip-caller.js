import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { lookup as dnsLookup } from 'node:dns/promises';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      // Bỏ qua link-local (169.254.x.x) và loopback
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.'))
        return iface.address;
    }
  }
  // Fallback: bất kỳ IPv4 non-internal
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const rand = (n = 8) => randomBytes(n).toString('hex');

function extractTag(hdr) {
  const m = String(hdr ?? '').match(/;tag=([^\s;,]+)/);
  return m ? m[1] : '';
}

function parseResponses(buf) {
  // TCP có thể gộp nhiều message – tách theo SIP/2.0
  const text = buf.toString('utf8');
  const results = [];
  const parts = text.split(/(?=SIP\/2\.0\s+\d{3})/);
  for (const part of parts) {
    const m = part.match(/^SIP\/2\.0\s+(\d+)\s+(.*)/);
    if (!m) continue;
    const [head = ''] = part.split('\r\n\r\n');
    const lines = head.split('\r\n');
    const headers = {};
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i < 1) continue;
      headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    results.push({ status: parseInt(m[1]), reason: m[2].trim(), headers, raw: part });
  }
  return results;
}

// ─── SDP ─────────────────────────────────────────────────────────────────────

export function buildSdp(ip, rtpPort) {
  const ts = Math.floor(Date.now() / 1000);
  return [
    'v=0',
    `o=ZCC ${ts} ${ts} IN IP4 ${ip}`,
    's=Zalo Cloud Connect',
    `c=IN IP4 ${ip}`,
    't=0 0',
    `m=audio ${rtpPort} RTP/AVP 0 101`,
    'a=rtpmap:0 PCMU/8000',
    'a=rtpmap:101 telephone-event/8000',
    'a=fmtp:101 0-15',
    'a=sendrecv',
  ].join('\r\n');
}

export function parseRtpPayload(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 12) return null;
  const version = packet[0] >> 6;
  if (version !== 2) return null;

  const csrcCount = packet[0] & 0x0f;
  const hasExtension = (packet[0] & 0x10) !== 0;
  const hasPadding = (packet[0] & 0x20) !== 0;
  let offset = 12 + csrcCount * 4;
  if (offset > packet.length) return null;

  if (hasExtension) {
    if (offset + 4 > packet.length) return null;
    const extensionWords = packet.readUInt16BE(offset + 2);
    offset += 4 + extensionWords * 4;
    if (offset > packet.length) return null;
  }

  let end = packet.length;
  if (hasPadding) {
    const paddingLength = packet[packet.length - 1];
    if (paddingLength === 0 || paddingLength > packet.length - offset) return null;
    end -= paddingLength;
  }

  return {
    payloadType: packet[1] & 0x7f,
    sequence: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    payload: packet.subarray(offset, end),
  };
}

// ─── RTP Manager ─────────────────────────────────────────────────────────────

class RtpManager {
  constructor(log) {
    this._log = log;
    this._sock = dgram.createSocket('udp4');
    this._seq  = 0;
    this._ts   = 0;
    this._ssrc = Math.floor(Math.random() * 0xffffffff);
    this._silenceInterval = null;
    this._audioSink = null;  // callback(ulawBuffer) called on received RTP
    this.remoteIp   = null;
    this.remotePort = null;
  }

  async bind({ address = '0.0.0.0', minPort = 10000, maxPort = 10100 } = {}) {
    let lastError;
    for (let port = minPort; port <= maxPort; port += 2) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => reject(error);
          this._sock.once('error', onError);
          this._sock.bind(port, address, () => {
            this._sock.off('error', onError);
            resolve();
          });
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw new Error(`Không bind được cổng RTP ${minPort}-${maxPort}: ${lastError.message}`);

    this._sock.on('message', (pkt, rinfo) => {
      const rtp = parseRtpPayload(pkt);
      if (!rtp || rtp.payloadType !== 0) return;
      this._log(`[RTP] rx ${rtp.payload.length}B from ${rinfo.address}:${rinfo.port}`);

      this.remoteIp = rinfo.address;
      this.remotePort = rinfo.port;
      this._audioSink?.(rtp.payload);

    });
    this._sock.on('error', (e) => this._log(`[RTP err] ${e.message}`));
    return this._sock.address().port;
  }

  setAudioSink(fn) { this._audioSink = fn; }

  /** Gửi buffer µ-law 8kHz qua RTP */
  send(ulawBuf) {
    if (!this.remoteIp || !this.remotePort) return;
    const SAMPLES = ulawBuf.length;
    const pkt = Buffer.allocUnsafe(12 + SAMPLES);
    pkt[0] = 0x80; pkt[1] = 0x00; // V=2, PT=0 PCMU
    pkt.writeUInt16BE(this._seq & 0xffff, 2);
    pkt.writeUInt32BE(this._ts, 4);
    pkt.writeUInt32BE(this._ssrc, 8);
    ulawBuf.copy(pkt, 12);
    this._seq++; this._ts += SAMPLES;
    this._sock.send(pkt, 0, pkt.length, this.remotePort, this.remoteIp);
  }

  /** Bắt đầu gửi silence 20ms để giữ kết nối */
  startSilence() {
    if (this._silenceInterval) return;
    const silence = Buffer.alloc(160, 0xff);
    this._silenceInterval = setInterval(() => this.send(silence), 20);
  }

  stopSilence() {
    clearInterval(this._silenceInterval);
    this._silenceInterval = null;
  }

  close() {
    this.stopSilence();
    try { this._sock.close(); } catch {}
  }
}

// ─── SipCaller ───────────────────────────────────────────────────────────────

export class SipCaller extends EventEmitter {
  /**
   * @param {object}  opts
   * @param {string}  opts.fromUri        sip:OA_ID@domain
   * @param {string}  opts.domain         ZCC SIP domain
   * @param {number}  [opts.port=5060]
   * @param {string}  [opts.localIp]      IP local dùng cho SIP Via/Contact
   * @param {string}  [opts.advertisedIp] Public IP quảng bá trong SDP
   * @param {number}  [opts.rtpMinPort=10000]
   * @param {number}  [opts.rtpMaxPort=10100]
   * @param {string}  [opts.transport]    'tcp' (default) | 'udp'
   * @param {boolean} [opts.verbose=false]
   */
  constructor({
    fromUri,
    domain,
    port = 5060,
    localIp,
    advertisedIp,
    rtpBindIp = '0.0.0.0',
    rtpMinPort = 10000,
    rtpMaxPort = 10100,
    transport = 'tcp',
    verbose = false,
  }) {
    super();
    this.fromUri    = fromUri;
    this.domain     = domain;
    this.serverPort = port;
    this.localIp    = localIp ?? getLocalIp();
    this.advertisedIp = advertisedIp ?? this.localIp;
    this.rtpBindIp = rtpBindIp;
    this.rtpMinPort = Number(rtpMinPort);
    this.rtpMaxPort = Number(rtpMaxPort);
    this.transport  = transport.toUpperCase();
    this.verbose    = verbose;
    if (!Number.isInteger(this.rtpMinPort) || !Number.isInteger(this.rtpMaxPort)
      || this.rtpMinPort < 1024 || this.rtpMaxPort < this.rtpMinPort) {
      throw new TypeError('Dải cổng RTP không hợp lệ.');
    }
  }

  _log(...a) { if (this.verbose) console.error('[SIP]', ...a); }

  call(toUri, { ringTimeout = 60_000, callDuration = 30_000 } = {}) {
    const log = (...a) => this._log(...a);

    return new Promise((resolve, reject) => {
      const callId  = `${rand(6)}@${this.localIp}`;
      const fromTag = rand(4);
      const branch  = `z9hG4bK${rand(8)}`;
      const cseq    = 1;
      let   toTag   = '';
      let   state   = 'init';

      let transport = this.transport; // 'TCP' | 'UDP'
      let tcpSock, udpSock, serverIp, localPort, rtpPort;
      let ringTimer, durationTimer;
      let rtpMgr = null;
      let tcpBuf = '';

      // ── Message builders ──────────────────────────────────────────────────

      const via = (b = branch) =>
        `Via: SIP/2.0/${transport} ${this.localIp}:${localPort};branch=${b};rport`;

      const commonHdrs = (method, cseqNum = cseq) => {
        const toH = toTag ? `<${toUri}>;tag=${toTag}` : `<${toUri}>`;
        return [
          `From: <${this.fromUri}>;tag=${fromTag}`,
          `To: ${toH}`,
          `Call-ID: ${callId}`,
          `CSeq: ${cseqNum} ${method}`,
        ].join('\r\n');
      };

      const makeInvite = () => {
        const sdp = buildSdp(this.advertisedIp, rtpPort);
        return [
          `INVITE ${toUri} SIP/2.0`,
          via(),
          'Max-Forwards: 70',
          commonHdrs('INVITE'),
          `Contact: <sip:${this.localIp}:${localPort};transport=${transport.toLowerCase()}>`,
          'Allow: INVITE,ACK,BYE,CANCEL',
          'Content-Type: application/sdp',
          `Content-Length: ${Buffer.byteLength(sdp, 'utf8')}`,
          '',
          sdp,
        ].join('\r\n');
      };

      const makeAck = () => [
        `ACK ${toUri} SIP/2.0`,
        via(`z9hG4bK${rand(8)}`),
        'Max-Forwards: 70',
        commonHdrs('ACK'),
        'Content-Length: 0',
        '', '',
      ].join('\r\n');

      const makeBye = () => [
        `BYE ${toUri} SIP/2.0`,
        via(`z9hG4bK${rand(8)}`),
        'Max-Forwards: 70',
        commonHdrs('BYE', cseq + 1),
        'Content-Length: 0',
        '', '',
      ].join('\r\n');

      const makeCancel = () => [
        `CANCEL ${toUri} SIP/2.0`,
        via(),
        'Max-Forwards: 70',
        commonHdrs('CANCEL'),
        'Content-Length: 0',
        '', '',
      ].join('\r\n');

      // ── Transport ─────────────────────────────────────────────────────────

      const send = (msg, label = '') => {
        log(`\n>>> GỬI ${label || msg.split('\r\n')[0]}\n${msg}`);
        const buf = Buffer.from(msg, 'utf8');
        if (transport === 'TCP') {
          tcpSock?.write(buf);
        } else {
          udpSock?.send(buf, 0, buf.length, this.serverPort, serverIp, (e) => {
            if (e) log(`[UDP error] ${e.message}`);
          });
        }
      };

      // ── State ─────────────────────────────────────────────────────────────

      const cleanup = () => {
        clearTimeout(ringTimer);
        clearTimeout(durationTimer);
        rtpMgr?.close();
        try { tcpSock?.destroy(); } catch {}
        try { udpSock?.close(); } catch {}
      };

      const fail = (err) => {
        if (state === 'terminated') return;
        state = 'terminated';
        log(`[FAIL] ${err.message}`);
        cleanup();
        this.emit('failed', err);
        reject(err);
      };

      const end = (reason) => {
        if (state === 'terminated') return;
        state = 'terminated';
        log(`[END] ${reason}`);
        cleanup();
        this.emit('ended', { reason });
        resolve({ reason });
      };

      this._hangup = () => {
        if (state === 'connected') { send(makeBye(), 'BYE'); end('hangup'); }
        else if (state === 'calling' || state === 'ringing') { send(makeCancel(), 'CANCEL'); end('cancelled'); }
      };

      // ── Response handler ──────────────────────────────────────────────────

      const handleResponse = ({ status, reason, headers, raw }) => {
        log(`\n<<< NHẬN SIP ${status} ${reason}\n${raw}`);

        const tag = extractTag(headers['to']);
        if (tag) { log(`[TAG] to-tag=${tag}`); toTag = tag; }

        this.emit('sip', { status, reason });

        if (status === 100) {
          log('[100] Trying');
        } else if (status === 180 || status === 183) {
          log(`[${status}] Ringing/Progress`);
          if (state === 'calling') { state = 'ringing'; this.emit('ringing'); }
        } else if (status >= 200 && status < 300) {
          log(`[${status}] OK`);
          clearTimeout(ringTimer);

          let remoteRtpIp = serverIp, remoteRtpPort = 0;
          const mLine = raw.match(/^m=audio\s+(\d+)/m);
          const cLine = raw.match(/^c=IN IP4\s+(\S+)/m);
          if (mLine) remoteRtpPort = parseInt(mLine[1]);
          if (cLine) remoteRtpIp = cLine[1];
          const offeredPayloads = raw.match(/^m=audio\s+\d+\s+RTP\/AVP\s+(.+)$/m)?.[1]
            ?.trim().split(/\s+/) ?? [];
          if (!offeredPayloads.includes('0')) {
            fail(new Error('ZCC không chấp nhận codec PCMU (payload 0).'));
            return;
          }
          log(`[SDP] remoteRTP=${remoteRtpIp}:${remoteRtpPort}`);

          send(makeAck(), 'ACK');
          state = 'connected';

          // Configure RTP bidirectional
          rtpMgr.remoteIp   = remoteRtpIp;
          rtpMgr.remotePort = remoteRtpPort;
          if (remoteRtpPort > 0) {
            // Start silence so ZCC keeps the call alive
            // (will switch to real audio when browser sends mic data)
            rtpMgr.startSilence();
          } else {
            log('[WARN] Không tìm được remote RTP port trong SDP');
          }

          // Expose audio API on the caller instance
          this.sendAudio    = (ulawBuf) => rtpMgr.send(ulawBuf);
          this.setAudioSink = (fn)      => rtpMgr.setAudioSink(fn);
          this.stopSilence  = ()        => rtpMgr.stopSilence();

          this.emit('connected', { remoteRtpIp, remoteRtpPort });

          if (callDuration > 0) {
            log(`[TIMER] Auto-BYE sau ${callDuration}ms`);
            durationTimer = setTimeout(() => {
              send(makeBye(), 'BYE (auto)');
              end('duration');
            }, callDuration);
          }
        } else if (status >= 300) {
          fail(Object.assign(new Error(`SIP ${status}: ${reason}`), { statusCode: status }));
        }
      };

      const onData = (buf) => {
        if (transport === 'TCP') {
          tcpBuf += buf.toString('utf8');
          const responses = parseResponses(Buffer.from(tcpBuf));
          if (responses.length > 0) {
            for (const r of responses) handleResponse(r);
            // Giữ lại phần chưa parse xong (nếu có)
            tcpBuf = '';
          }
        } else {
          const responses = parseResponses(buf);
          for (const r of responses) handleResponse(r);
        }
      };

      // ── Boot ──────────────────────────────────────────────────────────────

      (async () => {
        try {
          log(`[INIT] from=${this.fromUri}`);
          log(`[INIT] to=${toUri}`);
          log(`[INIT] server=${this.domain}:${this.serverPort} transport=${transport}`);
          log(`[INIT] localIp=${this.localIp} advertisedIp=${this.advertisedIp}`);

          log(`[DNS] Resolve ${this.domain}...`);
          serverIp = (await dnsLookup(this.domain)).address;
          log(`[DNS] → ${serverIp}`);

          // Bind RTP socket via RtpManager
          rtpMgr = new RtpManager(log);
          rtpPort = await rtpMgr.bind({
            address: this.rtpBindIp,
            minPort: this.rtpMinPort,
            maxPort: this.rtpMaxPort,
          });
          log(`[BIND] RTP port=${rtpPort}`);

          if (transport === 'TCP') {
            // ── TCP ──────────────────────────────────────────────────────────
            tcpSock = new net.Socket();
            tcpSock.on('error', fail);
            tcpSock.on('data', onData);
            tcpSock.on('close', () => {
              log('[TCP] Connection closed by server');
              if (state !== 'terminated') end('server-closed');
            });

            await new Promise((res, rej) => {
              tcpSock.connect(this.serverPort, serverIp, () => {
                localPort = tcpSock.localPort;
                log(`[TCP] Connected ${tcpSock.localAddress}:${localPort} → ${serverIp}:${this.serverPort}`);
                res();
              });
              tcpSock.once('error', rej);
            });

          } else {
            // ── UDP ──────────────────────────────────────────────────────────
            udpSock = dgram.createSocket('udp4');
            udpSock.on('error', fail);
            udpSock.on('message', onData);
            await new Promise((res, rej) => udpSock.bind(0, (e) => e ? rej(e) : res()));
            localPort = udpSock.address().port;
            log(`[UDP] Bound port=${localPort}`);
          }

          state = 'calling';
          send(makeInvite(), 'INVITE');
          this.emit('calling', { toUri, transport });

          log(`[TIMER] Ring timeout=${ringTimeout}ms`);
          ringTimer = setTimeout(() => {
            if (state !== 'connected') {
              log(`[TIMEOUT] Không có SIP response sau ${ringTimeout}ms`);
              send(makeCancel(), 'CANCEL (timeout)');
              fail(new Error(`Không có trả lời sau ${ringTimeout / 1000}s`));
            }
          }, ringTimeout);

        } catch (err) {
          fail(err);
        }
      })();
    });
  }

  hangup() { this._hangup?.(); }
}
