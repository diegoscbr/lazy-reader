import { fetchElevenLabs } from './content/elevenlabs-api.js';

export async function loadOptionsState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['ttsProvider', 'apiKey', 'cloudVoiceId', 'speed', 'voiceId'],
      (result) => {
        resolve({
          ttsProvider: result.ttsProvider || 'local',
          apiKey: result.apiKey || '',
          cloudVoiceId: result.cloudVoiceId || '',
          speed: result.speed || 1.0,
          voiceId: result.voiceId || '',
        });
      }
    );
  });
}

export async function saveProvider(provider, apiKey, cloudVoiceId) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ ttsProvider: provider, apiKey, cloudVoiceId }, () => {
      sendRuntimeMessage({
        cmd: 'setProvider',
        provider,
        apiKey,
        cloudVoiceId,
      });
      resolve();
    });
  });
}

export async function fetchVoices(apiKey) {
  const result = await fetchVoicesWithStatus(apiKey);
  return result.voices;
}

export function normalizeApiKey(apiKey) {
  const raw = String(apiKey || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.startsWith('sk_')) {
    return raw;
  }

  const bearerMatch = raw.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }

  const match = raw.match(/sk_[^\s"',`}\]]+/);
  return match ? match[0] : raw;
}

export function validateApiKey(apiKey) {
  const trimmed = normalizeApiKey(apiKey);

  if (!trimmed) {
    return 'Enter an ElevenLabs API key first.';
  }
  if (trimmed.length > 256) {
    return 'API key looks too large. Paste only the raw sk_... value.';
  }
  if (trimmed.startsWith('{') || trimmed.includes('"voices"')) {
    return 'This looks like JSON, not an API key. Paste only the raw sk_... value.';
  }
  if (/\s/.test(trimmed)) {
    return 'API key should not contain spaces or line breaks.';
  }
  if (!trimmed.startsWith('sk_')) {
    return 'API key should start with sk_.';
  }

  return '';
}

async function fetchVoicesWithStatus(apiKey) {
  const runtimeResult = await sendRuntimeRequest({
    cmd: 'loadVoices',
    apiKey,
  });

  if (runtimeResult && Array.isArray(runtimeResult.voices)) {
    return {
      voices: runtimeResult.voices,
      error: runtimeResult.error || '',
      status: runtimeResult.status || 0,
    };
  }

  try {
    const response = await fetchElevenLabs('/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    });
    if (!response.ok) {
      return {
        voices: [],
        error: await readErrorMessage(response),
        status: response.status,
      };
    }

    const data = await response.json();
    return {
      voices: data.voices || [],
      error: '',
      status: response.status,
    };
  } catch (err) {
    return {
      voices: [],
      error: err instanceof Error ? err.message : 'Network error while loading voices.',
      status: 0,
    };
  }
}

if (typeof document !== 'undefined' && document.getElementById('provider')) {
  wireOptionsPage();
}

function wireOptionsPage() {
  const providerEl = document.getElementById('provider');
  const cloudFieldsEl = document.getElementById('cloudFields');
  const apiKeyEl = document.getElementById('apiKey');
  const voiceSelectEl = document.getElementById('voiceSelect');
  const loadVoicesBtnEl = document.getElementById('loadVoicesBtn');
  const previewBtnEl = document.getElementById('previewBtn');
  const saveBtnEl = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');

  loadOptionsState().then(async (state) => {
    providerEl.value = state.ttsProvider;
    apiKeyEl.value = normalizeApiKey(state.apiKey);
    toggleCloudFields(state.ttsProvider === 'elevenlabs');

    if (apiKeyEl.value) {
      await loadVoices(state.cloudVoiceId);
    }
  });

  providerEl.addEventListener('change', async () => {
    const isCloud = providerEl.value === 'elevenlabs';
    toggleCloudFields(isCloud);

    if (!isCloud) {
      await saveProvider('local', '', '');
      showStatus('Switched to local voices', 'success');
      resetVoiceSelect('Local voices do not need an API key');
      return;
    }

    if (apiKeyEl.value.trim()) {
      await loadVoices();
    }
  });

  apiKeyEl.addEventListener('input', () => {
    const normalizedKey = normalizeApiKey(apiKeyEl.value);
    if (normalizedKey !== apiKeyEl.value.trim()) {
      apiKeyEl.value = normalizedKey;
    }

    const validationError = validateApiKey(normalizedKey);
    if (!apiKeyEl.value.trim()) {
      resetVoiceSelect('Enter API key first');
      showStatus('', '');
      return;
    }
    if (validationError) {
      resetVoiceSelect('Invalid API key');
      showStatus(validationError, 'error');
      return;
    }
    resetVoiceSelect('Click "Load Voices" to fetch voices');
    showStatus('', '');
  });

  apiKeyEl.addEventListener('change', async () => {
    if (apiKeyEl.value.trim()) {
      apiKeyEl.value = normalizeApiKey(apiKeyEl.value);
      await loadVoices();
    }
  });

  loadVoicesBtnEl.addEventListener('click', async () => {
    apiKeyEl.value = normalizeApiKey(apiKeyEl.value);
    await loadVoices();
  });

  saveBtnEl.addEventListener('click', async () => {
    const provider = providerEl.value;
    const apiKey = normalizeApiKey(apiKeyEl.value);
    const cloudVoiceId = voiceSelectEl.value;

    apiKeyEl.value = apiKey;

    if (provider === 'elevenlabs') {
      const validationError = validateApiKey(apiKey);
      if (validationError) {
        showStatus(validationError, 'error');
        return;
      }
    }

    if (provider === 'elevenlabs' && !cloudVoiceId) {
      showStatus('Please load voices and select one before saving.', 'error');
      return;
    }

    await saveProvider(provider, apiKey, cloudVoiceId);
    showStatus('Settings saved', 'success');
  });

  previewBtnEl.addEventListener('click', async () => {
    const apiKey = normalizeApiKey(apiKeyEl.value);
    const voiceId = voiceSelectEl.value;

    if (!apiKey || !voiceId) {
      return;
    }

    showStatus('Playing preview...', '');

    try {
      const response = await fetchElevenLabs(`/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: 'Hello. This is Lazy Reader using your selected voice.',
          model_id: 'eleven_v3',
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(objectUrl);
      showStatus('', '');
    } catch (err) {
      showStatus(`Preview failed: ${err.message}`, 'error');
    }
  });

  function toggleCloudFields(show) {
    cloudFieldsEl.classList.toggle('visible', show);
  }

  async function loadVoices(selectedVoiceId = '') {
    const apiKey = normalizeApiKey(apiKeyEl.value);
    apiKeyEl.value = apiKey;
    const validationError = validateApiKey(apiKey);
    if (validationError) {
      resetVoiceSelect('Enter API key first');
      showStatus(validationError, 'error');
      return;
    }

    voiceSelectEl.disabled = true;
    voiceSelectEl.innerHTML = '<option value="">Loading voices...</option>';
    previewBtnEl.disabled = true;
    showStatus('Loading voices...', '');

    const { voices, error, status } = await fetchVoicesWithStatus(apiKey);
    if (voices.length === 0) {
      resetVoiceSelect('No voices found');
      showStatus(formatVoiceLoadError(error, status), 'error');
      return;
    }

    voiceSelectEl.innerHTML = voices.map((voice) => {
      const selected = voice.voice_id === selectedVoiceId ? ' selected' : '';
      return `<option value="${voice.voice_id}"${selected}>${voice.name}</option>`;
    }).join('');
    voiceSelectEl.disabled = false;
    previewBtnEl.disabled = false;
    showStatus(`${voices.length} voices loaded`, 'success');
  }

  function resetVoiceSelect(message) {
    voiceSelectEl.disabled = true;
    voiceSelectEl.innerHTML = `<option value="">${message}</option>`;
    previewBtnEl.disabled = true;
  }

  function showStatus(text, type) {
    statusEl.textContent = text;
    statusEl.className = `status${type ? ` ${type}` : ''}`;
  }
}

async function readErrorMessage(response) {
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
    // Ignore JSON parse errors and fall back to status-based messaging.
  }

  return '';
}

function formatVoiceLoadError(error, status) {
  if (status === 401) {
    return 'ElevenLabs rejected this API key (401). Paste a current key and click "Load Voices".';
  }
  if (status === 413) {
    return 'The API key header was too large (413). Paste only the raw sk_... key, not JSON or extra text.';
  }
  if (status > 0) {
    return error || `Failed to load voices (${status}).`;
  }
  if (/proxy unavailable/i.test(error || '')) {
    return error;
  }
  return error || 'Failed to load voices.';
}

function sendRuntimeMessage(message) {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.catch === 'function') {
      void result.catch(() => {});
    }
  } catch {
    // Ignore transient runtime messaging failures from the options page.
  }
}

async function sendRuntimeRequest(message) {
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return result;
  } catch {
    return null;
  }
}
