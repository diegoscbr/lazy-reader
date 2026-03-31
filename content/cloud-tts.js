import { fetchElevenLabs } from './elevenlabs-api.js';

export class ElevenLabsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ElevenLabsError';
    this.status = status;
  }
}

export function mapCharsToWords(alignment) {
  const characters = alignment?.characters;
  const startTimes = alignment?.character_start_times_seconds;
  const endTimes = alignment?.character_end_times_seconds;

  if (!Array.isArray(characters) || characters.length === 0) {
    return Array.isArray(alignment?.words) ? alignment.words : [];
  }

  const words = [];
  let currentWord = '';
  let wordStart = 0;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (typeof ch !== 'string' || /\s/.test(ch)) {
      if (currentWord) {
        words.push({ word: currentWord, start: wordStart, end: wordEnd });
        currentWord = '';
      }
      continue;
    }

    if (!currentWord) {
      wordStart = Number(startTimes?.[i] ?? 0);
    }
    currentWord += ch;
    wordEnd = Number(endTimes?.[i] ?? wordStart);
  }

  if (currentWord) {
    words.push({ word: currentWord, start: wordStart, end: wordEnd });
  }

  return words;
}

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    const detail = payload?.detail;
    if (typeof detail === 'string') return detail;
    if (typeof detail?.message === 'string') return detail.message;
  } catch {
    // Fall through to generic message.
  }

  return `ElevenLabs API error (${response.status})`;
}

export async function fetchCloudSpeech(text, voiceId, apiKey) {
  const response = await fetchElevenLabs(`/v1/text-to-speech/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      output_format: 'mp3_44100_128',
    }),
  });

  if (!response.ok) {
    throw new ElevenLabsError(await readErrorMessage(response), response.status);
  }

  const data = await response.json();

  return {
    audioBase64: data.audio_base64,
    words: mapCharsToWords(data.alignment),
  };
}
