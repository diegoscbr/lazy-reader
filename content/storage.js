export const DEFAULT_SETTINGS = Object.freeze({
  speed: 1.0,
  voiceId: '',
  ttsProvider: 'local',
  apiKey: '',
  cloudVoiceId: '',
});

export function loadSettings() {
  return new Promise((resolve) => {
    const keys = Object.keys(DEFAULT_SETTINGS);
    chrome.storage.local.get(keys, (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...result });
    });
  });
}

let saveTimer = null;

export function saveSettings(partial) {
  clearTimeout(saveTimer);
  return new Promise((resolve) => {
    saveTimer = setTimeout(() => {
      chrome.storage.local.set(partial, () => {
        if (chrome.runtime.lastError) {
          console.error('Lazy Reader: storage write failed', chrome.runtime.lastError.message);
        }
        resolve();
      });
    }, 300);
  });
}
