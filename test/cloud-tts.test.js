import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ElevenLabsError, fetchCloudSpeech, mapCharsToWords } from '../content/cloud-tts.js';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('cloud-tts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('mapCharsToWords', () => {
    it('groups characters into words using whitespace boundaries', () => {
      const words = mapCharsToWords({
        characters: ['H', 'i', ' ', 'y', 'o'],
        character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4],
        character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5],
      });

      expect(words).toEqual([
        { word: 'Hi', start: 0, end: 0.2 },
        { word: 'yo', start: 0.3, end: 0.5 },
      ]);
    });

    it('returns provided words when character alignment is missing', () => {
      const words = mapCharsToWords({
        words: [{ word: 'Hello', start: 0, end: 1 }],
      });

      expect(words).toEqual([{ word: 'Hello', start: 0, end: 1 }]);
    });
  });

  describe('fetchCloudSpeech', () => {
    it('calls ElevenLabs with the expected request shape', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          audio_base64: 'AAAA',
          alignment: {
            characters: ['H', 'i'],
            character_start_times_seconds: [0, 0.1],
            character_end_times_seconds: [0.1, 0.2],
          },
        }),
      });

      await fetchCloudSpeech('Hi', 'voice123', 'sk-key');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8787/v1/text-to-speech/voice123/with-timestamps',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'xi-api-key': 'sk-key',
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }),
        })
      );

      const request = mockFetch.mock.calls[0][1];
      expect(JSON.parse(request.body)).toEqual({
        text: 'Hi',
        model_id: 'eleven_v3',
        output_format: 'mp3_44100_128',
      });
    });

    it('returns audio data and mapped word timestamps', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          audio_base64: 'base64audiodata',
          alignment: {
            characters: ['T', 'e', 's', 't'],
            character_start_times_seconds: [0, 0.1, 0.2, 0.3],
            character_end_times_seconds: [0.1, 0.2, 0.3, 0.4],
          },
        }),
      });

      const result = await fetchCloudSpeech('Test', 'v1', 'key');

      expect(result).toEqual({
        audioBase64: 'base64audiodata',
        words: [{ word: 'Test', start: 0, end: 0.4 }],
      });
    });

    it('maps multi-word character alignment to words', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          audio_base64: 'AAAA',
          alignment: {
            characters: ['H', 'i', ' ', 'y', 'o'],
            character_start_times_seconds: [0, 0.05, 0.1, 0.15, 0.2],
            character_end_times_seconds: [0.05, 0.1, 0.15, 0.2, 0.3],
          },
        }),
      });

      const result = await fetchCloudSpeech('Hi yo', 'v1', 'key');

      expect(result.words).toEqual([
        { word: 'Hi', start: 0, end: 0.1 },
        { word: 'yo', start: 0.15, end: 0.3 },
      ]);
    });

    it('throws ElevenLabsError on API errors with parsed detail messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ detail: { message: 'Invalid API key' } }),
      });

      const promise = fetchCloudSpeech('Hi', 'v1', 'bad-key');
      await expect(promise).rejects.toBeInstanceOf(ElevenLabsError);
      await expect(promise).rejects.toThrow(/Invalid API key/);
    });

    it('throws ElevenLabsError on rate limits', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ detail: { message: 'Rate limit exceeded' } }),
      });

      await expect(fetchCloudSpeech('Hi', 'v1', 'key')).rejects.toBeInstanceOf(ElevenLabsError);
    });

    it('propagates network failures', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Proxy unavailable'));

      await expect(fetchCloudSpeech('Hi', 'v1', 'key')).rejects.toThrow(/proxy unavailable/i);
    });
  });
});
