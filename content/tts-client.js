const MIN_SPEED = 0.5;
const MAX_SPEED = 3.0;

export class TTSClient {
  constructor() {
    this._eventCallback = null;
    this._segmentChangeCallback = null;
    this._messageListener = (msg) => this._handleMessage(msg);
    chrome.runtime.onMessage.addListener(this._messageListener);
  }

  speak(segments) {
    this._send({ cmd: 'speak', segments });
  }

  pause() {
    this._send({ cmd: 'pause' });
  }

  resume() {
    this._send({ cmd: 'resume' });
  }

  stop() {
    this._send({ cmd: 'stop' });
  }

  setSpeed(rate) {
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
    this._send({ cmd: 'speed', rate: clamped });
  }

  skipForward() {
    this._send({ cmd: 'skipForward' });
  }

  skipBack() {
    this._send({ cmd: 'skipBack' });
  }

  onEvent(callback) {
    this._eventCallback = callback;
  }

  onSegmentChange(callback) {
    this._segmentChangeCallback = callback;
  }

  destroy() {
    chrome.runtime.onMessage.removeListener(this._messageListener);
    this._eventCallback = null;
    this._segmentChangeCallback = null;
  }

  _send(msg) {
    chrome.runtime.sendMessage(msg, () => {
      if (chrome.runtime.lastError) {
        console.error('Lazy Reader: message send failed', chrome.runtime.lastError.message);
      }
    });
  }

  _handleMessage(msg) {
    if (msg.event === 'segmentChange' && this._segmentChangeCallback) {
      this._segmentChangeCallback(msg.segmentIndex);
      return;
    }
    if (msg.event && this._eventCallback) {
      this._eventCallback(msg);
    }
  }
}
