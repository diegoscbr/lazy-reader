import { fetchCloudSpeech } from './content/cloud-tts.js';
import { fetchElevenLabs } from './content/elevenlabs-api.js';

// background.js — Service worker: TTS controller + script injector
// All chrome.* listeners registered at top-level scope for MV3 restart survival.

let currentSegments = [];
let currentSegmentIndex = 0;
let currentRate = 1.0;
let activeTabId = null;
let currentProvider = 'local';
let currentApiKey = '';
let currentCloudVoiceId = '';
let currentPlaybackMode = 'local';

// --- Exported handler functions (for testing) ---

export function handleSpeak(segments, tabId) {
  currentSegments = segments;
  currentSegmentIndex = 0;
  activeTabId = tabId;
  speakSegment(currentSegmentIndex);
}

export function handlePause() {
  if (currentPlaybackMode === 'cloud') {
    void sendOffscreenCommand('pauseAudio');
    return;
  }
  chrome.tts.pause();
}

export function handleResume() {
  if (currentPlaybackMode === 'cloud') {
    void sendOffscreenCommand('resumeAudio');
    return;
  }
  chrome.tts.resume();
}

export function handleStop() {
  if (currentPlaybackMode === 'cloud') {
    void sendOffscreenCommand('stopAudio');
  }
  chrome.tts.stop();
  currentSegments = [];
  currentSegmentIndex = 0;
  activeTabId = null;
  currentPlaybackMode = 'local';
}

export function handleSpeed(rate) {
  currentRate = rate;
  if (currentPlaybackMode === 'cloud') {
    void sendOffscreenCommand('setPlaybackRate', { rate });
  }
}

export function handleSkipForward() {
  if (currentSegmentIndex < currentSegments.length - 1) {
    stopCurrentPlayback();
    currentSegmentIndex++;
    sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
    speakSegment(currentSegmentIndex);
  }
}

export function handleSkipBack() {
  if (currentSegmentIndex > 0) {
    stopCurrentPlayback();
    currentSegmentIndex--;
    sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
    speakSegment(currentSegmentIndex);
  }
}

export function handleSetProvider(provider, apiKey, cloudVoiceId) {
  currentProvider = provider === 'elevenlabs' ? 'elevenlabs' : 'local';
  currentApiKey = apiKey || '';
  currentCloudVoiceId = cloudVoiceId || '';
}

export async function handleLoadVoices(apiKey) {
  try {
    const response = await fetchElevenLabs('/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });

    if (!response.ok) {
      return {
        ok: false,
        voices: [],
        error: await readApiError(response),
        status: response.status,
      };
    }

    const data = await response.json();
    return {
      ok: true,
      voices: data.voices || [],
      error: '',
      status: response.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error while loading voices.';
    return {
      ok: false,
      voices: [],
      error: message,
      status: 0,
    };
  }
}

// --- Internal functions ---

async function speakSegment(index) {
  if (index >= currentSegments.length) {
    sendToTab({ event: 'end' });
    handleStop();
    return;
  }

  const segment = currentSegments[index];

  if (shouldUseCloud()) {
    await speakCloudSegment(segment);
    return;
  }

  speakLocalSegment(segment);
}

function speakLocalSegment(segment) {
  currentPlaybackMode = 'local';
  chrome.tts.speak(segment.text, {
    rate: currentRate,
    onEvent: (ttsEvent) => {
      if (ttsEvent.type === 'word') {
        sendToTab({ event: 'word', charIndex: ttsEvent.charIndex });
      } else if (ttsEvent.type === 'sentence') {
        sendToTab({ event: 'sentence', charIndex: ttsEvent.charIndex });
      } else if (ttsEvent.type === 'end') {
        currentSegmentIndex++;
        if (currentSegmentIndex < currentSegments.length) {
          sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
          speakSegment(currentSegmentIndex);
        } else {
          sendToTab({ event: 'end' });
          handleStop();
        }
      } else if (ttsEvent.type === 'error') {
        console.error('Lazy Reader TTS error:', ttsEvent.errorMessage);
        sendToTab({ event: 'error', message: ttsEvent.errorMessage });
      }
    },
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Lazy Reader: TTS speak failed', chrome.runtime.lastError.message);
    }
  });
}

async function speakCloudSegment(segment) {
  try {
    currentPlaybackMode = 'cloud';
    await ensureOffscreenDocument();
    const { audioBase64, words } = await fetchCloudSpeech(
      segment.text,
      currentCloudVoiceId,
      currentApiKey
    );

    sendToTab({ event: 'cloudSegmentStart', words });
    await sendOffscreenCommand('loadAndPlay', {
      audioBase64,
      words,
      rate: currentRate,
    });
  } catch (err) {
    currentPlaybackMode = 'local';
    console.error('Lazy Reader: Cloud TTS failed, falling back to local', err);
    sendToTab({ event: 'cloudFallback', message: err.message || 'Cloud playback failed' });
    speakLocalSegment(segment);
  }
}

function shouldUseCloud() {
  return currentProvider === 'elevenlabs' && Boolean(currentApiKey) && Boolean(currentCloudVoiceId);
}

async function ensureOffscreenDocument() {
  const getContexts = chrome.runtime.getContexts?.bind(chrome.runtime);
  const contexts = getContexts
    ? await getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    : [];

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Playing cloud TTS audio',
  });
}

function stopCurrentPlayback() {
  if (currentPlaybackMode === 'cloud') {
    void sendOffscreenCommand('stopAudio');
    return;
  }
  chrome.tts.stop();
}

function sendOffscreenCommand(cmd, extras = {}) {
  return sendRuntimeMessage({ cmd, ...extras });
}

function sendRuntimeMessage(message) {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === 'function') {
      return result.catch(() => {});
    }
    return Promise.resolve(result);
  } catch {
    return Promise.resolve();
  }
}

function sendToTab(msg) {
  if (activeTabId !== null) {
    chrome.tabs.sendMessage(activeTabId, msg).catch(() => {});
  }
}

async function readApiError(response) {
  try {
    const payload = await response.json();
    const detail = payload?.detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (typeof detail?.message === 'string') {
      return detail.message;
    }
  } catch {
    // Ignore response parsing errors and fall back to status handling.
  }

  return '';
}

// --- Chrome event listeners (top-level scope) ---

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/content.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['dist/content.js'],
    });
  } catch (err) {
    console.error('Lazy Reader: Failed to inject scripts', err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (msg.cmd === 'loadVoices') {
    void handleLoadVoices(msg.apiKey || '').then(sendResponse);
    return true;
  }

  switch (msg.cmd || msg.event) {
    case 'speak': handleSpeak(msg.segments, tabId); break;
    case 'pause': handlePause(); break;
    case 'resume': handleResume(); break;
    case 'stop': handleStop(); break;
    case 'speed': handleSpeed(msg.rate); break;
    case 'skipForward': handleSkipForward(); break;
    case 'skipBack': handleSkipBack(); break;
    case 'setProvider': handleSetProvider(msg.provider, msg.apiKey, msg.cloudVoiceId); break;
    case 'wordTiming':
      sendToTab(msg);
      break;
    case 'audioEnd':
      currentSegmentIndex++;
      if (currentSegmentIndex < currentSegments.length) {
        sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
        speakSegment(currentSegmentIndex);
      } else {
        sendToTab({ event: 'end' });
        handleStop();
      }
      break;
    case 'keepalive': break;
  }
  sendResponse({ ok: true });
  return false;
});
