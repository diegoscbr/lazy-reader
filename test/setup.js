const storage = {};

globalThis.chrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    lastError: null,
  },
  storage: {
    local: {
      get: vi.fn((keys, cb) => {
        if (typeof keys === 'string') keys = [keys];
        const result = {};
        for (const k of keys) {
          if (storage[k] !== undefined) result[k] = storage[k];
        }
        if (cb) cb(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items, cb) => {
        Object.assign(storage, items);
        if (cb) cb();
        return Promise.resolve();
      }),
    },
  },
  tts: {
    speak: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn((cb) => {
      cb([
        { voiceName: 'Samantha', lang: 'en-US', remote: false },
        { voiceName: 'Google US English', lang: 'en-US', remote: true },
      ]);
    }),
    isSpeaking: vi.fn(() => false),
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
  },
  scripting: {
    executeScript: vi.fn(() => Promise.resolve()),
    insertCSS: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    sendMessage: vi.fn(() => Promise.resolve()),
  },
};
