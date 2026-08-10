import { SimpleUser } from '/vendor/sip.js/platform/web/index.js';

const STORAGE_KEY = 'simlydent-softphone-settings';
const DEFAULT_SETTINGS = { extension: '', password: '', rememberPassword: true };
let phone;
let callActive = false;
let callTimerInterval = null;
let callStartTime = null;

// Audio FX synthesizer (zero external dependencies)
class SoftphoneAudioFX {
  constructor() {
    this.ctx = null;
    this.ringInterval = null;
  }
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }
  playTone(freq = 440, duration = 120) {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration / 1000);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration / 1000);
    } catch {}
  }
  startRingtone() {
    this.stopRingtone();
    try {
      this.init();
      if (!this.ctx) return;
      const playChime = () => {
        try {
          const now = this.ctx.currentTime;
          const osc1 = this.ctx.createOscillator();
          const osc2 = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc1.frequency.setValueAtTime(523.25, now); // C5
          osc2.frequency.setValueAtTime(659.25, now); // E5
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(this.ctx.destination);
          osc1.start(now);
          osc2.start(now);
          osc1.stop(now + 1.4);
          osc2.stop(now + 1.4);
        } catch {}
      };
      playChime();
      this.ringInterval = setInterval(playChime, 2400);
    } catch {}
  }
  stopRingtone() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }
}

const audioFX = new SoftphoneAudioFX();

