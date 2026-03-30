// background.js — Service worker (TTS controller + script injector)
// All chrome.* listeners at top-level scope to survive MV3 restarts.

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['styles/content.css'],
    });
  } catch (err) {
    console.error('Lazy Reader: Failed to inject scripts', err);
  }
});
