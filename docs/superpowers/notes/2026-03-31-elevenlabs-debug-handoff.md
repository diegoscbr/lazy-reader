# ElevenLabs Debug Handoff

Date: 2026-03-31
Repo: `/Users/diegoescobar/Workshop/lazy-reader`

## Current State

- Lazy Reader cloud TTS support is implemented.
- The Chrome extension options page can load/save ElevenLabs settings.
- A local relay was added for ElevenLabs requests:
  - `npm run proxy:elevenlabs`
  - serves on `http://127.0.0.1:8787`
- The extension now prefers the local relay for:
  - `GET /v1/voices`
  - `POST /v1/text-to-speech/...`
  - `POST /v1/text-to-speech/.../with-timestamps`

## Confirmed Findings

1. The extension is reaching the local proxy.
2. The proxy logs show requests like:

```text
[proxy] GET /v1/voices key=sk_d71...f971
[proxy] -> 401 /v1/voices
```

3. So the proxy/domain problem is solved.
4. ElevenLabs is returning `401` for `/v1/voices` with the forwarded key.
5. Earlier terminal testing showed `POST /v1/text-to-speech/...` succeeded with a key.
6. That means the unresolved issue is now specifically about key/account/request behavior for `/v1/voices`, not Chrome extension networking.

## Important Security Note

- The ElevenLabs key was exposed multiple times during debugging.
- That key should be considered compromised.
- Rotate it before doing any further tests.

## Code Changes Already Made

### Options / Key Handling

- [options.js](/Users/diegoescobar/Workshop/lazy-reader/options.js)
  - added `Load Voices`
  - improved status/error handling
  - normalizes pasted API keys
  - routes voice loading through the background worker
  - now surfaces proxy-unavailable errors

- [options.html](/Users/diegoescobar/Workshop/lazy-reader/options.html)
  - cloud settings UI
  - voice load / preview / save controls

### Background / Cloud TTS

- [background.js](/Users/diegoescobar/Workshop/lazy-reader/background.js)
  - cloud/local provider routing
  - `loadVoices` runtime handler
  - offscreen playback integration

- [content/cloud-tts.js](/Users/diegoescobar/Workshop/lazy-reader/content/cloud-tts.js)
  - ElevenLabs `/with-timestamps` requests
  - word timing mapping

- [content/elevenlabs-api.js](/Users/diegoescobar/Workshop/lazy-reader/content/elevenlabs-api.js)
  - localhost-first fetch helper
  - currently throws if proxy is unavailable

### Proxy

- [scripts/elevenlabs-proxy.mjs](/Users/diegoescobar/Workshop/lazy-reader/scripts/elevenlabs-proxy.mjs)
  - local HTTP relay on `127.0.0.1:8787`
  - forwards ElevenLabs headers/body
  - logs masked key fingerprint and upstream status

### Manifest / Docs

- [manifest.json](/Users/diegoescobar/Workshop/lazy-reader/manifest.json)
  - includes `http://127.0.0.1:8787/*` host permission

- [README.md](/Users/diegoescobar/Workshop/lazy-reader/README.md)
  - documents the relay startup command

## Verification Already Completed

- `npx vitest run test/options.test.js test/background.test.js test/cloud-tts.test.js`
- `npm run build`
- `node --check scripts/elevenlabs-proxy.mjs`

All of the above were passing at the end of the session.

## Most Likely Remaining Possibilities

1. The exact key used for successful TTS is not the same key being used for `/v1/voices`.
2. The key was rotated/revoked between tests.
3. The key is accepted for TTS but rejected for `/v1/voices`.
4. Hidden characters or workspace/account mismatch still exist in one of the test paths.

## Exact Next Steps

### 1. Rotate Key

- Create a brand-new ElevenLabs key.
- Do not paste it into chat, screenshots, or committed files.

### 2. Start Proxy

```bash
npm run proxy:elevenlabs
```

Keep that terminal open.

### 3. Reinstall Extension Cleanly

1. Open `chrome://extensions`
2. Remove `Lazy Reader`
3. Load unpacked again from `/Users/diegoescobar/Workshop/lazy-reader`
4. Open the options page

### 4. Run These 3 Curl Checks

#### Direct voices

```bash
curl -i "https://api.elevenlabs.io/v1/voices" \
  -H "xi-api-key: YOUR_NEW_KEY_HERE"
```

#### Direct TTS

```bash
curl -i "https://api.elevenlabs.io/v1/text-to-speech/CwhRBWXzGAHq8TQ4Fs17" \
  -H "xi-api-key: YOUR_NEW_KEY_HERE" \
  -H "Content-Type: application/json" \
  -H "Accept: audio/mpeg" \
  --data '{"text":"Hello world","model_id":"eleven_v3"}' \
  --output hello-world.mp3
```

#### Proxy voices

```bash
curl -i "http://127.0.0.1:8787/v1/voices" \
  -H "xi-api-key: YOUR_NEW_KEY_HERE"
```

### 5. Interpret Results

- Direct `voices` = `200`, proxy `voices` = `200`
  - extension should work

- Direct `voices` = `200`, proxy `voices` = `401`
  - proxy forwarding bug

- Direct `voices` = `401`, proxy `voices` = `401`, direct TTS = `200`
  - key/account accepted for TTS but rejected for `voices`

- Direct `voices` = `401`, direct TTS = `401`
  - bad/revoked/wrong-workspace key

### 6. Browser Retest

1. Paste the same fresh raw key into the extension options page
2. Click `Load Voices`
3. Watch the proxy log output

Expected proxy log:

```text
[proxy] GET /v1/voices key=sk_123...abcd
[proxy] -> 200 /v1/voices
```

## Best Resume Point

When resuming, start from:

1. key rotation
2. the 3 curl checks
3. compare those statuses against the proxy log

That will reveal whether the remaining bug is:
- ElevenLabs key/account behavior
- proxy forwarding
- or extension-side key mismatch
