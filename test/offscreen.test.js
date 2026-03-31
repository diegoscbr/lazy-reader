import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OffscreenPlayer } from '../offscreen.js';

class MockAudioBufferSourceNode {
  constructor() {
    this.buffer = null;
    this.connect = vi.fn();
    this.start = vi.fn();
    this.stop = vi.fn(() => {
      this.onended?.();
    });
    this.playbackRate = { value: 1.0 };
    this.onended = null;
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
  }

  decodeAudioData(buffer) {
    this.lastDecodedBuffer = buffer;
    return Promise.resolve({
      duration: 2.0,
      length: 88200,
      sampleRate: 44100,
    });
  }

  createBufferSource() {
    const source = new MockAudioBufferSourceNode();
    createdSources.push(source);
    return source;
  }

  close() {
    return Promise.resolve();
  }
}

globalThis.AudioContext = MockAudioContext;

const messageListener = chrome.runtime.onMessage.addListener.mock.calls.at(-1)?.[0];
const createdSources = [];

describe('OffscreenPlayer', () => {
  let player;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    chrome.runtime.sendMessage.mockReset();
    createdSources.length = 0;
    player = new OffscreenPlayer();
  });

  it('decodes base64 audio into an AudioBuffer', async () => {
    await player.loadAudio('AAAA');
    expect(player.audioBuffer).not.toBeNull();
    expect(player.ctx).toBeInstanceOf(MockAudioContext);
  });

  it('creates a buffer source and starts playback', async () => {
    await player.loadAudio('AAAA');
    player.play();
    expect(player.source).not.toBeNull();
    expect(player.source.start).toHaveBeenCalledWith(0, 0);
  });

  it('adjusts the playback rate on the active source', async () => {
    await player.loadAudio('AAAA');
    player.play();
    player.setPlaybackRate(2.0);
    expect(player.source.playbackRate.value).toBe(2.0);
  });

  it('does nothing if no source is playing', () => {
    expect(() => player.setPlaybackRate(2.0)).not.toThrow();
  });

  it('stops the source and resets state', async () => {
    await player.loadAudio('AAAA');
    player.play();
    player.stop();
    expect(player.source).toBeNull();
    expect(player.paused).toBe(false);
  });

  it('does not emit audioEnd when stopped intentionally', async () => {
    await player.loadAudio('AAAA');
    player.play();
    const source = player.source;
    player.stop();
    source.onended?.();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'audioEnd' })
    );
  });

  it('does not emit audioEnd when paused', async () => {
    await player.loadAudio('AAAA');
    player.play();
    const source = player.source;
    player.pause();
    expect(player.paused).toBe(true);
    source.onended?.();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'audioEnd' })
    );
  });

  it('resumes from paused position', async () => {
    await player.loadAudio('AAAA');
    player.play();
    player.pause();
    player.resume();
    expect(player.paused).toBe(false);
    expect(player.source).not.toBeNull();
  });

  it('returns 0 when not playing', () => {
    expect(player.getCurrentTime()).toBe(0);
  });

  it('handles loadAndPlay, pauseAudio, resumeAudio, stopAudio, and setPlaybackRate messages', async () => {
    expect(messageListener).toBeTypeOf('function');

    await messageListener({ cmd: 'loadAndPlay', audioBase64: 'AAAA', words: [] }, {}, vi.fn());
    await vi.runAllTimersAsync();
    expect(createdSources).toHaveLength(1);
    expect(createdSources[0].start).toHaveBeenCalledWith(0, 0);

    await messageListener({ cmd: 'pauseAudio' }, {}, vi.fn());
    expect(createdSources[0].stop).toHaveBeenCalled();

    await messageListener({ cmd: 'resumeAudio' }, {}, vi.fn());
    expect(createdSources).toHaveLength(2);
    expect(createdSources[1].start).toHaveBeenCalledWith(0, 0);

    await messageListener({ cmd: 'setPlaybackRate', rate: 1.5 }, {}, vi.fn());
    expect(createdSources[1].playbackRate.value).toBe(1.5);

    await messageListener({ cmd: 'stopAudio' }, {}, vi.fn());
    expect(createdSources[1].stop).toHaveBeenCalled();
  });
});
