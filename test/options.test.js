import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadOptionsState,
  saveProvider,
  fetchVoices,
  normalizeApiKey,
  validateApiKey,
} from '../options.js';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      cb({});
      return Promise.resolve({});
    });
    chrome.storage.local.set.mockImplementation((items, cb) => {
      if (cb) cb();
      return Promise.resolve();
    });
  });

  describe('loadOptionsState', () => {
    it('returns current settings', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ ttsProvider: 'elevenlabs', apiKey: 'sk-test', cloudVoiceId: 'v1' });
        return Promise.resolve();
      });

      const state = await loadOptionsState();

      expect(state.ttsProvider).toBe('elevenlabs');
      expect(state.apiKey).toBe('sk-test');
      expect(state.cloudVoiceId).toBe('v1');
    });
  });

  describe('saveProvider', () => {
    it('saves provider settings and notifies background', async () => {
      await saveProvider('elevenlabs', 'sk-key', 'voice1');

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { ttsProvider: 'elevenlabs', apiKey: 'sk-key', cloudVoiceId: 'voice1' },
        expect.any(Function)
      );
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        cmd: 'setProvider',
        provider: 'elevenlabs',
        apiKey: 'sk-key',
        cloudVoiceId: 'voice1',
      });
    });
  });

  describe('fetchVoices', () => {
    it('prefers the background worker response when available', async () => {
      chrome.runtime.sendMessage.mockResolvedValueOnce({
        ok: true,
        voices: [{ voice_id: 'v1', name: 'Roger' }],
        error: '',
        status: 200,
      });

      const voices = await fetchVoices('sk-key');

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        cmd: 'loadVoices',
        apiKey: 'sk-key',
      });
      expect(voices).toEqual([{ voice_id: 'v1', name: 'Roger' }]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns voices from ElevenLabs API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          voices: [
            { voice_id: 'v1', name: 'Rachel' },
            { voice_id: 'v2', name: 'Adam' },
          ],
        }),
      });

      const voices = await fetchVoices('sk-key');
      expect(voices).toHaveLength(2);
      expect(voices[0].name).toBe('Rachel');
    });

    it('returns empty array on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const voices = await fetchVoices('bad-key');
      expect(voices).toEqual([]);
    });

    it('returns empty array on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network down'));
      const voices = await fetchVoices('bad-key');
      expect(voices).toEqual([]);
    });
  });

  describe('validateApiKey', () => {
    it('normalizes a pasted blob down to the raw key', () => {
      expect(normalizeApiKey('Bearer sk_test_123\n{"voices":[]}')).toBe('sk_test_123');
    });

    it('preserves full keys with punctuation', () => {
      expect(normalizeApiKey('sk_test-123_abc.def+/=')).toBe('sk_test-123_abc.def+/=');
    });

    it('extracts full keys with punctuation from wrappers', () => {
      expect(normalizeApiKey('{"apiKey":"sk_test-123_abc.def+/="}')).toBe(
        'sk_test-123_abc.def+/='
      );
    });

    it('accepts a normalized ElevenLabs key', () => {
      expect(validateApiKey('Bearer sk_test_123')).toBe('');
    });

    it('accepts a normal-looking ElevenLabs key', () => {
      expect(validateApiKey('sk_test_123')).toBe('');
    });

    it('accepts keys with punctuation', () => {
      expect(validateApiKey('sk_test-123_abc.def+/=')).toBe('');
    });

    it('rejects oversized values', () => {
      expect(validateApiKey(`sk_${'x'.repeat(300)}`)).toMatch(/too large/i);
    });

    it('rejects pasted JSON', () => {
      expect(validateApiKey('{"voices":[]}')).toMatch(/json/i);
    });
  });
});
