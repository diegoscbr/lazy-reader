import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleSpeak,
  handlePause,
  handleResume,
  handleStop,
  handleSpeed,
  handleSkipForward,
  handleSkipBack,
  handleSetProvider,
  handleLoadVoices,
} from '../background.js';

describe('background TTS controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
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
    // Reset module state
    handleStop();
    handleSetProvider('local', '', '');
  });

  describe('handleSpeak', () => {
    it('calls chrome.tts.speak with the first segment text', () => {
      const segments = [
        { type: 'prose', text: 'Hello world.' },
        { type: 'prose', text: 'Second segment.' },
      ];
      handleSpeak(segments, 1);
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        'Hello world.',
        expect.objectContaining({ rate: 1 }),
        expect.any(Function)
      );
    });
  });

  describe('handlePause', () => {
    it('calls chrome.tts.pause', () => {
      handlePause();
      expect(chrome.tts.pause).toHaveBeenCalled();
    });
  });

  describe('handleResume', () => {
    it('calls chrome.tts.resume', () => {
      handleResume();
      expect(chrome.tts.resume).toHaveBeenCalled();
    });
  });

  describe('handleStop', () => {
    it('calls chrome.tts.stop', () => {
      handleStop();
      expect(chrome.tts.stop).toHaveBeenCalled();
    });
  });

  describe('handleSpeed', () => {
    it('updates the rate for subsequent speaks', () => {
      handleSpeed(2.0);
      const segments = [{ type: 'prose', text: 'Test.' }];
      handleSpeak(segments, 1);
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        'Test.',
        expect.objectContaining({ rate: 2.0 }),
        expect.any(Function)
      );
    });
  });

  describe('cloud TTS routing', () => {
    it('does not call chrome.tts.speak when provider is elevenlabs', async () => {
      handleSetProvider('elevenlabs', 'sk-key', 'voice123');
      const segments = [{ type: 'prose', text: 'Hello.' }];
      handleSpeak(segments, 1);
      await Promise.resolve();
      expect(chrome.tts.speak).not.toHaveBeenCalled();
      expect(chrome.offscreen.createDocument).toHaveBeenCalled();
    });

    it('falls back to local when provider is local', () => {
      handleSetProvider('local', '', '');
      const segments = [{ type: 'prose', text: 'Hello.' }];
      handleSpeak(segments, 1);
      expect(chrome.tts.speak).toHaveBeenCalled();
    });

    it('routes pause, resume, and speed to offscreen during cloud playback', async () => {
      handleSetProvider('elevenlabs', 'sk-key', 'voice123');
      handleSpeak([{ type: 'prose', text: 'Hello.' }], 1);
      await Promise.resolve();

      vi.clearAllMocks();
      handlePause();
      handleResume();
      handleSpeed(1.5);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ cmd: 'pauseAudio' });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ cmd: 'resumeAudio' });
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ cmd: 'setPlaybackRate', rate: 1.5 });
    });
  });

  describe('handleLoadVoices', () => {
    it('returns voices from ElevenLabs via the background worker', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          voices: [{ voice_id: 'voice123', name: 'Roger' }],
        }),
      });

      const result = await handleLoadVoices('sk-key');

      expect(result).toEqual({
        ok: true,
        voices: [{ voice_id: 'voice123', name: 'Roger' }],
        error: '',
        status: 200,
      });
    });
  });

  describe('handleSkipForward', () => {
    it('stops current speech and moves to next segment', () => {
      const segments = [
        { type: 'prose', text: 'First.' },
        { type: 'prose', text: 'Second.' },
      ];
      handleSpeak(segments, 1);
      vi.clearAllMocks();
      handleSkipForward();
      expect(chrome.tts.stop).toHaveBeenCalled();
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        'Second.',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('does nothing when on the last segment', () => {
      const segments = [{ type: 'prose', text: 'Only one.' }];
      handleSpeak(segments, 1);
      vi.clearAllMocks();
      handleSkipForward();
      expect(chrome.tts.speak).not.toHaveBeenCalled();
    });
  });

  describe('handleSkipBack', () => {
    it('stops current speech and moves to previous segment', () => {
      const segments = [
        { type: 'prose', text: 'First.' },
        { type: 'prose', text: 'Second.' },
      ];
      handleSpeak(segments, 1);
      // Manually advance to segment 1
      handleSkipForward();
      vi.clearAllMocks();
      handleSkipBack();
      expect(chrome.tts.stop).toHaveBeenCalled();
      expect(chrome.tts.speak).toHaveBeenCalledWith(
        'First.',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('does nothing when on the first segment', () => {
      const segments = [{ type: 'prose', text: 'First.' }];
      handleSpeak(segments, 1);
      vi.clearAllMocks();
      handleSkipBack();
      expect(chrome.tts.speak).not.toHaveBeenCalled();
    });
  });
});
