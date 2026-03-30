import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Player } from '../content/player.js';

describe('Player', () => {
  let player;

  beforeEach(() => {
    document.body.innerHTML = '';
    player = new Player();
  });

  afterEach(() => {
    player.destroy();
  });

  describe('create', () => {
    it('injects a Shadow DOM host into document.body', () => {
      player.create();
      const host = document.querySelector('#lazy-reader-player');
      expect(host).not.toBeNull();
      expect(host.shadowRoot).not.toBeNull();
    });

    it('renders play/pause, skip back, skip forward, speed, and close controls', () => {
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      expect(shadow.querySelector('[data-action="playpause"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="skipback"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="skipforward"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="speed"]')).not.toBeNull();
      expect(shadow.querySelector('[data-action="close"]')).not.toBeNull();
    });
  });

  describe('callbacks', () => {
    it('calls onPlayPause when play/pause is clicked', () => {
      const cb = vi.fn();
      player.onPlayPause(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="playpause"]').click();
      expect(cb).toHaveBeenCalled();
    });

    it('calls onClose when close is clicked', () => {
      const cb = vi.fn();
      player.onClose(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="close"]').click();
      expect(cb).toHaveBeenCalled();
    });

    it('calls onSkipForward when skip forward is clicked', () => {
      const cb = vi.fn();
      player.onSkipForward(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="skipforward"]').click();
      expect(cb).toHaveBeenCalled();
    });

    it('calls onSkipBack when skip back is clicked', () => {
      const cb = vi.fn();
      player.onSkipBack(cb);
      player.create();
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      shadow.querySelector('[data-action="skipback"]').click();
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('updateState', () => {
    it('shows pause icon when playing', () => {
      player.create();
      player.updateState({ playing: true });
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      const btn = shadow.querySelector('[data-action="playpause"]');
      expect(btn.textContent).toContain('⏸');
    });

    it('shows play icon when paused', () => {
      player.create();
      player.updateState({ playing: false });
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      const btn = shadow.querySelector('[data-action="playpause"]');
      expect(btn.textContent).toContain('▶');
    });

    it('updates speed display', () => {
      player.create();
      player.updateState({ speed: 2.0 });
      const shadow = document.querySelector('#lazy-reader-player').shadowRoot;
      const speedEl = shadow.querySelector('[data-action="speed"]');
      expect(speedEl.textContent).toContain('2.0x');
    });
  });

  describe('destroy', () => {
    it('removes the player from the DOM', () => {
      player.create();
      expect(document.querySelector('#lazy-reader-player')).not.toBeNull();
      player.destroy();
      expect(document.querySelector('#lazy-reader-player')).toBeNull();
    });
  });
});
