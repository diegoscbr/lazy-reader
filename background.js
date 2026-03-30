// background.js — Service worker: TTS controller + script injector
// All chrome.* listeners registered at top-level scope for MV3 restart survival.

let currentSegments = [];
let currentSegmentIndex = 0;
let currentRate = 1.0;
let activeTabId = null;

// --- Exported handler functions (for testing) ---

export function handleSpeak(segments, tabId) {
  currentSegments = segments;
  currentSegmentIndex = 0;
  activeTabId = tabId;
  speakSegment(currentSegmentIndex);
}

export function handlePause() {
  chrome.tts.pause();
}

export function handleResume() {
  chrome.tts.resume();
}

export function handleStop() {
  chrome.tts.stop();
  currentSegments = [];
  currentSegmentIndex = 0;
  activeTabId = null;
}

export function handleSpeed(rate) {
  currentRate = rate;
}

export function handleSkipForward() {
  if (currentSegmentIndex < currentSegments.length - 1) {
    chrome.tts.stop();
    currentSegmentIndex++;
    sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
    speakSegment(currentSegmentIndex);
  }
}

export function handleSkipBack() {
  if (currentSegmentIndex > 0) {
    chrome.tts.stop();
    currentSegmentIndex--;
    sendToTab({ event: 'segmentChange', segmentIndex: currentSegmentIndex });
    speakSegment(currentSegmentIndex);
  }
}

// --- Internal functions ---

function speakSegment(index) {
  if (index >= currentSegments.length) {
    sendToTab({ event: 'end' });
    handleStop();
    return;
  }
  const segment = currentSegments[index];
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

function sendToTab(msg) {
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, msg).catch(() => {});
  }
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
  switch (msg.cmd) {
    case 'speak': handleSpeak(msg.segments, tabId); break;
    case 'pause': handlePause(); break;
    case 'resume': handleResume(); break;
    case 'stop': handleStop(); break;
    case 'speed': handleSpeed(msg.rate); break;
    case 'skipForward': handleSkipForward(); break;
    case 'skipBack': handleSkipBack(); break;
    case 'keepalive': break;
  }
  sendResponse({ ok: true });
  return false;
});
