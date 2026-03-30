import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TTSClient } from '../content/tts-client.js';

describe('TTSClient', () => {
  let client;

  beforeEach(() => {
    vi.clearAllMocks();
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (cb) cb({ ok: true });
    });
    client = new TTSClient();
  });

  describe('speak', () => {
    it('sends speak command with segments to background', () => {
      const segments = [{ type: 'prose', text: 'Hello world' }];
      client.speak(segments);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speak', segments },
        expect.any(Function)
      );
    });
  });

  describe('pause', () => {
    it('sends pause command', () => {
      client.pause();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'pause' },
        expect.any(Function)
      );
    });
  });

  describe('resume', () => {
    it('sends resume command', () => {
      client.resume();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'resume' },
        expect.any(Function)
      );
    });
  });

  describe('stop', () => {
    it('sends stop command', () => {
      client.stop();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'stop' },
        expect.any(Function)
      );
    });
  });

  describe('setSpeed', () => {
    it('sends speed command with rate', () => {
      client.setSpeed(2.0);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speed', rate: 2.0 },
        expect.any(Function)
      );
    });

    it('clamps speed to max 3.0', () => {
      client.setSpeed(5.0);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speed', rate: 3.0 },
        expect.any(Function)
      );
    });

    it('clamps speed to min 0.5', () => {
      client.setSpeed(0.1);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'speed', rate: 0.5 },
        expect.any(Function)
      );
    });
  });

  describe('skipForward', () => {
    it('sends skipForward command', () => {
      client.skipForward();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'skipForward' },
        expect.any(Function)
      );
    });
  });

  describe('skipBack', () => {
    it('sends skipBack command', () => {
      client.skipBack();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        { cmd: 'skipBack' },
        expect.any(Function)
      );
    });
  });

  describe('event listener', () => {
    it('registers message listener on construction', () => {
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('calls onEvent callback when background sends event', () => {
      const callback = vi.fn();
      client.onEvent(callback);
      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ event: 'word', charIndex: 5 });
      expect(callback).toHaveBeenCalledWith({ event: 'word', charIndex: 5 });
    });

    it('calls onSegmentChange when segment changes', () => {
      const callback = vi.fn();
      client.onSegmentChange(callback);
      const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      listener({ event: 'segmentChange', segmentIndex: 2 });
      expect(callback).toHaveBeenCalledWith(2);
    });
  });

  describe('destroy', () => {
    it('removes message listener', () => {
      client.destroy();
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalled();
    });
  });
});
