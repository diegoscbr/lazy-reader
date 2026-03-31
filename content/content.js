import { parsePageContent } from './parser.js';
import { TTSClient } from './tts-client.js';
import { Highlighter } from './highlighter.js';
import { Player } from './player.js';
import { loadSettings, saveSettings } from './storage.js';

// Guard against double-injection
if (window.__lazyReaderActive) {
  window.__lazyReaderCleanup?.();
} else {
  init();
}

async function init() {
  window.__lazyReaderActive = true;

  const settings = await loadSettings();
  const segments = parsePageContent(document);

  if (segments.length === 0) {
    showToast('No readable content found on this page.');
    window.__lazyReaderActive = false;
    return;
  }

  const tts = new TTSClient();
  const highlighter = new Highlighter();
  const player = new Player();
  const isCloudConfigured =
    settings.ttsProvider === 'elevenlabs' &&
    Boolean(settings.apiKey) &&
    Boolean(settings.cloudVoiceId);
  const effectiveProvider = isCloudConfigured ? 'elevenlabs' : 'local';

  highlighter.setMode(isCloudConfigured ? 'word' : 'sentence');
  sendRuntimeMessage({
    cmd: 'setProvider',
    provider: settings.ttsProvider,
    apiKey: settings.apiKey,
    cloudVoiceId: settings.cloudVoiceId,
  });

  let currentSegmentIndex = 0;
  let playing = false;

  player.create();
  player.updateState({ playing: false, speed: settings.speed, provider: effectiveProvider });

  // Keyboard shortcuts
  function onKeyDown(e) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (playing) {
        tts.pause();
        playing = false;
      } else {
        tts.resume();
        playing = true;
      }
      player.updateState({ playing });
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // Wire up player callbacks
  player.onPlayPause(() => {
    if (playing) {
      tts.pause();
      playing = false;
    } else {
      if (currentSegmentIndex === 0 && !playing) {
        tts.speak(segments);
        highlighter.highlightSegment(segments[0]);
      } else {
        tts.resume();
      }
      playing = true;
    }
    player.updateState({ playing });
  });

  player.onClose(() => cleanup());
  player.onSkipForward(() => tts.skipForward());
  player.onSkipBack(() => tts.skipBack());
  player.onSpeedChange((speed) => {
    tts.setSpeed(speed);
    saveSettings({ speed });
  });

  // Wire up TTS events
  tts.onEvent((msg) => {
    if (msg.event === 'sentence') {
      highlighter.advanceSentence();
    } else if (msg.event === 'wordTiming') {
      highlighter.advanceToWord(msg.wordIndex);
    } else if (msg.event === 'cloudFallback') {
      showToast(`Cloud voice unavailable: ${msg.message}. Using local voice.`);
      highlighter.cleanup();
      highlighter.setMode('sentence');
      if (currentSegmentIndex < segments.length) {
        highlighter.highlightSegment(segments[currentSegmentIndex]);
      }
      player.updateState({ provider: 'local' });
    } else if (msg.event === 'end') {
      playing = false;
      player.updateState({ playing: false });
      highlighter.cleanup();
    } else if (msg.event === 'error') {
      showToast(`TTS error: ${msg.message}`);
      cleanup();
    }
  });

  tts.onSegmentChange((index) => {
    currentSegmentIndex = index;
    if (index < segments.length) {
      highlighter.highlightSegment(segments[index]);
    }
  });

  // Keepalive ping to prevent background worker suspension
  const keepaliveInterval = setInterval(() => {
    if (playing) {
      sendRuntimeMessage({ cmd: 'keepalive' });
    }
  }, 20000);

  // Page navigation cleanup
  function onPageHide() {
    cleanup();
  }
  window.addEventListener('beforeunload', onPageHide);

  function cleanup() {
    tts.stop();
    tts.destroy();
    highlighter.cleanup();
    player.destroy();
    clearInterval(keepaliveInterval);
    window.removeEventListener('beforeunload', onPageHide);
    document.removeEventListener('keydown', onKeyDown);
    window.__lazyReaderActive = false;
    window.__lazyReaderCleanup = null;
  }

  window.__lazyReaderCleanup = cleanup;

  // Auto-start playback
  tts.speak(segments);
  highlighter.highlightSegment(segments[0]);
  playing = true;
  player.updateState({ playing: true, provider: effectiveProvider });
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 80px; right: 20px; z-index: 2147483647;
    background: rgba(30,30,30,0.92); color: #e0e0e0; padding: 8px 16px;
    border-radius: 6px; font-size: 13px; font-family: monospace;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function sendRuntimeMessage(message) {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === 'function') {
      void result.catch(() => {});
    }
  } catch {
    // Ignore transient extension messaging failures during page teardown/reload.
  }
}
