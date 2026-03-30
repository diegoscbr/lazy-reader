import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleSpeak,
  handlePause,
  handleResume,
  handleStop,
  handleSpeed,
  handleSkipForward,
  handleSkipBack,
} from '../background.js';

describe('background TTS controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state
    handleStop();
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
