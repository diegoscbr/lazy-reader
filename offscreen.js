// offscreen.js — AudioContext playback for cloud TTS audio

let wordTimingTimer = null;

export class OffscreenPlayer {
  constructor() {
    this.ctx = null;
    this.audioBuffer = null;
    this.source = null;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.paused = false;
    this._rate = 1.0;
    this._stoppingIntentionally = false;
  }

  async loadAudio(base64) {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }

    const bytes = base64ToUint8Array(base64);
    this.audioBuffer = await this.ctx.decodeAudioData(bytes.buffer.slice(0));
  }

  play(offset = 0) {
    if (!this.audioBuffer || !this.ctx) return;

    this._stopSource();

    const source = this.ctx.createBufferSource();
    source.buffer = this.audioBuffer;
    source.playbackRate.value = this._rate;
    source.connect(this.ctx.destination);
    source.start(0, offset);

    this.source = source;
    this.startTime = this.ctx.currentTime - (offset / this._rate);
    this.pauseOffset = 0;
    this.paused = false;
    this._stoppingIntentionally = false;

    source.onended = () => {
      if (this.source === source && !this._stoppingIntentionally) {
        clearWordTimingLoop();
        this._sendEvent({ event: 'audioEnd' });
      }
    };
  }

  pause() {
    if (!this.source || this.paused) return;
    this.pauseOffset = this.getCurrentTime();
    this._stopSource();
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.play(this.pauseOffset);
  }

  stop() {
    this._stopSource();
    clearWordTimingLoop();
    this.source = null;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.paused = false;
  }

  setPlaybackRate(rate) {
    this._rate = rate;

    if (this.source && !this.paused) {
      const currentPos = this.getCurrentTime();
      this.source.playbackRate.value = rate;
      this.startTime = this.ctx.currentTime - (currentPos / this._rate);
    }
  }

  getCurrentTime() {
    if (this.paused) return this.pauseOffset;
    if (!this.ctx || !this.source) return 0;
    return (this.ctx.currentTime - this.startTime) * this._rate;
  }

  _stopSource() {
    if (!this.source) return;
    this._stoppingIntentionally = true;
    try {
      this.source.stop();
    } catch (_) {
      // Ignore stop errors from already-ended sources.
    }
    this.source = null;
  }

  _sendEvent(msg) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(msg).catch(() => {});
    }
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  const player = new OffscreenPlayer();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      switch (msg.cmd) {
        case 'loadAndPlay':
          await player.loadAudio(msg.audioBase64);
          if (typeof msg.rate === 'number') {
            player.setPlaybackRate(msg.rate);
          }
          player.play();
          startWordTimingLoop(player, msg.words);
          sendResponse({ ok: true });
          break;
        case 'pauseAudio':
          player.pause();
          sendResponse({ ok: true });
          break;
        case 'resumeAudio':
          player.resume();
          sendResponse({ ok: true });
          break;
        case 'stopAudio':
          player.stop();
          clearWordTimingLoop();
          sendResponse({ ok: true });
          break;
        case 'setPlaybackRate':
          player.setPlaybackRate(msg.rate);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false });
      }
    })().catch((err) => {
      console.error('Lazy Reader: offscreen message handling failed', err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    });
    return true;
  });
}

function startWordTimingLoop(player, words) {
  clearWordTimingLoop();

  if (!words?.length) return;

  let lastWordIndex = -1;
  wordTimingTimer = setInterval(() => {
    if (player.paused) return;

    const currentTime = player.getCurrentTime();
    for (let i = words.length - 1; i >= 0; i--) {
      if (currentTime >= words[i].start && i !== lastWordIndex) {
        lastWordIndex = i;
        player._sendEvent({
          event: 'wordTiming',
          wordIndex: i,
          word: words[i].word,
          start: words[i].start,
          end: words[i].end,
        });
        break;
      }
    }
  }, 50);
}

function clearWordTimingLoop() {
  if (wordTimingTimer) {
    clearInterval(wordTimingTimer);
    wordTimingTimer = null;
  }
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
