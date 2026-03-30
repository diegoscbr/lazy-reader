const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export class Player {
  constructor() {
    this._host = null;
    this._shadow = null;
    this._callbacks = {
      playPause: null,
      close: null,
      skipForward: null,
      skipBack: null,
      speedChange: null,
    };
    this._state = { playing: false, speed: 1.0 };
  }

  create() {
    if (this._host) return;
    this._host = document.createElement('div');
    this._host.id = 'lazy-reader-player';
    this._shadow = this._host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this._getCSS();
    this._shadow.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'lazy-reader-bar';
    bar.innerHTML = `
      <button data-action="skipback" title="Skip back">⏮</button>
      <button data-action="playpause" title="Play/Pause">▶</button>
      <button data-action="skipforward" title="Skip forward">⏭</button>
      <div class="lazy-reader-divider"></div>
      <div class="lazy-reader-speed" data-action="speed" title="Click to change speed">1.0x</div>
      <div class="lazy-reader-divider"></div>
      <button data-action="close" title="Close">✕</button>
    `;

    bar.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      switch (action) {
        case 'playpause': this._callbacks.playPause?.(); break;
        case 'close': this._callbacks.close?.(); break;
        case 'skipforward': this._callbacks.skipForward?.(); break;
        case 'skipback': this._callbacks.skipBack?.(); break;
        case 'speed': this._cycleSpeed(); break;
      }
    });

    this._shadow.appendChild(bar);
    document.body.appendChild(this._host);
  }

  updateState(partial) {
    this._state = { ...this._state, ...partial };
    if (!this._shadow) return;
    const playBtn = this._shadow.querySelector('[data-action="playpause"]');
    if (playBtn) {
      playBtn.textContent = this._state.playing ? '⏸' : '▶';
    }
    const speedEl = this._shadow.querySelector('[data-action="speed"]');
    if (speedEl) {
      speedEl.textContent = `${this._state.speed.toFixed(1)}x`;
    }
  }

  destroy() {
    this._host?.remove();
    this._host = null;
    this._shadow = null;
  }

  onPlayPause(cb) { this._callbacks = { ...this._callbacks, playPause: cb }; }
  onClose(cb) { this._callbacks = { ...this._callbacks, close: cb }; }
  onSkipForward(cb) { this._callbacks = { ...this._callbacks, skipForward: cb }; }
  onSkipBack(cb) { this._callbacks = { ...this._callbacks, skipBack: cb }; }
  onSpeedChange(cb) { this._callbacks = { ...this._callbacks, speedChange: cb }; }

  _cycleSpeed() {
    const currentIndex = SPEED_OPTIONS.indexOf(this._state.speed);
    const nextIndex = (currentIndex + 1) % SPEED_OPTIONS.length;
    const newSpeed = SPEED_OPTIONS[nextIndex];
    this.updateState({ speed: newSpeed });
    this._callbacks.speedChange?.(newSpeed);
  }

  _getCSS() {
    return `
      :host {
        all: initial;
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 2147483647;
        font-family: monospace, sans-serif;
        font-size: 13px;
      }
      .lazy-reader-bar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        background: rgba(30, 30, 30, 0.92);
        color: #e0e0e0;
        border-radius: 8px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
        opacity: 0.6;
        transition: opacity 0.2s ease;
        user-select: none;
      }
      .lazy-reader-bar:hover { opacity: 1; }
      .lazy-reader-bar button {
        background: none;
        border: none;
        color: #e0e0e0;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
        line-height: 1;
      }
      .lazy-reader-bar button:hover { background: rgba(255, 255, 255, 0.1); }
      .lazy-reader-speed {
        padding: 4px 8px;
        min-width: 40px;
        text-align: center;
        cursor: pointer;
        border-radius: 4px;
      }
      .lazy-reader-speed:hover { background: rgba(255, 255, 255, 0.1); }
      .lazy-reader-divider {
        width: 1px;
        height: 16px;
        background: rgba(255, 255, 255, 0.2);
        margin: 0 2px;
      }
    `;
  }
}
