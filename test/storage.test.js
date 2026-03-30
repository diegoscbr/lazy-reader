import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../content/storage.js';

describe('storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DEFAULT_SETTINGS', () => {
    it('has expected defaults', () => {
      expect(DEFAULT_SETTINGS).toEqual({
        speed: 1.0,
        voiceId: '',
        ttsProvider: 'local',
      });
    });
  });

  describe('loadSettings', () => {
    it('returns defaults when storage is empty', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({});
        return Promise.resolve({});
      });
      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('merges stored values with defaults', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ speed: 2.0 });
        return Promise.resolve({ speed: 2.0 });
      });
      const settings = await loadSettings();
      expect(settings.speed).toBe(2.0);
      expect(settings.voiceId).toBe('');
      expect(settings.ttsProvider).toBe('local');
    });
  });

  describe('saveSettings', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('writes partial settings to storage after debounce', async () => {
      chrome.storage.local.set.mockImplementation((items, cb) => {
        if (cb) cb();
        return Promise.resolve();
      });
      const promise = saveSettings({ speed: 1.5 });
      vi.advanceTimersByTime(300);
      await promise;
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { speed: 1.5 },
        expect.any(Function)
      );
    });

    it('logs error but resolves on storage failure', async () => {
      chrome.storage.local.set.mockImplementation((items, cb) => {
        chrome.runtime.lastError = { message: 'Quota exceeded' };
        if (cb) cb();
        chrome.runtime.lastError = null;
        return Promise.resolve();
      });
      const promise = saveSettings({ speed: 1.5 });
      vi.advanceTimersByTime(300);
      await expect(promise).resolves.not.toThrow();
    });
  });
});
