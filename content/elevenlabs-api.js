const REMOTE_BASE = 'https://api.elevenlabs.io';
const LOCAL_PROXY_BASE = 'http://127.0.0.1:8787';

export async function fetchElevenLabs(path, init = {}) {
  try {
    return await fetch(`${LOCAL_PROXY_BASE}${path}`, init);
  } catch {
    const error = new Error(
      'Lazy Reader proxy unavailable. Start `npm run proxy:elevenlabs` and reload the extension.'
    );
    error.code = 'LAZY_READER_PROXY_UNAVAILABLE';
    error.proxyUrl = `${LOCAL_PROXY_BASE}${path}`;
    error.remoteUrl = `${REMOTE_BASE}${path}`;
    throw error;
  }
}