export function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(values) {
  const next = { ...readSettings(), ...values };
  if (!next.rememberPassword) next.password = '';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function mount() {
  if (document.getElementById('zcc-float')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <aside id="zcc-float" class="zcc-float" aria-label="SimlyDent ZCC Softphone">
      <!-- Floating Trigger Pill Button -->
      <button id="zcc-float-toggle" class="zcc-float-toggle" type="button" aria-expanded="false">
        <span class="zcc-toggle-glow"></span>
        <span id="zcc-toggle-dot" class="zcc-toggle-dot"></span>
        <span class="zcc-toggle-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </span>
        <span id="zcc-toggle-text" class="zcc-toggle-text">Zalo Softphone</span>
        <span id="zcc-toggle-timer" class="zcc-toggle-timer" hidden>00:00</span>
      </button>

      <!-- Glassmorphic Floating Window Panel -->
      <section id="zcc-float-panel" class="zcc-float-panel" hidden>
        <!-- Panel Header -->
        <header class="zcc-panel-header">
          <div class="zcc-brand-group">
            <div class="zcc-brand-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </div>
            <div class="zcc-brand-info">
              <strong class="zcc-brand-title">SimlyDent Call</strong>
              <small id="zcc-status" class="zcc-status-pill">Chưa kết nối</small>
            </div>
          </div>
          <div class="zcc-header-actions">
            <button id="zcc-dialpad-toggle" type="button" class="zcc-icon-btn" title="Bàn phím quay số">🔢</button>
            <a href="/softphone" class="zcc-icon-btn" title="Thiết lập máy nhánh">⚙</a>
            <button id="zcc-panel-close" type="button" class="zcc-icon-btn zcc-close-btn" title="Thu nhỏ">✕</button>
          </div>
        </header>

        <!-- Call Visualizer Status Card -->
        <div id="zcc-call-card" class="zcc-call-card state-idle">
          <div class="zcc-ripple-container">
            <div class="zcc-ripple-ring ring-1"></div>
            <div class="zcc-ripple-ring ring-2"></div>
          </div>
          <div class="zcc-avatar-wrap">
            <div id="zcc-avatar" class="zcc-avatar">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
          </div>
          <div class="zcc-callee-info">
            <div id="zcc-display-name" class="zcc-display-name">Sẵn sàng gọi điện</div>
            <div id="zcc-live-timer" class="zcc-live-timer" hidden>00:00</div>
          </div>
          <div id="zcc-audio-wave" class="zcc-audio-wave" hidden>
            <span class="w-bar"></span>
            <span class="w-bar"></span>
            <span class="w-bar"></span>
            <span class="w-bar"></span>
            <span class="w-bar"></span>
          </div>
        </div>

        <!-- Form Inputs Body -->
        <div id="zcc-form-body" class="zcc-form-body">
          <div class="zcc-field">
            <label for="zcc-target-type">Loại đích gọi</label>
            <select id="zcc-target-type">
              <option value="phone">Số điện thoại (Zalo Telephony)</option>
              <option value="user_id">Zalo User ID</option>
            </select>
          </div>

          <div class="zcc-field">
            <label for="zcc-callee">Số điện thoại / Zalo ID</label>
            <div class="zcc-input-wrap">
              <input id="zcc-callee" inputmode="numeric" placeholder="0372626121 hoặc +84372626121">
              <button id="zcc-clear-callee" type="button" class="zcc-clear-btn" title="Xóa">✕</button>
            </div>
          </div>

          <div id="zcc-consent-actions" class="zcc-consent-actions">
            <button id="zcc-check-consent" type="button" class="zcc-btn zcc-btn-ghost">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              Kiểm tra quyền
            </button>
            <button id="zcc-request-consent" type="button" class="zcc-btn zcc-btn-ghost">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              Xin quyền gọi
            </button>
          </div>
        </div>

        <!-- Dialpad Grid -->
        <div id="zcc-dialpad" class="zcc-dialpad" hidden>
          <div class="zcc-dialpad-grid">
            <button type="button" class="zcc-dial-btn" data-key="1">1</button>
            <button type="button" class="zcc-dial-btn" data-key="2">2<span>ABC</span></button>
            <button type="button" class="zcc-dial-btn" data-key="3">3<span>DEF</span></button>
            <button type="button" class="zcc-dial-btn" data-key="4">4<span>GHI</span></button>
            <button type="button" class="zcc-dial-btn" data-key="5">5<span>JKL</span></button>
            <button type="button" class="zcc-dial-btn" data-key="6">6<span>MNO</span></button>
            <button type="button" class="zcc-dial-btn" data-key="7">7<span>PQRS</span></button>
            <button type="button" class="zcc-dial-btn" data-key="8">8<span>TUV</span></button>
            <button type="button" class="zcc-dial-btn" data-key="9">9<span>WXYZ</span></button>
            <button type="button" class="zcc-dial-btn" data-key="*">*</button>
            <button type="button" class="zcc-dial-btn" data-key="0">0<span>+</span></button>
            <button type="button" class="zcc-dial-btn" data-key="#">#</button>
          </div>
        </div>

        <!-- Action Controls -->
        <div class="zcc-controls-group">
          <div class="zcc-float-actions">
            <button id="zcc-call" type="button" class="zcc-btn zcc-btn-primary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              <span>Gọi Zalo</span>
            </button>
            <button id="zcc-answer" type="button" class="zcc-btn zcc-btn-success" hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              Nghe
            </button>
            <button id="zcc-decline" type="button" class="zcc-btn zcc-btn-danger" hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"></path>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
              Từ chối
            </button>
          </div>

          <div id="zcc-incall-actions" class="zcc-float-actions zcc-incall-actions">
            <button id="zcc-mute" type="button" class="zcc-btn zcc-btn-secondary" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
              <span class="zcc-mute-text">Tắt mic</span>
            </button>
            <button id="zcc-hold" type="button" class="zcc-btn zcc-btn-secondary" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
              <span class="zcc-hold-text">Giữ máy</span>
            </button>
          </div>
        </div>

        <p id="zcc-message" class="zcc-message" aria-live="polite"></p>
        <audio id="zcc-remote-audio" autoplay playsinline></audio>
      </section>
    </aside>
  `);

  document.head.insertAdjacentHTML('beforeend', `<style>
    .zcc-float {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 9999;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      color: #f8fafc;
      box-sizing: border-box;
    }

    /* Floating Pill Button */
    .zcc-float-toggle {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      padding: 12px 20px;
      background: linear-gradient(135deg, #0068ff 0%, #0046b8 100%);
      color: #ffffff;
      font-size: 13.5px;
      font-weight: 700;
      box-shadow: 0 10px 30px rgba(0, 104, 255, 0.4), 0 2px 10px rgba(0, 0, 0, 0.3);
      cursor: pointer;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      user-select: none;
    }
    .zcc-float-toggle:hover {
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 14px 36px rgba(0, 104, 255, 0.5), 0 4px 14px rgba(0, 0, 0, 0.4);
    }
    .zcc-float-toggle:active {
      transform: translateY(1px) scale(0.98);
    }
    .zcc-toggle-glow {
      position: absolute;
      inset: -50%;
      background: radial-gradient(circle, rgba(255,255,255,0.25) 0%, transparent 60%);
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }
    .zcc-float-toggle:hover .zcc-toggle-glow {
      opacity: 1;
    }

    .zcc-toggle-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #94a3b8;
      box-shadow: 0 0 8px rgba(148, 163, 184, 0.5);
      transition: all 0.3s;
      flex-shrink: 0;
    }
    .zcc-toggle-dot.registered {
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
      animation: zcc-pulse 2s infinite;
    }
    .zcc-toggle-dot.calling {
      background: #f59e0b;
      box-shadow: 0 0 10px #f59e0b;
      animation: zcc-pulse 0.8s infinite alternate;
    }
    .zcc-toggle-dot.ringing {
      background: #ec4899;
      box-shadow: 0 0 14px #ec4899;
      animation: zcc-pulse 0.4s infinite alternate;
    }
    .zcc-toggle-dot.active {
      background: #10b981;
      box-shadow: 0 0 12px #10b981;
    }
    .zcc-toggle-dot.error {
      background: #f43f5e;
      box-shadow: 0 0 10px #f43f5e;
    }

    .zcc-toggle-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .zcc-toggle-timer {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.5px;
      background: rgba(0, 0, 0, 0.25);
      padding: 2px 8px;
      border-radius: 99px;
      color: #6ee7b7;
    }

    /* Glassmorphic Panel Container */
    .zcc-float-panel {
      width: 340px;
      margin-bottom: 14px;
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 22px;
      background: linear-gradient(150deg, rgba(13, 22, 41, 0.94) 0%, rgba(8, 14, 28, 0.96) 100%);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(0, 104, 255, 0.15);
      animation: zcc-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .zcc-float-panel[hidden] {
      display: none !important;
    }

    @keyframes zcc-slide-up {
      from { opacity: 0; transform: translateY(16px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* Panel Header */
    .zcc-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .zcc-brand-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .zcc-brand-icon {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: linear-gradient(135deg, #0068ff, #0042a5);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0, 104, 255, 0.3);
    }
    .zcc-brand-info {
      display: flex;
      flex-direction: column;
    }
    .zcc-brand-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.2;
    }
    .zcc-status-pill {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 500;
    }

    .zcc-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .zcc-icon-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      color: #94a3b8;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
    }
    .zcc-icon-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.2);
    }
    .zcc-close-btn:hover {
      background: rgba(244, 63, 94, 0.2);
      color: #f43f5e;
      border-color: rgba(244, 63, 94, 0.4);
    }

    /* Call Visualizer Card */
    .zcc-call-card {
      position: relative;
      background: rgba(15, 25, 45, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      overflow: hidden;
      transition: all 0.3s;
    }

    /* Ripple concentric rings for calling & ringing */
    .zcc-ripple-container {
      position: absolute;
      width: 90px;
      height: 90px;
      top: 14px;
      pointer-events: none;
    }
    .zcc-ripple-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid #0068ff;
      opacity: 0;
    }
    .state-calling .zcc-ripple-ring.ring-1 {
      animation: zcc-ring-ripple 1.8s infinite cubic-bezier(0, 0.2, 0.8, 1);
    }
    .state-calling .zcc-ripple-ring.ring-2 {
      animation: zcc-ring-ripple 1.8s infinite cubic-bezier(0, 0.2, 0.8, 1);
      animation-delay: 0.6s;
    }
    .state-ringing .zcc-ripple-ring {
      border-color: #ec4899;
    }
    .state-ringing .zcc-ripple-ring.ring-1 {
      animation: zcc-ring-ripple 1.2s infinite cubic-bezier(0, 0.2, 0.8, 1);
    }
    .state-ringing .zcc-ripple-ring.ring-2 {
      animation: zcc-ring-ripple 1.2s infinite cubic-bezier(0, 0.2, 0.8, 1);
      animation-delay: 0.4s;
    }

    @keyframes zcc-ring-ripple {
      0% { transform: scale(0.85); opacity: 0.8; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    /* Avatar styling */
    .zcc-avatar-wrap {
      position: relative;
      z-index: 2;
      margin-bottom: 10px;
    }
    .zcc-avatar {
      width: 54px;
      height: 54px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1e293b, #0f172a);
      border: 2px solid rgba(255, 255, 255, 0.15);
      color: #38bdf8;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
      transition: all 0.3s;
    }
    .state-calling .zcc-avatar {
      border-color: #0068ff;
      color: #60a5fa;
      box-shadow: 0 0 20px rgba(0, 104, 255, 0.4);
    }
    .state-ringing .zcc-avatar {
      border-color: #ec4899;
      color: #f472b6;
      box-shadow: 0 0 24px rgba(236, 72, 153, 0.5);
      animation: zcc-shake-btn 0.6s infinite alternate ease-in-out;
    }
    .state-active .zcc-avatar {
      border-color: #10b981;
      color: #34d399;
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
    }

    @keyframes zcc-shake-btn {
      0% { transform: rotate(-5deg) scale(1.04); }
      100% { transform: rotate(5deg) scale(1.04); }
    }

    .zcc-callee-info {
      z-index: 2;
    }
    .zcc-display-name {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      font-family: 'JetBrains Mono', monospace;
      letter-spacing: -0.2px;
      word-break: break-all;
    }
    .zcc-live-timer {
      font-family: 'JetBrains Mono', monospace;
      font-size: 20px;
      font-weight: 700;
      color: #34d399;
      letter-spacing: 1px;
      margin-top: 4px;
      text-shadow: 0 0 12px rgba(52, 211, 153, 0.3);
    }

    /* Audio Equalizer Wave Animation */
    .zcc-audio-wave {
      display: flex;
      align-items: center;
      gap: 3px;
      height: 18px;
      margin-top: 8px;
      z-index: 2;
    }
    .zcc-audio-wave .w-bar {
      width: 3px;
      height: 100%;
      background: #10b981;
      border-radius: 3px;
      animation: zcc-wave-bounce 1.2s infinite ease-in-out alternate;
    }
    .zcc-audio-wave .w-bar:nth-child(1) { animation-delay: 0.1s; height: 30%; }
    .zcc-audio-wave .w-bar:nth-child(2) { animation-delay: 0.3s; height: 75%; }
    .zcc-audio-wave .w-bar:nth-child(3) { animation-delay: 0.2s; height: 100%; }
    .zcc-audio-wave .w-bar:nth-child(4) { animation-delay: 0.4s; height: 50%; }
    .zcc-audio-wave .w-bar:nth-child(5) { animation-delay: 0.15s; height: 85%; }

    @keyframes zcc-wave-bounce {
      0% { transform: scaleY(0.25); }
      100% { transform: scaleY(1); }
    }

    /* Form Fields */
    .zcc-form-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 12px;
    }
    .zcc-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .zcc-field label {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .zcc-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .zcc-field input, .zcc-field select {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 9px 12px;
      background: #060d1a;
      color: #f8fafc;
      font-family: inherit;
      font-size: 13px;
      outline: none;
      transition: all 0.2s;
    }
    .zcc-field input:focus, .zcc-field select:focus {
      border-color: #0068ff;
      background: #091326;
      box-shadow: 0 0 0 3px rgba(0, 104, 255, 0.25);
    }
    .zcc-field select {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      padding-right: 32px;
    }
    .zcc-clear-btn {
      position: absolute;
      right: 8px;
      background: transparent;
      border: none;
      color: #64748b;
      font-size: 12px;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
    }
    .zcc-clear-btn:hover {
      color: #f8fafc;
    }

    /* Consent Action Chips */
    .zcc-consent-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .zcc-btn-ghost {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
      font-size: 11.5px;
      padding: 7px 10px;
    }
    .zcc-btn-ghost:hover {
      background: rgba(0, 104, 255, 0.15);
      border-color: rgba(0, 104, 255, 0.3);
      color: #60a5fa;
    }

    /* Dialpad Grid */
    .zcc-dialpad {
      margin-bottom: 12px;
    }
    .zcc-dialpad-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }
    .zcc-dial-btn {
      height: 38px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      color: #ffffff;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      line-height: 1;
      transition: all 0.15s;
    }
    .zcc-dial-btn span {
      font-size: 8px;
      font-weight: 400;
      color: #64748b;
      margin-top: 1px;
    }
    .zcc-dial-btn:hover {
      background: rgba(0, 104, 255, 0.2);
      border-color: #0068ff;
    }
    .zcc-dial-btn:active {
      transform: scale(0.94);
      background: #0068ff;
    }

    /* Control Buttons */
    .zcc-controls-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .zcc-float-actions {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }
    .zcc-incall-actions {
      grid-template-columns: 1fr 1fr;
    }

    .zcc-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 40px;
      border: none;
      border-radius: 12px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
      user-select: none;
    }
    .zcc-btn:active {
      transform: scale(0.97);
    }
    .zcc-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none !important;
    }

    .zcc-btn-primary {
      background: linear-gradient(135deg, #0068ff, #0046b8);
      color: #ffffff;
      box-shadow: 0 4px 16px rgba(0, 104, 255, 0.35);
    }
    .zcc-btn-primary:hover {
      background: linear-gradient(135deg, #1b75ff, #0052cc);
      box-shadow: 0 6px 20px rgba(0, 104, 255, 0.45);
    }

    .zcc-btn-success {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #ffffff;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);
      animation: zcc-pulse 1s infinite alternate;
    }
    .zcc-btn-success:hover {
      background: linear-gradient(135deg, #34d399, #10b981);
    }

    .zcc-btn-danger {
      background: linear-gradient(135deg, #f43f5e, #be123c);
      color: #ffffff;
      box-shadow: 0 4px 16px rgba(244, 63, 94, 0.35);
    }
    .zcc-btn-danger:hover {
      background: linear-gradient(135deg, #fb7185, #e11d48);
    }

    .zcc-btn-secondary {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #cbd5e1;
    }
    .zcc-btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
    }
    .zcc-btn-secondary.is-active {
      background: rgba(0, 104, 255, 0.25);
      border-color: #0068ff;
      color: #60a5fa;
    }

    .zcc-message {
      min-height: 18px;
      margin: 10px 0 0;
      font-size: 11.5px;
      color: #93c5fd;
      text-align: center;
      word-break: break-word;
    }

    @keyframes zcc-pulse {
      0% { opacity: 0.7; transform: scale(0.98); }
      100% { opacity: 1; transform: scale(1.02); }
    }

    @media (max-width: 520px) {
      .zcc-float { right: 14px; bottom: 14px; }
      .zcc-float-panel { width: min(340px, calc(100vw - 28px)); }
    }
  </style>`);
}

function ui() {
  return Object.fromEntries([
    'float', 'float-toggle', 'toggle-dot', 'toggle-text', 'toggle-timer',
    'float-panel', 'panel-close', 'dialpad-toggle', 'status',
    'call-card', 'avatar', 'display-name', 'live-timer', 'audio-wave',
    'form-body', 'target-type', 'callee', 'clear-callee',
    'consent-actions', 'check-consent', 'request-consent',
    'dialpad', 'call', 'answer', 'decline', 'mute', 'hold', 'incall-actions',
    'message', 'remote-audio'
  ].map((name) => [
    name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
    document.getElementById(`zcc-${name}`)
  ]));
}

function startTimer() {
  stopTimer();
  callStartTime = Date.now();
  const u = ui();
  u.liveTimer.hidden = false;
  u.toggleTimer.hidden = false;

  const update = () => {
    const elapsedSec = Math.floor((Date.now() - callStartTime) / 1000);
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    const timeStr = `${mins}:${secs}`;
    u.liveTimer.textContent = timeStr;
    u.toggleTimer.textContent = timeStr;
  };
  update();
  callTimerInterval = setInterval(update, 1000);
}

function stopTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  const u = ui();
  u.liveTimer.hidden = true;
  u.toggleTimer.hidden = true;
  u.liveTimer.textContent = '00:00';
  u.toggleTimer.textContent = '00:00';
}

function setCardState(state) {
  const u = ui();
  u.callCard.className = `zcc-call-card state-${state}`;
  u.audioWave.hidden = state !== 'active';
  
  if (state === 'idle') {
    u.displayName.textContent = 'Sẵn sàng gọi điện';
    u.toggleDot.className = 'zcc-toggle-dot registered';
    u.toggleText.textContent = 'Zalo Softphone';
    u.call.hidden = false;
    u.call.className = 'zcc-btn zcc-btn-primary';
    u.call.querySelector('span').textContent = 'Gọi Zalo';
    u.answer.hidden = true;
    u.decline.hidden = true;
    u.mute.disabled = true;
    u.hold.disabled = true;
    u.mute.classList.remove('is-active');
    u.hold.classList.remove('is-active');
    u.formBody.hidden = false;
    stopTimer();
    audioFX.stopRingtone();
  } else if (state === 'calling') {
    u.displayName.textContent = u.callee.value.trim() || 'Đang kết nối...';
    u.toggleDot.className = 'zcc-toggle-dot calling';
    u.toggleText.textContent = 'Đang gọi...';
    u.call.hidden = false;
    u.call.className = 'zcc-btn zcc-btn-danger';
    u.call.querySelector('span').textContent = 'Hủy cuộc gọi';
    u.answer.hidden = true;
    u.decline.hidden = true;
    u.formBody.hidden = true;
  } else if (state === 'ringing') {
    u.displayName.textContent = 'Cuộc gọi đến...';
    u.toggleDot.className = 'zcc-toggle-dot ringing';
    u.toggleText.textContent = '🔔 Cuộc gọi đến';
    u.call.hidden = true;
    u.answer.hidden = false;
    u.decline.hidden = false;
    u.formBody.hidden = true;
    audioFX.startRingtone();
    // Auto unhide panel when incoming call arrives
    u.floatPanel.hidden = false;
    u.floatToggle.setAttribute('aria-expanded', 'true');
  } else if (state === 'active') {
    u.displayName.textContent = u.callee.value.trim() || 'Đang đàm thoại';
    u.toggleDot.className = 'zcc-toggle-dot active';
    u.toggleText.textContent = '🟢 Đang đàm thoại';
    u.call.hidden = false;
    u.call.className = 'zcc-btn zcc-btn-danger';
    u.call.querySelector('span').textContent = 'Kết thúc';
    u.answer.hidden = true;
    u.decline.hidden = true;
    u.mute.disabled = false;
    u.hold.disabled = false;
    u.formBody.hidden = true;
    audioFX.stopRingtone();
    startTimer();
  }
}

function status(text, error = false) {
  const u = ui();
  u.status.textContent = text;
  u.message.textContent = error ? text : '';
  if (error) {
    u.toggleDot.className = 'zcc-toggle-dot error';
    u.toggleText.textContent = '⚠️ Lỗi kết nối';
  }
}

function sipUri(user, domain) {
  return `sip:${String(user).trim().replace(/^sip:/, '')}@${domain}`;
}

function runtimeFor(extension = readSettings().extension) {
  return fetch(`/api/config?extension=${encodeURIComponent(extension)}`).then((response) => response.json());
}

function zccPhoneTarget(value) {
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  const target = compact.startsWith('0') ? `+84${compact.slice(1)}` : compact.startsWith('84') ? `+${compact}` : compact;
  if (!/^\+84\d{8,10}$/.test(target)) throw new Error('Số điện thoại ZCC phải có dạng +84xxxxxxxxx.');
  return target;
}

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.error !== 0) throw new Error(data.message || data.error || 'Yêu cầu Zalo không thành công.');
  return data;
}

async function attachAudio() {
  for (let index = 0; index < 20; index += 1) {
    if (phone?.remoteMediaStream) {
      ui().remoteAudio.srcObject = phone.remoteMediaStream;
      await ui().remoteAudio.play().catch(() => {});
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function connect() {
  const saved = readSettings();
  const runtime = await runtimeFor(saved.extension);
  if (!saved.extension || !saved.password || !runtime.pbx?.wssUrl || !runtime.pbx?.sipDomain) {
    status('Vào ⚙ để thiết lập extension', true);
    return;
  }
  if (phone?.isConnected()) return;
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (runtime.webrtc?.turn?.urls) iceServers.push(runtime.webrtc.turn);

  phone = new SimpleUser(runtime.pbx.wssUrl, {
    aor: sipUri(saved.extension, runtime.pbx.sipDomain),
    media: { constraints: { audio: true, video: false }, remote: { audio: ui().remoteAudio } },
    reconnectionAttempts: 5,
    reconnectionDelay: 4,
    userAgentOptions: {
      authorizationUsername: saved.extension,
      authorizationPassword: saved.password,
      displayName: saved.extension,
      logBuiltinEnabled: false,
      sessionDescriptionHandlerFactoryOptions: {
        iceGatheringTimeout: 10000,
        peerConnectionConfiguration: { bundlePolicy: 'balanced', rtcpMuxPolicy: 'require', iceServers }
      }
    },
    delegate: {
      onServerConnect: () => status('Đang đăng ký…'),
      onRegistered: () => {
        status(`Sẵn sàng · ${saved.extension}`);
        setCardState('idle');
      },
      onServerDisconnect: () => status('Mất kết nối tổng đài', true),
      onCallCreated: () => {
        callActive = true;
        setCardState('calling');
        status('Đang gọi…');
      },
      onCallReceived: () => {
        callActive = true;
        setCardState('ringing');
        status('Cuộc gọi đến');
      },
      onCallAnswered: () => {
        setCardState('active');
        status('Đang đàm thoại');
        void attachAudio();
      },
      onCallHangup: () => {
        callActive = false;
        setCardState('idle');
        status(`Sẵn sàng · ${saved.extension}`);
      }
    }
  });

  await phone.connect();
  await phone.register();
}

mount();
const u = ui();

u.floatToggle.onclick = () => {
  audioFX.init();
  u.floatPanel.hidden = !u.floatPanel.hidden;
  u.floatToggle.setAttribute('aria-expanded', String(!u.floatPanel.hidden));
};

u.panelClose.onclick = () => {
  u.floatPanel.hidden = true;
  u.floatToggle.setAttribute('aria-expanded', 'false');
};

u.dialpadToggle.onclick = () => {
  u.dialpad.hidden = !u.dialpad.hidden;
};

if (u.clearCallee) {
  u.clearCallee.onclick = () => {
    u.callee.value = '';
    u.callee.focus();
  };
}

// Dialpad key handlers
document.querySelectorAll('.zcc-dial-btn').forEach((btn) => {
  btn.onclick = () => {
    const key = btn.dataset.key;
    audioFX.playTone(600 + key.charCodeAt(0) * 10, 100);
    if (!callActive) {
      u.callee.value += key;
    } else if (phone?.session) {
      try {
        if (typeof phone.session.dtmf === 'function') phone.session.dtmf(key);
        else if (typeof phone.sendDTMF === 'function') phone.sendDTMF(key);
      } catch {}
    }
  };
});

u.targetType.onchange = () => {
  const isPhone = u.targetType.value === 'phone';
  u.consentActions.hidden = !isPhone;
  u.callee.placeholder = isPhone ? '0372626121 hoặc +84372626121' : 'Zalo User ID';
};

u.call.onclick = async () => {
  try {
    audioFX.init();
    if (callActive) return phone?.hangup();
    if (!phone?.isConnected()) throw new Error('Tổng đài chưa sẵn sàng.');
    const runtime = await runtimeFor();
    const accountId = runtime.assignedAccountId;
    if (!accountId) throw new Error('Extension chưa được gán Zalo OA.');
    const targetType = u.targetType.value;
    const callee = targetType === 'phone' ? zccPhoneTarget(u.callee.value) : u.callee.value.trim();
    if (!callee) throw new Error('Nhập Zalo User ID hoặc số điện thoại.');
    if (targetType === 'phone') await post('/api/check-consent', { phone: callee, accountId });
    await phone.call(sipUri(callee, runtime.pbx.sipDomain), {
      extraHeaders: [`X-ZCC-Target-Type: ${targetType}`, `X-ZCC-Account-ID: ${accountId}`]
    });
  } catch (error) {
    status(error.message, true);
  }
};

u.checkConsent.onclick = async () => {
  try {
    const runtime = await runtimeFor();
    await post('/api/check-consent', { phone: zccPhoneTarget(u.callee.value), accountId: runtime.assignedAccountId });
    status('Khách hàng đã cấp quyền gọi');
  } catch (error) {
    status(error.message, true);
  }
};

u.requestConsent.onclick = async () => {
  try {
    const runtime = await runtimeFor();
    await post('/api/request-consent', { phone: zccPhoneTarget(u.callee.value), accountId: runtime.assignedAccountId, callType: 'audio', reasonCode: 101 });
    status('Đã gửi yêu cầu gọi điện');
  } catch (error) {
    status(error.message, true);
  }
};

u.answer.onclick = () => {
  audioFX.stopRingtone();
  phone?.answer().catch((error) => status(error.message, true));
};

u.decline.onclick = () => {
  audioFX.stopRingtone();
  phone?.decline();
};

u.mute.onclick = () => {
  if (phone?.isMuted()) {
    phone.unmute();
    u.mute.classList.remove('is-active');
    u.mute.querySelector('.zcc-mute-text').textContent = 'Tắt mic';
  } else {
    phone?.mute();
    u.mute.classList.add('is-active');
    u.mute.querySelector('.zcc-mute-text').textContent = 'Bật mic';
  }
};

u.hold.onclick = () => {
  if (phone?.isHeld()) {
    phone.unhold();
    u.hold.classList.remove('is-active');
    u.hold.querySelector('.zcc-hold-text').textContent = 'Giữ máy';
  } else {
    phone?.hold();
    u.hold.classList.add('is-active');
    u.hold.querySelector('.zcc-hold-text').textContent = 'Bỏ giữ';
  }
};

window.addEventListener('simlydent-softphone-settings', () => {
  phone?.disconnect().catch(() => {});
  phone = null;
  void connect();
});

void connect();

